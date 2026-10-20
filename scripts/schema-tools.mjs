// Helpers for the vendored schemas, shared by the drafting script and the tests.

/** Keywords whose value is a subschema. */
const SCHEMA_KEYWORDS = new Set([
    'additionalProperties', 'additionalItems', 'contains', 'propertyNames', 'if', 'then', 'else', 'not',
    'unevaluatedProperties', 'unevaluatedItems', 'items',
]);
/** Keywords whose value is an array of subschemas. */
const ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
/** Keywords whose value maps names to subschemas. */
const MAP_KEYWORDS = new Set(['properties', 'patternProperties', 'definitions', '$defs', 'dependentSchemas', 'dependencies']);

export const ANNOTATIONS = ['title', 'description'];

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function escapePointer(segment) {
    return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

export function unescapePointer(segment) {
    return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function getPointer(doc, pointer) {
    let node = doc;
    for (const segment of pointer.split('/').slice(1)) {
        if (node === undefined || node === null) return undefined;
        node = node[unescapePointer(segment)];
    }
    return node;
}

/**
 * Calls `visit(node, pointer, context)` for every subschema. `context.keyword` is the keyword the subschema sits under
 * (`properties`, `items`, …) and `context.name` the property name for map keywords.
 */
export function walkSchemas(node, visit, pointer = '', context = { keyword: undefined, name: undefined, parents: [] }) {
    if (!isObject(node)) return;
    visit(node, pointer, context);
    const parents = [...context.parents, { node, pointer, keyword: context.keyword, name: context.name }];
    for (const [key, value] of Object.entries(node)) {
        const at = `${pointer}/${escapePointer(key)}`;
        if (SCHEMA_KEYWORDS.has(key)) {
            if (Array.isArray(value)) value.forEach((item, i) => walkSchemas(item, visit, `${at}/${i}`, { keyword: key, parents }));
            else walkSchemas(value, visit, at, { keyword: key, parents });
        } else if (ARRAY_KEYWORDS.has(key) && Array.isArray(value)) {
            value.forEach((item, i) => walkSchemas(item, visit, `${at}/${i}`, { keyword: key, parents }));
        } else if (MAP_KEYWORDS.has(key) && isObject(value)) {
            for (const [name, sub] of Object.entries(value)) {
                walkSchemas(sub, visit, `${at}/${escapePointer(name)}`, { keyword: key, name, parents });
            }
        }
    }
}

/** True for `{ "const": …, "title": …, "description": … }`: one documented value of a value list. */
export function isTitledConst(branch) {
    return isObject(branch) && 'const' in branch && Object.keys(branch).every((key) => ['const', 'title', 'description', '$comment'].includes(key));
}

/** A `oneOf`/`anyOf` whose every branch is a titled const, i.e. an `enum` with documented values. */
export function valueList(node) {
    for (const keyword of ['oneOf', 'anyOf']) {
        if (Array.isArray(node[keyword]) && node[keyword].length > 0 && node[keyword].every(isTitledConst)) return { keyword, values: node[keyword] };
    }
    return undefined;
}

/**
 * The validation-relevant content of a schema: annotations removed, value lists turned back into `enum`, `$id`
 * dropped. Two schemas with equal canonical forms accept and reject exactly the same documents.
 */
export function canonicalize(schema) {
    const copy = structuredClone(schema);
    delete copy.$id;
    walkSchemas(copy, (node) => {
        for (const key of ANNOTATIONS) delete node[key];
        const list = valueList(node);
        if (list && !('enum' in node)) {
            delete node[list.keyword];
            node.enum = list.values.map((value) => value.const);
        }
    });
    return copy;
}

/** Every title and description of a schema, by JSON pointer. */
export function annotations(schema) {
    const out = new Map();
    walkSchemas(schema, (node, pointer) => {
        for (const key of ANNOTATIONS) if (typeof node[key] === 'string') out.set(`${pointer}/${key}`, node[key]);
    });
    return out;
}

/** Own field prefixes from the conventional `"^(?!cube:)"` / `"^(?!(obs|in_situ):)"` patterns. */
export function ownPrefixes(schema) {
    const counts = new Map();
    walkSchemas(schema, (node) => {
        const patterns = [...(isObject(node.patternProperties) ? Object.keys(node.patternProperties) : [])];
        if (isObject(node.propertyNames) && typeof node.propertyNames.pattern === 'string') patterns.push(node.propertyNames.pattern);
        for (const pattern of patterns) {
            const match = /^\^\(\?!\(?([a-z0-9_|-]+)\)?:\)$/i.exec(pattern);
            if (match) for (const prefix of match[1].split('|')) counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
        }
    });
    if (counts.size === 0) return [];
    const max = Math.max(...counts.values());
    return [...counts.entries()].filter(([, n]) => n * 2 >= max).map(([prefix]) => prefix);
}

function prefixOf(name) {
    const at = name.indexOf(':');
    return at > 0 ? name.slice(0, at) : undefined;
}

const CONDITIONS = ['if', 'not', 'propertyNames', 'contains', 'dependencies', 'dependentSchemas'];

/** True inside conditions (`if`, `not`, `contains`, dependencies, …), whose values are never offered as choices. */
export function inCondition(context) {
    return CONDITIONS.includes(context.keyword) || context.parents.some((p) => CONDITIONS.includes(p.keyword));
}

/** Core keys that extension schemas only re-declare to reach the places where their fields go. */
const WIRING = new Set([
    'type', 'stac_extensions', 'properties', 'assets', 'item_assets', 'summaries', 'links', 'linkTemplates', 'assetTemplates',
    'bands', 'providers', 'collection', 'features',
]);
/** Keywords that only constrain a value: a node made of these is a condition or discriminator, not a definition. */
const CONSTRAINT_ONLY = new Set(['const', 'contains', 'required', 'minItems', 'maxItems', 'minProperties', 'not', '$comment', 'minLength']);

/**
 * Where a `$ref`-only (or single-`allOf`) node points, so documentation can live on the referenced definition.
 * Returns `{ node, url }` of the target, or undefined when the node is not a pure reference. References to a whole
 * document (`common.json`, `bands.json`) are not followed: such documents are not definitions of one field.
 */
export function referenceTarget(node, url, resolve) {
    const keys = Object.keys(node).filter((key) => !ANNOTATIONS.includes(key) && key !== '$comment');
    let ref;
    if (keys.length === 1 && keys[0] === '$ref') ref = node.$ref;
    else if (keys.length === 1 && keys[0] === 'allOf' && node.allOf.length === 1 && isObject(node.allOf[0]) && Object.keys(node.allOf[0]).length === 1 && node.allOf[0].$ref) {
        ref = node.allOf[0].$ref;
    }
    if (!ref) return undefined;
    const target = new URL(ref, url);
    const pointer = decodeURIComponent(target.hash.slice(1));
    if (pointer === '' || pointer === '/') return undefined;
    target.hash = '';
    const doc = resolve(target.toString());
    const resolved = doc === undefined ? undefined : getPointer(doc, pointer);
    return isObject(resolved) ? { node: resolved, url: target.toString(), pointer } : undefined;
}

/** The chain of nodes from a property to the definition it purely references, nearest first. */
export function referenceChain(node, url, resolve) {
    const chain = [{ node, url }];
    for (let depth = 0; depth < 8; depth++) {
        const target = referenceTarget(chain.at(-1).node, chain.at(-1).url, resolve);
        if (!target) break;
        chain.push({ node: target.node, url: target.url });
    }
    return chain;
}

/** Title and description of a property: the nearest ones along its reference chain. */
export function documentation(node, url, resolve) {
    const chain = referenceChain(node, url, resolve);
    return {
        title: chain.find((link) => link.node.title)?.node.title,
        description: chain.find((link) => link.node.description)?.node.description,
    };
}

/** The node where documentation of a property belongs by default: the end of its reference chain. */
export function documentationNode(node, url, resolve) {
    return referenceChain(node, url, resolve).at(-1);
}

/**
 * Properties that must be documented: every property of the schema, except conditions (`if`, `not`), constraint-only
 * discriminators, contents of `summaries`, core keys that extension schemas only re-declare, and fields of other
 * extensions. Each site is `{ pointer, name, node, path }`, `path` being the property names and definition names on the
 * way from the root (useful for matching documentation tables).
 */
export function documentationSites(schema, { core }) {
    const prefixes = core ? [] : ownPrefixes(schema);
    const sites = [];
    walkSchemas(schema, (node, pointer, context) => {
        if (context.keyword !== 'properties' || !isObject(node)) return;
        const chain = [...context.parents, { keyword: context.keyword, name: context.name }];
        if (inCondition(context)) return;
        const propertyNames = chain.filter((p) => p.keyword === 'properties').map((p) => p.name);
        if (propertyNames.slice(0, -1).includes('summaries')) return;
        const name = context.name;
        if (Object.keys(node).length === 0) return;
        if (Object.keys(node).every((key) => CONSTRAINT_ONLY.has(key) || ANNOTATIONS.includes(key))) return;
        if (!core) {
            const prefix = prefixOf(name);
            if (prefix && prefixes.length > 0 && !prefixes.includes(prefix)) return;
            if (!prefix && WIRING.has(name) && propertyNames.length <= 2) return;
        }
        const path = chain.flatMap((p) => (p.keyword === 'properties' || p.keyword === 'definitions' || p.keyword === '$defs') && p.name ? [p.name] : []);
        sites.push({ pointer, name, node, path });
    });
    return sites;
}
