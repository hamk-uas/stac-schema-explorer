import { describe, expect, it } from 'vitest';

import { fromShortId, repoUrl, toShortId } from '../src/lib/extensions';
import { buildMatrix, stacMatrixGroups } from '../src/lib/matrix';
import { CORE, type ProbeResult, type StacType } from '../src/lib/model';
import { probe } from '../src/lib/probe';
import { stringFromRegex } from '../src/lib/sampler';
import { formatErrors } from '../src/lib/schemas';
import { documentView, groupFields, shapeOf, templateView, type ObjectView } from '../src/lib/tree';
import { readState, writeState } from '../src/lib/url-state';
import { EXTENSIONS, fixtureStore } from './helpers';

const DATACUBE = 'https://stac-extensions.github.io/datacube/v2.3.0/schema.json';
const CF = 'https://stac-extensions.github.io/cf/v1.0.0/schema.json';
const THEMES = 'https://stac-extensions.github.io/themes/v1.0.0/schema.json';
const SEMANTICS = 'https://hamk-uas.github.io/stac-semantics/v0.1.0/schema.json';

let cached: Promise<ProbeResult> | undefined;
function defaultProbe(): Promise<ProbeResult> {
    cached ??= probe(fixtureStore(), '1.1.0', EXTENSIONS);
    return cached;
}

function placed(result: ProbeResult, type: StacType, source: string, field: string): Map<string, string> {
    return new Map(result.templates[type].placements.filter((p) => p.source === source && p.field === field).map((p) => [p.location, p.kind]));
}

describe('extension ids', () => {
    it('shortens stac-extensions URLs and expands them back', () => {
        expect(toShortId(CF)).toBe('cf@1.0.0');
        expect(fromShortId('cf@1.0.0')).toBe(CF);
        expect(fromShortId('datacube@v2.3.0')).toBe(DATACUBE);
        expect(toShortId(SEMANTICS)).toBe(SEMANTICS);
    });

    it('derives GitHub repositories from schema URLs', () => {
        expect(repoUrl(CF)).toBe('https://github.com/stac-extensions/cf');
        expect(repoUrl(SEMANTICS)).toBe('https://github.com/hamk-uas/stac-semantics');
        expect(repoUrl('https://sklvarjo.github.io/observatory-stac-extension/schema.json')).toBe('https://github.com/sklvarjo/observatory-stac-extension');
        expect(repoUrl('https://raw.githubusercontent.com/owner/repo/main/schema.json')).toBe('https://github.com/owner/repo');
        expect(repoUrl('https://example.com/ext/v1.0.0/schema.json')).toBeUndefined();
    });
});

describe('url state', () => {
    it('round-trips through the query string', () => {
        const state = readState('');
        state.extensions = [CF, SEMANTICS];
        state.mode = 'href';
        state.href = 'https://example.com/catalog.json?x=1&y=2';
        state.selected = 'https://example.com/item.json';
        state.pointer = '/assets/data';
        state.showCore = true;
        state.view = 'matrix';
        state.focus = CF;
        state.schema = SEMANTICS;
        const search = writeState(state);
        expect(search).toContain('ext=cf@1.0.0');
        expect(readState(search)).toEqual(state);
    });

    it('starts with no extensions or conventions and keeps chosen ones', () => {
        const state = readState('');
        expect(state.extensions).toEqual([]);
        expect(state.conventions).toEqual([]);
        expect(writeState(state)).not.toMatch(/ext=|conv=/);
        state.conventions = ['https://raw.githubusercontent.com/zarr-conventions/proj/refs/tags/v0.1/schema.json'];
        expect(writeState(state)).toContain('conv=proj@v0.1');
        expect(readState(writeState(state)).conventions).toEqual(state.conventions);
    });
});

describe('sampler', () => {
    it('generates strings that match simple patterns', () => {
        for (const pattern of ['^[A-Z]{3}-\\d{2}$', '^(EPSG|IAU):[0-9]+$', '^[0-9a-f]{6}$', '^v?\\d+\\.\\d+(\\.\\d+)?$']) {
            const value = stringFromRegex(pattern);
            expect(value, pattern).toBeDefined();
            expect(new RegExp(pattern).test(value!)).toBe(true);
        }
    });
});

describe('probe with the default extensions', () => {
    it('produces examples that validate against core and every applicable extension', async () => {
        const result = await defaultProbe();
        for (const type of ['Catalog', 'Collection', 'Feature'] as const) {
            expect(result.templates[type].errors, type).toEqual([]);
            expect(result.templates[type].valid).toBe(true);
        }
        expect(result.sources.map((s) => s.prefixes)).toEqual([[], ['cube'], ['cf'], [], ['sem']]);
    });

    it('places CF fields on variables, dimensions and bands, but not on Catalogs', async () => {
        const result = await defaultProbe();
        const item = placed(result, 'Feature', CF, 'cf:cell_methods');
        for (const location of ['/properties', '/properties/cube:variables/tas', '/properties/cube:dimensions/time', '/assets/data', '/assets/data/bands/0', '/properties/bands/0']) {
            expect(item.get(location), location).toBe('validated');
        }
        expect(placed(result, 'Collection', CF, 'cf:standard_name').get('/summaries')).toBe('validated');
        expect(result.templates.Catalog.notApplicable).toContain(CF);
    });

    it('detects datacube alternatives of an anyOf and presence-only summaries', async () => {
        const result = await defaultProbe();
        const collection = placed(result, 'Collection', DATACUBE, 'cube:dimensions');
        expect(collection.get('')).toBe('validated');
        expect(collection.get('/assets/data')).toBe('validated');
        expect(collection.get('/item_assets/data')).toBe('validated');
        expect(collection.get('/summaries')).toBe('presence');
        const item = placed(result, 'Feature', DATACUBE, 'cube:variables');
        expect([...item.keys()].sort()).toEqual(['/assets/data', '/properties']);
    });

    it('places themes on Catalogs, Collections and Item properties only', async () => {
        const result = await defaultProbe();
        expect([...placed(result, 'Catalog', THEMES, 'themes').keys()]).toEqual(['']);
        expect([...placed(result, 'Feature', THEMES, 'themes').keys()]).toEqual(['/properties']);
        expect(placed(result, 'Collection', THEMES, 'themes').get('/summaries')).toBe('presence');
    });

    it('places semantics on variable-like objects but not on Item properties', async () => {
        const result = await defaultProbe();
        const item = placed(result, 'Feature', SEMANTICS, 'sem:concepts');
        expect(item.has('/properties')).toBe(false);
        expect(item.get('/properties/cube:variables/tas')).toBe('validated');
        expect(item.get('/assets/data')).toBe('validated');
    });

    it('finds core bands in Item properties, which STAC 1.1.0 allows only when an asset has bands', async () => {
        const result = await defaultProbe();
        expect(placed(result, 'Feature', 'core', 'bands').get('/properties')).toBe('validated');
        expect(placed(result, 'Feature', 'core', 'bands').get('/assets/data')).toBe('validated');
    });

    it('does not treat map entries such as item_assets as fields', async () => {
        const result = await defaultProbe();
        expect(result.templates.Collection.placements.some((p) => p.location === '/item_assets')).toBe(false);
    });
});

describe('schemas that validate fields of other extensions', () => {
    it('reports CF fields that the Observatory extension allows in Table columns', async () => {
        const observatory = 'https://sklvarjo.github.io/observatory-stac-extension/schema.json';
        const table = 'https://stac-extensions.github.io/table/v1.3.0/schema.json';
        const result = await probe(fixtureStore(), '1.1.0', [observatory, CF, table, DATACUBE]);
        const info = result.sources.find((s) => s.key === observatory)!;
        expect(info.prefixes).toEqual(['obs', 'in_situ']);
        expect(info.fields).toContain('cf:cell_methods');
        expect(placed(result, 'Feature', observatory, 'cf:cell_methods').get('/properties/table:columns/0')).toBe('validated');
        expect(placed(result, 'Feature', CF, 'cf:cell_methods').has('/properties/table:columns/0')).toBe(false);

        const fieldsAt = (location: string) => result.templates.Collection.placements
            .filter((p) => p.location === location && p.source === observatory)
            .map((p) => ({ name: p.field, source: p.source, state: 'populated' as const, kind: p.kind }));
        const dimension = groupFields(fieldsAt('/assets/data/cube:dimensions/time'), result.sources)[0];
        expect(dimension.label).not.toContain('obs:*');
        expect(dimension.label).toMatch(/of 11 obs:\)/);
        const column = groupFields(fieldsAt('/assets/data/table:columns/0'), result.sources)[0];
        expect(column.label).toContain('cf:cell_methods');
    });
});

describe('field documentation', () => {
    it('describes fields with title, description, readable type and titled values', async () => {
        const result = await defaultProbe();
        const cf = result.sources.find((s) => s.key === CF)!;
        expect(cf.docs['cf:cell_methods']).toMatchObject({ title: 'Cell Methods', type: 'array of (string or null)' });
        expect(cf.docs['cf:cell_methods'].description).toMatch(/method/);
        const datacube = result.sources.find((s) => s.key === DATACUBE)!;
        expect(datacube.docs['cube:variables'].type).toBe('object: name → Variable Object');
        const core = result.sources.find((s) => s.key === 'core')!;
        expect(core.docs.title.description).toBe('A human-readable title describing the entity.');
        expect(core.docs.data_type.values?.find((v) => v.value === 'float32')).toBeDefined();
        expect(core.docs.nodata.type).toBe('number or "nan" or "inf" or "-inf"');
        expect(core.docs.nodata.values?.map((v) => v.title)).toEqual(['NaN (not a number)', 'Positive infinity', 'Negative infinity']);
    });

    it('reports a failed value list as one error listing the allowed values', async () => {
        const store = fixtureStore();
        const raster = 'https://stac-extensions.github.io/raster/v2.0.0/schema.json';
        const validate = await store.validator(raster);
        const doc = {
            type: 'Feature', stac_version: '1.1.0', stac_extensions: [raster], id: 'x', geometry: null, properties: { datetime: '2024-01-01T00:00:00Z' }, links: [],
            assets: { a: { href: 'a.tif', 'raster:sampling': 'center' } },
        };
        expect(validate(doc)).toBe(false);
        const messages = formatErrors(validate.errors, raster);
        expect(messages.join('\n')).toContain('must be one of "area", "point"');
        expect(messages.join('\n')).not.toMatch(/constant|match exactly one/);
    });
});

describe('views', () => {
    it('merges identical siblings in the template view', async () => {
        const result = await defaultProbe();
        const view = templateView(result.templates.Feature, false);
        const properties = view.children.find((c) => c.kind === 'properties')!;
        const dimensions = properties.children.filter((c) => c.kind === 'dimension');
        expect(dimensions).toHaveLength(1);
        expect(dimensions[0].names).toEqual(['x', 'y', 'time']);
        expect(dimensions[0].label).toBe('cube:dimensions › x, y, time');
    });

    it('normalizes asset keys and array indices into shapes', () => {
        expect(shapeOf('/assets/thumbnail/bands/3')).toBe('/assets/*/bands/*');
        expect(shapeOf('/properties/cube:variables/CH4')).toBe('/properties/cube:variables/*');
    });

    it('classifies fields of a real document as populated, possible or unexpected', async () => {
        const result = await defaultProbe();
        const doc = {
            type: 'Feature', stac_version: '1.1.0', id: 'x', geometry: null, links: [],
            properties: { datetime: null, 'cf:standard_name': 'air_temperature', 'foo:bar': 1 },
            assets: { a: { href: 'a.zarr', 'sem:concepts': [{ uri: 'http://example.com/x' }], 'themes': [] } },
        };
        const view = documentView(doc, result.templates.Feature, result.sources, false);
        const find = (node: ObjectView, kind: string) => node.children.find((c) => c.kind === kind)!;
        const props = find(view, 'properties').fields;
        expect(props.find((f) => f.name === 'cf:standard_name')?.state).toBe('populated');
        expect(props.find((f) => f.name === 'cf:cell_methods')?.state).toBe('possible');
        expect(props.find((f) => f.name === 'foo:bar')).toMatchObject({ state: 'unexpected', source: '?foo' });
        const asset = find(view, 'asset').fields;
        expect(asset.find((f) => f.name === 'sem:concepts')?.state).toBe('populated');
        expect(asset.find((f) => f.name === 'themes')).toMatchObject({ state: 'unexpected', source: THEMES });
        const groups = groupFields(props, result.sources);
        expect(groups.find((g) => g.source === CF)?.label).toBe('cf:*');
    });

    it('builds a placement matrix with conceptual columns', async () => {
        const result = await defaultProbe();
        const matrix = buildMatrix(stacMatrixGroups(result.templates), result.sources, new Set([CORE]));
        const keys = matrix.columns.map((c) => c.key);
        expect(keys).toContain('Feature properties › cube:variable');
        expect(keys).toContain('Collection Item Asset › Band');
        expect(keys).not.toContain('Collection assets › Asset');
        const cell = matrix.cells.get(`${CF}|cf:cell_methods|Feature properties › cube:variable`);
        expect(cell?.kind).toBe('validated');
        expect(matrix.cells.get(`${DATACUBE}|cube:dimensions|Collection `)?.partial).toBe(false);
        expect(matrix.cells.get(`${DATACUBE}|cube:dimensions|Collection Asset`)?.partial).toBe(false);
    });
});
