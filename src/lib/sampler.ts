import type { Json, JsonObject } from './model';
import type { SchemaStore } from './schemas';

type Schema = Record<string, unknown>;

const MAX_DEPTH = 7;
const MAX_CANDIDATES = 6;

const FORMAT_SAMPLES: Record<string, string> = {
    'date-time': '2024-01-01T00:00:00Z',
    date: '2024-01-01',
    time: '00:00:00Z',
    duration: 'P1D',
    uri: 'https://example.com/',
    'uri-reference': 'https://example.com/',
    iri: 'https://example.com/',
    'iri-reference': 'https://example.com/',
    url: 'https://example.com/',
    'uri-template': 'https://example.com/{id}',
    email: 'info@example.com',
    'idn-email': 'info@example.com',
    hostname: 'example.com',
    'idn-hostname': 'example.com',
    ipv4: '127.0.0.1',
    ipv6: '::1',
    uuid: '00000000-0000-4000-8000-000000000000',
    regex: '^.*$',
    'json-pointer': '/a',
};

const STRING_GUESSES = [
    'example', 'EPSG:4326', 'x', 'en', '1.0.0', 'A', 'a', '1', 'ffffff', '#ffffff', '10.1000/xyz123', 'MGRS-26WNE',
    '2024-01-01T00:00:00Z', 'PT3H', 'image/png', 'CC-BY-4.0', 'sha256', '1220e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
];

/** Readable values for well-known fields; used first and kept only when the schema accepts them. */
export const FIELD_HINTS: Record<string, Json[]> = {
    'cube:dimensions': [{
        x: { type: 'spatial', axis: 'x', extent: [19.0, 32.0], reference_system: 4326 },
        y: { type: 'spatial', axis: 'y', extent: [59.0, 70.0], reference_system: 4326 },
        time: { type: 'temporal', extent: ['2024-01-01T00:00:00Z', '2024-12-31T00:00:00Z'] },
    }],
    'cube:variables': [
        { tas: { type: 'data', dimensions: ['time', 'y', 'x'], unit: 'K', description: 'Air temperature' } },
        { tas: { dimensions: ['time', 'y', 'x'], unit: 'K', description: 'Air temperature' } },
    ],
    'cf:standard_name': ['air_temperature'],
    'cf:cell_methods': [['mean', null, null]],
    themes: [[{ scheme: 'https://gcmd.earthdata.nasa.gov/kms/concepts/concept_scheme/sciencekeywords', concepts: [{ id: 'EARTH SCIENCE > ATMOSPHERE > ATMOSPHERIC TEMPERATURE' }] }]],
    'sem:concepts': [[{ uri: 'http://vocab.nerc.ac.uk/standard_name/air_temperature/', role: 'variable' }]],
    'table:columns': [[{ name: 'TA', type: 'float64', description: 'Air temperature' }]],
    'table:tables': [{ observations: { name: 'observations', description: 'Observations table' } }],
    'eo:common_name': ['red'],
    'eo:center_wavelength': [0.665],
    'eo:cloud_cover': [12.5],
    'proj:code': ['EPSG:4326'],
    'proj:shape': [[100, 100]],
    'proj:bbox': [[19.0, 59.0, 32.0, 70.0]],
    'proj:transform': [[0.13, 0, 19.0, 0, -0.11, 70.0, 0, 0, 1]],
    'file:checksum': ['1220e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    'zarr:zarr_format': [3],
    'zarr:node_type': ['group'],
    'sci:doi': ['10.1000/xyz123'],
    'classification:classes': [[{ value: 1, name: 'water', description: 'Open water' }]],
};

/** Example values for STAC core Common Metadata fields. */
export const CORE_FIELD_SAMPLES: Record<string, Json[]> = {
    title: ['Example title'],
    description: ['Example description'],
    keywords: [['example']],
    roles: [['data']],
    datetime: ['2024-01-01T00:00:00Z'],
    created: ['2024-01-01T00:00:00Z'],
    updated: ['2024-01-01T00:00:00Z'],
    start_datetime: ['2024-01-01T00:00:00Z'],
    end_datetime: ['2024-12-31T23:59:59Z'],
    license: ['CC-BY-4.0'],
    providers: [[{ name: 'Example provider', roles: ['producer'] }]],
    platform: ['example-platform'],
    instruments: [['example-instrument']],
    constellation: ['example-constellation'],
    mission: ['example-mission'],
    gsd: [10],
    bands: [[{ name: 'b1', description: 'Band 1' }]],
    nodata: [-9999],
    data_type: ['float32'],
    statistics: [{ minimum: 0, maximum: 1 }],
    unit: ['K'],
};

export const CORE_FIELDS_BY_VERSION: Record<string, string[]> = {
    '1.1.0': Object.keys(CORE_FIELD_SAMPLES),
    '1.0.0': ['title', 'description', 'datetime', 'created', 'updated', 'start_datetime', 'end_datetime', 'license', 'providers',
        'platform', 'instruments', 'constellation', 'mission', 'gsd'],
};

function isSchema(value: unknown): value is Schema {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-copies a schema node, making every `$ref` absolute so nodes from different documents can be merged. */
function absolutize(node: unknown, base: string): unknown {
    if (Array.isArray(node)) return node.map((n) => absolutize(n, base));
    if (!isSchema(node)) return node;
    const out: Schema = {};
    for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') out[key] = new URL(value, base).toString();
        else if (key === 'enum' || key === 'const' || key === 'examples' || key === 'default') out[key] = value;
        else out[key] = absolutize(value, base);
    }
    return out;
}

function mergeSchemas(a: Schema, b: Schema): Schema {
    const out: Schema = { ...a };
    for (const [key, value] of Object.entries(b)) {
        if (key === 'required' && Array.isArray(out.required) && Array.isArray(value)) out.required = [...new Set([...out.required, ...value])];
        else if ((key === 'properties' || key === 'patternProperties') && isSchema(out[key]) && isSchema(value)) {
            const merged: Schema = { ...(out[key] as Schema) };
            for (const [prop, sub] of Object.entries(value)) {
                merged[prop] = prop in merged && isSchema(merged[prop]) && isSchema(sub) ? { allOf: [merged[prop], sub] } : sub;
            }
            out[key] = merged;
        } else if (key === 'allOf' && Array.isArray(out.allOf) && Array.isArray(value)) out.allOf = [...out.allOf, ...value];
        else if (key === 'type' && out.type !== undefined) {
            const left = Array.isArray(out.type) ? out.type : [out.type];
            const right = Array.isArray(value) ? value : [value];
            const both = left.filter((t) => right.includes(t) || (t === 'number' && right.includes('integer')));
            out.type = both.length > 0 ? both : value;
        } else out[key] = value;
    }
    return out;
}

/** Generates a string matching a (simple) regular expression, or undefined. */
export function stringFromRegex(pattern: string): string | undefined {
    let i = 0;
    const src = pattern;
    function parseAlternation(): string {
        const branches: string[] = [parseSequence()];
        while (src[i] === '|') {
            i++;
            branches.push(parseSequence());
        }
        return branches.find((b) => b.length > 0) ?? branches[0];
    }
    function parseSequence(): string {
        let out = '';
        while (i < src.length && src[i] !== '|' && src[i] !== ')') {
            let atom = '';
            const c = src[i];
            if (c === '^' || c === '$') { i++; continue; }
            if (c === '(') {
                i++;
                if (src[i] === '?') { i++; if (src[i] === ':' || src[i] === '=' || src[i] === '!') i++; }
                atom = parseAlternation();
                i++;
            } else if (c === '[') {
                i++;
                const negate = src[i] === '^';
                if (negate) i++;
                let first: string | undefined;
                while (i < src.length && src[i] !== ']') {
                    let ch = src[i];
                    if (ch === '\\') { i++; ch = classEscape(src[i]); }
                    if (first === undefined) first = ch;
                    i++;
                }
                i++;
                atom = negate ? 'x' : (first ?? 'a');
            } else if (c === '\\') {
                i++;
                atom = classEscape(src[i]);
                i++;
            } else if (c === '.') { atom = 'a'; i++; } else { atom = c; i++; }
            let min = 1;
            const q = src[i];
            if (q === '*' || q === '?') { min = 0; i++; } else if (q === '+') { min = 1; i++; } else if (q === '{') {
                const end = src.indexOf('}', i);
                min = Number.parseInt(src.slice(i + 1, end).split(',')[0], 10) || 0;
                i = end + 1;
            }
            if (src[i] === '?') i++;
            out += atom.repeat(min);
        }
        return out;
    }
    function classEscape(ch: string): string {
        if (ch === 'd') return '1';
        if (ch === 'w') return 'a';
        if (ch === 's') return ' ';
        if (ch === 'D' || ch === 'W' || ch === 'S') return 'x';
        return ch;
    }
    try {
        const result = parseAlternation();
        return new RegExp(pattern, 'u').test(result) ? result : undefined;
    } catch {
        return undefined;
    }
}

function regexAccepts(pattern: string, value: string): boolean {
    try {
        return new RegExp(pattern, 'u').test(value);
    } catch {
        return false;
    }
}

function uniqueJson(values: Json[]): Json[] {
    const seen = new Set<string>();
    return values.filter((v) => {
        const key = JSON.stringify(v);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export class Sampler {
    constructor(private readonly store: SchemaStore) {}

    private deref(ref: string): Schema | boolean | undefined {
        const url = new URL(ref);
        const pointer = decodeURIComponent(url.hash.slice(1));
        url.hash = '';
        const node = this.store.resolveAt(url.toString(), pointer);
        if (typeof node === 'boolean') return node;
        return isSchema(node) ? (absolutize(node, this.store.baseOf(url.toString())) as Schema) : undefined;
    }

    /** Candidate values for the subschema at `pointer` of the schema at `schemaUrl`. */
    samplesAt(schemaUrl: string, pointer: string): Json[] {
        const node = this.store.resolveAt(schemaUrl, pointer);
        if (typeof node === 'boolean') return node ? ['example'] : [];
        if (!isSchema(node)) return [];
        return this.sample(absolutize(node, this.store.baseOf(schemaUrl)) as Schema, 0, new Set());
    }

    private flatten(schema: Schema, refs: Set<string>, depth = 0): Schema {
        let out: Schema = { ...schema };
        if (typeof out.$ref === 'string' && depth < 10) {
            const ref = out.$ref;
            delete out.$ref;
            if (!refs.has(ref)) {
                const target = this.deref(ref);
                if (isSchema(target)) out = mergeSchemas(this.flatten(target, new Set([...refs, ref]), depth + 1), out);
            }
        }
        if (Array.isArray(out.allOf) && depth < 10) {
            const parts = out.allOf;
            delete out.allOf;
            for (const part of parts) {
                if (isSchema(part)) out = mergeSchemas(out, this.flatten(part, refs, depth + 1));
            }
        }
        return out;
    }

    sample(input: Schema, depth: number, refs: Set<string>): Json[] {
        if (depth > MAX_DEPTH) return [];
        const schema = this.flatten(input, refs);
        const results: Json[] = [];
        if ('const' in schema) return [schema.const as Json];
        if (Array.isArray(schema.examples)) results.push(...(schema.examples as Json[]));
        if (schema.default !== undefined) results.push(schema.default as Json);
        if (Array.isArray(schema.enum)) {
            const values = schema.enum as Json[];
            return uniqueJson([...results.filter((r) => values.some((v) => JSON.stringify(v) === JSON.stringify(r))), ...values.filter((v) => v !== null), ...values]).slice(0, 3);
        }

        const branches = (Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : undefined) as unknown[] | undefined;
        if (branches) {
            const rest: Schema = { ...schema };
            delete rest.oneOf;
            delete rest.anyOf;
            delete rest.examples;
            delete rest.default;
            for (const branch of branches) {
                if (!isSchema(branch)) continue;
                results.push(...this.sample(mergeSchemas(rest, this.flatten(branch, refs)), depth + 1, refs));
                if (results.length >= MAX_CANDIDATES) break;
            }
            return uniqueJson(results).slice(0, MAX_CANDIDATES);
        }

        let types: string[];
        if (Array.isArray(schema.type)) types = schema.type as string[];
        else if (typeof schema.type === 'string') types = [schema.type];
        else if (schema.properties || schema.required || schema.additionalProperties || schema.patternProperties) types = ['object'];
        else if (schema.items || schema.contains || schema.prefixItems) types = ['array'];
        else if (schema.minimum !== undefined || schema.maximum !== undefined) types = ['number'];
        else if (schema.pattern || schema.format || schema.minLength) types = ['string'];
        else types = ['string'];
        const ordered = [...types.filter((t) => t !== 'null'), ...types.filter((t) => t === 'null')];

        for (const type of ordered) {
            if (type === 'object') results.push(...this.sampleObject(schema, depth, refs));
            else if (type === 'array') results.push(...this.sampleArray(schema, depth, refs));
            else if (type === 'string') results.push(...this.sampleString(schema));
            else if (type === 'number' || type === 'integer') results.push(...this.sampleNumber(schema, type === 'integer'));
            else if (type === 'boolean') results.push(true, false);
            else if (type === 'null') results.push(null);
        }
        return uniqueJson(results).slice(0, MAX_CANDIDATES);
    }

    private first(schema: unknown, depth: number, refs: Set<string>): Json | undefined {
        if (schema === true) return 'example';
        if (!isSchema(schema)) return undefined;
        return this.sample(schema, depth + 1, refs)[0];
    }

    private sampleObject(schema: Schema, depth: number, refs: Set<string>): Json[] {
        const properties = isSchema(schema.properties) ? schema.properties : {};
        const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
        const build = (keys: string[]): JsonObject => {
            const out: JsonObject = {};
            for (const key of keys) {
                const value = key in properties ? this.first(properties[key], depth, refs) : 'example';
                if (value !== undefined) out[key] = value;
            }
            return out;
        };
        const candidates: JsonObject[] = [];
        const allKeys = [...new Set([...required, ...Object.keys(properties)])].filter((k) => properties[k] !== false);
        candidates.push(build(allKeys));
        if (allKeys.length !== required.length) candidates.push(build(required));

        const entrySchema = isSchema(schema.additionalProperties) ? schema.additionalProperties : undefined;
        const patterns = isSchema(schema.patternProperties) ? Object.entries(schema.patternProperties) : [];
        if (entrySchema || patterns.length > 0) {
            const names = isSchema(schema.propertyNames) && typeof schema.propertyNames.pattern === 'string' ? schema.propertyNames.pattern : undefined;
            for (const candidate of candidates) {
                if (Object.keys(candidate).length > 0 && !(typeof schema.minProperties === 'number' && Object.keys(candidate).length < schema.minProperties)) continue;
                const [pattern, sub] = patterns.find(([, s]) => isSchema(s) && Object.keys(s).length > 0) ?? [undefined, entrySchema];
                const keyPattern = pattern ?? names;
                const key = keyPattern
                    ? (['example', 'data', 'x', 'en', 'b1'].find((k) => regexAccepts(keyPattern, k)) ?? stringFromRegex(keyPattern) ?? 'example')
                    : 'example';
                const value = this.first(sub, depth, refs);
                if (value !== undefined) candidate[key] = value;
            }
        }
        return candidates;
    }

    private sampleArray(schema: Schema, depth: number, refs: Set<string>): Json[] {
        const tuple = Array.isArray(schema.prefixItems) ? schema.prefixItems : Array.isArray(schema.items) ? schema.items : undefined;
        if (tuple) {
            const values = tuple.map((s) => this.first(s, depth, refs) ?? 'example');
            return [values];
        }
        const itemSchema = isSchema(schema.items) ? schema.items : isSchema(schema.contains) ? schema.contains : undefined;
        if (schema.maxItems === 0) return [[]];
        const count = Math.max(typeof schema.minItems === 'number' ? schema.minItems : 1, 1);
        if (!itemSchema) return [Array.from({ length: count }, (_, i) => `example${i || ''}`)];
        const itemCandidates = this.sample(itemSchema, depth + 1, refs);
        if (itemCandidates.length === 0) return [];
        const items: Json[] = [];
        for (let i = 0; i < count; i++) {
            const base = itemCandidates[i % itemCandidates.length];
            if (schema.uniqueItems && i >= itemCandidates.length) {
                items.push(typeof base === 'number' ? base + i : typeof base === 'string' ? `${base}${i}` : base);
            } else items.push(base);
        }
        const out: Json[] = [items];
        if (itemCandidates.length > 1 && count === 1) out.push([itemCandidates[1]]);
        return out;
    }

    private sampleString(schema: Schema): Json[] {
        const out: string[] = [];
        const pattern = typeof schema.pattern === 'string' ? schema.pattern : undefined;
        if (typeof schema.format === 'string' && FORMAT_SAMPLES[schema.format]) out.push(FORMAT_SAMPLES[schema.format]);
        if (pattern) {
            out.push(...STRING_GUESSES.filter((g) => regexAccepts(pattern, g)).slice(0, 2));
            const generated = stringFromRegex(pattern);
            if (generated !== undefined) out.push(generated);
        } else out.push('example');
        const min = typeof schema.minLength === 'number' ? schema.minLength : 0;
        const max = typeof schema.maxLength === 'number' ? schema.maxLength : Infinity;
        return out.map((s) => (s.length < min ? s + 'x'.repeat(min - s.length) : s.length > max ? s.slice(0, max) : s));
    }

    private sampleNumber(schema: Schema, integer: boolean): Json[] {
        const exMin = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined;
        const exMax = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined;
        let min = typeof schema.minimum === 'number' ? schema.minimum : exMin !== undefined ? exMin + (integer ? 1 : 0.5) : undefined;
        let max = typeof schema.maximum === 'number' ? schema.maximum : exMax !== undefined ? exMax - (integer ? 1 : 0.5) : undefined;
        if (schema.exclusiveMinimum === true && min !== undefined) min += integer ? 1 : 0.5;
        if (schema.exclusiveMaximum === true && max !== undefined) max -= integer ? 1 : 0.5;
        let value: number;
        if (min !== undefined && max !== undefined) value = (min + max) / 2;
        else if (min !== undefined) value = min + 1;
        else if (max !== undefined) value = Math.min(max, 1);
        else value = 1;
        if (integer) value = Math.round(value);
        if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) value = Math.round(value / schema.multipleOf) * schema.multipleOf;
        return [value];
    }
}
