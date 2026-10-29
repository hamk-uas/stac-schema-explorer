import { describe, expect, it } from 'vitest';

import { KNOWN_CONVENTIONS } from '../src/lib/conventions';
import type { JsonObject, TypeTemplate } from '../src/lib/model';
import {
    addedSchemas, applyRewrites, conventionsToken, declareConventionsAttribute, declareStacExtensions, declareZarrConventions, fieldEdits,
    templateValue, toggleRewrite, type Rewrite,
} from '../src/lib/rewrites';
import { documentView } from '../src/lib/tree';
import { readState, writeState } from '../src/lib/url-state';

const DATACUBE = 'https://stac-extensions.github.io/datacube/v2.3.0/schema.json';
const DOC = 'https://example.com/item.json';
const schemaOf = (id: string) => KNOWN_CONVENTIONS.find((c) => c.id === id)!.versions[0].schema;

const template: TypeTemplate = {
    type: 'Feature', stacVersion: '1.1.0', conflicts: [], notApplicable: [], valid: true, errors: [],
    doc: { type: 'Feature', properties: { 'cube:dimensions': { x: { type: 'spatial' } } }, assets: { a: { 'cube:dimensions': { t: { type: 'temporal' } } } } },
    placements: [
        { source: DATACUBE, field: 'cube:dimensions', location: '/properties', kind: 'validated' },
        { source: DATACUBE, field: 'cube:dimensions', location: '/assets/a', kind: 'validated' },
    ],
};

describe('rewrites', () => {
    it('add example values from the template at the same place and remove present fields', () => {
        const doc: JsonObject = { type: 'Feature', properties: { 'eo:cloud_cover': 3 }, assets: { data: {} } };
        const rewrites: Rewrite[] = [
            { op: 'add', doc: DOC, pointer: '/assets/data', field: 'cube:dimensions', source: DATACUBE },
            { op: 'remove', doc: DOC, pointer: '/properties', field: 'eo:cloud_cover', source: 'x' },
        ];
        const out = applyRewrites(doc, rewrites, (r) => templateValue(template, r));
        expect(out).toEqual({ type: 'Feature', properties: {}, assets: { data: { 'cube:dimensions': { t: { type: 'temporal' } } } } });
        expect(doc.properties).toEqual({ 'eo:cloud_cover': 3 });
    });

    it('skip rewrites inside a missing object', () => {
        const doc: JsonObject = { properties: {} };
        const out = applyRewrites(doc, [{ op: 'add', doc: DOC, pointer: '/assets/x', field: 'a', source: DATACUBE }], () => 1);
        expect(out).toEqual(doc);
    });

    it('toggle: add per merged object, undo with the fields added inside', () => {
        let list = toggleRewrite([], DOC, ['/assets/a', '/assets/b'], 'cube:dimensions', DATACUBE, false);
        expect(list.map((r) => [r.op, r.pointer])).toEqual([['add', '/assets/a'], ['add', '/assets/b']]);
        list = toggleRewrite(list, DOC, ['/assets/a/cube:dimensions/t'], 'unit', DATACUBE, false);
        list = toggleRewrite(list, DOC, ['/assets/a', '/assets/b'], 'cube:dimensions', DATACUBE, true);
        expect(list).toEqual([]);
        expect(toggleRewrite([], DOC, [''], 'title', 'core', true)[0].op).toBe('remove');
    });

    it('declare added extensions, not core or unknown fields', () => {
        const rewrites: Rewrite[] = [
            { op: 'add', doc: DOC, pointer: '', field: 'cube:dimensions', source: DATACUBE },
            { op: 'add', doc: DOC, pointer: '', field: 'title', source: 'core' },
            { op: 'remove', doc: DOC, pointer: '', field: 'x:y', source: '?x' },
        ];
        expect(addedSchemas(rewrites)).toEqual([DATACUBE]);
        expect(declareStacExtensions({ stac_extensions: ['a'] }, [DATACUBE]).stac_extensions).toEqual(['a', DATACUBE]);
        expect(declareStacExtensions({}, [DATACUBE]).stac_extensions).toEqual([DATACUBE]);
    });

    it('declare Zarr conventions by their entry and attribute conventions in Conventions', () => {
        const proj = schemaOf('proj');
        const uuid = KNOWN_CONVENTIONS.find((c) => c.id === 'proj')!.declaration!.zarrConventions!.uuid;
        const entry = { uuid, name: 'proj:', schema_url: proj };
        const node = declareZarrConventions({ attributes: {} }, [proj], { attributes: { zarr_conventions: [entry] } });
        expect(node).toEqual({ attributes: { zarr_conventions: [entry] } });
        expect(declareZarrConventions(node, [proj], undefined)).toBe(node);

        expect(conventionsToken(schemaOf('cf'))).toMatch(/^CF-\d/);
        expect(conventionsToken(proj)).toBeUndefined();
        const root = declareConventionsAttribute({ attributes: { Conventions: 'CF-1.8' } }, [schemaOf('cf'), schemaOf('acdd')]);
        expect(root.attributes).toEqual({ Conventions: `CF-1.8 ${conventionsToken(schemaOf('acdd'))}` });
    });

    it('mark added and removed fields in the document view', () => {
        const doc: JsonObject = { type: 'Feature', properties: {}, assets: { a: { 'cube:dimensions': {} } } };
        const sources = [{ key: DATACUBE, url: DATACUBE, title: 'Datacube', prefixes: ['cube'], fields: ['cube:dimensions'], unsampled: [], docs: {} }];
        const edits = fieldEdits([
            { op: 'add', doc: DOC, pointer: '/assets/a', field: 'cube:dimensions', source: DATACUBE },
            { op: 'remove', doc: DOC, pointer: '/properties', field: 'cube:dimensions', source: DATACUBE },
            { op: 'remove', doc: DOC, pointer: '/properties', field: 'foo:bar', source: '?foo' },
        ]);
        const view = documentView(doc, template, sources, false, edits);
        const properties = view.children.find((c) => c.kind === 'properties')!;
        expect(properties.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'cube:dimensions', state: 'possible', edit: 'removed' }),
            expect.objectContaining({ name: 'foo:bar', source: '?foo', state: 'possible', edit: 'removed' }),
        ]));
        const asset = view.children.find((c) => c.kind === 'asset')!;
        expect(asset.fields).toEqual([expect.objectContaining({ name: 'cube:dimensions', state: 'populated', edit: 'added' })]);
    });

    it('round-trip through the share URL', () => {
        const state = readState('');
        state.mode = 'href';
        state.rewrites = [
            { op: 'add', doc: DOC, pointer: '/assets/data', field: 'cube:dimensions', source: DATACUBE },
            { op: 'remove', doc: 'node:https://example.com/s.zarr/zarr.json#', pointer: '/attributes', field: 'title', source: schemaOf('acdd') },
            { op: 'remove', doc: DOC, pointer: '', field: 'id', source: 'core' },
        ];
        const search = writeState(state);
        expect(search).toContain('rw=add|datacube@2.3.0|https://example.com/item.json|/assets/data|cube:dimensions');
        expect(readState(search).rewrites).toEqual(state.rewrites);
    });
});
