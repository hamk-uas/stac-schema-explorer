/**
 * Reads the netCDF data model of a file (groups, dimensions, variables, attributes), without its data, as the nodes the
 * netCDF format schema describes. A port of the Observatory's `readNetCDFMetadata` (`@observatory/data`): keep the two
 * projections alike; the format schema is their contract.
 */
import type { JsonObject } from '../model';

/** A node of embedded metadata read from a file: its path (`''` for the root) and the node as JSON. */
export interface MetadataNode {
    path: string;
    node: JsonObject;
}

interface H5Attribute { value: unknown }
interface H5Dataset {
    shape: number[] | null;
    dtype: string;
    attrs: Record<string, H5Attribute>;
    metadata?: { chunks: number[] | null; type?: number; size?: number; signed?: boolean; vlen?: boolean; maxshape?: (number | null)[] | null };
    filters?: { id: number; name: string; cd_values: number[] }[];
    get_attached_scales?(axis: number): string[];
}
interface H5Group {
    attrs: Record<string, H5Attribute>;
    keys(): string[];
    get(path: string): unknown;
}
interface H5FS {
    writeFile(path: string, data: Uint8Array): void;
    unlink(path: string): void;
    createLazyFile?(parent: string, name: string, url: string, read: boolean, write: boolean): { contents: unknown; stream_ops?: Record<string, unknown> };
}

/** The parts of h5wasm used here; tests pass `h5wasm/node`. */
export interface H5Module {
    ready: Promise<{ FS: H5FS }>;
    File: new (path: string, mode: 'r') => H5Group & { close(): void };
    Dataset: abstract new (...args: never[]) => object;
    Group?: abstract new (...args: never[]) => object;
}

export interface ReadNetCDFOptions {
    signal?: AbortSignal;
    /** Read a netCDF-4 file by synchronous HTTP range requests, fetching only its metadata blocks. Only in a worker. */
    rangeRequests?: boolean;
    /** Largest file downloaded when it is not read by range requests; default 64 MiB. */
    maxDownloadBytes?: number;
    fetch?: typeof fetch;
    h5?: H5Module;
    /** Directory in h5wasm's filesystem for the scratch copy of the file (a real directory with `h5wasm/node`). */
    scratchDir?: string;
}

const DIMENSION_PLACEHOLDER = 'This is a netCDF dimension but not a netCDF variable.';
/** HDF5 attributes with which netCDF-4 stores its data model; they are not netCDF attributes. */
const INTERNAL_ATTRIBUTES = new Set(['CLASS', 'NAME', 'REFERENCE_LIST', 'DIMENSION_LIST', '_Netcdf4Dimid', '_Netcdf4Coordinates', '_nc3_strict']);
const BLOCK_SIZE = 256 * 1024;
const CACHED_BLOCKS = 32;
let scratchCounter = 0;
let defaultH5: Promise<H5Module> | undefined;

type AttributeValue = string | number | boolean | string[] | number[];

function decodeAttributeValue(value: unknown): AttributeValue | undefined {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return Number(value);
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
        const numbers = Array.from(value as unknown as ArrayLike<number | bigint>, Number);
        return numbers.length === 1 ? numbers[0] : numbers;
    }
    if (Array.isArray(value)) {
        if (value.every((entry) => typeof entry === 'string')) return value.length === 1 ? value[0] : (value as string[]);
        const numbers = value.flat(Infinity).map(Number);
        return numbers.length === 1 ? numbers[0] : numbers;
    }
    return undefined;
}

function decodeAttributes(attrs: Record<string, H5Attribute>): Record<string, AttributeValue> {
    const result: Record<string, AttributeValue> = {};
    for (const [key, attribute] of Object.entries(attrs)) {
        const decoded = decodeAttributeValue(attribute.value);
        if (decoded !== undefined) result[key] = decoded;
    }
    return result;
}

/** A JSON value: non-finite numbers become "NaN", "Infinity" and "-Infinity", as in Zarr. */
function jsonValue(value: unknown): unknown {
    if (typeof value === 'number') return Number.isFinite(value) ? value : Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity';
    if (Array.isArray(value)) return value.map(jsonValue);
    return value;
}

function jsonAttributes(attrs: Record<string, unknown>): JsonObject {
    return Object.fromEntries(Object.entries(attrs).filter(([key]) => !INTERNAL_ATTRIBUTES.has(key)).map(([key, value]) => [key, jsonValue(value)])) as JsonObject;
}

/** The netCDF type of an HDF5 dataset from h5wasm's type metadata, or from its NumPy-style dtype. */
function netcdfType(dataset: H5Dataset): string {
    const meta = dataset.metadata;
    if (meta?.type !== undefined && meta.size !== undefined) {
        if (meta.type === 0) {
            const signed: Record<number, string> = { 1: 'byte', 2: 'short', 4: 'int', 8: 'int64' };
            const unsigned: Record<number, string> = { 1: 'ubyte', 2: 'ushort', 4: 'uint', 8: 'uint64' };
            return (meta.signed === false ? unsigned : signed)[meta.size] ?? 'user-defined';
        }
        if (meta.type === 1) return meta.size === 4 ? 'float' : meta.size === 8 ? 'double' : 'user-defined';
        if (meta.type === 3) return meta.vlen ? 'string' : 'char';
        return 'user-defined';
    }
    const match = /^[<>|=]?([a-zA-Z])(\d*)$/.exec(dataset.dtype);
    const types: Record<string, string> = { b: 'byte', B: 'ubyte', h: 'short', H: 'ushort', i: 'int', I: 'uint', l: 'int', L: 'uint', q: 'int64', Q: 'uint64', f: 'float', d: 'double', S: 'char' };
    return (match && types[match[1]]) ?? 'user-defined';
}

interface Dimension { name: string; length: number; dimid?: number }

/** Dimension names of a variable: by netCDF-4 dimension ids, by attached dimension scales, or by matching lengths. */
function resolveDims(dataset: H5Dataset, attrs: Record<string, AttributeValue>, dimensions: Dimension[]): string[] {
    const shape = dataset.shape ?? [];
    const byDimid = attrs._Netcdf4Coordinates;
    const ids = typeof byDimid === 'number' ? [byDimid] : byDimid;
    if (Array.isArray(ids) && ids.length === shape.length) {
        const names = ids.map((id) => dimensions.find((dim) => dim.dimid === id)?.name);
        if (names.every((name): name is string => name !== undefined)) return names;
    }
    const attached = shape.map((_, axis) => dataset.get_attached_scales?.(axis)?.[0]?.replace(/^\//, ''));
    if (attached.every((name): name is string => !!name && dimensions.some((dim) => dim.name === name))) return attached;
    const remaining = [...dimensions];
    return shape.map((length, axis) => {
        const index = remaining.findIndex((dim) => dim.length === length);
        if (index === -1) return `dim_${axis}`;
        return remaining.splice(index, 1)[0].name;
    });
}

function isUnlimited(dataset: H5Dataset): boolean {
    const max = dataset.metadata?.maxshape?.[0];
    return dataset.metadata?.maxshape != null && (max === null || max === undefined || max < 0 || max > Number.MAX_SAFE_INTEGER);
}

function describeHDF5(root: H5Group, h5: H5Module): MetadataNode[] {
    const nodes: MetadataNode[] = [];
    const visit = (group: H5Group, path: string, inherited: Dimension[]) => {
        const datasets: [string, H5Dataset][] = [];
        const groups: [string, H5Group][] = [];
        for (const key of group.keys()) {
            const child = group.get(key);
            if (child instanceof h5.Dataset) datasets.push([key, child as unknown as H5Dataset]);
            else if (h5.Group && child instanceof h5.Group) groups.push([key, child as unknown as H5Group]);
        }
        const own: Dimension[] = [];
        const unlimited = new Set<string>();
        const placeholders = new Set<string>();
        for (const [name, dataset] of datasets) {
            const attrs = decodeAttributes(dataset.attrs);
            if (attrs.CLASS !== 'DIMENSION_SCALE') continue;
            own.push({ name, length: dataset.shape?.[0] ?? 0, dimid: typeof attrs._Netcdf4Dimid === 'number' ? attrs._Netcdf4Dimid : undefined });
            if (isUnlimited(dataset)) unlimited.add(name);
            if (typeof attrs.NAME === 'string' && attrs.NAME.startsWith(DIMENSION_PLACEHOLDER)) placeholders.add(name);
        }
        const attrs = decodeAttributes(group.attrs);
        nodes.push({ path, node: {
            node_type: 'group',
            name: path ? path.slice(path.lastIndexOf('/') + 1) : '/',
            ...(path ? {} : { format: '_nc3_strict' in attrs ? 'netCDF-4 classic model' : 'netCDF-4' }),
            dimensions: Object.fromEntries(own.map((dim) => [dim.name, { size: dim.length, ...(unlimited.has(dim.name) ? { unlimited: true } : {}) }])),
            attributes: jsonAttributes(attrs),
        } });
        // Variables see the dimensions of their group and its ancestors; nearer ones shadow farther ones of the same name.
        const visible = [...own, ...inherited.filter((dim) => !own.some((other) => other.name === dim.name))];
        for (const [name, dataset] of datasets) {
            if (placeholders.has(name)) continue;
            const variableAttrs = decodeAttributes(dataset.attrs);
            const shape = dataset.shape ?? [];
            const chunks = dataset.metadata?.chunks;
            const filters = dataset.filters ?? [];
            nodes.push({ path: path ? `${path}/${name}` : name, node: {
                node_type: 'variable',
                name,
                data_type: netcdfType(dataset),
                dimensions: shape.length ? resolveDims(dataset, variableAttrs, visible) : [],
                shape: [...shape],
                ...(chunks ? { chunk_shape: [...chunks] } : {}),
                ...(filters.length ? { filters: filters.map((filter) => ({ id: filter.id, name: filter.name, ...(filter.cd_values?.length ? { parameters: [...filter.cd_values] } : {}) })) } : {}),
                attributes: jsonAttributes(variableAttrs),
            } });
        }
        for (const [name, child] of groups) visit(child, path ? `${path}/${name}` : name, visible);
    };
    visit(root, '', []);
    return nodes;
}

async function describeClassic(bytes: Uint8Array): Promise<MetadataNode[]> {
    const { NetCDFReader } = await import('netcdfjs');
    const reader = new NetCDFReader(bytes);
    const attributes = (list: { name: string; value: unknown }[]) => Object.fromEntries(list.map((attribute) => [attribute.name, jsonValue(attribute.value)])) as JsonObject;
    const record = reader.recordDimension;
    const nodes: MetadataNode[] = [{ path: '', node: {
        node_type: 'group',
        name: '/',
        format: reader.version === '64-bit offset format' ? '64-bit offset' : 'classic',
        dimensions: Object.fromEntries(reader.dimensions.map((dimension, index) => [dimension.name, index === record?.id
            ? { size: record.length, unlimited: true } : { size: dimension.size }])) as JsonObject,
        attributes: attributes(reader.globalAttributes),
    } }];
    for (const variable of reader.variables) {
        nodes.push({ path: variable.name, node: {
            node_type: 'variable',
            name: variable.name,
            data_type: variable.type,
            dimensions: variable.dimensions.map((index) => reader.dimensions[index].name),
            shape: variable.dimensions.map((index) => (index === record?.id ? record.length : reader.dimensions[index].size)),
            attributes: attributes(variable.attributes),
        } });
    }
    return nodes;
}

const cacheHint = 'A browser-cached copy without CORS headers (for example from a request made without an Origin) can cause this; clear the browser cache for this host.';

/** Downloads a file of at most `limit` bytes, decompressing gzip. */
async function download(url: string, fetchImpl: typeof fetch, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > limit) {
        await response.body?.cancel();
        throw new Error(`The netCDF file is ${length} bytes, more than the ${limit} bytes it may be downloaded with to read its metadata`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
    return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

/** Starts a full GET only to learn Content-Length (a CORS-safelisted header, unlike Content-Range); the caller cancels its body. */
async function probeLength(url: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<Response> {
    try {
        return await fetchImpl(url, { signal });
    } catch (cause) {
        if (!(cause instanceof TypeError) || signal?.aborted) throw cause;
    }
    return fetchImpl(url, { signal, cache: 'reload' });
}

/** A synchronous range read for the lazy file; a network failure is retried once with `Cache-Control: no-cache`. */
function readRange(url: string, start: number, end: number): XMLHttpRequest {
    const send = (revalidate: boolean) => {
        const request = new XMLHttpRequest();
        request.open('GET', url, false);
        request.setRequestHeader('Range', `bytes=${start}-${end}`);
        if (revalidate) request.setRequestHeader('Cache-Control', 'no-cache');
        request.responseType = 'arraybuffer';
        request.send();
        return request;
    };
    try {
        return send(false);
    } catch {
        // Retried below, bypassing cached responses.
    }
    try {
        return send(true);
    } catch (cause) {
        throw new Error(`The range request for ${url} failed, also when bypassing the browser cache. ${cacheHint}`, { cause });
    }
}

/** Maps a remote file into h5wasm's filesystem as a lazy file read by range requests of 256 KiB blocks. */
async function mapRemoteFile(url: string, path: string, FS: H5FS, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<void> {
    if (typeof document !== 'undefined' || typeof XMLHttpRequest === 'undefined' || !FS.createLazyFile) throw new Error('netCDF range requests need a browser worker');
    const response = await probeLength(url, fetchImpl, signal);
    const length = Number(response.headers.get('content-length'));
    const modified = response.headers.get('last-modified');
    await response.body?.cancel();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    if (!Number.isSafeInteger(length) || length <= 0) throw new Error('netCDF range requests need an exposed Content-Length header');
    const node = FS.createLazyFile(path.slice(0, path.lastIndexOf('/')) || '/', path.slice(path.lastIndexOf('/') + 1), url, true, false);
    const blocks = new Map<number, Uint8Array>();
    const block = (index: number): Uint8Array => {
        let cached = blocks.get(index);
        if (!cached) {
            const start = index * BLOCK_SIZE;
            const end = Math.min(length, start + BLOCK_SIZE) - 1;
            const request = readRange(url, start, end);
            if (request.status !== 206 || !(request.response instanceof ArrayBuffer) || request.response.byteLength !== end - start + 1) {
                throw new Error('the server must return the requested byte range (HTTP 206)');
            }
            if (modified && request.getResponseHeader('last-modified') && request.getResponseHeader('last-modified') !== modified) throw new Error('the file changed while it was read');
            cached = new Uint8Array(request.response);
        }
        blocks.delete(index);
        blocks.set(index, cached);
        if (blocks.size > CACHED_BLOCKS) blocks.delete(blocks.keys().next().value!);
        return cached;
    };
    node.contents = { length, get: (index: number) => block(Math.floor(index / BLOCK_SIZE))[index % BLOCK_SIZE] };
    // Emscripten's lazy file copies one byte per JS callback; copy whole block segments into the wasm heap instead.
    if (node.stream_ops) node.stream_ops = { ...node.stream_ops, read(_stream: unknown, buffer: Int8Array, offset: number, count: number, position: number) {
        if (position >= length) return 0;
        const size = Math.min(length - position, count);
        const target = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, size);
        for (let copied = 0; copied < size;) {
            const at = position + copied;
            const within = at % BLOCK_SIZE;
            const segment = block(Math.floor(at / BLOCK_SIZE)).subarray(within, within + size - copied);
            target.set(segment, copied);
            copied += segment.length;
        }
        return size;
    } };
}

/**
 * The groups and variables of a netCDF file (classic, 64-bit offset or netCDF-4, also gzip-compressed), without its data:
 * what `ncdump -h` shows. With `rangeRequests` (in a worker) a netCDF-4 file is read by HTTP range requests; otherwise it is
 * downloaded, at most `maxDownloadBytes` of it.
 */
export async function readNetCDF(source: string | Uint8Array, options: ReadNetCDFOptions = {}): Promise<MetadataNode[]> {
    const fetchImpl = options.fetch ?? fetch;
    const { signal } = options;
    const ranged = typeof source === 'string' && !!options.rangeRequests && !/\.gz(?:[?#]|$)/i.test(source);
    let bytes: Uint8Array | undefined;
    if (!ranged) {
        bytes = typeof source === 'string' ? await download(source, fetchImpl, options.maxDownloadBytes ?? 64 * 1024 * 1024, signal) : source;
        if (bytes[0] === 0x43 && bytes[1] === 0x44 && bytes[2] === 0x46) return describeClassic(bytes);
    }
    const h5 = options.h5 ?? (await (defaultH5 ??= import('h5wasm').then((module) => module.default as unknown as H5Module)));
    const { FS } = await h5.ready;
    signal?.throwIfAborted();
    const path = `${(options.scratchDir ?? '').replace(/[\\/]$/, '')}/embedded-${Date.now()}-${scratchCounter++}.nc`;
    if (bytes) FS.writeFile(path, bytes);
    else await mapRemoteFile(source as string, path, FS, fetchImpl, signal);
    let file: (H5Group & { close(): void }) | undefined;
    try {
        file = new h5.File(path, 'r');
        return describeHDF5(file, h5);
    } finally {
        file?.close();
        try {
            FS.unlink(path);
        } catch {
            // The scratch file is already gone.
        }
    }
}
