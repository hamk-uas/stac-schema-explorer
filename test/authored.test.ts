import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import { AUTHORED_BASE, localPath } from '../scripts/manifest.mjs';
import { documentation, documentationSites, getPointer, inCondition, valueList, walkSchemas } from '../scripts/schema-tools.mjs';
import { authoredUrls, vendoredUrls } from '../scripts/vendored.mjs';
import { fixtureStore } from './helpers';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (url: string) => JSON.parse(readFileSync(join(root, 'schemas', localPath(url)), 'utf8'));
const fixture = (name: string) => JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'embedded', name), 'utf8'));
const authored: string[] = authoredUrls();
const schemaUrls = authored.filter((url) => url.endsWith('/schema.json'));
const known = new Set<string>([...authored, ...vendoredUrls('schemas')]);
const resolve = (url: string) => (known.has(url) ? read(url) : undefined);

type Schema = Record<string, unknown>;
interface Registry {
    formats: { id: string; schema: string; mediaTypes: string[]; nodeTypes: string[] }[];
    conventions: {
        id: string; kind: string; formats: string[]; authored: boolean;
        declaration?: { zarrConventions?: { uuid: string }; conventionsAttribute?: string };
        detection?: string[][];
        versions: { version: string; schema: string }[];
    }[];
}
interface CrosswalkEntry {
    id: string;
    embedded: { schema: string; path: string[]; nodes: string | string[] };
    stac: { schema?: string; paths: (string | number)[][]; in: string[] };
    relation: 'same' | 'converted' | 'related';
    conversion?: string;
}
const registry: Registry = read(`${AUTHORED_BASE}registry.json`);
const crosswalk: { entries: CrosswalkEntry[] } = read(`${AUTHORED_BASE}crosswalk.json`);

/** The node itself and the nodes its `$ref`s and `allOf`/`anyOf`/`oneOf` branches lead to, within one document. */
function alternatives(node: unknown, doc: Schema, seen = new Set<unknown>()): Schema[] {
    if (!node || typeof node !== 'object' || seen.has(node)) return [];
    seen.add(node);
    const schema = node as Schema;
    const out = [schema];
    if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#')) out.push(...alternatives(getPointer(doc, schema.$ref.slice(1)), doc, seen));
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
        if (Array.isArray(schema[keyword])) for (const branch of schema[keyword] as unknown[]) out.push(...alternatives(branch, doc, seen));
    }
    return out;
}

/** Schema nodes that a path into an instance reaches; `*` stands for any key or index. */
function nodesAt(doc: Schema, path: readonly string[]): Schema[] {
    let nodes = alternatives(doc, doc);
    for (const segment of path) {
        const next: Schema[] = [];
        for (const node of nodes) {
            const properties = node.properties as Record<string, unknown> | undefined;
            if (segment !== '*' && properties?.[segment]) next.push(...alternatives(properties[segment], doc));
            if (segment === '*' || /^\d+$/.test(segment)) {
                if (node.items && typeof node.items === 'object') next.push(...alternatives(node.items, doc));
            }
            if (segment === '*' && node.additionalProperties && typeof node.additionalProperties === 'object') {
                next.push(...alternatives(node.additionalProperties, doc));
            }
        }
        nodes = next;
    }
    return nodes;
}

describe('authored format and convention schemas', () => {
    it('are published under the authored base URL', () => {
        expect(schemaUrls.length).toBeGreaterThan(5);
        for (const url of authored) expect(url.startsWith(AUTHORED_BASE)).toBe(true);
    });

    it.each(schemaUrls)('%s has its URL as $id and says that it is unofficial', (url) => {
        const schema = read(url);
        expect(schema.$id).toBe(url);
        expect(schema.description).toMatch(/Unofficial JSON Schema/);
    });

    it.each(schemaUrls)('%s compiles', async (url) => {
        await expect(fixtureStore().validator(url)).resolves.toBeTypeOf('function');
    });

    it.each(schemaUrls)('%s documents every field', (url) => {
        const missing = documentationSites(read(url), { core: true })
            .filter((site: { node: object }) => {
                const docs = documentation(site.node, url, resolve);
                return !docs.title || !docs.description;
            })
            .map((site: { pointer: string }) => site.pointer);
        expect(missing).toEqual([]);
    });

    it.each(schemaUrls)('%s lists allowed values as titled constants', (url) => {
        const problems: string[] = [];
        const ajv = new Ajv({ strict: false });
        walkSchemas(read(url), (node: Record<string, unknown>, pointer: string, context: unknown) => {
            if (Array.isArray(node.enum) && !inCondition(context)) problems.push(`${pointer}: enum`);
            const list = valueList(node);
            if (!list) return;
            const validate = ajv.compile({ [list.keyword]: list.values });
            for (const value of list.values) {
                if (!value.title) problems.push(`${pointer}: ${JSON.stringify(value.const)} has no title`);
                if (!validate(value.const)) problems.push(`${pointer}: ${JSON.stringify(value.const)} is listed more than once`);
            }
        });
        expect(problems).toEqual([]);
    });
});

describe('registry', () => {
    const formatIds = registry.formats.map((format) => format.id);

    it('has unique identifiers', () => {
        expect(new Set(formatIds).size).toBe(formatIds.length);
        const ids = registry.conventions.map((convention) => convention.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('refers to vendored or authored schemas', () => {
        for (const format of registry.formats) expect(known.has(format.schema), format.schema).toBe(true);
        for (const convention of registry.conventions) {
            for (const version of convention.versions) expect(known.has(version.schema), version.schema).toBe(true);
            expect(convention.versions.every((version) => version.schema.startsWith(AUTHORED_BASE)), convention.id).toBe(convention.authored);
        }
    });

    it('applies each convention to known formats, by declaration or detection', () => {
        for (const convention of registry.conventions) {
            expect(convention.formats.every((format) => formatIds.includes(format)), convention.id).toBe(true);
            expect(Boolean(convention.declaration) !== Boolean(convention.detection), convention.id).toBe(true);
            if (convention.declaration?.conventionsAttribute) expect(() => new RegExp(convention.declaration!.conventionsAttribute!)).not.toThrow();
            for (const path of convention.detection ?? []) {
                const schema = read(convention.versions[0]!.schema);
                expect(nodesAt(schema, path).length, `${convention.id}: ${path.join('/')}`).toBeGreaterThan(0);
            }
        }
    });

    it('identifies Zarr conventions by the UUID their schema declares', () => {
        for (const convention of registry.conventions.filter((c) => c.kind === 'zarr-convention')) {
            const schema = read(convention.versions[0]!.schema);
            expect(getPointer(schema, '/$defs/conventionMetadata/properties/uuid/const')).toBe(convention.declaration?.zarrConventions?.uuid);
        }
    });
});

describe('STAC crosswalk', () => {
    const coreFields = new Set<string>();
    for (const url of vendoredUrls('schemas').filter((u: string) => u.startsWith('https://schemas.stacspec.org/v1.1.0/'))) {
        walkSchemas(read(url), (node: Record<string, unknown>) => {
            if (node.properties && typeof node.properties === 'object') Object.keys(node.properties).forEach((key) => coreFields.add(key));
        });
    }

    it('has unique identifiers', () => {
        const ids = crosswalk.entries.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it.each(crosswalk.entries.map((entry) => [entry.id, entry] as const))('%s points to a documented embedded field', (_id, entry) => {
        expect(known.has(entry.embedded.schema), entry.embedded.schema).toBe(true);
        const nodes = nodesAt(read(entry.embedded.schema), entry.embedded.path);
        expect(nodes.some((node) => typeof node.title === 'string' && typeof node.description === 'string')).toBe(true);
    });

    it.each(crosswalk.entries.map((entry) => [entry.id, entry] as const))('%s points to a STAC field', (_id, entry) => {
        if (entry.stac.schema) expect(known.has(entry.stac.schema), entry.stac.schema).toBe(true);
        const extensionFields = new Set<string>();
        if (entry.stac.schema) {
            walkSchemas(read(entry.stac.schema), (node: Record<string, unknown>) => {
                if (node.properties && typeof node.properties === 'object') Object.keys(node.properties).forEach((key) => extensionFields.add(key));
            });
        }
        for (const path of entry.stac.paths) {
            if (path.length === 0) continue;
            const field = String(path[0]);
            expect(coreFields.has(field) || extensionFields.has(field), field).toBe(true);
        }
        expect(entry.relation === 'converted').toBe(Boolean(entry.conversion));
    });
});

describe('embedded metadata of the lab catalogs', () => {
    const zarrNodes = (doc: Schema): Schema[] => {
        const nested = (doc.consolidated_metadata as { metadata?: Record<string, Schema> } | undefined)?.metadata ?? {};
        return [doc, ...Object.values(nested)];
    };
    const valid = async (url: string, node: unknown) => {
        const validate = await fixtureStore().validator(url);
        return validate(node) ? [] : validate.errors;
    };
    const conventionSchemas = (node: Schema) => ((node.attributes as Schema | undefined)?.zarr_conventions as { schema_url: string }[] | undefined ?? [])
        .map((declared) => declared.schema_url);

    it.each(['arctic-ch4.zarr.json', 'blue-marble.zarr.json', 'tessera.zarr.json'])('%s nodes are valid Zarr v3', async (name) => {
        for (const node of zarrNodes(fixture(name))) expect(await valid(`${AUTHORED_BASE}zarr/v3/schema.json`, node)).toEqual([]);
    });

    it.each(['arctic-ch4.zarr.json', 'blue-marble.zarr.json'])('%s nodes are valid against their declared Zarr conventions', async (name) => {
        for (const node of zarrNodes(fixture(name))) {
            for (const url of conventionSchemas(node)) expect(await valid(url, node), url).toEqual([]);
        }
    });

    it('arctic-ch4 attributes are valid CF and ACDD', async () => {
        for (const node of zarrNodes(fixture('arctic-ch4.zarr.json'))) {
            expect(await valid(`${AUTHORED_BASE}cf/v1.13/schema.json`, node)).toEqual([]);
            expect(await valid(`${AUTHORED_BASE}acdd/v1.3/schema.json`, node)).toEqual([]);
            expect(await valid(`${AUTHORED_BASE}gdal/v0.1.0/schema.json`, node)).toEqual([]);
        }
    });

    it('EOPF nodes are valid Zarr v2 with xarray, CF and EOPF attributes', async () => {
        for (const { node } of fixture('eopf-nodes.json')) {
            for (const schema of ['zarr/v2', 'xarray/v0.1.0', 'cf/v1.13', 'eopf/v0.1.0']) {
                expect(await valid(`${AUTHORED_BASE}${schema}/schema.json`, node), schema).toEqual([]);
            }
        }
    });

    it('HIKET netCDF nodes are valid netCDF with CF attributes', async () => {
        for (const { node } of fixture('hiket-co2-flux.netcdf.json')) {
            expect(await valid(`${AUTHORED_BASE}netcdf/v0.1.0/schema.json`, node)).toEqual([]);
            expect(await valid(`${AUTHORED_BASE}cf/v1.13/schema.json`, node)).toEqual([]);
        }
    });

    it('Earth Genome COG nodes are valid TIFF with GeoTIFF and GDAL metadata', async () => {
        for (const { node } of fixture('earth-genome-b04.tiff.json')) {
            for (const schema of ['tiff/v0.1.0', 'geotiff/v1.1', 'gdal/v0.1.0']) {
                expect(await valid(`${AUTHORED_BASE}${schema}/schema.json`, node), schema).toEqual([]);
            }
        }
    });

    it('rejects a Zarr v3 array without its required metadata', async () => {
        expect(await valid(`${AUTHORED_BASE}zarr/v3/schema.json`, { zarr_format: 3, node_type: 'array' })).not.toEqual([]);
    });
});
