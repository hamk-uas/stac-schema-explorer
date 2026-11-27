import { describe, expect, it } from 'vitest';

import { describeUrl, fromShortId, isHttpUrl, repoUrl, toShortId } from '../src/lib/extensions';
import { readableAssets } from '../src/lib/embedded-docs';
import { buildMatrix, stacMatrixGroups } from '../src/lib/matrix';
import { CORE, type ProbeResult, type StacType } from '../src/lib/model';
import { getAt } from '../src/lib/pointer';
import { probe } from '../src/lib/probe';
import { requirementOf, requirementText } from '../src/lib/requirement';
import { applyRewrites } from '../src/lib/rewrites';
import { stringFromRegex } from '../src/lib/sampler';
import { formatErrors, SchemaStore } from '../src/lib/schemas';
import { fetchDoc, toRealDoc } from '../src/lib/stac';
import { documentView, groupFields, mapKeysOf, shapeOf, templateView, type ObjectView } from '../src/lib/tree';
import { readState, writeState } from '../src/lib/url-state';
import { EXTENSIONS, fixtureFetch, fixtureStore } from './helpers';

const DATACUBE = 'https://stac-extensions.github.io/datacube/v2.3.0/schema.json';
const CF = 'https://stac-extensions.github.io/cf/v1.0.0/schema.json';
const THEMES = 'https://stac-extensions.github.io/themes/v1.0.0/schema.json';
const EOPF = 'https://cs-si.github.io/eopf-stac-extension/v1.2.0/schema.json';

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
        expect(toShortId(EOPF)).toBe(EOPF);
    });

    it('derives GitHub repositories from schema URLs', () => {
        expect(repoUrl(CF)).toBe('https://github.com/stac-extensions/cf');
        expect(repoUrl(EOPF)).toBe('https://github.com/cs-si/eopf-stac-extension');
        expect(repoUrl('https://example-org.github.io/custom-ext/schema.json')).toBe('https://github.com/example-org/custom-ext');
        expect(repoUrl('https://raw.githubusercontent.com/owner/repo/main/schema.json')).toBe('https://github.com/owner/repo');
        expect(repoUrl('https://example.com/ext/v1.0.0/schema.json')).toBeUndefined();
    });

    it('names a mistyped share-link entry by its text and reports it instead of fetching it relative to the app', async () => {
        expect(describeUrl('projection')).toEqual({ name: 'projection', known: false });
        const fetched: string[] = [];
        const store = new SchemaStore(async (url) => { fetched.push(url); return {}; });
        await expect(store.load(fromShortId('projection'))).rejects.toThrow('not a schema URL or name@version: projection');
        expect(fetched).toEqual([]);
    });
});

describe('url state', () => {
    it('round-trips through the query string', () => {
        const state = readState('');
        state.extensions = [CF, EOPF];
        state.mode = 'href';
        state.href = 'https://example.com/catalog.json?x=1&y=2';
        state.selected = 'https://example.com/item.json';
        state.pointer = '/assets/data';
        state.view = 'matrix';
        state.focus = CF;
        state.schema = EOPF;
        state.cores = ['stac', 'netcdf'];
        state.theme = 'dark';
        state.examples = [
            { label: 'Custom Item', href: 'https://example.com/custom-item.json' },
            { label: 'https://example.com/plain.zarr', href: 'https://example.com/plain.zarr' },
        ];
        const search = writeState(state);
        expect(search).toContain('ext=cf@1.0.0');
        expect(search).toContain('core=stac&core=netcdf');
        expect(search).toContain('theme=dark');
        expect(search).toContain('example=Custom+Item|https://example.com/custom-item.json');
        expect(readState(search)).toEqual(state);
        expect(readState('?theme=invalid').theme).toBe('');
        expect(readState('?example=Bad|javascript:alert(1)&example=Good|https://example.com/a.json').examples)
            .toEqual([{ label: 'Good', href: 'https://example.com/a.json' }]);
    });

    it('starts with every core and no extensions or conventions, and keeps chosen ones', () => {
        const state = readState('');
        expect(state.cores).toEqual(['stac', 'zarr-v3', 'zarr-v2', 'netcdf', 'tiff']);
        expect(state.extensions).toEqual([]);
        expect(state.conventions).toEqual([]);
        expect(writeState(state)).not.toMatch(/ext=|conv=|core=/);
        state.conventions = ['https://raw.githubusercontent.com/zarr-conventions/proj/refs/tags/v0.1/schema.json'];
        state.cores = [];
        expect(writeState(state)).toContain('conv=proj@v0.1');
        expect(readState(writeState(state))).toMatchObject({ conventions: state.conventions, cores: [] });
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
        expect(result.sources.map((s) => s.prefixes)).toEqual([[], ['cube'], ['cf'], []]);
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

    it('finds core bands in Item properties, which STAC 1.1.0 allows only when an asset has bands', async () => {
        const result = await defaultProbe();
        expect(placed(result, 'Feature', 'core', 'bands').get('/properties')).toBe('validated');
        expect(placed(result, 'Feature', 'core', 'bands').get('/assets/data')).toBe('validated');
    });

    it('does not treat map entries such as item_assets as fields', async () => {
        const result = await defaultProbe();
        expect(result.templates.Collection.placements.some((p) => p.location === '/item_assets')).toBe(false);
    });

    it('tells which fields are required where they are placed, and on what condition', async () => {
        const result = await defaultProbe();
        const required = (type: StacType, location: string, field: string) =>
            result.templates[type].placements.find((p) => p.source === CORE && p.location === location && p.field === field)?.required;
        // Every alternative of the Item's anyOf requires datetime (null or not).
        expect(required('Feature', '/properties', 'datetime')).toEqual({});
        expect(required('Feature', '/properties', 'end_datetime')).toEqual({ when: 'start_datetime is present' });
        expect(required('Collection', '', 'license')).toEqual({});
        expect(required('Feature', '/properties', 'title')).toBeUndefined();
    });

    it('words the conditions of required fields and leaves the example as it was', async () => {
        const url = 'https://example.org/node.json';
        const schema = {
            $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', required: ['kind'],
            properties: { kind: { type: 'string' }, size: { type: 'number' }, start: { type: 'number' }, end: { type: 'number' }, note: { type: 'string' } },
            allOf: [{ if: { properties: { kind: { const: 'array' } }, required: ['kind'] }, then: { required: ['size'] } }],
            dependencies: { start: ['end'] },
        };
        const store = new SchemaStore(async () => schema);
        const validate = await store.validator(url);
        const doc = { kind: 'array', size: 2, start: 0, end: 1, note: 'x' };
        expect(requirementOf(store, url, validate, doc, '', 'kind')).toEqual({});
        expect(requirementOf(store, url, validate, doc, '', 'size')).toEqual({ when: 'kind is "array"' });
        expect(requirementOf(store, url, validate, doc, '', 'end')).toEqual({ when: 'start is present' });
        expect(requirementOf(store, url, validate, doc, '', 'note')).toBeUndefined();
        expect(Object.keys(doc)).toEqual(['kind', 'size', 'start', 'end', 'note']);
        expect(requirementText({ when: 'kind is "array"' }, true)).toBe('required here when kind is "array"');
    });
});

describe('schemas that validate fields of other extensions', () => {
    it('reports CF fields that another extension allows in Table columns', async () => {
        const custom = 'https://example.org/custom-table-cf/v0.1.0/schema.json';
        const table = 'https://stac-extensions.github.io/table/v1.3.0/schema.json';
        const customSchema = {
            $schema: 'http://json-schema.org/draft-07/schema#',
            $id: custom,
            title: 'Custom Table CF Extension',
            type: 'object',
            required: ['stac_extensions', 'type'],
            properties: {
                stac_extensions: { type: 'array', contains: { const: custom } },
                type: { type: 'string', enum: ['Feature', 'Collection'] },
                properties: { $ref: '#/definitions/container' },
                assets: { type: 'object', additionalProperties: { $ref: '#/definitions/container' } },
            },
            definitions: {
                container: {
                    type: 'object',
                    properties: {
                        'demo:a': { type: 'string' },
                        'demo:b': { type: 'string' },
                        'demo:c': { type: 'string' },
                        'demo:d': { type: 'string' },
                        'table:columns': {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    'demo:a': { type: 'string' },
                                    'cf:cell_methods': { $ref: `${CF}#/definitions/cf:cell_methods` },
                                },
                                patternProperties: { '^(?!(demo|cf):)': {} },
                                additionalProperties: false,
                            },
                        },
                        'cube:dimensions': {
                            type: 'object',
                            additionalProperties: {
                                type: 'object',
                                properties: {
                                    'demo:a': { type: 'string' },
                                    'demo:b': { type: 'string' },
                                    'demo:c': { type: 'string' },
                                },
                                patternProperties: { '^(?!demo:)': {} },
                                additionalProperties: false,
                            },
                        },
                    },
                    patternProperties: { '^(?!demo:)': {} },
                    additionalProperties: false,
                },
            },
        };
        const store = new SchemaStore(async (url) => (url === custom ? customSchema : fixtureFetch(url)));
        const result = await probe(store, '1.1.0', [custom, CF, table, DATACUBE]);
        const info = result.sources.find((s) => s.key === custom)!;
        expect(info.prefixes).toEqual(['demo']);
        expect(info.fields).toContain('cf:cell_methods');
        expect(placed(result, 'Feature', custom, 'cf:cell_methods').get('/properties/table:columns/0')).toBe('validated');
        expect(placed(result, 'Feature', CF, 'cf:cell_methods').has('/properties/table:columns/0')).toBe(false);

        const fieldsAt = (location: string) => result.templates.Collection.placements
            .filter((p) => p.location === location && p.source === custom)
            .map((p) => ({ name: p.field, source: p.source, state: 'populated' as const, kind: p.kind }));
        const dimension = groupFields(fieldsAt('/assets/data/cube:dimensions/time'), result.sources)[0];
        expect(dimension.label).not.toContain('demo:*');
        expect(dimension.label).toMatch(/of 4 demo:\)/);
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

    it('documents nested object properties and variants without expanding external recursive schemas', async () => {
        const result = await defaultProbe();
        const datacube = result.sources.find((s) => s.key === DATACUBE)!;
        const dims = datacube.docs['cube:dimensions'].objects ?? [];
        expect(dims.map((d) => d.title)).toContain('Temporal Dimension Object');
        const temporal = dims.find((d) => d.title === 'Temporal Dimension Object')!;
        expect(temporal.properties.find((p) => p.name === 'step')).toMatchObject({
            name: 'step',
            type: 'string or null',
        });
        expect(temporal.properties.find((p) => p.name === 'step')?.description).toMatch(/ISO 8601 duration/);
        const horizontal = dims.find((d) => d.title === 'Horizontal Spatial Raster Dimension Object')!;
        expect(horizontal.properties.find((p) => p.name === 'reference_system')?.objects).toBeUndefined();

        const themes = result.sources.find((s) => s.key === THEMES)!;
        const themeProps = themes.docs.themes.objects?.[0]?.properties ?? [];
        const concepts = themeProps.find((p) => p.name === 'concepts');
        expect(concepts?.objects?.[0]?.properties.map((p) => p.name)).toEqual(['id', 'title', 'description', 'url']);

        const featureDims = (result.templates.Feature.doc.properties as Record<string, unknown>)['cube:dimensions'] as Record<string, Record<string, unknown>>;
        expect(featureDims.time.step).toBe('P1M');
        expect(featureDims.x.step).toBe(0.1);
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
        const view = templateView(result.templates.Feature, false, result.sources);
        const properties = view.children.find((c) => c.kind === 'properties')!;
        const dimensions = properties.children.filter((c) => c.kind === 'dimension');
        expect(dimensions).toHaveLength(1);
        expect(dimensions[0].names).toEqual(['x', 'y', 'time']);
        expect(dimensions[0].label).toBe('cube:dimensions › x, y, time');
    });

    it('normalizes asset keys, array indices and schema-defined map keys into shapes', async () => {
        const result = await defaultProbe();
        const mapKeys = mapKeysOf(result.sources);
        expect(shapeOf('/assets/thumbnail/bands/3')).toBe('/assets/*/bands/*');
        expect(shapeOf('/properties/cube:variables/CH4', mapKeys)).toBe('/properties/cube:variables/*');
        expect(mapKeys.has('cube:dimensions')).toBe(true);
        expect(mapKeys.has('cube:variables')).toBe(true);
    });

    it('classifies fields of a real document as populated, possible or unexpected', async () => {
        const result = await defaultProbe();
        const doc = {
            type: 'Feature', stac_version: '1.1.0', id: 'x', geometry: null, links: [],
            properties: { datetime: null, 'cf:standard_name': 'air_temperature', 'foo:bar': 1 },
            assets: { a: { href: 'a.zarr', 'cf:standard_name': 'air_temperature', 'themes': [] } },
        };
        const view = documentView(doc, result.templates.Feature, result.sources, false);
        const find = (node: ObjectView, kind: string) => node.children.find((c) => c.kind === kind)!;
        const props = find(view, 'properties').fields;
        expect(props.find((f) => f.name === 'cf:standard_name')?.state).toBe('populated');
        expect(props.find((f) => f.name === 'cf:cell_methods')?.state).toBe('possible');
        expect(props.find((f) => f.name === 'foo:bar')).toMatchObject({ state: 'unexpected', source: '?foo' });
        const asset = find(view, 'asset').fields;
        expect(asset.find((f) => f.name === 'cf:standard_name')?.state).toBe('populated');
        expect(asset.find((f) => f.name === 'themes')).toMatchObject({ state: 'unexpected', source: THEMES });
        const groups = groupFields(props, result.sources);
        expect(groups.find((g) => g.source === CF)?.label).toBe('cf:*');
    });

    it('does not flag unprefixed sub-properties inside field values as unexpected core fields', async () => {
        const result = await defaultProbe();
        const doc = {
            type: 'Feature', stac_version: '1.1.0', id: 'x', geometry: null, links: [],
            properties: {
                datetime: '2024-01-01T00:00:00Z',
                themes: [{ scheme: 'https://example.com/scheme', concepts: [{ id: 'c1', title: 'Temp', description: 'Air temp' }] }],
            },
            assets: {
                data: {
                    href: 'a.zarr',
                    'cube:dimensions': {
                        time: { type: 'temporal', description: 'UTC day', extent: ['2024-01-01T00:00:00Z', '2024-12-31T00:00:00Z'], step: 'P1D' },
                    },
                    'cube:variables': {
                        ch4: {
                            type: 'data',
                            description: 'Methane',
                            dimensions: ['time'],
                            unit: 'ppbv',
                            data_type: 'float32',
                            nodata: 'nan',
                            'cf:standard_name': 'dry_atmosphere_mole_fraction_of_methane',
                            'foo:bar': 1,
                        },
                    },
                },
            },
        };
        const view = documentView(doc, result.templates.Feature, result.sources, true);
        const allFields = (node: ObjectView): { pointer: string; name: string; state: string; source: string }[] => [
            ...node.fields.map((f) => ({ pointer: node.pointers[0], name: f.name, state: f.state, source: f.source })),
            ...node.children.flatMap(allFields),
        ];
        const unexpected = allFields(view).filter((f) => f.state === 'unexpected');
        expect(unexpected).toEqual([{ pointer: '/assets/data/cube:variables/ch4', name: 'foo:bar', state: 'unexpected', source: '?foo' }]);
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

describe('security hardening for untrusted external URLs and schemas', () => {
    it('blocks prototype traversal and pollution via pointers, rewrites, and URL params', () => {
        const doc = { type: 'Feature', id: 'x', assets: { data: { href: 'https://example.com/a.tif' } } };
        expect(getAt(doc, '/__proto__')).toBeUndefined();
        expect(getAt(doc, '/assets/__proto__')).toBeUndefined();
        expect(getAt(doc, '/constructor/prototype')).toBeUndefined();

        const before = Object.prototype.hasOwnProperty;
        applyRewrites(
            doc,
            [
                { op: 'add', source: CORE, doc: 'x', pointer: '/__proto__', field: 'polluted' },
                { op: 'add', source: CORE, doc: 'x', pointer: '/assets/__proto__', field: 'polluted' },
                { op: 'remove', source: CORE, doc: 'x', pointer: '/__proto__', field: 'hasOwnProperty' },
                { op: 'add', source: CORE, doc: 'x', pointer: '', field: '__proto__' },
            ],
            () => 'evil',
        );
        expect(('polluted' in ({} as Record<string, unknown>))).toBe(false);
        expect(Object.prototype.hasOwnProperty).toBe(before);

        const state = readState('?rw=add|core|doc|/__proto__|polluted&rw=remove|core|doc|/assets|constructor&rw=add|core|doc|/assets|title');
        expect(state.rewrites).toEqual([{ op: 'add', source: CORE, doc: 'doc', pointer: '/assets', field: 'title' }]);
    });

    it('rejects non-HTTP(S) URLs in query state, STAC links/assets, and fetchDoc', async () => {
        expect(isHttpUrl('https://example.com/a.json')).toBe(true);
        expect(isHttpUrl('javascript:alert(1)')).toBe(false);
        expect(isHttpUrl('data:application/json,{}')).toBe(false);
        expect(isHttpUrl('/relative/path.json')).toBe(false);

        const state = readState('?href=data:application/json,%7B%7D&schema=javascript:alert(1)&focus=file:///etc/passwd');
        expect(state.href).toBe('');
        expect(state.schema).toBe('');
        expect(state.focus).toBe('');

        const real = toRealDoc('https://example.com/catalog.json', {
            type: 'Catalog',
            id: 'c',
            links: [
                { rel: 'child', href: 'javascript:alert(1)' },
                { rel: 'item', href: 'data:application/json,{}' },
                { rel: 'child', href: 'sub/catalog.json' },
            ],
        });
        expect(real.childLinks.map((l) => l.href)).toEqual(['https://example.com/sub/catalog.json']);

        const assets = readableAssets(
            {
                assets: {
                    bad: { href: 'javascript:alert(1)', type: 'image/tiff' },
                    good: { href: 'data.tif', type: 'image/tiff' },
                },
            },
            'https://example.com/item.json',
        );
        expect(assets.map((a) => a.href)).toEqual(['https://example.com/data.tif']);
        await expect(fetchDoc('data:application/json,{}')).rejects.toThrow('unsupported URL scheme');
    });

    it('prevents cross-origin or vendored $id cache poisoning in SchemaStore', async () => {
        const evilUrl = 'https://attacker.example/evil.json';
        const store = new SchemaStore(async (url) => {
            if (url === evilUrl) return { $schema: 'http://json-schema.org/draft-07/schema#', $id: CF, title: 'Poisoned' };
            return fixtureFetch(url);
        });
        await store.load(evilUrl);
        expect(store.getDocument(CF)).toBeUndefined();
        expect(store.baseOf(evilUrl)).toBe(evilUrl);

        const jsIdUrl = 'https://attacker.example/js-id.json';
        const store2 = new SchemaStore(async () => ({ $schema: 'http://json-schema.org/draft-07/schema#', $id: 'javascript:alert(1)' }));
        await store2.load(jsIdUrl);
        expect(store2.baseOf(jsIdUrl)).toBe(jsIdUrl);
    });
});
