import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { embeddedCounterparts, fromConventionShortId, KNOWN_CONVENTIONS, stacCounterparts, toConventionShortId } from '../src/lib/conventions';
import { nodeConventions, realNodeView } from '../src/lib/embedded-docs';
import { probeEmbedded, validateNode } from '../src/lib/embedded-probe';
import { buildMatrix } from '../src/lib/matrix';
import type { JsonObject } from '../src/lib/model';
import { conventionsToken } from '../src/lib/rewrites';
import { fieldIndex } from '../src/lib/tree';
import { fixtureStore } from './helpers';

const ZC = (name: string) => `https://raw.githubusercontent.com/zarr-conventions/${name}/refs/tags/v0.1/schema.json`;
const B = 'https://hamk-uas.github.io/stac-schema-explorer/schemas/';

describe('conventions', () => {
    it('round-trips short ids of known conventions', () => {
        expect(toConventionShortId(ZC('proj'))).toBe('proj@v0.1');
        expect(fromConventionShortId('proj@v0.1')).toBe(ZC('proj'));
        expect(fromConventionShortId('cf@1.13')).toBe(`${B}cf/v1.13/schema.json`);
        expect(toConventionShortId('https://example.org/x/schema.json')).toBe('https://example.org/x/schema.json');
        expect(KNOWN_CONVENTIONS.map((c) => c.kind)).toContain('zarr-convention');
    });

    it('relates embedded fields and STAC fields in both directions', () => {
        expect(stacCounterparts(ZC('proj'), ['attributes', 'proj:code']).map((e) => e.id)).toEqual(['proj-code']);
        expect(stacCounterparts(`${B}gdal/v0.1.0/schema.json`, ['gdal_metadata', 'bands', '0', 'SCALE']).map((e) => e.id)).toEqual(['gdal-scale']);
        expect(embeddedCounterparts('proj:code', 'https://stac-extensions.github.io/projection/v2.0.0/schema.json').map((e) => e.id))
            .toEqual(['proj-code', 'geotiff-projected-crs', 'geotiff-geodetic-crs']);
        expect(embeddedCounterparts('title').map((e) => e.id)).toEqual(['acdd-title']);
    });
});

describe('embedded placement probing', () => {
    it('places the fields of formats and conventions in the node types their schemas allow', async () => {
        const store = fixtureStore();
        const result = await probeEmbedded(store, [ZC('proj'), ZC('spatial'), ZC('multiscales'), `${B}cf/v1.13/schema.json`]);
        expect(result.nodes.map((n) => n.key)).toEqual(['zarr-v3:group', 'zarr-v3:array', 'zarr-v2:group', 'zarr-v2:array', 'netcdf:group', 'netcdf:variable']);
        const at = (key: string, source: string, field: string) => result.nodes.find((n) => n.key === key)!.placements.find((p) => p.source === source && p.field === field);
        expect(at('zarr-v3:group', ZC('proj'), 'proj:code')).toMatchObject({ location: '/attributes', kind: 'validated' });
        expect(at('zarr-v3:group', ZC('multiscales'), 'multiscales')).toMatchObject({ location: '/attributes', kind: 'validated' });
        expect(at('zarr-v3:array', ZC('multiscales'), 'multiscales')).toBeUndefined();
        expect(result.nodes.find((n) => n.key === 'zarr-v3:array')!.notApplicable).toEqual([ZC('multiscales')]);
        expect(at('zarr-v3:array', ZC('spatial'), 'spatial:dimensions')).toBeDefined();
        expect(at('zarr-v3:array', `${B}zarr/v3/schema.json`, 'shape')).toMatchObject({ location: '' });
        expect(at('zarr-v3:group', `${B}zarr/v3/schema.json`, 'shape')).toBeUndefined();
        expect(at('netcdf:variable', `${B}cf/v1.13/schema.json`, 'standard_name')).toMatchObject({ location: '/attributes', kind: 'validated' });
        expect(at('netcdf:group', `${B}netcdf/v0.1.0/schema.json`, 'format')).toBeDefined();
        expect(at('netcdf:variable', `${B}netcdf/v0.1.0/schema.json`, 'format')).toBeUndefined();
        for (const node of result.nodes) expect(node.errors, node.key).toEqual([]);
        const proj = result.sources.find((s) => s.key === ZC('proj'))!;
        expect(proj.fields.sort()).toEqual(['proj:code', 'proj:projjson', 'proj:wkt2']);
        expect(proj.docs['proj:code']?.title).toBe('CRS code');
        expect(proj.containers['proj:code']).toBe('attributes');
    });

    it('places TIFF conventions in the file and its images', async () => {
        const result = await probeEmbedded(fixtureStore(), [`${B}geotiff/v1.1/schema.json`, `${B}gdal/v0.1.0/schema.json`]);
        expect(result.nodes.map((n) => n.key)).toEqual(expect.arrayContaining(['tiff:file', 'tiff:image']));
        const image = result.nodes.find((n) => n.key === 'tiff:image')!;
        expect(image.placements.some((p) => p.field === 'ProjectedCRSGeoKey' && p.location === '/geo_keys')).toBe(true);
        expect(image.placements.some((p) => p.field === 'GDAL_NODATA' && p.location === '/tags')).toBe(true);
        const file = result.nodes.find((n) => n.key === 'tiff:file')!;
        expect(file.placements.some((p) => p.field === 'gdal_structural_metadata')).toBe(true);
        expect(file.placements.some((p) => p.field === 'GDAL_NODATA')).toBe(false);
    });

    it('places the fields a convention adds to another convention only where that one is used', async () => {
        const alone = await probeEmbedded(fixtureStore(), [ZC('spatial')]);
        const spatial = alone.sources.find((s) => s.key === ZC('spatial'))!;
        expect(spatial.fields).not.toContain('multiscales');
        for (const node of alone.nodes) {
            expect(node.placements.filter((p) => p.field === 'multiscales'), node.key).toEqual([]);
            expect(node.placements.filter((p) => p.location.includes('multiscales')), node.key).toEqual([]);
        }
        const both = await probeEmbedded(fixtureStore(), [ZC('multiscales'), ZC('spatial')]);
        const group = both.nodes.find((n) => n.key === 'zarr-v3:group')!;
        expect(group.errors).toEqual([]);
        expect(group.placements.find((p) => p.field === 'multiscales')?.source).toBe(ZC('multiscales'));
        const nested = group.placements.filter((p) => p.source === ZC('spatial') && p.location.startsWith('/attributes/multiscales/layout/'));
        expect(nested.map((p) => p.field)).toEqual(expect.arrayContaining(['spatial:shape', 'spatial:transform']));
        expect(both.nodes.find((n) => n.key === 'zarr-v3:array')!.placements.some((p) => p.location.includes('multiscales'))).toBe(false);

        const groups = both.nodes.filter((n) => n.format === 'zarr-v3').map((n) => ({ type: `node:${n.key}`, label: n.nodeType, tone: 'node', doc: n.doc, placements: n.placements }));
        const matrix = buildMatrix(groups, both.sources.filter((s) => s.formats.includes('zarr-v3')), new Set([`${B}zarr/v3/schema.json`]));
        expect(matrix.cells.get(`${ZC('spatial')}|spatial:shape|node:zarr-v3:group attributes › multiscales › layout[]`)).toBeDefined();
        expect(matrix.cells.get(`${ZC('multiscales')}|multiscales|node:zarr-v3:group attributes`)?.kind).toBe('validated');
        expect(matrix.rows.some((r) => r.source === `${B}zarr/v3/schema.json`)).toBe(false);
    });

    it('places NZ in Zarr v3 groups and arrays, and recognises it however data declares it', async () => {
        const NZ = 'https://raw.githubusercontent.com/zarr-conventions/nz/7c923cf7b5467c1a873ca93c9223bf08d60efc07/schema.json';
        const store = fixtureStore();
        const result = await probeEmbedded(store, [NZ]);
        expect(result.nodes.map((n) => n.key)).toEqual(['zarr-v3:group', 'zarr-v3:array']);
        const at = (key: string, field: string) => result.nodes.find((n) => n.key === key)!.placements.find((p) => p.source === NZ && p.field === field);
        expect(at('zarr-v3:group', 'conventions')).toMatchObject({ location: '/attributes', kind: 'validated' });
        expect(at('zarr-v3:array', '_FillValue')).toMatchObject({ location: '/attributes' });
        // The schema checks `conventions` only in groups: in arrays it is allowed but not validated.
        expect(at('zarr-v3:array', 'conventions')?.kind).toBe('presence');
        for (const node of result.nodes) expect(node.errors, node.key).toEqual([]);

        // Data declares the v1 URL its schema names, which is not published yet: it is read as the vendored draft.
        const declared = {
            zarr_format: 3, node_type: 'group',
            attributes: {
                zarr_conventions: [{ uuid: 'd0a980b5-c644-4dcc-85a1-283799a58f40', schema_url: 'https://raw.githubusercontent.com/zarr-conventions/nz/refs/tags/v1/schema.json', name: 'NZ-1.0' }],
                conventions: 'NZ-1.0',
            },
        };
        expect(nodeConventions('zarr-v3', declared, declared)).toEqual([NZ]);
        expect(await validateNode(store, declared, `${B}zarr/v3/schema.json`, [NZ])).toEqual([]);
        // NZ's lowercase `conventions` declares attribute conventions too, as the NUG's `Conventions` does.
        const byAttribute = { zarr_format: 3, node_type: 'group', attributes: { conventions: 'NZ-1.0 CF-1.13' } };
        expect(nodeConventions('zarr-v3', byAttribute, byAttribute).sort()).toEqual([`${B}cf/v1.13/schema.json`, NZ].sort());
        // Rewrites declare NZ by its zarr_conventions entry, not by a Conventions token made of its version label.
        expect(conventionsToken(NZ)).toBeUndefined();
        expect(conventionsToken(`${B}cf/v1.13/schema.json`)).toBe('CF-1.13');
    });

    it('places the coordinate set convention down to coordinate values, and its examples show no unexpected field', async () => {
        const CS = 'https://raw.githubusercontent.com/R-CF/zarr_conventions_cs/33df41a6164e5af1761b32c6686b342bfe4beb3c/schema.json';
        const store = fixtureStore();
        const result = await probeEmbedded(store, [CS]);
        const node = (key: string) => result.nodes.find((n) => n.key === key)!;
        for (const n of result.nodes) expect(n.errors, n.key).toEqual([]);
        // Arrays carry a coordinate set, groups the CRS objects arrays can share; Zarr v2 arrays have no dimension_names.
        expect(node('zarr-v3:array').placements.find((p) => p.field === 'cs')).toMatchObject({ location: '/attributes', kind: 'validated' });
        expect(node('zarr-v3:group').placements.find((p) => p.field === 'crs' && p.location === '/attributes')?.kind).toBe('validated');
        expect(node('zarr-v2:array').notApplicable).toEqual([CS]);
        // Exactly one of regular, external or explicit values: each is placed, though the example holds only one.
        const values = node('zarr-v3:array').placements.filter((p) => p.location.endsWith('/values') && p.location.includes('/axes/')).map((p) => p.field);
        expect([...new Set(values)].sort()).toEqual(['explicit', 'external', 'regular']);
        // Keys a referenced document defines (proj: of its id) are fields there, but the convention claims no proj: prefix.
        const source = result.sources.find((s) => s.key === CS)!;
        expect(source.fields).toContain('proj:code');
        expect(source.prefixes).toEqual([]);

        const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/embedded/${name}`, import.meta.url), 'utf8')) as JsonObject;
        for (const [name, key] of [['cs-cmip6-day.json', 'zarr-v3:array'], ['cs-cru-group.json', 'zarr-v3:group']] as const) {
            const example = read(name);
            // It declares the schema URL the convention names, which does not resolve: read as the vendored copy.
            expect(nodeConventions('zarr-v3', example, example), name).toContain(CS);
            // The examples are abbreviated zarr.json documents: checked against the convention only.
            expect(await validateNode(store, example, CS, []), name).toEqual([]);
            const view = realNodeView(example, node(key), result.sources.filter((s) => s.formats.includes('zarr-v3')), `${B}zarr/v3/schema.json`, true);
            const fields = [...fieldIndex(view).entries()];
            expect(fields.some(([pointer]) => pointer.includes('/axes/')), name).toBe(true);
            expect(fields.filter(([, f]) => f.state === 'unexpected').map(([pointer]) => pointer), name).toEqual([]);
        }
    });

    it('places geolocation arrays with the ref objects it composes, not the PROJJSON of their CRS', async () => {
        const GL = 'https://raw.githubusercontent.com/R-CF/zarr_convention_geolocation/refs/tags/v1.0.0/schema.json';
        const REF = 'https://raw.githubusercontent.com/R-CF/zarr_convention_ref/refs/tags/v2.0.0/schema.json';
        const store = fixtureStore();
        const result = await probeEmbedded(store, [GL, REF]);
        for (const n of result.nodes) {
            expect(n.errors, n.key).toEqual([]);
            expect(n.notApplicable, n.key).toEqual([]);
        }
        const array = result.nodes.find((n) => n.key === 'zarr-v3:array')!;
        const at = (location: string) => array.placements.filter((p) => p.location === location).map((p) => `${p.source === GL ? 'geolocation' : 'ref'}:${p.field}`).sort();
        expect(at('/attributes')).toEqual(['geolocation:geolocation', 'ref:ref']);
        // ref is a convention geolocation composes: its fields are placed inside geolocation's references too.
        expect(at('/attributes/geolocation/geodetic/x/ref')).toEqual(['geolocation:attribute', 'geolocation:node', 'geolocation:uri']);
        const geolocation = result.sources.find((s) => s.key === GL)!;
        expect(geolocation.fields).toContain('proj:code');
        expect(geolocation.fields).not.toContain('datum');
        expect(geolocation.prefixes).toEqual([]);

        const example = JSON.parse(readFileSync(new URL('./fixtures/embedded/geolocation-geodetic-planar.json', import.meta.url), 'utf8')) as JsonObject;
        expect(nodeConventions('zarr-v3', example, example)).toEqual(expect.arrayContaining([GL, REF]));
        for (const url of [GL, REF]) expect(await validateNode(store, example, url, []), url).toEqual([]);
        const view = realNodeView(example, array, result.sources.filter((s) => s.formats.includes('zarr-v3')), `${B}zarr/v3/schema.json`, true);
        const fields = [...fieldIndex(view).entries()];
        expect(fields.some(([pointer]) => pointer === '/attributes/geolocation/planar/x/ref|node')).toBe(true);
        expect(fields.filter(([, f]) => f.state === 'unexpected').map(([pointer]) => pointer)).toEqual([]);
    });

    it('places the fields within the objects of a convention without prefixes, and shows them in real nodes', async () => {
        const store = fixtureStore();
        const both = await probeEmbedded(store, [ZC('multiscales'), ZC('spatial'), ZC('proj')]);
        const group = both.nodes.find((n) => n.key === 'zarr-v3:group')!;
        expect(group.errors).toEqual([]);
        const own = (location: string) => group.placements.filter((p) => p.source === ZC('multiscales') && p.location === location).map((p) => p.field).sort();
        expect(own('/attributes/multiscales')).toEqual(['layout', 'resampling_method']);
        const layout = [...new Set(group.placements.filter((p) => p.source === ZC('multiscales') && p.location.startsWith('/attributes/multiscales/layout/')
            && p.location.split('/').length === 5).map((p) => p.field))].sort();
        expect(layout).toEqual(['asset', 'derived_from', 'resampling_method', 'transform']);
        expect(group.placements.find((p) => p.field === 'asset')?.kind).toBe('validated');
        // Spatial's additions inside the layout are kept next to the fields of multiscales.
        expect(group.placements.some((p) => p.source === ZC('spatial') && p.field === 'spatial:shape' && p.location.startsWith('/attributes/multiscales/layout/'))).toBe(true);
        // The keys of a prefixed field's value (PROJJSON of proj:projjson) are not fields of the convention.
        expect(both.sources.find((s) => s.key === ZC('proj'))!.fields.sort()).toEqual(['proj:code', 'proj:projjson', 'proj:wkt2']);

        const root = JSON.parse(readFileSync(new URL('./fixtures/embedded/blue-marble.zarr.json', import.meta.url), 'utf8')) as JsonObject;
        const { consolidated_metadata: _, ...node } = root;
        const view = realNodeView(node, group, both.sources.filter((s) => s.formats.includes('zarr-v3')), `${B}zarr/v3/schema.json`, true);
        const fields = [...fieldIndex(view).entries()].filter(([key]) => key.startsWith('/attributes/multiscales/'));
        expect(fields.length).toBeGreaterThan(0);
        expect(fields.filter(([, f]) => f.state === 'unexpected').map(([key]) => key)).toEqual([]);
    });

    it('validates a real node against its format and declared conventions', async () => {
        const store = fixtureStore();
        expect(await validateNode(store, { zarr_format: 3, node_type: 'group', attributes: {} }, `${B}zarr/v3/schema.json`, [])).toEqual([]);
        expect(await validateNode(store, { zarr_format: 3, node_type: 'group', shape: [1], attributes: {} }, `${B}zarr/v3/schema.json`, [])).not.toEqual([]);
    });
});
