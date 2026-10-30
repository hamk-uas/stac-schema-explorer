import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeArrayBuffer } from 'geotiff';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { dataFiles, mediaTypeName, otherAssets, readableAssets, readerKind, realNodeView, zarrMetadataUrls } from '../src/lib/embedded-docs';
import { validateNode } from '../src/lib/embedded-probe';
import { readNetCDF, type H5Module } from '../src/lib/readers/netcdf';
import { parseGDALMetadata, readTiff } from '../src/lib/readers/tiff';
import { fixtureStore } from './helpers';

const B = 'https://hamk-uas.github.io/stac-schema-explorer/schemas/';
const NETCDF = `${B}netcdf/v0.1.0/schema.json`;
const CF = `${B}cf/v1.13/schema.json`;
const TIFF = `${B}tiff/v0.1.0/schema.json`;

let h5: H5Module & { File: new (path: string, mode: string) => any };
let dir: string;
beforeAll(async () => {
    h5 = (await import('h5wasm/node')) as never;
    await h5.ready;
    dir = await mkdtemp(join(tmpdir(), 'sse-readers-'));
});
afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
});

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

/** A fake server of binary files that answers range requests with 206. */
function serve(files: Record<string, Uint8Array>) {
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input instanceof Request ? input.url : input);
        const body = files[url];
        if (!body) return new Response('missing', { status: 404 });
        const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init.headers).get('range') ?? '');
        if (!range) return new Response(body as BodyInit, { headers: { 'content-length': String(body.length) } });
        const start = Number(range[1]);
        const end = Math.min(Number(range[2]), body.length - 1);
        return new Response(body.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': String(end - start + 1) } });
    }) as typeof fetch;
}

/** A netCDF-4 file with a subgroup: flux(time, lat) with CF attributes; time is unlimited. */
async function netcdf4(): Promise<Uint8Array> {
    const path = join(dir, 'flux.nc');
    const file = new h5.File(path, 'w');
    const scale = (dataset: any, name: string, dimid: number) => {
        dataset.create_attribute('CLASS', 'DIMENSION_SCALE');
        dataset.create_attribute('NAME', name);
        dataset.create_attribute('_Netcdf4Dimid', new Int32Array([dimid]), [1], '<i');
    };
    file.create_dataset({ name: 'time', data: [0, 1], dtype: '<d', maxshape: [null], chunks: [2] });
    scale(file.get('time'), 'time', 0);
    file.get('time').create_attribute('units', 'days since 2020-01-01');
    file.create_dataset({ name: 'lat', data: [60, 61, 62], dtype: '<d' });
    scale(file.get('lat'), 'lat', 1);
    file.create_dataset({ name: 'flux', data: new Float32Array(6), shape: [2, 3], chunks: [1, 3], dtype: '<f', compression: 4 });
    const flux = file.get('flux');
    flux.create_attribute('_Netcdf4Coordinates', new Int32Array([0, 1]), [2], '<i');
    flux.create_attribute('_FillValue', new Float32Array([Number.NaN]), [1], '<f');
    flux.create_attribute('units', 'mol m-2 s-1');
    flux.create_attribute('standard_name', 'surface_upward_mole_flux_of_carbon_dioxide');
    file.create_attribute('Conventions', 'CF-1.8');
    file.create_attribute('title', 'Test flux');
    file.create_group('extra');
    file.get('extra').create_attribute('comment', 'a subgroup');
    file.close();
    return new Uint8Array(await readFile(path));
}

/** A classic (CDF-1) netCDF file: v(x) float with units, t(time) double on the unlimited record dimension with 2 records. */
function classicNetCDF(): Uint8Array {
    const out: number[] = [];
    const int = (n: number) => out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    const pad = () => { while (out.length % 4) out.push(0); };
    const text = (s: string) => { int(s.length); for (const c of s) out.push(c.charCodeAt(0)); pad(); };
    const charAttribute = (name: string, value: string) => { text(name); int(2); text(value); };
    out.push(0x43, 0x44, 0x46, 1);
    int(2);
    int(0x0a); int(2); text('time'); int(0); text('x'); int(3);
    int(0x0c); int(1); charAttribute('title', 'Classic file');
    int(0x0b); int(2);
    text('v'); int(1); int(1); int(0x0c); int(1); charAttribute('units', 'K'); int(5); int(12);
    const beginV = out.length; int(0);
    text('t'); int(1); int(0); int(0); int(0); int(6); int(8);
    const beginT = out.length; int(0);
    const patch = (at: number, value: number) => out.splice(at, 4, (value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
    patch(beginV, out.length);
    out.push(...new Array(12).fill(0));
    patch(beginT, out.length);
    out.push(...new Array(16).fill(0));
    return new Uint8Array(out);
}

describe('netCDF reader', () => {
    it('reads groups, dimensions, variables and attributes of netCDF-4 without HDF5 internals, valid against the format and CF', async () => {
        const nodes = await readNetCDF(await netcdf4(), { h5, scratchDir: dir });
        expect(nodes.map((n) => n.path)).toEqual(['', 'flux', 'lat', 'time', 'extra']);
        const [root, flux] = nodes;
        expect(root.node.format).toBe('netCDF-4');
        expect(root.node.dimensions).toEqual({ time: { size: 2, unlimited: true }, lat: { size: 3 } });
        expect(root.node.attributes).toEqual({ Conventions: 'CF-1.8', title: 'Test flux' });
        expect(flux.node).toMatchObject({ node_type: 'variable', data_type: 'float', dimensions: ['time', 'lat'], shape: [2, 3], chunk_shape: [1, 3] });
        expect((flux.node.filters as { id: number }[])[0].id).toBe(1);
        expect(flux.node.attributes).toEqual({ _FillValue: 'NaN', units: 'mol m-2 s-1', standard_name: 'surface_upward_mole_flux_of_carbon_dioxide' });
        const store = fixtureStore();
        for (const { path, node } of nodes) expect(await validateNode(store, node, NETCDF, [CF]), path).toEqual([]);
        // A filter's `id` is part of the format's `filters`, not the ACDD attribute `id`.
        const acdd = { key: `${B}acdd/v1.3/schema.json`, url: `${B}acdd/v1.3/schema.json`, title: 'ACDD', prefixes: [], fields: ['id'], unsampled: [], docs: {},
            kind: 'attribute-convention' as const, containers: { id: 'attributes' }, formats: ['netcdf'] };
        const view = realNodeView(flux.node, undefined, [acdd], NETCDF, true);
        expect(view.children.flatMap((child) => child.pointers).filter((pointer) => pointer.startsWith('/filters'))).toEqual([]);
        // Format fields, structure included, are the format's and in place when shown, not STAC core fields out of place.
        const netcdf = { key: NETCDF, url: NETCDF, title: 'netCDF', prefixes: [], fields: ['data_type', 'shape'], unsampled: [], docs: {},
            kind: 'format' as const, containers: {}, formats: ['netcdf'] };
        const shown = realNodeView(flux.node, undefined, [netcdf, acdd], NETCDF, true);
        expect(shown.fields.find((f) => f.name === 'attributes')).toMatchObject({ source: NETCDF, state: 'populated' });
        const all = (o: typeof shown): typeof shown.fields => [...o.fields, ...o.children.flatMap(all)];
        expect(all(shown).filter((f) => f.source === 'core')).toEqual([]);
    });

    it('reads a classic file with its record dimension, also when it is downloaded', async () => {
        const bytes = classicNetCDF();
        const href = 'https://example.org/classic.nc';
        serve({ [href]: bytes });
        const nodes = await readNetCDF(href, { h5, scratchDir: dir });
        expect(nodes).toEqual([
            { path: '', node: { node_type: 'group', name: '/', format: 'classic', dimensions: { time: { size: 2, unlimited: true }, x: { size: 3 } }, attributes: { title: 'Classic file' } } },
            { path: 'v', node: { node_type: 'variable', name: 'v', data_type: 'float', dimensions: ['x'], shape: [3], attributes: { units: 'K' } } },
            { path: 't', node: { node_type: 'variable', name: 't', data_type: 'double', dimensions: ['time'], shape: [2], attributes: {} } },
        ]);
        const store = fixtureStore();
        for (const { path, node } of nodes) expect(await validateNode(store, node, NETCDF, []), path).toEqual([]);
    });

    it('refuses to download a file larger than the limit', async () => {
        const href = 'https://example.org/big.nc';
        serve({ [href]: new Uint8Array(100) });
        await expect(readNetCDF(href, { h5, scratchDir: dir, maxDownloadBytes: 10 })).rejects.toThrow(/100 bytes, more than the 10 bytes/);
    });

    it('needs a browser worker for range requests', async () => {
        await expect(readNetCDF('https://example.org/flux.nc', { h5, scratchDir: dir, rangeRequests: true })).rejects.toThrow(/browser worker/);
    });
});

describe('TIFF reader', () => {
    it('reads tags, GeoKeys and GDAL metadata by range requests, valid against the format, GeoTIFF and GDAL', async () => {
        const bytes = new Uint8Array(writeArrayBuffer(new Uint8Array(16).fill(3), {
            width: 4, height: 4, ModelPixelScale: [10, 10, 0], ModelTiepoint: [0, 0, 0, 600000, 9800020, 0],
            GeographicTypeGeoKey: 4326, ProjectedCSTypeGeoKey: 32723, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, GDAL_NODATA: '0',
        } as never));
        const href = 'https://example.org/b04.tif';
        serve({ [href]: bytes });
        const { nodes, notes } = await readTiff(href);
        expect(notes).toEqual([]);
        expect(nodes.map((n) => [n.path, n.node.node_type])).toEqual([['', 'file'], ['0', 'image']]);
        // geotiff.js writes big-endian ("MM") files.
        expect(nodes[0].node).toMatchObject({ byte_order: 'big-endian', bigtiff: false, image_count: 1 });
        const image = nodes[1].node as Record<string, any>;
        expect(image.tags.ImageWidth).toBe(4);
        expect(image.tags.ModelPixelScaleTag).toEqual([10, 10, 0]);
        expect(image.tags.GDAL_NODATA).toBe('0');
        expect(image.tags.GeoKeyDirectory).toBeUndefined();
        expect(image.geo_keys.ProjectedCRSGeoKey).toBe(32723);
        const store = fixtureStore();
        const conventions = [`${B}geotiff/v1.1/schema.json`, `${B}gdal/v0.1.0/schema.json`];
        for (const { path, node } of nodes) expect(await validateNode(store, node, TIFF, conventions), path).toEqual([]);
    });

    it('groups GDAL_METADATA items by band and domain', () => {
        const parsed = parseGDALMetadata('<GDALMetadata><Item name="AREA_OR_POINT">Area</Item><Item name="SCALE" sample="1" role="scale">0.0001</Item>'
            + '<Item name="DESCRIPTION" sample="0" role="description">Red &amp; near</Item><Item name="X" domain="IMAGERY">1</Item></GDALMetadata>');
        expect(parsed).toEqual({ dataset: { AREA_OR_POINT: 'Area', 'IMAGERY:X': '1' }, bands: [{ DESCRIPTION: 'Red & near' }, { SCALE: '0.0001' }] });
    });
});

describe('readable assets', () => {
    it('recognises Zarr, netCDF and TIFF by media type, or by file name without one', () => {
        expect(readerKind('x', 'application/vnd.zarr; version=3')).toBe('zarr');
        expect(readerKind('https://h/s.zarr/zarr.json', 'application/json')).toBe('zarr');
        expect(readerKind('x', 'application/x-netcdf')).toBe('netcdf');
        expect(readerKind('https://h/a.nc')).toBe('netcdf');
        expect(readerKind('https://h/a.nc.gz')).toBe('netcdf');
        expect(readerKind('https://h/a.tif?sig=1')).toBe('tiff');
        expect(readerKind('x', 'image/tiff; application=geotiff; profile=cloud-optimized')).toBe('tiff');
        expect(readerKind('https://h/a.tif', 'image/png')).toBeUndefined();
        expect(readerKind('https://h/a.json')).toBeUndefined();
        const doc = { assets: {
            data: { href: 'data.nc', type: 'application/netcdf' }, cog: { href: 'b04.tif' }, store: { href: 's.zarr' }, thumbnail: { href: 't.png', type: 'image/png' },
        } };
        expect(readableAssets(doc, 'https://h/items/item.json')).toEqual([
            { key: 'data', href: 'https://h/items/data.nc', kind: 'netcdf' },
            { key: 'cog', href: 'https://h/items/b04.tif', kind: 'tiff' },
            { key: 'store', href: 'https://h/items/s.zarr', kind: 'zarr' },
        ]);
    });

    it('finds the metadata documents of a Zarr store, keeping its query', () => {
        expect(zarrMetadataUrls('https://h/s.zarr/?sig=1')).toEqual(['https://h/s.zarr/zarr.json?sig=1', 'https://h/s.zarr/.zmetadata?sig=1']);
        expect(zarrMetadataUrls('https://h/s.zarr/.zgroup')).toEqual(['https://h/s.zarr/zarr.json', 'https://h/s.zarr/.zmetadata']);
        expect(zarrMetadataUrls('https://h/s.zarr/zarr.json')).toEqual(['https://h/s.zarr/zarr.json']);
    });

    it('groups assets naming the same Zarr store into one data file', () => {
        const doc = { assets: {
            data: { href: 's.zarr', type: 'application/vnd.zarr; version=3' },
            metadata: { href: 's.zarr/zarr.json', type: 'application/json' },
            other: { href: 'https://h/t.zarr/?sig=1', type: 'application/vnd.zarr' },
            cog: { href: 'b04.tif', type: 'image/tiff; application=geotiff' },
        } };
        expect(dataFiles(doc, 'https://h/items/item.json')).toEqual([
            { assets: ['data', 'metadata'], href: 'https://h/items/s.zarr', kind: 'zarr' },
            { assets: ['other'], href: 'https://h/t.zarr?sig=1', kind: 'zarr' },
            { assets: ['cog'], href: 'https://h/items/b04.tif', kind: 'tiff' },
        ]);
    });

    it('lists the other assets by media type, with readable names of common types', () => {
        const doc = { assets: {
            jan: { href: 'jan.csv', type: 'text/csv' },
            store: { href: 's.zarr', type: 'application/vnd.zarr' },
            feb: { href: 'feb.csv', type: 'text/csv' },
            thumb: { href: 't.webm', type: 'video/webm' },
            note: { href: 'readme' },
        } };
        expect(otherAssets(doc, 'https://h/items/item.json')).toEqual([
            { type: 'text/csv', name: 'CSV', assets: [{ key: 'jan', href: 'https://h/items/jan.csv' }, { key: 'feb', href: 'https://h/items/feb.csv' }] },
            { type: 'video/webm', name: 'video/webm', assets: [{ key: 'thumb', href: 'https://h/items/t.webm' }] },
            { type: undefined, name: 'No media type', assets: [{ key: 'note', href: 'https://h/items/readme' }] },
        ]);
        expect(mediaTypeName('application/geo+json; charset=utf-8')).toBe('GeoJSON');
    });
});
