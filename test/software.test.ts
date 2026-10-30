import { describe, expect, it } from 'vitest';

import { DATA_FORMATS, KNOWN_CONVENTIONS } from '../src/lib/conventions';
import { isStale, monthsSince, schemaLayer } from '../src/lib/layers';
import { CORE } from '../src/lib/model';
import { checkedOf, precedenceFor, schemaTarget, SOFTWARE, softwareFor } from '../src/lib/software';

const schemaOf = (id: string) => KNOWN_CONVENTIONS.find((c) => c.id === id)!.versions[0].schema;
const PROJECTION_V1 = 'https://stac-extensions.github.io/projection/v1.1.0/schema.json';
const ids = (uses: { software: { id: string } }[]) => uses.map((u) => u.software.id);
const sids = (list: { id: string }[]) => list.map((s) => s.id);

describe('software', () => {
    it('names schemas as the software list does', () => {
        expect(schemaTarget(CORE)).toEqual({ stac: 'core' });
        expect(schemaTarget(PROJECTION_V1)).toEqual({ stac: 'projection' });
        expect(schemaTarget(schemaOf('cf'))).toEqual({ convention: 'cf' });
        expect(schemaTarget(DATA_FORMATS.find((f) => f.id === 'netcdf')!.schema)).toEqual({ format: 'netcdf' });
        expect(schemaTarget('?foo')).toBeUndefined();
    });

    it('lists the drivers, libraries and packages that use a field, preferring claims that name it', () => {
        const uses = softwareFor(schemaOf('cf'), ['attributes', 'scale_factor']);
        const byId = new Map(uses.map((u) => [u.software.id, u]));
        expect(byId.get('gdal-netcdf')?.software.layer).toBe('driver');
        expect(byId.get('gdal-netcdf')!.supports.every((s) => s.fields)).toBe(true);
        expect(byId.get('xarray')?.supports.length).toBeGreaterThan(0);
        expect(byId.get('netcdf4-python')?.supports.length).toBeGreaterThan(0);
        // GDAL, and what is built on it, take the driver's interpretation over.
        expect(sids(byId.get('gdal')!.through)).toEqual(['gdal-netcdf']);
        expect(sids(byId.get('rasterio')!.through)).toEqual(['gdal-netcdf']);
        expect(sids(byId.get('rioxarray')!.through)).toEqual(expect.arrayContaining(['xarray', 'gdal-netcdf']));
        // stackstac reads pixels with rasterio but does not take over its interpretation.
        expect(byId.has('stackstac')).toBe(false);
        const xarray = softwareFor(schemaOf('cf'), ['attributes', 'long_name']).find((u) => u.software.id === 'xarray')!;
        expect(xarray.supports.map((s) => s.read)).toEqual(['pass-through']);
    });

    it('finds STAC fields of older extension versions by name', () => {
        expect(ids(softwareFor(PROJECTION_V1, ['proj:epsg']))).toEqual(expect.arrayContaining(['stackstac', 'odc-stac', 'gdal-stacit']));
        expect(ids(softwareFor(CORE, ['nodata']))).toContain('odc-stac');
    });

    it('tells which source a program prefers, and which it ignores', () => {
        const stac = precedenceFor(PROJECTION_V1, ['proj:transform']).find((p) => p.software.id === 'stackstac')!;
        expect(stac.step).toBe(0);
        const file = precedenceFor(schemaOf('geotiff'), ['geo_keys', 'ProjectedCRSGeoKey']);
        expect(file.find((p) => p.software.id === 'stackstac')?.step).toBe(-1);
        expect(file.find((p) => p.software.id === 'gdal-gtiff')?.step).toBe(1);
    });

    it('dates every claim, drivers by their library', () => {
        for (const software of SOFTWARE) expect(checkedOf(software)?.date, software.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(checkedOf(SOFTWARE.find((s) => s.id === 'gdal-zarr')!)).toBe(SOFTWARE.find((s) => s.id === 'gdal')!.checked);
    });
});

describe('layers', () => {
    it('places schemas in layers, with version, maturity and when they were checked', () => {
        expect(schemaLayer(CORE, '1.1.0')).toEqual({ layer: 'standard', kind: 'STAC core', version: '1.1.0' });
        expect(schemaLayer(PROJECTION_V1)).toMatchObject({ layer: 'convention', kind: 'STAC extension', version: '1.1.0' });
        expect(schemaLayer(schemaOf('proj'))).toMatchObject({ layer: 'convention', kind: 'Zarr convention', version: 'v0.1', maturity: 'Pilot' });
        expect(schemaLayer(schemaOf('cf'))!.checked).toMatchObject({ latest: '1.13' });
        expect(schemaLayer(DATA_FORMATS[0].schema)).toMatchObject({ layer: 'format', kind: 'Data format' });
        expect(schemaLayer('?foo')).toBeUndefined();
    });

    it('counts whole months and flags checks of three months or more', () => {
        const now = new Date('2026-10-30T12:00:00Z');
        expect(monthsSince('2026-10-30', now)).toBe(0);
        expect(monthsSince('2026-07-31', now)).toBe(2);
        expect(monthsSince('2026-07-30', now)).toBe(3);
        expect(isStale('2026-08-01', now)).toBe(false);
        expect(isStale('2026-07-30', now)).toBe(true);
    });
});
