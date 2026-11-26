import { joinPointer } from './pointer';
import type { SchemaStore } from './schemas';

/** Core STAC and Common Metadata keys; never reported as extension fields. */
export const CORE_KEYS = new Set([
    'type', 'stac_version', 'stac_extensions', 'id', 'title', 'description', 'keywords', 'roles', 'links', 'assets',
    'item_assets', 'properties', 'summaries', 'extent', 'license', 'providers', 'geometry', 'bbox', 'collection',
    'datetime', 'start_datetime', 'end_datetime', 'created', 'updated', 'platform', 'instruments', 'constellation',
    'mission', 'gsd', 'bands', 'nodata', 'data_type', 'statistics', 'unit', 'href', 'rel', 'method', 'headers', 'body',
    'name', 'url', 'assetTemplates', 'linkTemplates', 'features', 'conformsTo',
]);

/** Keys that are never fields, not even of extensions that were later merged into core. */
const STRUCTURAL_KEYS = new Set(['type', 'stac_version', 'stac_extensions', 'id', 'links', 'assets', 'properties', 'geometry', 'bbox', 'href', 'rel']);

export interface FieldSchemaRef {
    schemaUrl: string;
    pointer: string;
}

export interface CollectedFields {
    /** The schema's own field prefixes; empty for unprefixed extensions such as Themes. */
    prefixes: string[];
    fields: Map<string, FieldSchemaRef[]>;
}

export function prefixOf(key: string): string | undefined {
    const at = key.indexOf(':');
    return at > 0 ? key.slice(0, at) : undefined;
}

type Mode = 'container' | 'map' | 'array';

interface WalkOptions {
    /** Return true to descend into a map/array container key instead of treating it as a field. */
    isContainer: (key: string) => boolean;
    onKey: (key: string, ref: FieldSchemaRef) => void;
}

function followRef(store: SchemaStore, schemaUrl: string, ref: string): { schemaUrl: string; pointer: string } | undefined {
    const target = new URL(ref, store.baseOf(schemaUrl));
    const pointer = decodeURIComponent(target.hash.slice(1));
    target.hash = '';
    const url = target.toString();
    return store.getDocument(url) !== undefined ? { schemaUrl: url, pointer } : undefined;
}

/** True when the subschema at `pointer` validates objects with named `properties` (directly or via composition). */
function hasObjectProperties(store: SchemaStore, schemaUrl: string, pointer: string, visited: Set<string>): boolean {
    const visitKey = `${schemaUrl}#${pointer}`;
    if (visited.has(visitKey)) return false;
    visited.add(visitKey);
    const node = store.resolveAt(schemaUrl, pointer);
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return false;
    const schema = node as Record<string, unknown>;
    if (schema.properties && typeof schema.properties === 'object' && Object.keys(schema.properties as object).length > 0) return true;
    if (typeof schema.$ref === 'string') {
        const target = followRef(store, schemaUrl, schema.$ref);
        if (target && hasObjectProperties(store, target.schemaUrl, target.pointer, visited)) return true;
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
        const list = schema[keyword];
        if (Array.isArray(list) && list.some((_, i) => hasObjectProperties(store, schemaUrl, joinPointer(pointer, keyword, i), visited))) return true;
    }
    for (const keyword of ['if', 'then', 'else', 'not'] as const) {
        if (schema[keyword] && typeof schema[keyword] === 'object' && hasObjectProperties(store, schemaUrl, joinPointer(pointer, keyword), visited)) return true;
    }
    return false;
}

/** Whether a property's schema is a map or array of objects that can carry nested fields of other schemas. */
function containerMode(store: SchemaStore, schemaUrl: string, pointer: string, visited = new Set<string>()): 'map' | 'array' | undefined {
    const visitKey = `${schemaUrl}#${pointer}`;
    if (visited.has(visitKey)) return undefined;
    visited.add(visitKey);
    const node = store.resolveAt(schemaUrl, pointer);
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    const schema = node as Record<string, unknown>;
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        if (hasObjectProperties(store, schemaUrl, joinPointer(pointer, 'additionalProperties'), new Set())) return 'map';
    }
    if (schema.patternProperties && typeof schema.patternProperties === 'object') {
        for (const key of Object.keys(schema.patternProperties as object)) {
            if (!key.startsWith('^(?!') && hasObjectProperties(store, schemaUrl, joinPointer(pointer, 'patternProperties', key), new Set())) return 'map';
        }
    }
    if (Array.isArray(schema.items)) {
        if (schema.items.some((_, i) => hasObjectProperties(store, schemaUrl, joinPointer(pointer, 'items', i), new Set()))) return 'array';
    } else if (schema.items && typeof schema.items === 'object') {
        if (hasObjectProperties(store, schemaUrl, joinPointer(pointer, 'items'), new Set())) return 'array';
    }
    if (typeof schema.$ref === 'string') {
        const target = followRef(store, schemaUrl, schema.$ref);
        if (target) {
            const found = containerMode(store, target.schemaUrl, target.pointer, visited);
            if (found) return found;
        }
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
        const list = schema[keyword];
        if (!Array.isArray(list)) continue;
        for (let i = 0; i < list.length; i++) {
            const found = containerMode(store, schemaUrl, joinPointer(pointer, keyword, i), visited);
            if (found) return found;
        }
    }
    for (const keyword of ['if', 'then', 'else', 'not'] as const) {
        if (schema[keyword] && typeof schema[keyword] === 'object') {
            const found = containerMode(store, schemaUrl, joinPointer(pointer, keyword), visited);
            if (found) return found;
        }
    }
    return undefined;
}

function walk(store: SchemaStore, schemaUrl: string, pointer: string, mode: Mode, options: WalkOptions, visited: Set<string>): void {
    const visitKey = `${mode} ${schemaUrl}#${pointer}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    const node = store.resolveAt(schemaUrl, pointer);
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    const schema = node as Record<string, unknown>;

    if (typeof schema.$ref === 'string') {
        const target = new URL(schema.$ref, store.baseOf(schemaUrl));
        const targetPointer = decodeURIComponent(target.hash.slice(1));
        target.hash = '';
        const targetUrl = target.toString();
        if (store.getDocument(targetUrl) !== undefined) walk(store, targetUrl, targetPointer, mode, options, visited);
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
        const list = schema[keyword];
        if (Array.isArray(list)) list.forEach((_, i) => walk(store, schemaUrl, joinPointer(pointer, keyword, i), mode, options, visited));
    }
    for (const keyword of ['if', 'then', 'else', 'not'] as const) {
        if (schema[keyword] && typeof schema[keyword] === 'object') walk(store, schemaUrl, joinPointer(pointer, keyword), mode, options, visited);
    }

    if (mode === 'container' && schema.properties && typeof schema.properties === 'object') {
        for (const key of Object.keys(schema.properties as object)) {
            const sub = joinPointer(pointer, 'properties', key);
            if (key === 'properties') {
                walk(store, schemaUrl, sub, 'container', options, visited);
            } else {
                const subMode = options.isContainer(key) ? containerMode(store, schemaUrl, sub) : undefined;
                if (subMode) walk(store, schemaUrl, sub, subMode, options, visited);
                else options.onKey(key, { schemaUrl, pointer: sub });
            }
        }
    }
    if (mode === 'map') {
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
            walk(store, schemaUrl, joinPointer(pointer, 'additionalProperties'), 'container', options, visited);
        }
        if (schema.patternProperties && typeof schema.patternProperties === 'object') {
            for (const key of Object.keys(schema.patternProperties as object)) {
                walk(store, schemaUrl, joinPointer(pointer, 'patternProperties', key), 'container', options, visited);
            }
        }
    }
    if (mode === 'array') {
        if (Array.isArray(schema.items)) schema.items.forEach((_, i) => walk(store, schemaUrl, joinPointer(pointer, 'items', i), 'container', options, visited));
        else if (schema.items && typeof schema.items === 'object') walk(store, schemaUrl, joinPointer(pointer, 'items'), 'container', options, visited);
    }
}

/**
 * Finds the fields an extension schema defines. Fields are property keys at "container" level: the
 * object root, Item `properties`, assets, bands, `cube:variables` entries and the like, reached through
 * `$ref` and composition keywords. Values of fields are not descended into.
 *
 * Besides its own fields (those with its prefixes), a schema may validate fields of other extensions, for example
 * `cf:cell_methods` in Table columns; those are reported too, so that such extensions of other schemas show up.
 */
export function collectFields(store: SchemaStore, schemaUrl: string): CollectedFields {
    const prefixes = declaredPrefixes(store.getDocument(schemaUrl)) ?? guessPrefix(store, schemaUrl);
    const isOwn = (key: string) => {
        const prefix = prefixOf(key);
        return prefixes.length > 0 ? prefix !== undefined && prefixes.includes(prefix) : prefix === undefined && !CORE_KEYS.has(key);
    };
    const isForeignField = (key: string) => prefixOf(key) !== undefined && !isOwn(key);

    const fields = new Map<string, FieldSchemaRef[]>();
    const collect = (own: (key: string) => boolean, accept: (key: string) => boolean) => walk(store, schemaUrl, '', 'container', {
        isContainer: (key) => !own(key),
        onKey: (key, ref) => {
            if (!accept(key)) return;
            const refs = fields.get(key) ?? [];
            if (!refs.some((r) => r.schemaUrl === ref.schemaUrl && r.pointer === ref.pointer)) refs.push(ref);
            fields.set(key, refs);
        },
    }, new Set());
    collect(isOwn, (key) => isOwn(key) || isForeignField(key));
    // Extensions that later became core (Item Assets for STAC 1.0.0) define fields with core names.
    if (fields.size === 0 && prefixes.length === 0) {
        const own = (key: string) => prefixOf(key) === undefined && !STRUCTURAL_KEYS.has(key);
        collect(own, own);
    }
    const ownFirst = [...fields.entries()].sort(([a], [b]) => Number(isForeignField(a)) - Number(isForeignField(b)));
    return { prefixes, fields: new Map(ownFirst) };
}

/** Where a schema (typically STAC core) defines the given field names; links are skipped (their `title` differs). */
export function collectNamedFields(store: SchemaStore, schemaUrl: string, names: ReadonlySet<string>): Map<string, FieldSchemaRef[]> {
    const fields = new Map<string, FieldSchemaRef[]>();
    walk(store, schemaUrl, '', 'container', {
        isContainer: (key) => !names.has(key) && key !== 'links' && key !== 'linkTemplates',
        onKey: (key, ref) => {
            if (!names.has(key)) return;
            const refs = fields.get(key) ?? [];
            if (!refs.some((r) => r.schemaUrl === ref.schemaUrl && r.pointer === ref.pointer)) refs.push(ref);
            fields.set(key, refs);
        },
    }, new Set());
    return fields;
}

/**
 * Prefixes from the conventional `"patternProperties": {"^(?!cube:)": {}}` or `"^(?!(obs|in_situ):)"`. A schema may
 * also restrict fields of other extensions this way (`^(?!(obs|cf):)` where it re-validates CF fields), so only
 * prefixes that occur in at least half as many patterns as the most frequent one count as the schema's own.
 */
function declaredPrefixes(schema: unknown): string[] | undefined {
    const counts = new Map<string, number>();
    const visit = (node: unknown) => {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(visit);
        const record = node as Record<string, unknown>;
        const patterns = [
            ...(record.patternProperties && typeof record.patternProperties === 'object' ? Object.keys(record.patternProperties) : []),
            ...(record.propertyNames && typeof (record.propertyNames as Record<string, unknown>).pattern === 'string' ? [(record.propertyNames as Record<string, string>).pattern] : []),
        ];
        for (const pattern of patterns) {
            const match = /^\^\(\?!\(?([a-z0-9_|-]+)\)?:\)$/i.exec(pattern);
            if (match) match[1].split('|').forEach((p) => counts.set(p, (counts.get(p) ?? 0) + 1));
        }
        Object.values(record).forEach(visit);
    };
    visit(schema);
    if (counts.size === 0) return undefined;
    const max = Math.max(...counts.values());
    return [...counts.entries()].filter(([, n]) => n * 2 >= max).sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

/** The most frequent prefix among field-like keys, for schemas that do not declare their prefixes. */
function guessPrefix(store: SchemaStore, schemaUrl: string): string[] {
    const all = new Set<string>();
    const leaves = new Set<string>();
    // First pass keeps prefixed containers (`cube:variables`, `raster:bands`) as keys; second descends into them
    // so fields inside foreign containers (e.g. `cf:cell_methods` in `cube:variables`) outweigh the container's prefix.
    walk(store, schemaUrl, '', 'container', { isContainer: (key) => prefixOf(key) === undefined, onKey: (key) => all.add(key) }, new Set());
    walk(store, schemaUrl, '', 'container', { isContainer: () => true, onKey: (key) => leaves.add(key) }, new Set());
    const counts = new Map<string, number>();
    const leafPrefixed = [...leaves].filter((key) => prefixOf(key) !== undefined);
    const allPrefixed = [...all].filter((key) => prefixOf(key) !== undefined);
    for (const key of leafPrefixed.length > 0 ? leafPrefixed : allPrefixed) {
        const prefix = prefixOf(key)!;
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return best ? [best] : [];
}
