import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import { draftWritable, isDependency, localPath } from '../scripts/manifest.mjs';
import { annotations, canonicalize, documentation, documentationSites, draftTarget, inCondition, valueList, walkSchemas } from '../scripts/schema-tools.mjs';
import { vendoredUrls } from '../scripts/vendored.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (dir: string, url: string) => JSON.parse(readFileSync(join(root, dir, localPath(url)), 'utf8'));
const urls: string[] = vendoredUrls('upstream');
const enriched = urls.filter((url) => !isDependency(url));
const resolve = (url: string) => {
    try {
        return read('schemas', url);
    } catch {
        return undefined;
    }
};

describe('vendored schemas', () => {
    it('vendor exactly the upstream schemas', () => {
        expect(vendoredUrls('schemas')).toEqual(urls);
    });

    it.each(urls)('%s validates exactly like upstream', (url) => {
        expect(canonicalize(read('schemas', url))).toEqual(canonicalize(read('upstream', url)));
    });

    it.each(urls)('%s keeps every upstream title and description', (url) => {
        const ours = annotations(read('schemas', url));
        for (const [pointer, text] of annotations(read('upstream', url))) expect(ours.get(pointer), pointer).toBe(text);
    });

    it.each(urls)('%s has its URL as $id', (url) => {
        const schema = read('schemas', url);
        if ('$id' in schema) expect(schema.$id).toBe(url);
    });

    it.each(urls.filter(isDependency))('%s is an unmodified dependency', (url) => {
        const { $id: _ours, ...ours } = read('schemas', url);
        const { $id: _theirs, ...theirs } = read('upstream', url);
        expect(ours).toEqual(theirs);
    });

    it.each(enriched)('%s documents every field', (url) => {
        const missing = documentationSites(read('schemas', url), { core: url.includes('schemas.stacspec.org') })
            .filter((site: { node: object }) => {
                const docs = documentation(site.node, url, resolve);
                return !docs.title || !docs.description;
            })
            .map((site: { pointer: string }) => site.pointer);
        expect(missing).toEqual([]);
    });

    it.each(enriched)('%s lists allowed values as titled constants', (url) => {
        const schema = read('schemas', url);
        const problems: string[] = [];
        const ajv = new Ajv({ strict: false });
        walkSchemas(schema, (node: Record<string, unknown>, pointer: string, context: unknown) => {
            if (Array.isArray(node.enum) && !inCondition(context)) problems.push(`${pointer}: enum`);
            const list = valueList(node);
            if (!list) return;
            // Each value must match exactly one branch: a value listed twice fails here.
            const validate = ajv.compile({ [list.keyword]: list.values });
            for (const value of list.values) {
                if (!value.title) problems.push(`${pointer}: ${JSON.stringify(value.const)} has no title`);
                if (!validate(value.const)) problems.push(`${pointer}: ${JSON.stringify(value.const)} is listed more than once`);
            }
        });
        expect(problems).toEqual([]);
    });
});

describe('drafting documentation', () => {
    const STAC = 'https://schemas.stacspec.org/v1.1.0/';
    const R_CF = 'https://raw.githubusercontent.com/R-CF/';
    const GEOLOCATION = `${R_CF}zarr_convention_geolocation/refs/tags/v1.0.0/schema.json`;
    const PROJ = 'https://raw.githubusercontent.com/zarr-conventions/proj/refs/tags/v0.1/schema.json';

    it('writes only into the schema drafted and the other schemas of its manifest entry', () => {
        expect(draftWritable(`${STAC}collection-spec/json-schema/collection.json`, `${STAC}item-spec/json-schema/common.json`)).toBe(true);
        expect(draftWritable(`${STAC}item-spec/json-schema/item.json`, 'https://schemas.stacspec.org/v1.0.0/item-spec/json-schema/item.json')).toBe(false);
        // Another convention's schema (geolocation's id is a proj object), or a dependency (PROJJSON, ref of main).
        expect(draftWritable(GEOLOCATION, PROJ)).toBe(false);
        expect(draftWritable(GEOLOCATION, `${R_CF}zarr_convention_ref/refs/tags/v2.0.0/schema.json`)).toBe(false);
        expect(draftWritable(PROJ, 'https://proj.org/schemas/v0.7/projjson.schema.json')).toBe(false);
        expect(draftWritable(`${R_CF}zarr_conventions_cs/33df41a6164e5af1761b32c6686b342bfe4beb3c/schema.json`, `${R_CF}zarr_convention_ref/main/schema.json`)).toBe(false);
    });

    it('documents a property referencing a document it may not change next to its own $ref', () => {
        const schema = read('schemas', GEOLOCATION);
        const id = schema.$defs.arrays.properties.id;
        const target = draftTarget(id, GEOLOCATION, resolve, (url: string) => draftWritable(GEOLOCATION, url));
        expect(target.url).toBe(GEOLOCATION);
        expect(target.node).toBe(id);
        // Where it may, documentation goes on the definition referenced.
        const A = 'https://example.org/a.json';
        const B = 'https://example.org/b.json';
        const docs: Record<string, unknown> = { [A]: { properties: { x: { $ref: 'b.json#/$defs/x' } } }, [B]: { $defs: { x: { type: 'string' } } } };
        const x = (docs[A] as { properties: { x: object } }).properties.x;
        expect(draftTarget(x, A, (url: string) => docs[url], () => true)).toMatchObject({ url: B });
        expect(draftTarget(x, A, (url: string) => docs[url], (url: string) => url === A)).toMatchObject({ url: A, node: x });
    });
});
