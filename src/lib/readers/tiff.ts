/**
 * Reads the structure and tags of a TIFF file (GeoTIFF keys, GDAL metadata, COG ghost header) by HTTP range requests, as
 * the nodes the TIFF format schema describes. A port of the Observatory's `readTiffMetadata` (`@observatory/data`): keep
 * the two projections alike; the format schema is their contract.
 */
import type { JsonObject } from '../model';
import type { MetadataNode } from './netcdf';

/** Tags (by id) whose content is decoded into `geo_keys` and `gdal_metadata` instead of being listed raw. */
const GEO_KEY_DIRECTORY = 34735, GEO_DOUBLE_PARAMS = 34736, GEO_ASCII_PARAMS = 34737, GDAL_METADATA = 42112;
const DECODED_TAGS = new Set([GEO_KEY_DIRECTORY, GEO_DOUBLE_PARAMS, GEO_ASCII_PARAMS, GDAL_METADATA]);
/** geotiff.js tag names that differ from the names of the GeoTIFF standard. */
const TAG_NAMES: Record<string, string> = { ModelPixelScale: 'ModelPixelScaleTag', ModelTiepoint: 'ModelTiepointTag', ModelTransformation: 'ModelTransformationTag' };
/** Arrays longer than this are summarised by their length, like tags geotiff.js has not read. */
const MAX_LISTED_VALUES = 64;
const MAX_IMAGES = 64;

/** GeoKey names of GeoTIFF 1.1 by key id. */
const GEO_KEY_NAMES: Record<number, string> = {
    1024: 'GTModelTypeGeoKey', 1025: 'GTRasterTypeGeoKey', 1026: 'GTCitationGeoKey',
    2048: 'GeodeticCRSGeoKey', 2049: 'GeodeticCitationGeoKey', 2050: 'GeodeticDatumGeoKey', 2051: 'PrimeMeridianGeoKey',
    2052: 'GeogLinearUnitsGeoKey', 2053: 'GeogLinearUnitSizeGeoKey', 2054: 'GeogAngularUnitsGeoKey', 2055: 'GeogAngularUnitSizeGeoKey',
    2056: 'EllipsoidGeoKey', 2057: 'EllipsoidSemiMajorAxisGeoKey', 2058: 'EllipsoidSemiMinorAxisGeoKey', 2059: 'EllipsoidInvFlatteningGeoKey',
    2060: 'GeogAzimuthUnitsGeoKey', 2061: 'PrimeMeridianLongitudeGeoKey',
    3072: 'ProjectedCRSGeoKey', 3073: 'ProjectedCitationGeoKey', 3074: 'ProjectionGeoKey', 3075: 'ProjMethodGeoKey',
    3076: 'ProjLinearUnitsGeoKey', 3077: 'ProjLinearUnitSizeGeoKey', 3078: 'ProjStdParallel1GeoKey', 3079: 'ProjStdParallel2GeoKey',
    3080: 'ProjNatOriginLongGeoKey', 3081: 'ProjNatOriginLatGeoKey', 3082: 'ProjFalseEastingGeoKey', 3083: 'ProjFalseNorthingGeoKey',
    3084: 'ProjFalseOriginLongGeoKey', 3085: 'ProjFalseOriginLatGeoKey', 3086: 'ProjFalseOriginEastingGeoKey',
    3087: 'ProjFalseOriginNorthingGeoKey', 3088: 'ProjCenterLongGeoKey', 3089: 'ProjCenterLatGeoKey', 3090: 'ProjCenterEastingGeoKey',
    3091: 'ProjCenterNorthingGeoKey', 3092: 'ProjScaleAtNatOriginGeoKey', 3093: 'ProjScaleAtCenterGeoKey', 3094: 'ProjAzimuthAngleGeoKey',
    3095: 'ProjStraightVertPoleLongGeoKey', 3096: 'ProjRectifiedGridAngleGeoKey',
    4096: 'VerticalGeoKey', 4097: 'VerticalCitationGeoKey', 4098: 'VerticalDatumGeoKey', 4099: 'VerticalUnitsGeoKey',
};

function jsonNumber(value: number): number | string {
    return Number.isFinite(value) ? value : Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity';
}

/** A tag value as JSON: typed arrays as arrays (one value as a number), long arrays as their length. */
function tagValue(value: unknown): unknown {
    if (typeof value === 'number') return jsonNumber(value);
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') return value.replace(/\0+$/, '');
    if (ArrayBuffer.isView(value) || Array.isArray(value)) {
        const values = Array.from(value as ArrayLike<number | bigint | string>, (entry) => (typeof entry === 'bigint' ? Number(entry) : typeof entry === 'number' ? jsonNumber(entry) : entry));
        if (values.length > MAX_LISTED_VALUES) return { count: values.length };
        return values.length === 1 ? values[0] : values;
    }
    return value;
}

/** Decodes the GeoKeyDirectoryTag with its double and ASCII parameter tags. */
export function decodeGeoKeys(directory: ArrayLike<number>, doubles?: ArrayLike<number>, ascii?: string): { version: string; keys: JsonObject } {
    const keys: JsonObject = {};
    const count = Number(directory[3] ?? 0);
    for (let index = 0; index < count; index++) {
        const [id, location, length, offset] = [0, 1, 2, 3].map((field) => Number(directory[4 + index * 4 + field]));
        const name = GEO_KEY_NAMES[id] ?? String(id);
        if (location === 0) keys[name] = offset;
        else if (location === GEO_DOUBLE_PARAMS && doubles) {
            const values = Array.from({ length }, (_, at) => jsonNumber(Number(doubles[offset + at])));
            keys[name] = values.length === 1 ? values[0] : values;
        } else if (location === GEO_ASCII_PARAMS && ascii !== undefined) keys[name] = ascii.slice(offset, offset + length).replace(/[|\0]+$/, '');
    }
    return { version: Number(directory[2]) >= 1 ? '1.1' : '1.0', keys };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (text: string) => text.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_, entity: string) =>
    entity.startsWith('#x') || entity.startsWith('#X') ? String.fromCodePoint(parseInt(entity.slice(2), 16))
        : entity.startsWith('#') ? String.fromCodePoint(Number(entity.slice(1))) : ENTITIES[entity.toLowerCase()]);

/** Items of a GDAL_METADATA tag: dataset items and items of each band, keyed by name (`domain:name` outside the default domain). */
export function parseGDALMetadata(xml: string): { dataset: Record<string, string>; bands: Record<string, string>[] } {
    const dataset: Record<string, string> = {};
    const bands: Record<string, string>[] = [];
    for (const match of xml.matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/g)) {
        const attributes = Object.fromEntries([...match[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map(([, key, value]) => [key, unescapeXml(value)]));
        if (!attributes.name) continue;
        const key = attributes.domain ? `${attributes.domain}:${attributes.name}` : attributes.name;
        const value = unescapeXml(match[2]);
        if (attributes.sample === undefined) dataset[key] = value;
        else {
            const sample = Number(attributes.sample);
            if (!Number.isSafeInteger(sample) || sample < 0 || sample > 65535) continue;
            while (bands.length <= sample) bands.push({});
            bands[sample][key] = value;
        }
    }
    return { dataset, bands };
}

interface TiffDirectory {
    actualizedFields: Map<string | number, unknown>;
    deferredFields: Map<string | number, unknown>;
    deferredArrays: Map<string | number, { length: number }>;
    loadValue(tag: string | number): Promise<unknown>;
}

export interface ReadTiffResult {
    nodes: MetadataNode[];
    /** What was left out: tags summarised by their length, images beyond the first 64. */
    notes: string[];
}

/** Reads the header, the GDAL structural metadata and the tags of every image of a TIFF file by HTTP range requests. */
export async function readTiff(href: string, signal?: AbortSignal): Promise<ReadTiffResult> {
    const { fromUrl, globals } = await import('geotiff');
    const tiff = await fromUrl(href, { allowFullFile: false }, signal);
    const notes: string[] = [];
    const ghost = await tiff.getGhostValues().catch(() => null);
    const total = await tiff.getImageCount();
    const nodes: MetadataNode[] = [{ path: '', node: {
        node_type: 'file',
        byte_order: tiff.littleEndian ? 'little-endian' : 'big-endian',
        bigtiff: tiff.bigTiff,
        image_count: total,
        ...(ghost && Object.keys(ghost).length ? { gdal_structural_metadata: Object.fromEntries(Object.entries(ghost)
            .filter(([key]) => key !== 'GDAL_STRUCTURAL_METADATA_SIZE').map(([key, value]) => [key, String(value).trim()])) } : {}),
    } }];
    // geotiff.js keys fields by tag id (or by name in older versions).
    const idOf = (tag: string | number) => (typeof tag === 'number' ? tag : (globals.tags as Record<string, number>)[tag] ?? Number(tag));
    const nameOf = (tag: string | number) => {
        const name = (globals.tagDefinitions as Record<number, { name?: string } | undefined>)[idOf(tag)]?.name ?? String(tag);
        return TAG_NAMES[name] ?? name;
    };
    const summarised = new Set<string>();
    for (let index = 0; index < Math.min(total, MAX_IMAGES); index++) {
        signal?.throwIfAborted();
        const image = await tiff.getImage(index);
        const directory = image.getFileDirectory() as unknown as TiffDirectory;
        const tags: JsonObject = {};
        for (const [tag, value] of directory.actualizedFields) {
            if (DECODED_TAGS.has(idOf(tag))) continue;
            const listed = tagValue(value) as JsonObject[string];
            tags[nameOf(tag)] = listed;
            if (typeof listed === 'object' && listed !== null && 'count' in listed) summarised.add(nameOf(tag));
        }
        for (const [tag, array] of directory.deferredArrays) {
            if (DECODED_TAGS.has(idOf(tag))) continue;
            tags[nameOf(tag)] = { count: array.length };
            summarised.add(nameOf(tag));
        }
        for (const tag of directory.deferredFields.keys()) {
            if (DECODED_TAGS.has(idOf(tag)) || nameOf(tag) in tags) continue;
            tags[nameOf(tag)] = tagValue(await directory.loadValue(tag)) as JsonObject[string];
        }
        const node: JsonObject = { node_type: 'image', index, tags };
        const field = async (id: number) => {
            const name = (globals.tagDefinitions as Record<number, { name?: string } | undefined>)[id]?.name;
            for (const key of [id, name].filter((key): key is string | number => key !== undefined)) {
                if (directory.actualizedFields.has(key)) return directory.actualizedFields.get(key);
                if (directory.deferredFields.has(key) || directory.deferredArrays.has(key)) return directory.loadValue(key);
            }
            return undefined;
        };
        const directoryValues = await field(GEO_KEY_DIRECTORY);
        if (directoryValues) {
            const doubles = await field(GEO_DOUBLE_PARAMS);
            const ascii = await field(GEO_ASCII_PARAMS);
            const decoded = decodeGeoKeys(directoryValues as ArrayLike<number>, doubles as ArrayLike<number> | undefined, typeof ascii === 'string' ? ascii : undefined);
            node.geotiff_version = decoded.version;
            node.geo_keys = decoded.keys;
        }
        const gdal = await field(GDAL_METADATA);
        if (typeof gdal === 'string') {
            const { dataset, bands } = parseGDALMetadata(gdal);
            node.gdal_metadata = { ...(Object.keys(dataset).length ? { dataset } : {}), ...(bands.length ? { bands } : {}) };
        }
        nodes.push({ path: String(index), node });
    }
    if (summarised.size) notes.push(`Long tag values are shown by their length only: ${[...summarised].sort().join(', ')}.`);
    if (total > MAX_IMAGES) notes.push(`Only the first ${MAX_IMAGES} of ${total} images are read.`);
    return { nodes, notes };
}
