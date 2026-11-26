import type { FieldSchemaRef } from './fields';
import type { Json } from './model';
import type { SchemaStore } from './schemas';

export interface ValueDoc {
    value: Json;
    title?: string;
    description?: string;
}

export interface PropertyDoc {
    name: string;
    title?: string;
    description?: string;
    type: string;
    required?: boolean;
    /** True when the property's schema is a map of arbitrary keys to values (`additionalProperties`/`patternProperties` without `properties`). */
    isMap?: boolean;
    /** Nested object shapes when this property itself holds an object, map of objects, or array of objects. */
    objects?: ObjectDoc[];
}

export interface ObjectDoc {
    title?: string;
    description?: string;
    properties: PropertyDoc[];
}

/** What a field means, as documented in its JSON Schema. */
export interface FieldDoc {
    title?: string;
    description?: string;
    /** Readable type computed from the schema, e.g. `array of (string or null)`. */
    type: string;
    /** True when the field's schema is a map of arbitrary keys to values (`additionalProperties`/`patternProperties` without `properties`). */
    isMap?: boolean;
    /** Allowed values, when the schema lists them. */
    values?: ValueDoc[];
    /** Object shapes and their properties, when the field's value is an object, map of objects, or array of objects. */
    objects?: ObjectDoc[];
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

const MAX_OBJECT_DEPTH = 2;

function isMapSchema(store: SchemaStore, located: Located, depth = 0): boolean {
    if (depth > 4) return false;
    const links = chain(store, located);
    const { node, url } = links[links.length - 1];
    if (isSchema(node.properties)) return false;
    if (isSchema(node.additionalProperties) && Object.keys(node.additionalProperties).length > 0) return true;
    if (isSchema(node.patternProperties)) {
        if (Object.entries(node.patternProperties).some(([p, sub]) => !p.startsWith('^(?!') && isSchema(sub) && Object.keys(sub).length > 0)) return true;
    }
    const branches = (['oneOf', 'anyOf'] as const).flatMap((k) => (Array.isArray(node[k]) ? (node[k] as unknown[]) : []));
    return branches.some((b) => isSchema(b) && isMapSchema(store, { node: b, url }, depth + 1));
}

function sameHost(a: string, b: string): boolean {
    try {
        return new URL(a).host === new URL(b).host;
    } catch {
        return false;
    }
}

function resolveRef(store: SchemaStore, ref: string, base: string): (Located & { key: string }) | undefined {
    const target = new URL(ref, store.baseOf(base));
    const pointer = decodeURIComponent(target.hash.slice(1));
    target.hash = '';
    const url = target.toString();
    const node = store.resolveAt(url, pointer);
    return isSchema(node) ? { node, url, key: `${url}#${pointer}` } : undefined;
}

function collectObjectProps(
    store: SchemaStore,
    node: Schema,
    url: string,
    originUrl: string,
    visited: Set<string>,
): { properties: Map<string, Located>; required: Set<string> } {
    const properties = new Map<string, Located>();
    const required = new Set<string>();
    const visit = (cur: Schema, curUrl: string, seen: Set<string>) => {
        if (typeof cur.$ref === 'string') {
            const target = resolveRef(store, cur.$ref, curUrl);
            if (!target || !sameHost(target.url, originUrl) || seen.has(target.key)) return;
            visit(target.node, target.url, new Set([...seen, target.key]));
        }
        if (Array.isArray(cur.required)) {
            for (const r of cur.required) if (typeof r === 'string') required.add(r);
        }
        if (isSchema(cur.properties)) {
            for (const [key, sub] of Object.entries(cur.properties)) {
                if (isSchema(sub) && !properties.has(key)) properties.set(key, { node: sub, url: curUrl });
            }
        }
        if (Array.isArray(cur.allOf)) {
            for (const branch of cur.allOf) {
                if (isSchema(branch)) visit(branch, curUrl, seen);
            }
        }
    };
    visit(node, url, visited);
    return { properties, required };
}

/**
 * Extracts object shapes and their documented properties for a field whose value is an object, map of objects,
 * or array of objects. Stops at external dependency schemas (such as PROJJSON and GeoJSON), `$ref` cycles,
 * and `MAX_OBJECT_DEPTH` levels so recursive schemas never loop or overwhelm the panel.
 */
function objectsOf(
    store: SchemaStore,
    located: Located,
    originUrl: string,
    visited: Set<string>,
    depth: number,
): ObjectDoc[] {
    if (depth >= MAX_OBJECT_DEPTH) return [];
    const links: Located[] = [located];
    let seen = visited;
    for (let step = 0; step < 8; step++) {
        const { node, url } = links[links.length - 1];
        const keys = Object.keys(node).filter((key) => !ANNOTATIONS.has(key));
        let ref: string | undefined;
        if (keys.length === 1 && typeof node.$ref === 'string') ref = node.$ref;
        else if (keys.length === 1 && Array.isArray(node.allOf) && node.allOf.length === 1 && isSchema(node.allOf[0]) && typeof node.allOf[0].$ref === 'string' && Object.keys(node.allOf[0]).length === 1) {
            ref = node.allOf[0].$ref;
        }
        if (!ref) break;
        const target = resolveRef(store, ref, url);
        if (!target || !sameHost(target.url, originUrl) || seen.has(target.key)) return [];
        seen = new Set([...seen, target.key]);
        links.push({ node: target.node, url: target.url });
    }
    const { node, url } = links[links.length - 1];

    // Array of objects (e.g. `bands`, `themes`, `table:columns`, `classification:classes`).
    const types = Array.isArray(node.type) ? node.type : typeof node.type === 'string' ? [node.type] : [];
    if ((types.includes('array') || types.length === 0) && isSchema(node.items)) {
        return objectsOf(store, { node: node.items, url }, originUrl, seen, depth);
    }

    // Object with properties (directly or via `allOf`).
    const { properties, required } = collectObjectProps(store, node, url, originUrl, seen);
    if (properties.size > 0) {
        const title = links.map((l) => l.node.title).find((t): t is string => typeof t === 'string');
        const description = links.map((l) => l.node.description).find((d): d is string => typeof d === 'string');
        const props: PropertyDoc[] = [];
        for (const [name, propLoc] of properties) {
            const propLinks = chain(store, propLoc);
            const nested = objectsOf(store, propLoc, originUrl, seen, depth + 1);
            props.push({
                name,
                title: propLinks.map((l) => l.node.title).find((t): t is string => typeof t === 'string'),
                description: propLinks.map((l) => l.node.description).find((d): d is string => typeof d === 'string'),
                type: typeText(store, propLoc),
                ...(isMapSchema(store, propLoc) ? { isMap: true } : {}),
                ...(required.has(name) ? { required: true } : {}),
                ...(nested.length ? { objects: nested } : {}),
            });
        }
        return [{ title, description, properties: props }];
    }

    // Map of objects (e.g. `cube:dimensions`, `cube:variables`, `storage:schemes`).
    if (isSchema(node.additionalProperties) && Object.keys(node.additionalProperties).length > 0) {
        return objectsOf(store, { node: node.additionalProperties, url }, originUrl, seen, depth);
    }
    if (isSchema(node.patternProperties)) {
        for (const [pattern, sub] of Object.entries(node.patternProperties)) {
            if (!pattern.startsWith('^(?!') && isSchema(sub) && Object.keys(sub).length > 0) {
                const found = objectsOf(store, { node: sub, url }, originUrl, seen, depth);
                if (found.length) return found;
            }
        }
    }

    // Union of object variants (e.g. `cube:dimensions`'s five dimension types, or nullable objects).
    const branches = (['oneOf', 'anyOf'] as const).flatMap((k) => (Array.isArray(node[k]) ? (node[k] as unknown[]) : []));
    if (branches.length > 0) {
        const out: ObjectDoc[] = [];
        const keys = new Set<string>();
        for (const branch of branches) {
            if (!isSchema(branch)) continue;
            for (const obj of objectsOf(store, { node: branch, url }, originUrl, seen, depth)) {
                const sig = `${obj.title ?? ''}|${obj.properties.map((p) => p.name).join(',')}`;
                if (!keys.has(sig)) {
                    keys.add(sig);
                    out.push(obj);
                }
            }
        }
        return out;
    }

    return [];
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
        const objects = objectsOf(store, start, ref.schemaUrl, new Set([`${ref.schemaUrl}#${ref.pointer}`]), 0);
        const isMap = isMapSchema(store, start);
        const candidate: FieldDoc = {
            title: links.map((l) => l.node.title).find((t): t is string => typeof t === 'string'),
            description: links.map((l) => l.node.description).find((t): t is string => typeof t === 'string'),
            type: typeText(store, start),
            ...(isMap ? { isMap: true } : {}),
            values: valuesOf(end.node),
            ...(objects.length ? { objects } : {}),
            definedAt: `${ref.schemaUrl}#${ref.pointer}`,
        };
        if (!doc) doc = candidate;
        else {
            doc.title ??= candidate.title;
            doc.description ??= candidate.description;
            doc.isMap ??= candidate.isMap;
            doc.values ??= candidate.values;
            doc.objects ??= candidate.objects;
        }
        if (doc.title && doc.description && doc.objects) break;
    }
    return doc;
}
