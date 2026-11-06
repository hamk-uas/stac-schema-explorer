import type { ErrorObject, ValidateFunction } from 'ajv';

import type { Json, JsonObject, Requirement } from './model';
import { getAt, joinPointer, splitPointer } from './pointer';
import type { SchemaStore } from './schemas';

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const show = (value: unknown) => JSON.stringify(value);

/** A field's value condition in words (`node_type is "array"`), for the simple forms schemas use in `if`. */
function describeValue(name: string, schema: unknown): string | undefined {
    if (!isObject(schema)) return undefined;
    if ('const' in schema) return `${name} is ${show(schema.const)}`;
    if (Array.isArray(schema.enum)) return schema.enum.length === 1 ? `${name} is ${show(schema.enum[0])}` : `${name} is one of ${schema.enum.map(show).join(', ')}`;
    if (isObject(schema.properties) || Array.isArray(schema.required)) return describeCondition(schema, `${name}.`);
    if (typeof schema.type === 'string') return schema.type === 'null' ? `${name} is null` : `${name} is ${/^[aeiou]/.test(schema.type) ? 'an' : 'a'} ${schema.type}`;
    return undefined;
}

/**
 * The condition of an `if` schema in words: which fields are present and which values they have (`err_corr_1_dim is
 * present`, `node_type is "array"`). `exclude`: the required field itself, left out of the alternatives that make it
 * required. `undefined` when the condition has another form.
 */
export function describeCondition(schema: unknown, prefix = '', depth = 0, exclude?: string): string | undefined {
    if (!isObject(schema) || depth > 4) return undefined;
    const parts: string[] = [];
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === 'string') : [];
    for (const [name, value] of Object.entries(properties)) {
        const described = describeValue(`${prefix}${name}`, value);
        if (described) parts.push(described);
        else if (required.includes(name)) parts.push(`${prefix}${name} is present`);
    }
    for (const name of required) if (!(name in properties)) parts.push(`${prefix}${name} is present`);
    for (const keyword of ['anyOf', 'oneOf'] as const) {
        const branches = schema[keyword];
        if (!Array.isArray(branches)) continue;
        // Alternatives that each require one field: any of them is present.
        const single = branches.map((b) => (isObject(b) && Object.keys(b).length === 1 && Array.isArray(b.required) && b.required.length === 1 ? String(b.required[0]) : undefined));
        if (single.every((name): name is string => !!name)) {
            const names = single.filter((name) => name !== exclude).map((name) => `${prefix}${name}`);
            if (names.length) parts.push(names.length === 1 ? `${names[0]} is present` : `any of ${names.join(', ')} is present`);
            continue;
        }
        const described = branches.map((branch) => describeCondition(branch, prefix, depth + 1, exclude));
        if (described.every((d): d is string => !!d)) parts.push(described.length > 1 ? `(${described.join(' or ')})` : described[0]);
    }
    if (Array.isArray(schema.allOf)) for (const branch of schema.allOf) {
        const described = describeCondition(branch, prefix, depth + 1, exclude);
        if (described) parts.push(described);
    }
    if (schema.not !== undefined) {
        const described = describeCondition(schema.not, prefix, depth + 1);
        if (described) parts.push(`not (${described})`);
    }
    return parts.length ? parts.join(' and ') : undefined;
}

/** The schema document and pointer of an error's `schemaPath`: `#/…`, `<id>#/…`, or Ajv's `<id>/…` for a referenced schema. */
function locate(schemaUrl: string, schemaPath: string): { base: string; segments: string[] } {
    const hash = schemaPath.indexOf('#');
    const match = hash >= 0 ? [schemaPath, schemaPath.slice(0, hash), schemaPath.slice(hash + 1)] : /^(.*?\.json)(\/.*)?$/i.exec(schemaPath);
    const [, id = '', pointer = ''] = match ?? ['', '', schemaPath];
    let base = schemaUrl;
    try {
        if (id) base = new URL(id, schemaUrl).toString();
    } catch {
        // Keep the validated schema's URL.
    }
    return { base, segments: splitPointer(pointer) };
}

const resolveAt = (store: SchemaStore, base: string, segments: string[]): unknown => {
    try {
        return store.resolve(`${base}#${joinPointer('', ...segments)}`);
    } catch {
        return undefined;
    }
};

/**
 * The document holding the `required` that reported `field` missing. Ajv gives the path of an inlined `$ref` from the
 * referenced document's root, so a path that does not lead to such a `required` in the validated schema is looked up
 * in the other loaded documents.
 */
function requiredBase(store: SchemaStore, base: string, segments: string[], field: string): string | undefined {
    const lists = (url: string) => {
        const node = resolveAt(store, url, segments);
        return Array.isArray(node) && node.includes(field);
    };
    if (lists(base)) return base;
    return store.documentUrls().find(lists);
}

/**
 * The condition under which a missing-field error applies: `null` for a plain `required` (or one every alternative of an
 * `anyOf` makes), a description for a `required` under `then`/`else` (its `if`) or a dependency on another field, `''`
 * for a condition not described.
 */
function conditionOf(store: SchemaStore, schemaUrl: string, field: string, error: ErrorObject, errors: ErrorObject[]): string | null {
    const params = error.params as { property?: string };
    if (error.keyword === 'dependentRequired' || error.keyword === 'dependencies') return params.property ? `${params.property} is present` : '';
    const located = locate(schemaUrl, error.schemaPath);
    const { segments } = located;
    const at = Math.max(...['then', 'else', 'dependencies', 'dependentSchemas', 'anyOf', 'oneOf'].map((k) => segments.lastIndexOf(k)));
    if (at < 0) return null;
    const keyword = segments[at];
    if (keyword === 'dependencies' || keyword === 'dependentSchemas') return segments[at + 1] ? `${segments[at + 1]} is present` : '';
    if (keyword === 'anyOf' || keyword === 'oneOf') {
        // Ajv reports the first error of each alternative that fails: when each reports the field missing, every
        // alternative requires it (STAC's `datetime`, null or not).
        const prefix = `${error.schemaPath.slice(0, error.schemaPath.length - joinPointer('', ...segments.slice(at + 1)).length)}/`;
        const branches = new Map<string, boolean>();
        for (const e of errors) {
            if (!e.schemaPath.startsWith(prefix)) continue;
            const branch = e.schemaPath.slice(prefix.length).split('/')[0];
            const missing = e.keyword === 'required' && (e.params as { missingProperty?: string }).missingProperty === field;
            branches.set(branch, (branches.get(branch) ?? true) && missing);
        }
        return branches.size > 1 && [...branches.values()].every(Boolean) ? null : '';
    }
    const base = requiredBase(store, located.base, segments, field);
    const condition = base ? describeCondition(resolveAt(store, base, [...segments.slice(0, at), 'if']), '', 0, field) : undefined;
    if (keyword === 'else') return condition ? `not (${condition})` : '';
    return condition ?? '';
}

/** A requirement in words, for tooltips and field information; `here` says it is where the field is placed. */
export function requirementText(required: Requirement | undefined, here = false): string {
    const at = here ? ' here' : '';
    if (!required) return `optional${at}`;
    if (required.when === undefined) return `required${at}`;
    return required.when ? `required${at} when ${required.when}` : `required${at} when a condition of the schema holds`;
}

/**
 * Whether a field placed in an example document is required there: removing it makes its schema report it missing.
 * `{}` when it is always required, `{ when }` when required by a condition the example meets (`when: ''` for one not
 * described), `undefined` when optional. The document is left as it was, key order included.
 */
export function requirementOf(store: SchemaStore, schemaUrl: string, validate: ValidateFunction, doc: Json, location: string, field: string): Requirement | undefined {
    const holder = getAt(doc, location);
    if (!isObject(holder) || !(field in holder)) return undefined;
    const entries = Object.entries(holder);
    delete holder[field];
    let errors: ErrorObject[] = [];
    try {
        if (validate(doc) !== true) errors = [...(validate.errors ?? [])];
    } finally {
        for (const key of Object.keys(holder)) delete holder[key];
        for (const [key, value] of entries) holder[key] = value;
    }
    const missing = errors.filter((e) => e.instancePath === location && (e.params as { missingProperty?: string }).missingProperty === field
        && ['required', 'dependentRequired', 'dependencies'].includes(e.keyword));
    if (!missing.length) return undefined;
    const conditions = missing.map((e) => conditionOf(store, schemaUrl, field, e, errors));
    if (conditions.includes(null)) return {};
    return { when: conditions.find((c) => !!c) ?? '' };
}
