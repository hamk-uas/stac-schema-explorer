import { DATA_FORMATS, KNOWN_CONVENTIONS } from './conventions';
import type { EmbeddedProbeResult, EmbeddedSourceInfo, NodeTemplate } from './embedded-probe';
import { CORE, type Json, type JsonObject, type TypeTemplate } from './model';
import { documentView, templateView, type FieldEdits, type FieldView, type ObjectView } from './tree';

/** A node of embedded metadata shown as a card: a node template of the example, or a node read from a data asset. */
export interface NodeEntry {
    key: string;
    format: string;
    formatTitle: string;
    nodeType: string;
    /** Path of the node in its store or file (`''` for the root), or the template's node type. */
    title: string;
    /** The JSON metadata document the node comes from (a Zarr `zarr.json` or `.zmetadata`); none for binary files. */
    href?: string;
    doc: JsonObject;
    view: ObjectView;
    sources: EmbeddedSourceInfo[];
    /** Convention schemas the node is checked against (declared or recognised for real nodes, selected for templates). */
    conventions: string[];
    notApplicable?: string[];
    valid?: boolean;
    errors?: string[];
    /** Number of rewrites applied to `doc` (a node read from data). */
    rewrites?: number;
}

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Members whose entries are fields of their own (as `CONTAINERS` of the probe, not imported to keep the probe off this thread). */
const CONTAINER_KEYS = ['attributes', 'tags', 'geo_keys'];
const STRUCTURE = [...CONTAINER_KEYS, 'zarr_conventions'];

/** A node template as a {@link TypeTemplate}, so that the STAC tree views can show it; format fields only when its core is shown. */
function asTemplate(template: NodeTemplate, formatSchema: string, showFormat: boolean): TypeTemplate {
    return {
        type: 'Catalog', stacVersion: '', doc: template.doc, conflicts: [], notApplicable: template.notApplicable, valid: template.valid, errors: template.errors,
        placements: template.placements.filter((p) => showFormat || p.source !== formatSchema),
    };
}

const formatSchemaOf = (id: string) => DATA_FORMATS.find((f) => f.id === id)!.schema;

/** Cards of the example: one per node type of each format probed; `showFormat` tells which formats show their own fields. */
export function templateEntries(result: EmbeddedProbeResult, showFormat: (formatId: string) => boolean): NodeEntry[] {
    return result.nodes.map((template) => {
        const schema = formatSchemaOf(template.format);
        const sources = result.sources.filter((s) => s.formats.includes(template.format));
        return {
            key: `node:${template.key}`, format: template.format, formatTitle: template.formatTitle, nodeType: template.nodeType,
            title: `example ${template.nodeType}`, doc: template.doc, view: templateView(asTemplate(template, schema, showFormat(template.format)), true), sources,
            conventions: sources.filter((s) => s.kind !== 'format').map((s) => s.key), notApplicable: template.notApplicable,
            valid: template.valid, errors: template.errors,
        };
    });
}

/** The view of a real node within the fields its format and conventions allow at the same place (cf. `documentView`); format fields only with `showFormat`. */
export function realNodeView(node: JsonObject, template: NodeTemplate | undefined, sources: EmbeddedSourceInfo[], formatSchema: string, showFormat: boolean, edits?: FieldEdits): ObjectView {
    // The format's fields play the part of STAC core: hidden unless the format's core is shown. Containers and the
    // declaration of Zarr conventions are structure, like `stac_extensions` in STAC.
    const asCore = sources.map((s) => (s.key === formatSchema ? { ...s, key: CORE, fields: [...s.fields, ...STRUCTURE] } : s));
    const placements = (template?.placements ?? []).map((p) => (p.source === formatSchema ? { ...p, source: CORE } : p));
    const typeTemplate = template ? { ...asTemplate(template, formatSchema, true), placements } : undefined;
    const view = documentView(node, typeTemplate, asCore, showFormat, edits);
    // Objects within a format field (netCDF `filters`, Zarr `codecs`, `chunk_grid`) are that field's value, not places of
    // fields: a key there (a filter's `id`) is not the convention field of the same name (ACDD `id`).
    const inContainer = (pointer: string) => CONTAINER_KEYS.includes(pointer.split('/')[1] ?? '');
    // Back from the part of STAC core: format fields are the format's (named and coloured by it), and present structure
    // is in place even where no template places it.
    const asFormat = (field: FieldView): FieldView => {
        if (field.source !== CORE) return field;
        const state = field.state === 'unexpected' && STRUCTURE.includes(field.name) ? 'populated' : field.state;
        return { ...field, source: formatSchema, state };
    };
    const relabel = (object: ObjectView): ObjectView => ({ ...object, fields: object.fields.map(asFormat), children: object.children.map(relabel) });
    return relabel({ ...view, children: view.children.filter((child) => child.pointers.every(inContainer)) });
}

/** A Zarr metadata document of a store or one of its nodes. */
export interface ZarrDocument {
    format: 'zarr-v3' | 'zarr-v2';
    nodes: { path: string; node: JsonObject }[];
}

/** The nodes of a Zarr v3 `zarr.json` (with its consolidated metadata) or a Zarr v2 `.zmetadata`; undefined for other JSON. */
export function zarrDocument(json: Json): ZarrDocument | undefined {
    if (!isObject(json)) return undefined;
    if (json.zarr_format === 3 && (json.node_type === 'group' || json.node_type === 'array')) {
        const consolidated = isObject(json.consolidated_metadata) ? json.consolidated_metadata : undefined;
        const children = consolidated && isObject(consolidated.metadata) ? consolidated.metadata : {};
        const root: JsonObject = consolidated ? { ...json, consolidated_metadata: Object.fromEntries(Object.entries(consolidated).filter(([k]) => k !== 'metadata')) } : json;
        return { format: 'zarr-v3', nodes: [{ path: '', node: root },
            ...Object.entries(children).filter(([, n]) => isObject(n)).map(([path, node]) => ({ path, node: node as JsonObject })).sort((a, b) => a.path.localeCompare(b.path))] };
    }
    if (isObject(json.metadata) && Object.keys(json.metadata).some((key) => /(^|\/)\.(zgroup|zarray)$/.test(key))) {
        const byPath = new Map<string, { base?: JsonObject; type?: string; attributes?: JsonObject }>();
        for (const [key, value] of Object.entries(json.metadata)) {
            const match = /^(?:(.*)\/)?\.(zgroup|zarray|zattrs)$/.exec(key);
            if (!match || !isObject(value)) continue;
            const entry = byPath.get(match[1] ?? '') ?? {};
            if (match[2] === 'zattrs') entry.attributes = value;
            else { entry.base = value; entry.type = match[2] === 'zarray' ? 'array' : 'group'; }
            byPath.set(match[1] ?? '', entry);
        }
        const nodes = [...byPath].filter(([, e]) => e.base).map(([path, e]) => ({ path, node: { ...e.base!, node_type: e.type!, attributes: e.attributes ?? {} } as JsonObject }));
        return { format: 'zarr-v2', nodes: nodes.sort((a, b) => (a.path === '' ? -1 : b.path === '' ? 1 : a.path.localeCompare(b.path))) };
    }
    return undefined;
}

/** Convention schemas that apply to a node: its `zarr_conventions` (by UUID), the root's `Conventions` attribute, and conventions recognised from its keys. */
export function nodeConventions(format: string, node: JsonObject, root: JsonObject | undefined): string[] {
    const out = new Set<string>();
    const attributes = isObject(node.attributes) ? node.attributes : {};
    for (const declared of Array.isArray(attributes.zarr_conventions) ? attributes.zarr_conventions : []) {
        if (!isObject(declared)) continue;
        const known = KNOWN_CONVENTIONS.find((c) => c.declaration?.zarrConventions?.uuid === declared.uuid);
        const url = typeof declared.schema_url === 'string' ? declared.schema_url : known?.versions[0].schema;
        if (url) out.add(url);
    }
    const tokens = isObject(root?.attributes) && typeof root.attributes.Conventions === 'string' ? root.attributes.Conventions.split(/[\s,]+/) : [];
    for (const convention of KNOWN_CONVENTIONS) {
        if (!convention.formats.includes(format)) continue;
        const pattern = convention.declaration?.conventionsAttribute;
        if (pattern && tokens.some((token) => new RegExp(pattern).test(token))) out.add(convention.versions[0].schema);
        const has = (path: string[]) => path.reduce<Json | undefined>((value, key) => (isObject(value) ? value[key] : undefined), node) !== undefined;
        if (convention.detection?.some(has)) out.add(convention.versions[0].schema);
    }
    return [...out];
}

/** Which reader can read the embedded metadata of a data asset; a Zarr store's version is found when it is read. */
export type ReaderKind = 'zarr' | 'netcdf' | 'tiff';

export const READER_LABEL: Record<ReaderKind, string> = { zarr: 'Zarr store', netcdf: 'netCDF file', tiff: 'TIFF file' };

const ZARR_DOCUMENT = /\/(zarr\.json|\.zmetadata|\.zgroup|\.zarray|\.zattrs)$/i;

/**
 * The reader of an asset's embedded metadata from its media type, or from its file name when it has none: Zarr stores (and
 * their `zarr.json` or `.zmetadata`), netCDF files and TIFF files; `undefined` for others. Same rules as the Observatory's
 * `embeddedReaderKind`.
 */
export function readerKind(href: string, mediaType?: string): ReaderKind | undefined {
    let path: string;
    try {
        path = new URL(href, 'https://example.invalid/').pathname;
    } catch {
        return undefined;
    }
    const [essence = ''] = (mediaType ?? '').toLowerCase().replace(/\s+/g, '').split(';');
    if (essence.includes('zarr')) return 'zarr';
    if (['application/netcdf', 'application/x-netcdf', 'application/x-netcdf4'].includes(essence)) return 'netcdf';
    if (essence === 'image/tiff' || essence === 'image/geotiff') return 'tiff';
    if (ZARR_DOCUMENT.test(path)) return 'zarr';
    if (essence && essence !== 'application/octet-stream') return undefined;
    if (/\.zarr\/?$/i.test(path)) return 'zarr';
    if (/\.(nc|nc4|netcdf|cdf)(\.gz)?$/i.test(path)) return 'netcdf';
    if (/\.tiff?$/i.test(path)) return 'tiff';
    return undefined;
}

/** Assets of a STAC document whose embedded metadata this app can read, with their resolved hrefs. */
export function readableAssets(doc: JsonObject | undefined, baseHref: string | undefined): { key: string; href: string; kind: ReaderKind }[] {
    const assets = isObject(doc?.assets) ? doc.assets : {};
    const out: { key: string; href: string; kind: ReaderKind }[] = [];
    for (const [key, asset] of Object.entries(assets)) {
        if (!isObject(asset) || typeof asset.href !== 'string') continue;
        const kind = readerKind(asset.href, typeof asset.type === 'string' ? asset.type : undefined);
        if (!kind) continue;
        try {
            out.push({ key, href: new URL(asset.href, baseHref).toString(), kind });
        } catch {
            // An href that is not a URL cannot be read.
        }
    }
    return out;
}

/** The store of a Zarr asset, whether it names the store or one of its metadata documents. */
function zarrStore(href: string): string {
    const [path, query = ''] = href.split(/(?=[?#])/);
    return path.replace(ZARR_DOCUMENT, '').replace(/\/+$/, '') + query;
}

/**
 * The data files of a STAC document's readable assets: assets naming the same Zarr store (a `data` store and its
 * `metadata` zarr.json) are one file, read from the store.
 */
export function dataFiles(doc: JsonObject | undefined, baseHref: string | undefined): { assets: string[]; href: string; kind: ReaderKind }[] {
    const files = new Map<string, { assets: string[]; href: string; kind: ReaderKind }>();
    for (const asset of readableAssets(doc, baseHref)) {
        const id = asset.kind === 'zarr' ? `zarr ${zarrStore(asset.href)}` : `${asset.kind} ${asset.href}`;
        const file = files.get(id);
        if (file) file.assets.push(asset.key);
        else files.set(id, { assets: [asset.key], href: asset.kind === 'zarr' ? zarrStore(asset.href) : asset.href, kind: asset.kind });
    }
    return [...files.values()];
}

/** Readable names of common media types; others are shown by their media type alone. */
const MEDIA_TYPE_NAMES: Record<string, string> = {
    'text/csv': 'CSV',
    'text/plain': 'Text',
    'text/html': 'HTML',
    'application/json': 'JSON',
    'application/geo+json': 'GeoJSON',
    'application/vnd.apache.parquet': 'Parquet',
    'application/x-parquet': 'Parquet',
    'application/xml': 'XML',
    'text/xml': 'XML',
    'application/pdf': 'PDF',
    'application/zip': 'ZIP',
    'application/x-hdf5': 'HDF5',
    'application/x-hdf': 'HDF',
    'application/vnd.google-earth.kml+xml': 'KML',
    'application/geopackage+sqlite3': 'GeoPackage',
    'application/flatgeobuf': 'FlatGeobuf',
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'image/jp2': 'JPEG 2000',
    'image/webp': 'WebP',
};

/** A media type's readable name: `text/csv` → CSV, `image/tiff; application=geotiff` → TIFF. */
export function mediaTypeName(type: string | undefined): string | undefined {
    const essence = (type ?? '').toLowerCase().replace(/\s+/g, '').split(';')[0];
    return MEDIA_TYPE_NAMES[essence];
}

/**
 * The assets of a STAC document whose embedded metadata this app does not read (CSV tables, images, documents, …),
 * grouped by their media type (`type`), in the order they first appear.
 */
export function otherAssets(doc: JsonObject | undefined, baseHref: string | undefined): { type?: string; name: string; assets: { key: string; href?: string }[] }[] {
    const readable = new Set(readableAssets(doc, baseHref).map((a) => a.key));
    const groups = new Map<string, { type?: string; name: string; assets: { key: string; href?: string }[] }>();
    for (const [key, asset] of Object.entries(isObject(doc?.assets) ? doc.assets : {})) {
        if (readable.has(key) || !isObject(asset)) continue;
        const type = typeof asset.type === 'string' && asset.type.trim() ? asset.type.trim() : undefined;
        let href: string | undefined;
        try {
            href = typeof asset.href === 'string' ? new URL(asset.href, baseHref).toString() : undefined;
        } catch {
            href = undefined;
        }
        const group = groups.get(type ?? '') ?? { type, name: mediaTypeName(type) ?? type ?? 'No media type', assets: [] };
        group.assets.push({ key, href });
        groups.set(type ?? '', group);
    }
    return [...groups.values()];
}

/** Metadata embedded in a data file (a Zarr store, a netCDF or TIFF file), read from the data and shown as node cards. */
export interface DataView {
    /** What the file is: the URL opened, or the assets of a STAC document that name it. */
    label: string;
    href: string;
    kind: ReaderKind;
    /** Keys of the STAC assets naming the file; none for a file opened directly. */
    assets: string[];
    /** Node cards shown (an asset's file is read when first expanded). */
    expanded: boolean;
    status: 'idle' | 'loading' | 'ready' | 'error';
    error?: string;
    /** What the reader left out or how it had to read the file. */
    notes: string[];
    nodes: NodeEntry[];
    /** The nodes as read, before rewrites, and the metadata document they were read from. */
    document?: { format: string; nodes: { path: string; node: JsonObject }[]; read?: string };
}

/** URLs to try for the metadata of a Zarr store or document: the URL itself when it names a document, else `zarr.json` and `.zmetadata`. */
export function zarrMetadataUrls(href: string): string[] {
    const path = href.split(/[?#]/)[0];
    if (/(\/zarr\.json|\/\.zmetadata|\.json)$/i.test(path)) return [href];
    // A Zarr v2 node document is read with the rest of its store's consolidated metadata.
    const base = path.replace(/\/\.(zgroup|zarray|zattrs)$/i, '').replace(/\/+$/, '');
    const query = /\?[^#]*/.exec(href)?.[0] ?? '';
    return [`${base}/zarr.json${query}`, `${base}/.zmetadata${query}`];
}
