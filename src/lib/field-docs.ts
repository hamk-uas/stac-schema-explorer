import type { FieldSchemaRef } from './fields';
import type { Json } from './model';
import type { SchemaStore } from './schemas';

export interface ValueDoc {
    value: Json;
    title?: string;
    description?: string;
}

/** What a field means, as documented in its JSON Schema. */
export interface FieldDoc {
    title?: string;
    description?: string;
    /** Readable type computed from the schema, e.g. `array of (string or null)`. */
    type: string;
    /** Allowed values, when the schema lists them. */
    values?: ValueDoc[];
    /** Where the field is defined: `<schema url>#<pointer>`. */
    definedAt: string;
}

type Schema = Record<string, unknown>;
interface Located {
    node: Schema;
    url: string;
}

const ANNOTATIONS = new Set(['title', 'description', '$comment']);

function isSchema(value: unknown): value is Schema {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deref(store: SchemaStore, ref: string, base: string): Located | undefined {
    const target = new URL(ref, store.baseOf(base));
    const pointer = decodeURIComponent(target.hash.slice(1));
    target.hash = '';
    const node = store.resolveAt(target.toString(), pointer);
    return isSchema(node) ? { node, url: target.toString() } : undefined;
}

/** A `$ref`-only or single-`allOf` node and the definitions it points to, nearest first. */
function chain(store: SchemaStore, start: Located): Located[] {
    const out = [start];
    for (let depth = 0; depth < 8; depth++) {
        const { node, url } = out[out.length - 1];
        const keys = Object.keys(node).filter((key) => !ANNOTATIONS.has(key));
        let ref: string | undefined;
        if (keys.length === 1 && typeof node.$ref === 'string') ref = node.$ref;
        else if (keys.length === 1 && Array.isArray(node.allOf) && node.allOf.length === 1 && isSchema(node.allOf[0]) && typeof node.allOf[0].$ref === 'string' && Object.keys(node.allOf[0]).length === 1) {
            ref = node.allOf[0].$ref;
        }
        const next = ref ? deref(store, ref, url) : undefined;
        if (!next) break;
        out.push(next);
    }
    return out;
}

/** Allowed values of a value list (`oneOf`/`anyOf` of titled constants, also nested in a branch) or `enum`. */
export function valuesOf(node: Schema): ValueDoc[] | undefined {
    for (const keyword of ['oneOf', 'anyOf']) {
        const list = node[keyword];
        if (Array.isArray(list) && list.length > 0 && list.every((b) => isSchema(b) && 'const' in b)) {
            return list.map((b) => ({ value: (b as Schema).const as Json, title: (b as Schema).title as string | undefined, description: (b as Schema).description as string | undefined }));
        }
    }
    if (Array.isArray(node.enum)) return node.enum.map((value) => ({ value: value as Json }));
    for (const keyword of ['oneOf', 'anyOf']) {
        const list = node[keyword];
        if (!Array.isArray(list)) continue;
        const nested = list.filter(isSchema).flatMap((b) => valuesOf(b) ?? []);
        if (nested.length) return nested;
    }
    return undefined;
}

function join(parts: string[]): string {
    const unique = [...new Set(parts.filter(Boolean))];
    return unique.length > 1 ? unique.join(' or ') : (unique[0] ?? 'any');
}

function wrap(text: string): string {
    return text.includes(' or ') || text.includes(',') ? `(${text})` : text;
}

/** A short readable type: `string`, `array of number`, `object: name → Dimension Object`, `string (date-time)`, … */
export function typeText(store: SchemaStore, located: Located, depth = 0): string {
    if (depth > 4) return '…';
    const links = chain(store, located);
    const { node, url } = links[links.length - 1];
    const named = depth > 0 ? links.map((l) => l.node.title).find((t): t is string => typeof t === 'string' && /object$/i.test(t)) : undefined;
    if (named) return named;

    if ('const' in node) return JSON.stringify(node.const);
    const types = Array.isArray(node.type) ? (node.type as string[]) : typeof node.type === 'string' ? [node.type] : [];
    const list = (['oneOf', 'anyOf'] as const).map((k) => node[k]).find((l): l is Schema[] => Array.isArray(l) && l.length > 0 && l.every((b) => isSchema(b) && 'const' in b));
    if (list) {
        if (list.length <= 4) return join(list.map((b) => JSON.stringify(b.const)));
        const kinds = [...new Set(list.map((b) => (b.const === null ? 'null' : typeof b.const)))];
        return `${join(types.length ? types : kinds)}, one of ${list.length} values`;
    }
    if (Array.isArray(node.enum)) return node.enum.length <= 4 ? join(node.enum.map((v) => JSON.stringify(v))) : `${join(types)}, one of ${node.enum.length} values`;

    const branches = (['oneOf', 'anyOf'] as const).flatMap((k) => (Array.isArray(node[k]) ? (node[k] as unknown[]) : []));
    if (branches.length > 0 && types.length === 0) {
        return join(branches.filter(isSchema).map((b) => typeText(store, { node: b, url }, depth + 1)));
    }
    if (types.length === 0 && Array.isArray(node.allOf)) {
        const parts = node.allOf.filter(isSchema).map((b) => typeText(store, { node: b, url }, depth + 1)).filter((t) => t !== 'any');
        if (parts.length) return parts[0];
    }

    const describe = (type: string): string => {
        if (type === 'array') {
            const items = isSchema(node.items) ? typeText(store, { node: node.items, url }, depth + 1) : undefined;
            return items && items !== 'any' ? `array of ${wrap(items)}` : 'array';
        }
        if (type === 'object') {
            const entries = isSchema(node.additionalProperties) ? node.additionalProperties
                : isSchema(node.patternProperties) ? Object.values(node.patternProperties).find(isSchema) : undefined;
            if (entries && !isSchema(node.properties)) return `object: name → ${typeText(store, { node: entries as Schema, url }, depth + 1)}`;
            return 'object';
        }
        if (type === 'string' && typeof node.format === 'string') return `string (${node.format})`;
        return type;
    };
    if (types.length) return join(types.map(describe));
    if (isSchema(node.properties) || isSchema(node.additionalProperties)) return describe('object');
    if (isSchema(node.items)) return describe('array');
    return 'any';
}

/** Documentation of a field from the places a schema defines it; the nearest title and description win. */
export function fieldDoc(store: SchemaStore, refs: readonly FieldSchemaRef[]): FieldDoc | undefined {
    let doc: FieldDoc | undefined;
    for (const ref of refs) {
        const node = store.resolveAt(ref.schemaUrl, ref.pointer);
        if (!isSchema(node)) continue;
        const start = { node, url: ref.schemaUrl };
        const links = chain(store, start);
        const end = links[links.length - 1];
        const candidate: FieldDoc = {
            title: links.map((l) => l.node.title).find((t): t is string => typeof t === 'string'),
            description: links.map((l) => l.node.description).find((t): t is string => typeof t === 'string'),
            type: typeText(store, start),
            values: valuesOf(end.node),
            definedAt: `${ref.schemaUrl}#${ref.pointer}`,
        };
        if (!doc) doc = candidate;
        else {
            doc.title ??= candidate.title;
            doc.description ??= candidate.description;
            doc.values ??= candidate.values;
        }
        if (doc.title && doc.description) break;
    }
    return doc;
}
