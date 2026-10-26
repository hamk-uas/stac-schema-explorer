import type { ValidateFunction } from 'ajv';

import { CONVENTION_KINDS, conventionOfSchema, DATA_FORMATS, type DataFormat } from './conventions';
import { fieldDoc } from './field-docs';
import type { FieldSchemaRef } from './fields';
import type { Json, JsonObject, Placement, PlacementKind, SourceInfo } from './model';
import { getAt, joinPointer } from './pointer';
import { Sampler } from './sampler';
import { formatErrors, type SchemaStore } from './schemas';

/** Members of a node whose entries are fields of their own: attributes (Zarr, netCDF), TIFF tags and GeoKeys. */
export const CONTAINERS = ['attributes', 'tags', 'geo_keys'] as const;

/** One node type of one format, with every field of the selected schemas placed where they allow it. */
export interface NodeTemplate {
    key: string;
    format: string;
    formatTitle: string;
    nodeType: string;
    /** The extreme-case node: every placed field with an example value. */
    doc: JsonObject;
    placements: Placement[];
    /** Selected conventions of the format that place no field in this node type. */
    notApplicable: string[];
    valid: boolean;
    errors: string[];
}

export interface EmbeddedSourceInfo extends SourceInfo {
    /** `format` for a format schema (the counterpart of STAC core), else the convention kind. */
    kind: 'format' | (typeof CONVENTION_KINDS)[number]['kind'];
    /** The container (`attributes`, `tags`, `geo_keys`) of each field, or none for top-level keys of the node. */
    containers: Record<string, string | undefined>;
    /** Formats the schema applies to. */
    formats: string[];
}

export interface EmbeddedProbeResult {
    sources: EmbeddedSourceInfo[];
    nodes: NodeTemplate[];
}

/** Minimal valid nodes of each format and node type, into which fields are probed. */
const BASE_NODES: Record<string, Record<string, JsonObject>> = {
    'zarr-v3': {
        group: { zarr_format: 3, node_type: 'group', attributes: {} },
        array: {
            zarr_format: 3, node_type: 'array', shape: [180, 360], data_type: 'float32',
            chunk_grid: { name: 'regular', configuration: { chunk_shape: [90, 180] } },
            chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
            fill_value: 'NaN', codecs: [{ name: 'bytes', configuration: { endian: 'little' } }], dimension_names: ['y', 'x'], attributes: {},
        },
    },
    'zarr-v2': {
        group: { zarr_format: 2, node_type: 'group', attributes: {} },
        array: { zarr_format: 2, node_type: 'array', shape: [180, 360], chunks: [90, 180], dtype: '<f4', compressor: null, fill_value: 'NaN', order: 'C', filters: null, attributes: {} },
    },
    netcdf: {
        group: { node_type: 'group', name: '/', dimensions: { y: { size: 180 }, x: { size: 360 } }, attributes: {} },
        variable: { node_type: 'variable', name: 'temperature', data_type: 'float', dimensions: ['y', 'x'], shape: [180, 360], attributes: {} },
    },
    tiff: {
        file: { node_type: 'file', byte_order: 'little-endian', bigtiff: false, image_count: 1 },
        image: { node_type: 'image', index: 0, tags: { ImageWidth: 360, ImageLength: 180 } },
    },
};

type Schema = Record<string, unknown>;
const isSchema = (value: unknown): value is Schema => typeof value === 'object' && value !== null && !Array.isArray(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Properties a node schema defines at one level, following `$ref`, `allOf`/`anyOf`/`oneOf` and `if`/`then`/`else`. */
function properties(store: SchemaStore, url: string, pointer: string, out = new Map<string, FieldSchemaRef[]>(), seen = new Set<string>()): Map<string, FieldSchemaRef[]> {
    const key = `${url}#${pointer}`;
    if (seen.has(key)) return out;
    seen.add(key);
    const node = store.resolveAt(url, pointer);
    if (!isSchema(node)) return out;
    if (isSchema(node.properties)) {
        for (const name of Object.keys(node.properties)) {
            const refs = out.get(name) ?? [];
            refs.push({ schemaUrl: url, pointer: joinPointer(pointer, 'properties', name) } as FieldSchemaRef);
            out.set(name, refs);
        }
    }
    if (typeof node.$ref === 'string') {
        const target = new URL(node.$ref, store.baseOf(url));
        const fragment = decodeURIComponent(target.hash.slice(1));
        target.hash = '';
        properties(store, target.toString(), fragment, out, seen);
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
        if (Array.isArray(node[keyword])) (node[keyword] as unknown[]).forEach((_, i) => properties(store, url, `${pointer}/${keyword}/${i}`, out, seen));
    }
    for (const keyword of ['then', 'else']) if (isSchema(node[keyword])) properties(store, url, `${pointer}/${keyword}`, out, seen);
    return out;
}

/** Schemas of the items of an array schema, following `$ref` and `allOf`/`anyOf`/`oneOf`. */
function itemsOf(store: SchemaStore, url: string, pointer: string, out: FieldSchemaRef[] = [], seen = new Set<string>()): FieldSchemaRef[] {
    const key = `${url}#${pointer}`;
    if (seen.has(key)) return out;
    seen.add(key);
    const node = store.resolveAt(url, pointer);
    if (!isSchema(node)) return out;
    if (isSchema(node.items)) out.push({ schemaUrl: url, pointer: joinPointer(pointer, 'items') } as FieldSchemaRef);
    if (typeof node.$ref === 'string') {
        const target = new URL(node.$ref, store.baseOf(url));
        const fragment = decodeURIComponent(target.hash.slice(1));
        target.hash = '';
        itemsOf(store, target.toString(), fragment, out, seen);
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
        if (Array.isArray(node[keyword])) (node[keyword] as unknown[]).forEach((_, i) => itemsOf(store, url, `${pointer}/${keyword}/${i}`, out, seen));
    }
    return out;
}

interface NodeField {
    name: string;
    container?: string;
    /**
     * For a field a convention adds inside an object of another convention, the keys from the container down to that
     * object, `*` for any array item or map entry: `['multiscales', 'layout', '*']` for `spatial:shape` of spatial.
     */
    path?: string[];
    refs: FieldSchemaRef[];
}

const prefixOfKey = (key: string) => /^([a-z0-9_]+):/i.exec(key)?.[1];

/**
 * Fields a node schema defines: its top-level keys and the entries of its containers. As for STAC extensions, a schema
 * whose container entries have prefixes (`proj:`, `spatial:`) owns only those; its other entries (`multiscales` in the
 * spatial schema) are objects of other conventions, searched for the fields it adds inside them.
 */
function nodeFields(store: SchemaStore, url: string): NodeField[] {
    const top = properties(store, url, '');
    const out: NodeField[] = [];
    const nested: NodeField[] = [];
    for (const [name, refs] of top) {
        if (!(CONTAINERS as readonly string[]).includes(name)) {
            out.push({ name, refs });
            continue;
        }
        const children = new Map<string, FieldSchemaRef[]>();
        for (const ref of refs) properties(store, ref.schemaUrl, ref.pointer, children);
        const prefixes = new Set([...children.keys()].map(prefixOfKey).filter((p): p is string => !!p));
        const own = (key: string) => prefixes.size === 0 || prefixes.has(prefixOfKey(key) ?? '');
        const seen = new Set<string>();
        const visit = (ref: FieldSchemaRef, path: string[]) => {
            const key = `${ref.schemaUrl}#${ref.pointer}`;
            if (seen.has(key) || path.length > 6) return;
            seen.add(key);
            for (const [child, childRefs] of properties(store, ref.schemaUrl, ref.pointer)) {
                if (own(child)) {
                    const existing = nested.find((f) => f.name === child && f.path!.join('/') === path.join('/'));
                    if (existing) existing.refs.push(...childRefs);
                    else nested.push({ name: child, container: name, path, refs: [...childRefs] });
                } else childRefs.forEach((r) => visit(r, [...path, child]));
            }
            for (const item of itemsOf(store, ref.schemaUrl, ref.pointer)) visit(item, [...path, '*']);
        };
        for (const [child, childRefs] of children) {
            if (own(child)) out.push({ name: child, container: name, refs: childRefs });
            else childRefs.forEach((r) => visit(r, [child]));
        }
    }
    return [...out, ...nested];
}

/** Pointers of the objects at `path` below `base` (`*` for every array item or map entry). */
function expand(doc: JsonObject, base: string, path: string[]): string[] {
    let pointers = [base];
    for (const segment of path) {
        pointers = pointers.flatMap((pointer) => {
            const value = getAt(doc, pointer);
            if (segment === '*') {
                if (Array.isArray(value)) return value.map((_, i) => joinPointer(pointer, i));
                return isSchema(value) ? Object.keys(value).map((key) => joinPointer(pointer, key)) : [];
            }
            return isSchema(value) && segment in value ? [joinPointer(pointer, segment)] : [];
        });
    }
    return pointers.filter((pointer) => isSchema(getAt(doc, pointer)));
}

/** A copy of `node` with `name` set to `value` in the object at `pointer`. */
function setAt(node: JsonObject, pointer: string, name: string, value: Json): JsonObject {
    const out = clone(node);
    (getAt(out, pointer) as JsonObject)[name] = value;
    return out;
}

/** The `zarr_conventions` entry a Zarr convention schema requires: the constants of its convention metadata object. */
function conventionMetadata(store: SchemaStore, url: string): JsonObject | undefined {
    const definition = store.resolveAt(url, '/$defs/conventionMetadata/properties');
    if (!isSchema(definition)) return undefined;
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(definition)) if (isSchema(value) && 'const' in value) out[key] = value.const as Json;
    return out;
}

function invalidCandidates(sample: Json): Json[] {
    const all: Json[] = [{ invalid: true }, 'invalid', 12345, true, [true]];
    return all.filter((value) => typeof value !== typeof sample || Array.isArray(value) !== Array.isArray(sample));
}

function set(node: JsonObject, field: NodeField, value: Json | undefined): JsonObject {
    const out = clone(node);
    const target = field.container ? ((out[field.container] ??= {}) as JsonObject) : out;
    if (value === undefined) delete target[field.name];
    else target[field.name] = value;
    // Every Zarr and netCDF node has attributes; other containers exist only when they hold something.
    if (field.container && field.container !== 'attributes' && Object.keys(target).length === 0) delete out[field.container];
    return out;
}

/**
 * Where each field of the selected convention schemas, and of the formats they apply to (and the `formats` given), can go:
 * probed like STAC placements, by placing every field with an example value into a minimal node of each node type and
 * dropping those the schemas reject. A field is `validated` where an invalid value makes the node fail, `presence` where any
 * value passes.
 */
export async function probeEmbedded(store: SchemaStore, conventionUrls: readonly string[], formatIds: readonly string[] = []): Promise<EmbeddedProbeResult> {
    const sampler = new Sampler(store);
    const conventions: { url: string; formats: string[] }[] = [];
    const sources: EmbeddedSourceInfo[] = [];
    for (const url of conventionUrls) {
        const known = conventionOfSchema(url);
        try {
            await store.validator(url);
            const fields = nodeFields(store, url);
            conventions.push({ url, formats: known?.convention.formats ?? DATA_FORMATS.map((f) => f.id) });
            sources.push(describe(store, url, fields, known?.convention.kind ?? 'zarr-convention', known?.convention.formats ?? DATA_FORMATS.map((f) => f.id),
                known ? known.convention.title : url, known?.version.replace(/^v/, '')));
        } catch (error) {
            sources.push({ key: url, url, title: known?.convention.title ?? url, prefixes: [], fields: [], unsampled: [], docs: {}, kind: known?.convention.kind ?? 'zarr-convention',
                containers: {}, formats: known?.convention.formats ?? [], error: error instanceof Error ? error.message : String(error) });
        }
    }
    const formats = DATA_FORMATS.filter((format) => formatIds.includes(format.id) || conventions.some((c) => c.formats.includes(format.id)));
    // Every format's containers are needed to tell which container a convention field belongs to.
    for (const format of DATA_FORMATS) await store.validator(format.schema);
    const formatFields = new Map<string, NodeField[]>();
    for (const format of formats) {
        await store.validator(format.schema);
        const fields = nodeFields(store, format.schema);
        formatFields.set(format.id, fields);
        sources.unshift(describe(store, format.schema, fields, 'format', [format.id], format.title));
    }
    // Keys every format schema defines at the top level only wire a convention's fields into the node.
    const wiring = new Set(formats.flatMap((format) => formatFields.get(format.id)!.filter((f) => !f.container).map((f) => f.name)));
    for (const source of sources) {
        if (source.kind === 'format') continue;
        source.fields = source.fields.filter((name) => source.containers[name] !== undefined || !wiring.has(name));
        source.fields = source.fields.filter((name) => name !== 'zarr_conventions');
    }

    const nodes: NodeTemplate[] = [];
    for (const format of formats) {
        for (const nodeType of format.nodeTypes) {
            nodes.push(await probeNode(store, sampler, format, nodeType, formatFields.get(format.id)!, conventions.filter((c) => c.formats.includes(format.id)), sources));
        }
    }
    return { sources, nodes };
}

function describe(store: SchemaStore, url: string, fields: NodeField[], kind: EmbeddedSourceInfo['kind'], formats: string[], title: string, version?: string): EmbeddedSourceInfo {
    const docs: SourceInfo['docs'] = {};
    const containers: Record<string, string | undefined> = {};
    for (const field of fields) {
        const doc = fieldDoc(store, field.refs);
        if (doc && !docs[field.name]) docs[field.name] = doc;
        if (!(field.name in containers)) containers[field.name] = field.container;
    }
    const names = [...new Set(fields.map((f) => f.name))];
    const prefixes = [...new Set(names.map((n) => /^([a-z0-9_]+):/i.exec(n)?.[1]).filter((p): p is string => !!p))];
    return { key: url, url, title, version, prefixes, fields: names, unsampled: [], docs, kind, containers, formats };
}

async function probeNode(store: SchemaStore, sampler: Sampler, format: DataFormat, nodeType: string, formatFields: NodeField[],
    conventions: { url: string }[], sources: EmbeddedSourceInfo[]): Promise<NodeTemplate> {
    const formatValidate = await store.validator(format.schema);
    const containersOf = (schema: string) => new Set([...properties(store, schema, '').keys()].filter((key) => (CONTAINERS as readonly string[]).includes(key)));
    const ownContainers = containersOf(format.schema);
    const allContainers = new Set(DATA_FORMATS.flatMap((f) => (store.getDocument(f.schema) ? [...containersOf(f.schema)] : [])));
    const base = clone(BASE_NODES[format.id]![nodeType]!);
    const placements: Placement[] = [];
    const notApplicable: string[] = [];
    const sample = (field: NodeField): Json[] => field.refs.flatMap((ref) => sampler.samplesAt(ref.schemaUrl, ref.pointer)).slice(0, 4);
    const location = (field: NodeField) => (field.container ? joinPointer('', field.container) : '');
    const classify = (node: JsonObject, field: NodeField, value: Json, validators: ValidateFunction[]): PlacementKind =>
        invalidCandidates(value).some((invalid) => validators.some((validate) => !validate(set(node, field, invalid)))) ? 'validated' : 'presence';

    // The format's own fields, one by one: none of them depends on another.
    let template = clone(base);
    for (const field of formatFields) {
        const present = field.container ? (template[field.container] as JsonObject | undefined)?.[field.name] : template[field.name];
        const candidates = present !== undefined ? [present as Json] : sample(field);
        const value = candidates.find((candidate) => formatValidate(set(template, field, candidate)));
        if (value === undefined) continue;
        if (present === undefined) template = set(template, field, value);
        placements.push({ source: format.schema, field: field.name, location: location(field), kind: classify(template, field, value, [formatValidate]) });
    }
    // Each convention's fields, then all of them in one example node.
    let combined = clone(template);
    const applied: ValidateFunction[] = [];
    for (const { url } of conventions) {
        const validate = await store.validator(url);
        const source = sources.find((s) => s.key === url)!;
        const fields = nodeFields(store, url).filter((field) => !field.path && source.fields.includes(field.name) && source.containers[field.name] === field.container
            // A container of another format (`attributes` of Zarr and netCDF, `tags` of TIFF) is not where this format keeps fields.
            && (!field.container || ownContainers.has(field.container) || !allContainers.has(field.container)));
        let node = clone(base);
        const cmo = format.id.startsWith('zarr') ? conventionMetadata(store, url) : undefined;
        if (cmo) node = set(node, { name: 'zarr_conventions', container: 'attributes', refs: [] }, [cmo]);
        // Fields are added one by one, each kept unless it adds errors: required companions (spatial:dimensions of an array)
        // are kept whatever their order, and a convention that cannot apply here (multiscales in an array) keeps its errors.
        const failures = (candidate: JsonObject) => [validate, formatValidate].reduce((count, v) => count + (v(candidate) ? 0 : v.errors?.length ?? 1), 0);
        const values = new Map<NodeField, Json>();
        for (const field of fields) {
            const before = failures(node);
            for (const value of sample(field)) {
                const trial = set(node, field, value);
                if (failures(trial) > before) continue;
                node = trial;
                values.set(field, value);
                break;
            }
        }
        if (!values.size || failures(node) > 0) {
            notApplicable.push(url);
            continue;
        }
        if (cmo) {
            const declared = ((combined.attributes as JsonObject).zarr_conventions as Json[] | undefined) ?? [];
            combined = set(combined, { name: 'zarr_conventions', container: 'attributes', refs: [] }, [...declared, cmo]);
        }
        for (const [field, value] of values) {
            placements.push({ source: url, field: field.name, location: location(field), kind: classify(node, field, value, [validate]) });
            // A field two conventions define (spatial's additions to multiscales) keeps an example value both accept.
            const existing = field.container ? (combined[field.container] as JsonObject | undefined)?.[field.name] : combined[field.name];
            if (existing === undefined) combined = set(combined, field, value);
            else {
                const trial = set(combined, field, value);
                if ([...applied, validate].every((v) => v(trial))) combined = trial;
            }
        }
        applied.push(validate);
    }
    // Fields a convention adds inside the objects of another (spatial's `spatial:shape` in the `layout` of multiscales)
    // are placed only where a selected convention supplies such an object, never on their own.
    const allValidators = [formatValidate, ...applied];
    const failures = (candidate: JsonObject) => allValidators.reduce((count, v) => count + (v(candidate) ? 0 : v.errors?.length ?? 1), 0);
    for (const { url } of conventions) {
        if (notApplicable.includes(url)) continue;
        const validate = await store.validator(url);
        const source = sources.find((s) => s.key === url)!;
        for (const field of nodeFields(store, url).filter((f) => f.path && f.container && ownContainers.has(f.container) && source.fields.includes(f.name))) {
            for (const location of expand(combined, joinPointer('', field.container!), field.path!)) {
                const before = failures(combined);
                const value = sample(field).find((candidate) => failures(setAt(combined, location, field.name, candidate)) <= before);
                if (value === undefined) continue;
                combined = setAt(combined, location, field.name, value);
                const validated = invalidCandidates(value).some((invalid) => !validate(setAt(combined, location, field.name, invalid)));
                placements.push({ source: url, field: field.name, location, kind: validated ? 'validated' : 'presence' });
            }
        }
    }
    const errors: string[] = [];
    if (!formatValidate(combined)) errors.push(...formatErrors(formatValidate.errors, format.title));
    for (const { url } of conventions) {
        if (notApplicable.includes(url)) continue;
        const validate = await store.validator(url);
        if (!validate(combined)) errors.push(...formatErrors(validate.errors, url));
    }
    return { key: `${format.id}:${nodeType}`, format: format.id, formatTitle: format.title, nodeType, doc: combined, placements, notApplicable, valid: errors.length === 0, errors };
}

/** Validates a node of embedded metadata against its format schema and the given convention schemas. */
export async function validateNode(store: SchemaStore, node: JsonObject, formatSchema: string, conventionUrls: readonly string[]): Promise<string[]> {
    const errors: string[] = [];
    for (const url of [formatSchema, ...conventionUrls]) {
        try {
            const validate = await store.validator(url);
            if (!validate(node)) errors.push(...formatErrors(validate.errors, url));
        } catch (error) {
            errors.push(`${url}: schema could not be loaded (${error instanceof Error ? error.message : String(error)})`);
        }
    }
    return errors;
}
