import Ajv, { type AnySchemaObject, type ErrorObject, type ValidateFunction } from 'ajv';
import Ajv2019 from 'ajv/dist/2019.js';
import Ajv2020 from 'ajv/dist/2020.js';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import addFormats from 'ajv-formats';
import addFormatsDraft2019 from 'ajv-formats-draft2019';

import { isHttpUrl, normalizeSchemaUrl } from './extensions';
import { CORE, type StacType } from './model';
import { escapePointerSegment, splitPointer } from './pointer';
import { isVendored } from './vendored';

export type FetchJson = (url: string) => Promise<unknown>;

export const networkFetchJson: FetchJson = async (url) => {
    const response = await fetch(url, { credentials: 'omit', headers: { accept: 'application/schema+json, application/json' } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} (${url})`);
    return response.json();
};

const CORE_PATHS: Record<StacType, string> = {
    Catalog: 'catalog-spec/json-schema/catalog.json',
    Collection: 'collection-spec/json-schema/collection.json',
    Feature: 'item-spec/json-schema/item.json',
};

export function coreSchemaUrl(type: StacType, stacVersion: string): string {
    return `https://schemas.stacspec.org/v${stacVersion}/${CORE_PATHS[type]}`;
}

type Draft = '07' | '2019' | '2020';

function draftOf(schema: unknown): Draft {
    const uri = typeof schema === 'object' && schema !== null ? String((schema as { $schema?: unknown }).$schema ?? '') : '';
    if (uri.includes('2020-12')) return '2020';
    if (uri.includes('2019-09')) return '2019';
    return '07';
}

/** A pointer for use inside a URI fragment. */
export function pointerToFragment(pointer: string): string {
    return splitPointer(pointer).map((s) => '/' + encodeURIComponent(escapePointerSegment(s)).replaceAll('%3A', ':')).join('');
}

/**
 * Loads JSON Schemas once per page, compiles validators with the Ajv flavour matching each schema's draft,
 * and lets the rest of the engine walk raw schema documents by absolute URI.
 */
export class SchemaStore {
    private readonly documents = new Map<string, unknown>();
    private readonly pending = new Map<string, Promise<unknown>>();
    private readonly ajvs = new Map<Draft, Ajv>();
    private readonly validators = new Map<string, Promise<ValidateFunction>>();
    private readonly subValidators = new Map<string, ValidateFunction | null>();

    constructor(private readonly fetchJson: FetchJson = networkFetchJson) {}

    async load(url: string): Promise<unknown> {
        const key = normalizeSchemaUrl(url);
        const known = this.documents.get(key);
        if (known !== undefined) return known;
        let pending = this.pending.get(key);
        if (!pending) {
            // A relative or non-HTTP value (a mistyped share link) would otherwise be fetched relative to the app.
            if (!isHttpUrl(key)) {
                const invalid = Promise.reject(new Error(`not a schema URL or name@version: ${url}`));
                invalid.catch(() => undefined);
                return invalid;
            }
            const keyOrigin = new URL(key).origin;
            pending = this.fetchJson(key).then((raw) => {
                if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`not a JSON Schema object: ${key}`);
                let schema = raw as Record<string, unknown>;
                const id = schema.$id;
                if (typeof id === 'string') {
                    let safeId: string | undefined;
                    try {
                        const resolved = new URL(id, key);
                        const normalizedId = normalizeSchemaUrl(resolved.toString());
                        if ((resolved.protocol === 'http:' || resolved.protocol === 'https:')
                            && resolved.origin === keyOrigin
                            && (!isVendored(normalizedId) || isVendored(key))) {
                            safeId = normalizedId;
                        }
                    } catch {
                        // Malformed $id: rebind to key below.
                    }
                    if (safeId) {
                        this.documents.set(key, schema);
                        if (!this.documents.has(safeId)) this.documents.set(safeId, schema);
                    } else {
                        // Cross-origin, non-HTTP(S), or shadowing a vendored schema (e.g. a draft fork of a published
                        // extension): rebind $id to the loaded URL so Ajv keeps it isolated from the published schema.
                        schema = { ...schema, $id: key };
                        this.documents.set(key, schema);
                    }
                } else {
                    this.documents.set(key, schema);
                }
                return schema;
            });
            pending.catch(() => this.pending.delete(key));
            this.pending.set(key, pending);
        }
        return pending;
    }

    getDocument(url: string): unknown {
        return this.documents.get(normalizeSchemaUrl(url));
    }

    /** URLs of the loaded documents (and their `$id`s). */
    documentUrls(): string[] {
        return [...this.documents.keys()];
    }

    /** The `$id` of a loaded schema (normalized, same HTTP(S) origin), or the URL it was loaded from. */
    baseOf(url: string): string {
        const key = normalizeSchemaUrl(url);
        const doc = this.getDocument(key) as { $id?: unknown } | undefined;
        const id = doc?.$id;
        if (typeof id === 'string') {
            try {
                const resolved = new URL(id, key);
                if ((resolved.protocol === 'http:' || resolved.protocol === 'https:') && resolved.origin === new URL(key).origin) {
                    return normalizeSchemaUrl(resolved.toString());
                }
            } catch {
                // Fall back to the loaded URL.
            }
        }
        return key;
    }

    /** Resolves an absolute URI with an optional JSON Pointer fragment to a node of a loaded schema. */
    resolve(uri: string): unknown {
        const hashAt = uri.indexOf('#');
        const base = hashAt >= 0 ? uri.slice(0, hashAt) : uri;
        const fragment = hashAt >= 0 ? decodeURIComponent(uri.slice(hashAt + 1)) : '';
        return this.resolveAt(base, fragment);
    }

    resolveAt(schemaUrl: string, pointer: string): unknown {
        let node = this.documents.get(normalizeSchemaUrl(schemaUrl));
        for (const segment of splitPointer(pointer)) {
            if (node === null || typeof node !== 'object') return undefined;
            node = (node as Record<string, unknown>)[segment];
        }
        return node;
    }

    private ajvFor(draft: Draft): Ajv {
        let ajv = this.ajvs.get(draft);
        if (!ajv) {
            const options = {
                allErrors: false,
                strict: false,
                logger: false as const,
                validateSchema: false,
                loadSchema: (uri: string) => this.load(uri) as Promise<AnySchemaObject>,
            };
            ajv = draft === '2020' ? new Ajv2020(options) : draft === '2019' ? new Ajv2019(options) : new Ajv(options);
            // A 2019-09 or 2020-12 schema may `$ref` a draft-07 one (the coordinate set convention reaches PROJJSON):
            // without its meta-schema, compileAsync tries to load it through loadSchema and never settles.
            if (draft !== '07') ajv.addMetaSchema(draft7MetaSchema);
            addFormats(ajv);
            addFormatsDraft2019(ajv);
            this.ajvs.set(draft, ajv);
        }
        return ajv;
    }

    /** A compiled validator for a whole schema document. */
    validator(url: string): Promise<ValidateFunction> {
        const key = normalizeSchemaUrl(url);
        let validator = this.validators.get(key);
        if (!validator) {
            validator = this.load(key).then((schema) => this.ajvFor(draftOf(schema)).compileAsync({ $ref: key }));
            validator.catch(() => this.validators.delete(key));
            this.validators.set(key, validator);
        }
        return validator;
    }

    /**
     * A validator for a subschema (`<schema url>#<pointer>`) of an already compiled schema, or null when Ajv
     * cannot compile it on its own.
     */
    subValidator(schemaUrl: string, pointer: string): ValidateFunction | null {
        const key = `${normalizeSchemaUrl(schemaUrl)}#${pointer}`;
        if (this.subValidators.has(key)) return this.subValidators.get(key) ?? null;
        let validator: ValidateFunction | null = null;
        try {
            const ajv = this.ajvFor(draftOf(this.getDocument(schemaUrl)));
            validator = ajv.compile({ $ref: `${this.baseOf(schemaUrl)}#${pointerToFragment(pointer)}` });
        } catch {
            validator = null;
        }
        this.subValidators.set(key, validator);
        return validator;
    }
}

/**
 * Replaces the errors of a failed value list (`oneOf` of titled constants: one `const` error per allowed value plus
 * a `oneOf` error) with one `enum`-like error listing the allowed values.
 */
export function collapseValueListErrors(errors: readonly ErrorObject[]): ErrorObject[] {
    const out: ErrorObject[] = [];
    const consumed = new Set<ErrorObject>();
    for (const error of errors) {
        if (error.keyword !== 'oneOf' && error.keyword !== 'anyOf') continue;
        const prefix = `${error.schemaPath}/`;
        const branches = errors.filter((e) => e !== error && e.schemaPath.startsWith(prefix) && e.instancePath === error.instancePath);
        if (branches.length === 0 || !branches.every((e) => e.keyword === 'const' && /^\d+\/const$/.test(e.schemaPath.slice(prefix.length)))) continue;
        const allowedValues = branches.map((e) => e.params.allowedValue);
        consumed.add(error);
        branches.forEach((e) => consumed.add(e));
        out.push({ ...error, keyword: 'enum', params: { allowedValues }, message: `must be one of ${allowedValues.map((v) => JSON.stringify(v)).join(', ')}` });
    }
    return [...errors.filter((e) => !consumed.has(e)), ...out];
}

export function formatErrors(errors: readonly ErrorObject[] | null | undefined, source: string): string[] {
    return collapseValueListErrors(errors ?? []).slice(0, 5).map((e) => `${source === CORE ? 'core' : source}: ${e.instancePath || '/'} ${e.message ?? e.keyword}`);
}
