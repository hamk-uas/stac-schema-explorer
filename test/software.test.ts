import { describe, expect, it } from 'vitest';

import { DATA_FORMATS, KNOWN_CONVENTIONS } from '../src/lib/conventions';
import { CORE } from '../src/lib/model';
import { precedenceFor, schemaTarget, softwareFor } from '../src/lib/software';

const schemaOf = (id: string) => KNOWN_CONVENTIONS.find((c) => c.id === id)!.versions[0].schema;
const PROJECTION_V1 = 'https://stac-extensions.github.io/projection/v1.1.0/schema.json';
const ids = (uses: { software: { id: string } }[]) => uses.map((u) => u.software.id);

describe('software', () => {
    it('names schemas as the software list does', () => {
        expect(schemaTarget(CORE)).toEqual({ stac: 'core' });
        expect(schemaTarget(PROJECTION_V1)).toEqual({ stac: 'projection' });
        expect(schemaTarget(schemaOf('cf'))).toEqual({ convention: 'cf' });
        expect(schemaTarget(DATA_FORMATS.find((f) => f.id === 'netcdf')!.schema)).toEqual({ format: 'netcdf' });
        expect(schemaTarget('?foo')).toBeUndefined();
    });

    it('lists software for a field, preferring entries that name it, with what is built on it', () => {
        const uses = softwareFor(schemaOf('cf'), ['attributes', 'scale_factor']);
        expect(ids(uses)).toEqual(expect.arrayContaining(['gdal', 'xarray', 'netcdf4-python']));
        const gdal = uses.find((u) => u.software.id === 'gdal')!;
        expect(gdal.supports.every((s) => s.fields)).toBe(true);
        expect(gdal.through.map((s) => s.id)).toContain('rasterio');
        // An attribute no entry names is only passed through.
        const xarray = softwareFor(schemaOf('cf'), ['attributes', 'long_name']).find((u) => u.software.id === 'xarray')!;
        expect(xarray.supports.map((s) => s.read)).toEqual(['pass-through']);
    });

    it('finds STAC fields of older extension versions by name', () => {
        expect(ids(softwareFor(PROJECTION_V1, ['proj:epsg']))).toEqual(expect.arrayContaining(['stackstac', 'odc-stac']));
        expect(ids(softwareFor(CORE, ['nodata']))).toContain('odc-stac');
    });

    it('tells which source a loader prefers, and which it ignores', () => {
        const stac = precedenceFor(PROJECTION_V1, ['proj:transform']).find((p) => p.software.id === 'stackstac')!;
        expect(stac.step).toBe(0);
        const file = precedenceFor(schemaOf('geotiff'), ['geo_keys', 'ProjectedCRSGeoKey']);
        expect(file.find((p) => p.software.id === 'stackstac')?.step).toBe(-1);
        expect(file.find((p) => p.software.id === 'gdal')?.step).toBe(1);
    });
});
