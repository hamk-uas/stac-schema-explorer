import { DATA_FORMATS, KNOWN_CONVENTIONS } from './conventions';
import type { EmbeddedProbeResult, EmbeddedSourceInfo, NodeTemplate } from './embedded-probe';
import { CORE, type Json, type JsonObject, type TypeTemplate } from './model';
import { documentView, templateView, type ObjectView } from './tree';

/** A node of embedded metadata shown as a card: a node template of the example, or a node of a real Zarr store. */
export interface NodeEntry {
    key: string;
    format: string;
    formatTitle: string;
    nodeType: string;
    /** Path of the node in its store (`''` for the root), or the template's node type. */
    title: string;
    /** The metadata document the node comes from (`zarr.json`, `.zmetadata`). */
    href?: string;
    doc: JsonObject;
    view: ObjectView;
    sources: EmbeddedSourceInfo[];
    /** Convention schemas the node is checked against (declared or recognised for real nodes, selected for templates). */
    conventions: string[];
    notApplicable?: string[];
    valid?: boolean;
    errors?: string[];
}

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const STRUCTURE = ['attributes', 'tags', 'geo_keys', 'zarr_conventions'];

/** A node template as a {@link TypeTemplate}, so that the STAC tree views can show it; format fields only with `showCore`. */
function asTemplate(template: NodeTemplate, formatSchema: string, showCore: boolean): TypeTemplate {
    return {
        type: 'Catalog', stacVersion: '', doc: template.doc, conflicts: [], notApplicable: template.notApplicable, valid: template.valid, errors: template.errors,
        placements: template.placements.filter((p) => showCore || p.source !== formatSchema),
    };
}

const formatSchemaOf = (id: string) => DATA_FORMATS.find((f) => f.id === id)!.schema;

/** Cards of the example: one per node type of each format that a selected convention applies to. */
export function templateEntries(result: EmbeddedProbeResult, showCore: boolean): NodeEntry[] {
    return result.nodes.map((template) => {
        const schema = formatSchemaOf(template.format);
        const sources = result.sources.filter((s) => s.formats.includes(template.format));
        return {
            key: `node:${template.key}`, format: template.format, formatTitle: template.formatTitle, nodeType: template.nodeType,
            title: `example ${template.nodeType}`, doc: template.doc, view: templateView(asTemplate(template, schema, showCore), true), sources,
            conventions: sources.filter((s) => s.kind !== 'format').map((s) => s.key), notApplicable: template.notApplicable,
            valid: template.valid, errors: template.errors,
        };
    });
}

/** The view of a real node within the fields its format and conventions allow at the same place (cf. `documentView`). */
export function realNodeView(node: JsonObject, template: NodeTemplate | undefined, sources: EmbeddedSourceInfo[], formatSchema: string, showCore: boolean): ObjectView {
    // The format's fields play the part of STAC core: hidden unless core fields are shown. Containers and the declaration of
    // Zarr conventions are structure, like `stac_extensions` in STAC.
    const asCore = sources.map((s) => (s.key === formatSchema ? { ...s, key: CORE, fields: [...s.fields, ...STRUCTURE] } : s));
    const placements = (template?.placements ?? []).map((p) => (p.source === formatSchema ? { ...p, source: CORE } : p));
    const typeTemplate = template ? { ...asTemplate(template, formatSchema, true), placements } : undefined;
    return documentView(node, typeTemplate, asCore, showCore);
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

/** Assets of a STAC document whose embedded metadata this app can read: Zarr stores and their metadata documents. */
export function zarrAssets(doc: JsonObject | undefined, baseHref: string | undefined): { key: string; href: string }[] {
    const assets = isObject(doc?.assets) ? doc.assets : {};
    const out: { key: string; href: string }[] = [];
    for (const [key, asset] of Object.entries(assets)) {
        if (!isObject(asset) || typeof asset.href !== 'string') continue;
        const type = typeof asset.type === 'string' ? asset.type.toLowerCase() : '';
        const path = asset.href.split(/[?#]/)[0];
        if (!type.includes('zarr') && !/(\.zarr\/?|\/zarr\.json|\/\.zmetadata)$/i.test(path)) continue;
        try {
            out.push({ key, href: new URL(asset.href, baseHref).toString() });
        } catch {
            // An href that is not a URL cannot be read.
        }
    }
    return out;
}

/** URLs to try for the metadata of a Zarr store or document: the URL itself when it names a document, else `zarr.json` and `.zmetadata`. */
export function zarrMetadataUrls(href: string): string[] {
    const path = href.split(/[?#]/)[0];
    if (/(\/zarr\.json|\/\.zmetadata|\.json)$/i.test(path)) return [href];
    const base = href.replace(/\/+$/, '');
    return [`${base}/zarr.json`, `${base}/.zmetadata`];
}
