import { describe, expect, it } from 'vitest';

import { DEFAULT_CONVENTIONS, embeddedCounterparts, fromConventionShortId, KNOWN_CONVENTIONS, stacCounterparts, toConventionShortId } from '../src/lib/conventions';
import { probeEmbedded, validateNode } from '../src/lib/embedded-probe';
import { fixtureStore } from './helpers';

const ZC = (name: string) => `https://raw.githubusercontent.com/zarr-conventions/${name}/refs/tags/v0.1/schema.json`;
const B = 'https://hamk-uas.github.io/stac-schema-explorer/schemas/';

describe('conventions', () => {
    it('round-trips short ids of known conventions', () => {
        expect(toConventionShortId(ZC('proj'))).toBe('proj@v0.1');
        expect(fromConventionShortId('proj@v0.1')).toBe(ZC('proj'));
        expect(fromConventionShortId('cf@1.13')).toBe(`${B}cf/v1.13/schema.json`);
        expect(toConventionShortId('https://example.org/x/schema.json')).toBe('https://example.org/x/schema.json');
        expect(DEFAULT_CONVENTIONS).toContain(ZC('spatial'));
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

    it('validates a real node against its format and declared conventions', async () => {
        const store = fixtureStore();
        expect(await validateNode(store, { zarr_format: 3, node_type: 'group', attributes: {} }, `${B}zarr/v3/schema.json`, [])).toEqual([]);
        expect(await validateNode(store, { zarr_format: 3, node_type: 'group', shape: [1], attributes: {} }, `${B}zarr/v3/schema.json`, [])).not.toEqual([]);
    });
});
