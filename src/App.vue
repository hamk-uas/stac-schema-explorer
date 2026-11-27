<script setup lang="ts">
import { computed, markRaw, onMounted, reactive, ref, shallowRef, watch } from 'vue';

import ConventionPicker from './components/ConventionPicker.vue';
import CorePicker from './components/CorePicker.vue';
import DocCard from './components/DocCard.vue';
import ExtensionPicker from './components/ExtensionPicker.vue';
import FieldInfo, { type FieldCounterpart, type FieldPlace } from './components/FieldInfo.vue';
import JsonView from './components/JsonView.vue';
import Legend from './components/Legend.vue';
import MatrixView from './components/MatrixView.vue';
import NodeCard from './components/NodeCard.vue';
import SchemaInfo from './components/SchemaInfo.vue';
import Splitter from './components/Splitter.vue';
import { isProbeableLocation } from './lib/base-docs';
import { colorOf, sourceLabel } from './lib/colors';
import { DATA_FORMATS, embeddedCounterparts, embeddedSchemaLabel, stacCounterparts } from './lib/conventions';
import { TYPE_LABEL, type DocEntry } from './lib/docs';
import { dataFiles, nodeConventions, READER_LABEL, readerKind, realNodeView, templateEntries, zarrDocument, zarrMetadataUrls, type DataView, type NodeEntry, type ReaderKind } from './lib/embedded-docs';
import type { EmbeddedProbeResult, EmbeddedSourceInfo } from './lib/embedded-probe';
import { Engine } from './lib/engine';
import { describeUrl, extensionWithoutVersion, normalizeSchemaUrl } from './lib/extensions';
import { conceptPath, stacMatrixGroups, type MatrixGroup } from './lib/matrix';
import { CORE, STAC_TYPES, type JsonObject, type ProbeProgress, type ProbeResult, type SourceInfo, type StacType } from './lib/model';
import { getAt, joinPointer, objectLocations } from './lib/pointer';
import { readEmbeddedFile } from './lib/reader';
import { addedSchemas, applyRewrites, declareConventionsAttribute, declareStacExtensions, declareZarrConventions, fieldEdits, templateValue, toggleRewrite, type Rewrite } from './lib/rewrites';
import { precedenceFor, softwareFor } from './lib/software';
import { ALL_CORES } from './lib/cores';
import { LAYERS, schemaLayer } from './lib/layers';
import { fetchDoc, fetchItems, stacVersionFor, type RealDoc } from './lib/stac';
import { documentView, fieldIndex, templateView, undeclaredExtensions, type FieldView } from './lib/tree';
import { defaultState, readState, writeState, type AppState } from './lib/url-state';
import { isVendored } from './lib/vendored';

const DEFAULTS = defaultState();
const state = reactive<AppState>(readState(location.search));
watch(() => writeState(state), (search) => {
    if (search !== location.search) history.replaceState(null, '', search + location.hash);
});
watch(() => state.theme, (theme) => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
}, { immediate: true });

const engine = new Engine();
const result = shallowRef<ProbeResult>();
const progress = ref<ProbeProgress>();
const busy = ref(false);
const engineError = ref('');
let runId = 0;

async function runProbe() {
    const id = ++runId;
    busy.value = true;
    engineError.value = '';
    try {
        const probed = await engine.probe(state.stacVersion, [...state.extensions], (p) => {
            if (id === runId) progress.value = p;
        });
        if (id === runId) result.value = markRaw(probed);
    } catch (error) {
        if (id === runId) engineError.value = error instanceof Error ? error.message : String(error);
    } finally {
        if (id === runId) busy.value = false;
    }
}
watch(() => [state.stacVersion, state.extensions.join('\n')], runProbe, { immediate: true });

const sources = computed(() => result.value?.sources ?? []);

// ---- Embedded metadata: conventions of data formats ------------------------------------------------------------

const embeddedResult = shallowRef<EmbeddedProbeResult>();
const embeddedError = ref('');
let embeddedRunId = 0;
/** Selected cores of data formats: the example shows their nodes even without conventions. */
const formatCores = computed(() => state.cores.filter((id) => id !== 'stac'));
const showsCore = (id: string) => state.cores.includes(id);
async function runEmbeddedProbe() {
    const id = ++embeddedRunId;
    embeddedError.value = '';
    if (state.conventions.length === 0 && formatCores.value.length === 0) {
        embeddedResult.value = undefined;
        return;
    }
    try {
        const probed = await engine.probeEmbedded([...state.conventions], [...formatCores.value]);
        if (id === embeddedRunId) embeddedResult.value = markRaw(probed);
    } catch (error) {
        if (id === embeddedRunId) embeddedError.value = error instanceof Error ? error.message : String(error);
    }
}
watch(() => [state.conventions.join('\n'), formatCores.value.join('\n')], runEmbeddedProbe, { immediate: true });
const embeddedSources = computed<EmbeddedSourceInfo[]>(() => embeddedResult.value?.sources ?? []);
const exampleNodes = computed<NodeEntry[]>(() => (embeddedResult.value ? templateEntries(embeddedResult.value, showsCore) : []));

/** A data file opened directly as the URL (a Zarr store, a netCDF or TIFF file), shown below the (absent) STAC tree. */
const embeddedView = ref<DataView>();

/** The rewrites of one document, in the order they were made. */
const rewritesOf = (doc: string) => state.rewrites.filter((r) => r.doc === doc);
/** Schemas of rewritten fields, which the probe and the view need even when the document does not declare them. */
const rewriteSchemas = (rewrites: Rewrite[]) => rewrites.map((r) => r.source).filter((s) => s !== CORE && !s.startsWith('?'));

async function fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
}

/** The nodes of a Zarr store or metadata document, and the document they were read from. */
async function readZarr(href: string, json?: unknown): Promise<{ format: string; nodes: { path: string; node: JsonObject }[]; read: string }> {
    if (json !== undefined) {
        const document = zarrDocument(json as never);
        if (document) return { ...document, read: href };
    }
    for (const url of json === undefined ? zarrMetadataUrls(href) : []) {
        try {
            const document = zarrDocument((await fetchJson(url)) as never);
            if (document) return { ...document, read: url };
        } catch {
            // Try the next metadata document.
        }
    }
    throw new Error('no Zarr metadata (zarr.json or .zmetadata) found');
}

/** Opens a data file given as the URL: its embedded metadata, each node checked against its format and conventions. */
async function openEmbedded(href: string, label: string, kind: ReaderKind, json?: unknown, zarr?: Awaited<ReturnType<typeof readZarr>>) {
    const view: DataView = reactive({ label, href, kind, assets: [], expanded: true, status: 'idle', nodes: [], notes: [] });
    embeddedView.value = view;
    await readData(view, json, zarr);
}

/** Reads the embedded metadata of a data file into its view; `zarr`: a Zarr document already read. */
async function readData(view: DataView, json?: unknown, zarr?: Awaited<ReturnType<typeof readZarr>>) {
    view.status = 'loading';
    try {
        let document: { format: string; nodes: { path: string; node: JsonObject }[]; read?: string };
        if (view.kind === 'zarr') document = zarr ?? await readZarr(view.href, json);
        else {
            const read = await readEmbeddedFile(view.kind, view.href);
            document = { format: view.kind, nodes: read.nodes };
            view.notes = read.notes;
        }
        view.document = markRaw(document);
        await buildNodes(view);
    } catch (error) {
        view.status = 'error';
        view.error = error instanceof Error ? error.message : String(error);
        if (error instanceof TypeError) view.error += ' (network error or the server does not allow cross-origin requests)';
    }
}

const nodeRuns = new WeakMap<object, number>();

/** Node cards of the nodes read, with their rewrites applied, each checked against its format and conventions. */
async function buildNodes(view: DataView) {
    const source = view.document;
    if (!source) return;
    const run = (nodeRuns.get(view) ?? 0) + 1;
    nodeRuns.set(view, run);
    const format = DATA_FORMATS.find((f) => f.id === source.format)!;
    const keyOf = (path: string) => `node:${source.read ?? view.href}#${path}`;
    const originalRoot = source.nodes.find((n) => n.path === '')?.node;
    const rewrites = source.nodes.flatMap((n) => rewritesOf(keyOf(n.path)));
    const added = addedSchemas(rewrites, [format.schema]);
    const edited = rewriteSchemas(rewrites);
    const urls = [...new Set([...source.nodes.flatMap((n) => nodeConventions(format.id, n.node, originalRoot)), ...state.conventions, ...edited])];
    const probed = await engine.probeEmbedded(urls, [format.id]);
    if (nodeRuns.get(view) !== run) return;
    const templateOf = (node: JsonObject) => probed.nodes.find((t) => t.key === `${format.id}:${String(node.node_type)}`);
    const nodes = source.nodes.map(({ path, node }) => {
        const own = rewritesOf(keyOf(path));
        if (!own.length) return { path, node, rewrites: own };
        const template = templateOf(node);
        const rewritten = applyRewrites(node, own, (r) => templateValue(template, r, probed.sources));
        return { path, node: declareZarrConventions(rewritten, addedSchemas(own, [format.schema]), template?.doc), rewrites: own };
    });
    // Attribute conventions (CF, ACDD) of added fields are declared in the root's global `Conventions` attribute.
    const rootAt = nodes.findIndex((n) => n.path === '');
    if (rootAt >= 0 && added.length) nodes[rootAt] = { ...nodes[rootAt], node: declareConventionsAttribute(nodes[rootAt].node, added) };
    const root = rootAt >= 0 ? nodes[rootAt].node : undefined;
    view.nodes = nodes.map(({ path, node, rewrites: own }) => {
        const conventions = nodeConventions(format.id, node, root);
        const nodeType = String(node.node_type);
        const template = templateOf(node);
        const nodeSources = probed.sources.filter((s) => s.kind === 'format'
            ? s.key === format.schema
            : conventions.includes(s.key) || state.conventions.includes(s.key) || edited.includes(s.key));
        return markRaw({ key: keyOf(path), format: format.id, formatTitle: format.title, nodeType, title: path, href: source.read, doc: markRaw(node),
            view: realNodeView(node, template, nodeSources, format.schema, showsCore(format.id), fieldEdits(own)), sources: nodeSources, conventions, rewrites: own.length });
    });
    view.status = 'ready';
    await Promise.all(view.nodes.map(async (entry, i) => {
        const errors = await engine.validateNode(entry.doc, format.schema, entry.conventions);
        if (nodeRuns.get(view) === run) view.nodes[i] = markRaw({ ...entry, errors, valid: errors.length === 0 });
    }));
}

// ---- Example catalog -------------------------------------------------------------------------------------------

const exampleExpanded = reactive<Record<string, boolean>>({ catalog: true, collection: true, item: true });
const EXAMPLE_KEYS: Record<StacType, string> = { Catalog: 'catalog', Collection: 'collection', Feature: 'item' };

const exampleRoot = computed<DocEntry | undefined>(() => {
    const probed = result.value;
    if (!probed) return undefined;
    const make = (key: string, type: StacType, title: string, extra: Partial<DocEntry> = {}): DocEntry => {
        const template = probed.templates[type];
        return {
            key, type, title, doc: template.doc, template, sources: probed.sources, view: templateView(template, showsCore('stac'), probed.sources),
            valid: template.valid, errors: template.errors, status: 'ready', expanded: exampleExpanded[key] ?? false,
            children: [], remaining: [], ...extra,
        };
    };
    const item = make('item', 'Feature', 'Example item');
    const collection = make('collection', 'Collection', 'Example collection', { children: [item] });
    const subcatalog = make('subcatalog', 'Catalog', 'same possible fields as the root catalog', { role: 'sub-catalog', compact: true });
    return make('catalog', 'Catalog', 'Example catalog', { role: 'root', children: [subcatalog, collection] });
});

// ---- Real catalog from a URL -----------------------------------------------------------------------------------

const hrefInput = ref(state.href);
const hrefRoot = ref<DocEntry>();
const detached = ref<DocEntry>();
const BATCH = 12;

function newEntry(href: string, rel?: string, title?: string): DocEntry {
    return { key: href, type: 'Catalog', role: rel, title: title ?? href, href, status: 'idle', expanded: false, children: [], remaining: [] };
}

function fill(entry: DocEntry, real: RealDoc) {
    entry.type = real.type;
    entry.title = real.title;
    entry.doc = markRaw(real.json);
    entry.original = entry.doc;
    entry.remaining = [...real.childLinks];
    entry.itemsHref = real.itemsHref;
    entry.status = 'ready';
}

function declaredOf(doc: JsonObject | undefined): string[] {
    const declared = doc?.stac_extensions;
    return Array.isArray(declared) ? declared.filter((u): u is string => typeof u === 'string') : [];
}

const analyses = new WeakMap<object, number>();

/** Compares a real document, with its rewrites applied, with the template of its type, and validates it. */
async function analyze(entry: DocEntry) {
    const original = entry.original ?? entry.doc;
    if (!original) return;
    const run = (analyses.get(entry) ?? 0) + 1;
    analyses.set(entry, run);
    const rewrites = rewritesOf(entry.key);
    const version = stacVersionFor(original.stac_version);
    const urls = [...new Set([...state.extensions, ...(state.includeDeclared ? declaredOf(original) : []), ...rewriteSchemas(rewrites)].map(normalizeSchemaUrl))];
    const probed = await engine.probe(version, urls);
    if (analyses.get(entry) !== run) return;
    const template = probed.templates[entry.type];
    const doc = rewrites.length
        ? declareStacExtensions(applyRewrites(original, rewrites, (r) => templateValue(template, r, probed.sources)), addedSchemas(rewrites))
        : original;
    entry.doc = markRaw(doc);
    entry.rewrites = rewrites.length;
    entry.stacVersion = version;
    entry.templateUrls = urls;
    entry.template = markRaw(template);
    entry.sources = markRaw(probed.sources);
    entry.view = markRaw(documentView(doc, template, probed.sources, showsCore('stac'), fieldEdits(rewrites)));
    entry.undeclared = undeclaredExtensions(entry.view, declaredOf(doc), (a, b) => extensionWithoutVersion(a) === extensionWithoutVersion(b));
    if (entry.valid === undefined) {
        const errors = await engine.validate(doc, version, declaredOf(doc).map(normalizeSchemaUrl));
        if (analyses.get(entry) !== run) return;
        entry.errors = errors;
        entry.valid = errors.length === 0;
    }
}

async function load(entry: DocEntry) {
    entry.status = 'loading';
    try {
        fill(entry, await fetchDoc(entry.href!));
        await analyze(entry);
        attachData(entry);
    } catch (error) {
        entry.status = 'error';
        entry.error = error instanceof Error ? error.message : String(error);
        if (error instanceof TypeError) entry.error += ' (network error or the server does not allow cross-origin requests)';
    }
}

async function loadMore(entry: DocEntry) {
    if (entry.remaining.length > 0) {
        const batch = entry.remaining.splice(0, BATCH).map((l) => newEntry(l.href, l.rel, l.title));
        entry.children.push(...batch);
        const added = entry.children.slice(-batch.length);
        for (let i = 0; i < added.length; i += 6) await Promise.all(added.slice(i, i + 6).map(load));
    } else if (entry.itemsHref) {
        const itemsHref = entry.itemsHref;
        entry.itemsHref = undefined;
        try {
            const docs = await fetchItems(itemsHref, BATCH);
            entry.children.push(...docs.map((d) => newEntry(d.href, 'item', d.title)));
            const added = entry.children.slice(-docs.length);
            await Promise.all(added.map(async (child, i) => {
                fill(child, docs[i]);
                await analyze(child);
                attachData(child);
            }));
        } catch (error) {
            entry.error = `items: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}

async function toggle(entry: DocEntry) {
    if (state.mode === 'example') {
        exampleExpanded[entry.key] = !(exampleExpanded[entry.key] ?? false);
        return;
    }
    entry.expanded = !entry.expanded;
    if (entry.expanded && entry.children.length === 0) await loadMore(entry);
}

async function openHref(href: string, keepSelection = false) {
    const trimmed = href.trim();
    if (!trimmed) return;
    state.mode = 'href';
    state.href = trimmed;
    hrefInput.value = trimmed;
    if (!keepSelection) {
        state.selected = trimmed;
        state.pointer = '';
        selectedPointers.value = [''];
    }
    embeddedView.value = undefined;
    // Data files (a Zarr store or its zarr.json or .zmetadata, a netCDF or TIFF file) are explored as embedded metadata, not as STAC.
    const kind = readerKind(trimmed);
    let json: unknown;
    let zarr: Awaited<ReturnType<typeof readZarr>> | undefined;
    if (!kind) {
        try {
            json = await fetchJson(trimmed);
        } catch {
            // A Zarr store or node whose URL does not end in .zarr has its metadata document below it.
            zarr = await readZarr(trimmed).catch(() => undefined);
        }
    }
    if (kind || zarr || zarrDocument(json as never)) {
        hrefRoot.value = undefined;
        await openEmbedded(trimmed, trimmed, kind ?? 'zarr', json, zarr);
        const opened = embeddedView.value as DataView | undefined;
        if (!keepSelection && opened?.nodes[0]) state.selected = opened.nodes[0].key;
        return;
    }
    hrefRoot.value = newEntry(trimmed);
    const root = hrefRoot.value;
    await load(root);
    if (root.status === 'ready') {
        root.expanded = true;
        await loadMore(root);
    }
}

/**
 * Attaches the data files of a loaded document's assets, shown under it. Zarr metadata (a few small JSON documents) is
 * read at once; a netCDF or TIFF file, which can need a large download, when expanded or when the share link selects or
 * rewrites one of its nodes.
 */
function attachData(entry: DocEntry) {
    if (entry.data || !entry.original || !entry.href) return;
    entry.data = dataFiles(entry.original, entry.href).map((file) => reactive<DataView>({
        label: `asset ${file.assets.join(', ')} of ${entry.title}`, ...file, expanded: false, status: 'idle', nodes: [], notes: [],
    }));
    const linked = (file: DataView) => [state.selected, ...state.rewrites.map((r) => r.doc)].some((key) => key.startsWith(`node:${file.href}#`));
    for (const file of entry.data) if (file.kind === 'zarr' || linked(file)) void toggleData(entry, file);
}

async function toggleData(_entry: DocEntry, file: DataView) {
    file.expanded = !file.expanded;
    if (file.expanded && file.status === 'idle') await readData(file);
}

/** Every data file read or attached: the one opened as the URL and those of the loaded documents' assets. */
function dataViews(): DataView[] {
    const out: DataView[] = embeddedView.value ? [embeddedView.value] : [];
    const collect = (e: DocEntry) => out.push(...(e.data ?? []));
    walk(hrefRoot.value, collect);
    if (detached.value) collect(detached.value);
    return out;
}

function walk(entry: DocEntry | undefined, visit: (e: DocEntry) => void) {
    if (!entry) return;
    visit(entry);
    entry.children.forEach((c) => walk(c, visit));
}

watch(() => [state.extensions.join('\n'), state.includeDeclared], () => {
    walk(hrefRoot.value, (e) => e.status === 'ready' && void analyze(e));
    if (detached.value?.status === 'ready') void analyze(detached.value);
});
watch(() => showsCore('stac'), (show) => {
    const refresh = (e: DocEntry) => {
        if (e.doc && e.template && e.sources) e.view = markRaw(documentView(e.doc, e.template, e.sources, show, fieldEdits(rewritesOf(e.key))));
    };
    walk(hrefRoot.value, refresh);
    if (detached.value) refresh(detached.value);
});

/** Rebuilds the node cards of a data file that has been read (they depend on the display, selections and rewrites). */
function rebuildData(view: DataView) {
    if (view.status !== 'ready') return;
    buildNodes(view).catch((error: unknown) => {
        view.status = 'error';
        view.error = error instanceof Error ? error.message : String(error);
    });
}
// Format fields are shown with their format's core, and selected conventions are compared with every node.
watch(() => [formatCores.value.join('\n'), state.conventions.join('\n')], () => dataViews().forEach(rebuildData));

// ---- Rewrites --------------------------------------------------------------------------------------------------

/** Re-analyzes the documents and nodes whose rewrites changed. */
watch(() => state.rewrites, (now, before) => {
    const signature = (list: Rewrite[], doc: string) => JSON.stringify(list.filter((r) => r.doc === doc));
    const docs = new Set([...now, ...(before ?? [])].map((r) => r.doc));
    const changed = new Set([...docs].filter((doc) => signature(now, doc) !== signature(before ?? [], doc)));
    if (!changed.size) return;
    const refresh = (e: DocEntry) => {
        if (!changed.has(e.key) || e.status !== 'ready') return;
        e.valid = undefined;
        void analyze(e);
    };
    walk(hrefRoot.value, refresh);
    if (detached.value) refresh(detached.value);
    for (const view of dataViews()) if (view.nodes.some((n) => changed.has(n.key))) rebuildData(view);
});

/** Adds or removes a field of a real document or node in some of its objects, or undoes its rewrite. */
function editField(doc: string, pointers: string[], field: FieldView) {
    let source = field.source;
    // Format fields of a node are shown as core fields; their template placements are those of the format schema.
    const node = doc.startsWith('node:') ? dataNodes.value.find((n) => n.key === doc) : undefined;
    if (node && source === CORE) source = DATA_FORMATS.find((f) => f.id === node.format)?.schema ?? source;
    const present = field.edit ? field.edit === 'added' : field.state !== 'possible';
    state.rewrites = toggleRewrite(state.rewrites, doc, pointers, field.name, source, present);
    select(doc, pointers, [field.name]);
}

function resetRewrites(doc?: string) {
    state.rewrites = doc ? state.rewrites.filter((r) => r.doc !== doc) : [];
}

const rewrittenDocs = computed(() => new Set(state.rewrites.map((r) => r.doc)).size);

// ---- Selection and JSON panel ----------------------------------------------------------------------------------

const selectedPointers = ref<string[]>([state.pointer || '']);
const jsonOpen = ref(true);

// ---- Pane widths -------------------------------------------------------------------------------------------------

const MIN_SIDE = 180;
const MIN_MAIN = 240;
const MIN_JSON = 260;
const PANES_KEY = `stac-schema-explorer:panes${state.embed ? ':embed' : ''}`;

const appEl = ref<HTMLElement>();
const sideEl = ref<HTMLElement>();
const jsonEl = ref<HTMLElement>();

function loadPanes(): { side?: number; json?: number } {
    try {
        const stored = JSON.parse(localStorage.getItem(PANES_KEY) ?? '{}') as Record<string, unknown>;
        const width = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
        return { side: width(stored.side), json: width(stored.json) };
    } catch {
        return {};
    }
}
const storedPanes = loadPanes();
const sideWidth = ref<number | undefined>(storedPanes.side);
const jsonWidth = ref<number | undefined>(storedPanes.json);
watch([sideWidth, jsonWidth], ([side, json]) => {
    try {
        localStorage.setItem(PANES_KEY, JSON.stringify({ side, json }));
    } catch {
        // Storage may be unavailable, e.g. in a sandboxed embed; widths then last for the page only.
    }
});

/** Which sidebar panels are open; remembered per browser like the pane widths, not in share links. */
const PANELS_KEY = 'stac-schema-explorer:panels';
const panels = reactive<Record<'cores' | 'extensions' | 'conventions' | 'display' | 'legend', boolean>>({
    cores: true, extensions: true, conventions: true, display: true, legend: true,
});
try {
    const stored = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}') as Record<string, unknown>;
    for (const key of Object.keys(panels) as (keyof typeof panels)[]) if (typeof stored[key] === 'boolean') panels[key] = stored[key];
} catch {
    // Unavailable storage: all panels start open.
}
function setPanel(key: keyof typeof panels, event: Event) {
    panels[key] = (event.target as HTMLDetailsElement).open;
    try {
        localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
    } catch {
        // Storage may be unavailable; the state then lasts for the page only.
    }
}

const widthOf = (el: HTMLElement | undefined) => el?.getBoundingClientRect().width ?? 0;
const maxSide = () => widthOf(appEl.value) - (jsonOpen.value ? widthOf(jsonEl.value) : 0) - MIN_MAIN;
const maxJson = () => widthOf(appEl.value) - widthOf(sideEl.value) - MIN_MAIN;
const paneStyle = computed(() => ({
    ...(sideWidth.value === undefined ? {} : { '--side-col': `min(${sideWidth.value}px, 50vw)` }),
    ...(jsonWidth.value === undefined || !jsonOpen.value ? {} : { '--json-col': `min(${jsonWidth.value}px, 70vw)` }),
}));

const coresModified = computed(() => state.stacVersion !== DEFAULTS.stacVersion || ALL_CORES.some((id) => !state.cores.includes(id)));
const panesModified = computed(() => sideWidth.value !== undefined || jsonWidth.value !== undefined);
const displayModified = computed(() => state.groupFields !== DEFAULTS.groupFields
    || (state.mode === 'href' && state.includeDeclared !== DEFAULTS.includeDeclared)
    || state.focus !== DEFAULTS.focus
    || state.theme !== DEFAULTS.theme
    || panesModified.value);

function resetCores() {
    state.cores = [...ALL_CORES];
    state.stacVersion = DEFAULTS.stacVersion;
}
function resetPanes() {
    sideWidth.value = undefined;
    jsonWidth.value = undefined;
}
function resetDisplay() {
    state.groupFields = DEFAULTS.groupFields;
    state.includeDeclared = DEFAULTS.includeDeclared;
    state.focus = DEFAULTS.focus;
    state.theme = DEFAULTS.theme;
    resetPanes();
}

/** Fields of a clicked chip, shown in the selected objects of the JSON. */
const focusNames = ref<string[]>([]);

function select(key: string, pointers: string[], names: string[] = []) {
    state.selected = key;
    selectedPointers.value = pointers;
    focusNames.value = names;
    state.pointer = pointers.find((p) => p !== '') ?? '';
    jsonOpen.value = true;
    // The information panel describes what the JSON highlights: selecting objects without fields leaves nothing to describe.
    if (names.length === 0) {
        state.field = '';
        state.schema = '';
    }
}

function find(entry: DocEntry | undefined, key: string): DocEntry | undefined {
    if (!entry) return undefined;
    if (entry.key === key) return entry;
    for (const child of entry.children) {
        const hit = find(child, key);
        if (hit) return hit;
    }
    return undefined;
}

const currentRoot = computed(() => (state.mode === 'example' ? exampleRoot.value : hrefRoot.value));
/** Nodes of every data file read, which can be selected like documents. */
const dataNodes = computed(() => dataViews().flatMap((view) => view.nodes));
const currentNodes = computed(() => (state.mode === 'example' ? exampleNodes.value : dataNodes.value));
const selectedNode = computed(() => currentNodes.value.find((n) => n.key === state.selected));
const selectedEntry = computed(() => find(currentRoot.value, state.selected) ?? (state.mode === 'href' && detached.value?.key === state.selected ? detached.value : undefined));
const selectedDocument = computed(() => selectedEntry.value ?? selectedNode.value);
const jsonIndex = computed(() => (selectedDocument.value?.view ? fieldIndex(selectedDocument.value.view) : new Map()));
/** What the JSON highlights and scrolls to: the clicked fields where they occur in the selected objects, else those objects. */
const jsonPointers = computed(() => {
    const doc = selectedDocument.value?.doc;
    const occurrences = doc ? selectedPointers.value.flatMap((p) => focusNames.value.map((name) => joinPointer(p, name))).filter((p) => getAt(doc, p) !== undefined) : [];
    return occurrences.length ? occurrences : selectedPointers.value;
});
const jsonTitle = computed(() => {
    if (selectedEntry.value) return `${TYPE_LABEL[selectedEntry.value.type]} — ${selectedEntry.value.title}`;
    const node = selectedNode.value;
    return node ? `${node.formatTitle} ${node.nodeType} — ${node.title || 'root'}` : '';
});

// A shared link may select a document deeper than what is loaded: load it on its own.
watch(() => [state.mode, state.selected, hrefRoot.value?.status], () => {
    if (state.mode !== 'href' || !state.selected || !/^https?:/.test(state.selected) || !hrefRoot.value) return;
    if (find(hrefRoot.value, state.selected) || hrefRoot.value?.status === 'loading' || detached.value?.key === state.selected) return;
    detached.value = newEntry(state.selected, 'selected');
    void load(detached.value);
});

function selectFromMatrix(type: string, pointers: string[], field: string) {
    select(type.startsWith('node:') ? type : EXAMPLE_KEYS[type as StacType], pointers, [field]);
}

const stacGroups = computed(() => (result.value ? stacMatrixGroups(result.value.templates) : []));
/** One placement matrix per data format a selected convention applies to: its node types against its format and conventions. */
const embeddedMatrices = computed(() => {
    const probed = embeddedResult.value;
    if (!probed) return [];
    return DATA_FORMATS.filter((format) => probed.nodes.some((n) => n.format === format.id)).map((format) => ({
        format,
        sources: probed.sources.filter((s) => s.formats.includes(format.id)),
        groups: probed.nodes.filter((n) => n.format === format.id)
            .map((n): MatrixGroup => ({ type: `node:${n.key}`, label: n.nodeType, tone: 'node', doc: n.doc, placements: n.placements })),
    }));
});

function setMode(mode: AppState['mode']) {
    state.mode = mode;
    if (mode === 'example') {
        state.selected = 'collection';
        selectedPointers.value = [''];
        state.pointer = '';
    } else if (state.href) {
        state.selected = state.href;
        if (!hrefRoot.value) void openHref(state.href);
    }
}

function toggleFocus(source: string) {
    state.focus = state.focus === source ? '' : source;
}

/** A schema clicked in the sidebar: highlight its fields and describe it. */
function focusFromPicker(source: string) {
    toggleFocus(source);
    if (state.focus === source) openSchema(source);
}

// ---- Field information --------------------------------------------------------------------------------------------

/** Sources of the document whose field was clicked (a real document may declare extensions beyond the selection). */
const fieldContext = shallowRef<SourceInfo[]>();

/**
 * The schema of a field shown in a node of embedded metadata: format fields are shown as core fields there (the
 * counterparts of STAC core), but are documented by, and read or written as, fields of the format schema.
 */
function nodeSource(source: string, context?: SourceInfo[]): string {
    if (source !== CORE || !context) return source;
    const format = context.find((s) => 'kind' in s && (s as EmbeddedSourceInfo).kind === 'format');
    return format?.key ?? source;
}

function openField(source: string, name: string, context?: SourceInfo[]) {
    fieldContext.value = context ? markRaw(context) : undefined;
    state.field = `${nodeSource(source, context)}|${name}`;
    state.schema = '';
    jsonOpen.value = true;
}

const fieldPanel = computed(() => {
    if (!state.field) return undefined;
    const at = state.field.indexOf('|');
    const source = state.field.slice(0, at);
    const name = state.field.slice(at + 1);
    const pools = [fieldContext.value, sources.value, embeddedSources.value, selectedEntry.value?.sources, selectedNode.value?.sources]
        .filter((p): p is SourceInfo[] => !!p);
    const pool = pools.find((p) => p.some((s) => s.key === source && s.docs[name])) ?? pools[0] ?? [];
    const doc = pool.find((s) => s.key === source)?.docs[name];
    const places: FieldPlace[] = [];
    const probed = result.value;
    if (probed?.sources.some((s) => s.key === source)) {
        for (const type of STAC_TYPES) {
            const template = probed.templates[type];
            const locations = new Set(objectLocations(template.doc).filter(isProbeableLocation));
            const byLabel = new Map<string, FieldPlace>();
            for (const p of template.placements) {
                if (p.source !== source || p.field !== name) continue;
                const label = [TYPE_LABEL[type], ...conceptPath(p.location, locations)].join(' › ');
                const place = byLabel.get(label) ?? { label, type, locations: [], kind: p.kind };
                place.locations.push(p.location);
                if (p.kind === 'validated') place.kind = 'validated';
                if (p.required && !place.required) place.required = p.required;
                byLabel.set(label, place);
            }
            places.push(...byLabel.values());
        }
    }
    const embedded = embeddedSources.value.find((s) => s.key === source) ?? (pool.find((s) => s.key === source) as EmbeddedSourceInfo | undefined);
    for (const template of embeddedResult.value?.nodes ?? []) {
        for (const p of template.placements) {
            if (p.source !== source || p.field !== name) continue;
            places.push({ label: [template.formatTitle, template.nodeType, ...(p.location ? [p.location.slice(1)] : [])].join(' › '), type: `node:${template.key}`, locations: [p.location], kind: p.kind, required: p.required });
        }
    }
    const counterparts: FieldCounterpart[] = [];
    let counterpartsTitle: string | undefined;
    if (embedded && 'containers' in embedded) {
        const container = embedded.containers[name];
        counterpartsTitle = 'In STAC';
        for (const entry of stacCounterparts(source, container ? [container, name] : [name])) {
            const extension = entry.stac.schema ? describeUrl(entry.stac.schema) : undefined;
            counterparts.push({ label: `${entry.stac.paths.map((p) => p.join('.')).join(' or ')} (${extension ? `${extension.name} ${extension.version ?? ''}`.trim() : 'STAC core'}; ${entry.stac.in.join(' or ')})`,
                relation: entry.relation, note: entry.note });
        }
    } else {
        counterpartsTitle = 'Embedded in data as';
        for (const entry of embeddedCounterparts(name, source === 'core' ? undefined : source)) {
            counterparts.push({ label: `${embeddedSchemaLabel(entry.embedded.schema)}: ${entry.embedded.path.join('.')}`, relation: entry.relation, note: entry.note });
        }
    }
    // A field's path in a node (`attributes/grid_mapping`), or its name in STAC, as the software list names it.
    const container = embedded && 'containers' in embedded ? embedded.containers[name] : undefined;
    const path = container ? [container, name] : [name];
    const info = pool.find((s) => s.key === source);
    const formatsOf = embedded && 'formats' in embedded ? embedded.formats : [];
    return {
        source, name, doc, places, counterparts, counterpartsTitle, sources: pool, vendored: source === 'core' ? true : isVendored(source),
        software: softwareFor(source, path), precedence: precedenceFor(source, path),
        definer: schemaLayer(source, info?.version),
        container: formatsOf.length ? { formats: formatsOf.map((id) => DATA_FORMATS.find((f) => f.id === id)?.title ?? id), member: container } : undefined,
    };
});

function showPlace(place: FieldPlace) {
    if (state.mode !== 'example') setMode('example');
    const names = fieldPanel.value ? [fieldPanel.value.name] : [];
    if (place.type.startsWith('node:')) select(place.type, place.locations, names);
    else select(EXAMPLE_KEYS[place.type as StacType], place.locations, names);
}

// ---- Schema information -------------------------------------------------------------------------------------------

/** Sources of the document whose grouped chip was clicked, and the schema's fields in the clicked object. */
const schemaContext = shallowRef<SourceInfo[]>();
const schemaHere = ref<string[]>([]);

function openSchema(source: string, names: string[] = [], context?: SourceInfo[]) {
    schemaContext.value = context ? markRaw(context) : undefined;
    schemaHere.value = names;
    state.schema = nodeSource(source, context);
    state.field = '';
    jsonOpen.value = true;
}

const schemaPanel = computed(() => {
    const source = state.schema;
    if (!source) return undefined;
    const pools = [schemaContext.value, sources.value, embeddedSources.value, selectedEntry.value?.sources, selectedNode.value?.sources]
        .filter((p): p is SourceInfo[] => !!p);
    const pool = pools.find((p) => p.some((s) => s.key === source)) ?? pools[0] ?? [];
    const info = pool.find((s) => s.key === source);
    const places: FieldPlace[] = [];
    const probed = result.value;
    if (probed?.sources.some((s) => s.key === source)) {
        for (const type of STAC_TYPES) {
            const own = probed.templates[type].placements.filter((p) => p.source === source);
            if (own.length) {
                places.push({ label: TYPE_LABEL[type], type, locations: [...new Set(own.map((p) => p.location))],
                    kind: own.some((p) => p.kind === 'validated') ? 'validated' : 'presence' });
            }
        }
    }
    for (const template of embeddedResult.value?.nodes ?? []) {
        const own = template.placements.filter((p) => p.source === source);
        if (own.length) {
            places.push({ label: `${template.formatTitle} ${template.nodeType}`, type: `node:${template.key}`, locations: [...new Set(own.map((p) => p.location))],
                kind: own.some((p) => p.kind === 'validated') ? 'validated' : 'presence' });
        }
    }
    return { source, info, sources: pool, places, here: schemaHere.value.filter((name) => !info || info.fields.includes(name) || source.startsWith('?')) };
});

function showSchemaPlace(place: FieldPlace) {
    const names = schemaPanel.value?.info?.fields ?? [];
    if (state.mode !== 'example') setMode('example');
    schemaHere.value = [];
    if (place.type.startsWith('node:')) select(place.type, place.locations, names);
    else select(EXAMPLE_KEYS[place.type as StacType], place.locations, names);
}

function showSchemaField(name: string) {
    const panel = schemaPanel.value;
    if (!panel) return;
    select(state.selected, selectedPointers.value, [name]);
    openField(panel.source, name, panel.sources);
}

function selectJsonField(source: string, name: string, parent: string) {
    select(state.selected, [parent], [name]);
    openField(source, name, selectedDocument.value?.sources);
}

const fullAppUrl = computed(() => {
    const url = new URL(location.href);
    url.searchParams.delete('embed');
    return url.toString();
});

/** The app without URL parameters: its default state, at whatever path it is deployed. */
const homeUrl = location.pathname;

const findings = computed(() => {
    const probed = result.value;
    if (!probed) return [];
    const out: { type: string; text: string }[] = [];
    for (const type of STAC_TYPES) {
        const template = probed.templates[type];
        for (const c of template.conflicts) {
            out.push({ type: 'conflict', text: `${TYPE_LABEL[type]} ${c.location || '(top level)'}: ${c.field} (${sourceLabel(c.source, probed.sources)}) is rejected by ${sourceLabel(c.rejectedBy, probed.sources)}` });
        }
        for (const e of template.errors) out.push({ type: 'error', text: `${TYPE_LABEL[type]} example does not validate: ${e}` });
    }
    for (const s of probed.sources) {
        if (s.error) out.push({ type: 'error', text: `${s.title}: ${s.error}` });
        if (s.unsampled.length) out.push({ type: 'warn', text: `${s.title}: could not generate a valid example value for ${s.unsampled.join(', ')}` });
    }
    return out;
});

const EXAMPLE_URLS = [
    { label: 'Sentinel-2 L2A COG (Earth Search)', href: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/Q/WD/2020/7/S2A_36QWD_20200701_0_L2A/B04.tif' },
    { label: 'EOPF Sentinel-2 L1C (API)', href: 'https://stac.core.eopf.eodc.eu/collections/sentinel-2-l1c' },
    { label: 'Earth Search Sentinel-2 L2A (API)', href: 'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a' },
    { label: 'openEO CDSE Sentinel-2 L2A collection', href: 'https://openeo.dataspace.copernicus.eu/openeo/1.2/collections/SENTINEL2_L2A' },
];
const exampleUrls = computed(() => [
    ...state.examples,
    ...EXAMPLE_URLS.filter((ex) => !state.examples.some((custom) => custom.href === ex.href)),
]);

onMounted(() => {
    if (state.mode === 'href' && state.href) void openHref(state.href, true);
});
</script>

<template>
  <div ref="appEl" class="app" :class="{ 'no-json': !jsonOpen, embed: state.embed }" :style="paneStyle">
    <header v-if="!state.embed" class="top">
      <div class="brand">
        <h1><a class="home" :href="homeUrl" title="Click to reset all settings and selections">STAC Schema Explorer</a></h1>
        <p>Explore, compare and share where fields of STAC, its extensions and embedded data metadata (Zarr, netCDF, TIFF) belong.</p>
      </div>
      <nav class="modes" aria-label="View">
        <button
          type="button"
          :class="{ on: state.mode === 'example' }"
          title="Click to view a generated example catalog and placement matrix for the selected schemas"
          @click="setMode('example')"
        >Example catalog</button>
        <button
          type="button"
          :class="{ on: state.mode === 'href' }"
          title="Click to inspect and validate a live STAC Catalog, Collection, Item (static or STAC API), Zarr store, netCDF or TIFF URL"
          @click="setMode('href')"
        >Explore a STAC or data URL</button>
      </nav>
      <button
        type="button"
        class="json-toggle"
        :title="jsonOpen ? 'Click to hide the details and JSON panel' : 'Click to show the details and JSON panel'"
        @click="jsonOpen = !jsonOpen"
      >{{ jsonOpen ? 'Hide JSON' : 'Show JSON' }}</button>
      <a
        class="gh"
        href="https://github.com/hamk-uas/stac-schema-explorer"
        target="_blank"
        rel="noopener"
        title="Open the README and source code on GitHub in a new tab"
      >About / source</a>
    </header>

    <aside id="side-pane" ref="sideEl" class="side">
      <details class="panel" :open="panels.cores" @toggle="setPanel('cores', $event)">
        <summary title="Click to collapse or expand the Cores panel">
          <h2><span aria-hidden="true">{{ LAYERS.standard.symbol }}{{ LAYERS.format.symbol }}</span> Cores</h2>
          <button
            v-if="coresModified"
            type="button"
            class="reset"
            :title="`Click to restore default cores (all cores, STAC ${DEFAULTS.stacVersion})`"
            aria-label="Restore default cores"
            @click.prevent.stop="resetCores"
          >↺</button>
          <span class="count" :title="`${state.cores.length} of ${ALL_CORES.length} cores selected`">{{ state.cores.length }}/{{ ALL_CORES.length }}</span>
        </summary>
        <div class="panel-body">
          <p class="hint">Base schemas for STAC documents and data files. Select a core to display its own fields.</p>
          <CorePicker v-model="state.cores" v-model:stac-version="state.stacVersion" :explore="state.mode === 'href'" @focus="focusFromPicker" />
        </div>
      </details>
      <details class="panel" :open="panels.extensions" @toggle="setPanel('extensions', $event)">
        <summary title="Click to collapse or expand the STAC extensions panel">
          <h2><span aria-hidden="true">{{ LAYERS.convention.symbol }}</span> STAC extensions</h2>
          <button
            v-if="state.extensions.length"
            type="button"
            class="reset"
            title="Click to restore default (no extensions selected)"
            aria-label="Restore default extensions"
            @click.prevent.stop="state.extensions = []"
          >↺</button>
          <span class="count" :title="`${state.extensions.length} extensions selected`">{{ state.extensions.length }}</span>
        </summary>
        <div class="panel-body">
          <ExtensionPicker v-model="state.extensions" :sources="sources" @focus="focusFromPicker" />
        </div>
      </details>
      <details class="panel" :open="panels.conventions" @toggle="setPanel('conventions', $event)">
        <summary title="Click to collapse or expand the Data conventions panel">
          <h2><span aria-hidden="true">{{ LAYERS.convention.symbol }}</span> Data conventions</h2>
          <button
            v-if="state.conventions.length"
            type="button"
            class="reset"
            title="Click to restore default (no data conventions selected)"
            aria-label="Restore default data conventions"
            @click.prevent.stop="state.conventions = []"
          >↺</button>
          <span class="count" :title="`${state.conventions.length} data conventions selected`">{{ state.conventions.length }}</span>
        </summary>
        <div class="panel-body">
          <p class="hint">Metadata conventions embedded inside data files (Zarr, netCDF, TIFF) — the data-file counterparts of STAC extensions.</p>
          <ConventionPicker v-model="state.conventions" :sources="embeddedSources" @focus="focusFromPicker" />
        </div>
      </details>
      <details class="panel" :open="panels.display" @toggle="setPanel('display', $event)">
        <summary title="Click to collapse or expand Display options">
          <h2>Display</h2>
          <button
            v-if="displayModified"
            type="button"
            class="reset"
            title="Click to restore all Display options to their defaults"
            aria-label="Restore default display options"
            @click.prevent.stop="resetDisplay"
          >↺</button>
        </summary>
        <div class="panel-body">
          <div class="setting-row">
            <label title="Click to toggle grouping each schema's fields into a single expandable chip"><input v-model="state.groupFields" type="checkbox" /> Group fields by schema</label>
            <button
              v-if="state.groupFields !== DEFAULTS.groupFields"
              type="button"
              class="reset"
              title="Click to restore default (grouped)"
              aria-label="Restore default field grouping"
              @click="state.groupFields = DEFAULTS.groupFields"
            >↺</button>
          </div>
          <div v-if="state.mode === 'href'" class="setting-row">
            <label title="Click to toggle comparing explored documents against extensions they declare in stac_extensions"><input v-model="state.includeDeclared" type="checkbox" /> Include extensions the documents declare</label>
            <button
              v-if="state.includeDeclared !== DEFAULTS.includeDeclared"
              type="button"
              class="reset"
              title="Click to restore default (included)"
              aria-label="Restore default declared-extension handling"
              @click="state.includeDeclared = DEFAULTS.includeDeclared"
            >↺</button>
          </div>
          <div v-if="state.focus" class="setting-row focus">
            <span>Highlighting <span class="swatch" :style="{ background: colorOf(state.focus) }" /> {{ sourceLabel(state.focus, [...sources, ...embeddedSources]) }}</span>
            <button
              type="button"
              class="reset"
              title="Click to restore default (no schema highlighted)"
              aria-label="Clear highlighted schema"
              @click="state.focus = ''"
            >↺</button>
          </div>
          <div v-if="panesModified" class="setting-row focus">
            <span>Pane widths: custom</span>
            <button
              type="button"
              class="reset"
              title="Click to restore default pane widths"
              aria-label="Restore default pane widths"
              @click="resetPanes"
            >↺</button>
          </div>
          <div class="setting-row theme-row">
            <label for="theme-select">Theme</label>
            <select id="theme-select" v-model="state.theme" title="Choose the colour scheme (also controllable via ?theme=light or ?theme=dark)">
              <option value="">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <button
              v-if="state.theme !== DEFAULTS.theme"
              type="button"
              class="reset"
              title="Click to restore default theme (System)"
              aria-label="Restore default theme"
              @click="state.theme = DEFAULTS.theme"
            >↺</button>
          </div>
        </div>
      </details>
      <details class="panel" :open="panels.legend" @toggle="setPanel('legend', $event)">
        <summary title="Click to collapse or expand the Legend"><h2>Legend</h2></summary>
        <div class="panel-body">
          <Legend />
        </div>
      </details>
    </aside>

    <main class="main">
      <p v-if="state.embed" class="embed-bar">
        <strong>STAC Schema Explorer</strong>
        <button
          type="button"
          class="link"
          :title="jsonOpen ? 'Click to hide the details and JSON panel' : 'Click to show the details and JSON panel'"
          @click="jsonOpen = !jsonOpen"
        >{{ jsonOpen ? 'hide JSON' : 'show JSON' }}</button>
        <a :href="fullAppUrl" target="_blank" rel="noopener" title="Open this exact view in the full app in a new tab">open full app ↗</a>
      </p>
      <div v-if="busy" class="progress" role="status">
        <div class="bar" :style="{ width: `${Math.round(100 * (progress?.done ?? 0) / (progress?.total || 1))}%` }" />
        <span>Probing schemas… {{ progress?.label }}</span>
      </div>
      <p v-if="engineError" class="error">{{ engineError }}</p>

      <template v-if="state.mode === 'example'">
        <div class="toolbar">
          <div class="tabs">
            <button
              type="button"
              :class="{ on: state.view === 'tree' }"
              title="Click to inspect the generated example Catalog, Collection, Item and data nodes as a tree"
              @click="state.view = 'tree'"
            >Catalog tree</button>
            <button
              type="button"
              :class="{ on: state.view === 'matrix' }"
              title="Click to compare every field across all conceptual locations in a single matrix"
              @click="state.view = 'matrix'"
            >Placement matrix</button>
          </div>
          <p class="explain">
            Generated <em>extreme case</em>: every field of the selected schemas placed wherever the schemas allow it, validated against
            STAC {{ state.stacVersion }} core and all selected extensions. Select any schema, object or field to inspect details and JSON — share any view by copying the URL.
          </p>
        </div>
        <div v-if="state.view === 'tree' && exampleRoot" class="tree">
          <section class="main-panel" aria-labelledby="stac-tree-heading">
            <header class="panel-head">
              <h3 id="stac-tree-heading"><span aria-hidden="true">{{ LAYERS.standard.symbol }}</span> STAC {{ state.stacVersion }}</h3>
              <span class="panel-tag">STAC catalog hierarchy</span>
            </header>
            <p class="panel-desc">Catalog, Collection and Item documents with every field of STAC core and the selected extensions placed where allowed.</p>
            <DocCard
              :entry="exampleRoot"
              :sources="sources"
              :group="state.groupFields"
              :focus="state.focus"
              :selected-doc="state.selected"
              :selected-pointers="selectedPointers"
              @select="select"
              @toggle="toggle"
              @field="openField"
              @schema="openSchema"
            />
            <details v-if="findings.length" class="findings" open>
              <summary>Findings ({{ findings.length }})</summary>
              <ul>
                <li v-for="(f, i) in findings" :key="i" :class="f.type">{{ f.text }}</li>
              </ul>
            </details>
          </section>
          <section class="main-panel" aria-labelledby="embedded-heading">
            <header class="panel-head">
              <h3 id="embedded-heading"><span aria-hidden="true">{{ LAYERS.format.symbol }}</span> Embedded in the data</h3>
              <span class="panel-tag">Zarr, netCDF, TIFF</span>
            </header>
            <p class="panel-desc">
              Metadata stored inside data files (not in STAC): nodes for each selected format core and each format targeted by the
              selected data conventions, with every field placed where its schemas allow it.
            </p>
            <p v-if="embeddedError" class="error">{{ embeddedError }}</p>
            <p v-if="state.conventions.length === 0 && formatCores.length === 0" class="panel-desc">Select format cores or data conventions in the sidebar to see where their fields go.</p>
            <NodeCard
              v-for="node in exampleNodes"
              :key="node.key"
              :entry="node"
              :group="state.groupFields"
              :focus="state.focus"
              :selected-doc="state.selected"
              :selected-pointers="selectedPointers"
              @select="select"
              @field="openField"
              @schema="openSchema"
            />
          </section>
        </div>
        <div v-else-if="state.view === 'matrix'" class="matrices">
          <p class="matrix-legend">
            <span class="mark validated" /> validated by the schema,
            <span class="mark presence" /> presence only (counts towards an extension's “at least one field” requirement),
            <span class="mark validated partial" /> only in some objects of that kind (hover for details).
            Click any mark to open field details and highlight it in the example JSON.
          </p>
          <section v-if="result" class="main-panel" aria-labelledby="stac-matrix-heading">
            <header class="panel-head">
              <h3 id="stac-matrix-heading"><span aria-hidden="true">{{ LAYERS.standard.symbol }}</span> STAC {{ state.stacVersion }}</h3>
              <span class="panel-tag">Standard · Catalog, Collection and Item</span>
            </header>
            <p class="panel-desc">Where each STAC core and extension field can be placed, by document type and object path.</p>
            <MatrixView
              :groups="stacGroups"
              :sources="result.sources"
              :hidden="showsCore('stac') ? [] : [CORE]"
              :focus="state.focus"
              @select="selectFromMatrix"
              @field="(s: string, n: string) => openField(s, n)"
              @schema="(s: string) => openSchema(s)"
            />
          </section>
          <section v-for="m in embeddedMatrices" :key="m.format.id" class="main-panel" :aria-labelledby="`matrix-${m.format.id}`">
            <header class="panel-head">
              <h3 :id="`matrix-${m.format.id}`"><span aria-hidden="true">{{ LAYERS.format.symbol }}</span> {{ m.format.title }}</h3>
              <span class="panel-tag">Embedded in the data · {{ m.groups.map((g) => g.label).join(' and ') }} nodes</span>
            </header>
            <p class="panel-desc">{{ m.format.description }} Select format cores or data conventions in the sidebar to show their fields.</p>
            <MatrixView
              :groups="m.groups"
              :sources="m.sources"
              :hidden="showsCore(m.format.id) ? [] : [m.format.schema]"
              :focus="state.focus"
              top-label="node"
              @select="selectFromMatrix"
              @field="(s: string, n: string) => openField(s, n, m.sources)"
              @schema="(s: string) => openSchema(s, [], m.sources)"
            />
          </section>
          <section v-if="state.conventions.length === 0 && formatCores.length === 0" class="main-panel" aria-labelledby="embedded-matrix-empty">
            <header class="panel-head">
              <h3 id="embedded-matrix-empty"><span aria-hidden="true">{{ LAYERS.format.symbol }}</span> Embedded in the data</h3>
              <span class="panel-tag">Zarr, netCDF, TIFF</span>
            </header>
            <p class="panel-desc">Select format cores or data conventions in the sidebar to see placement matrices for metadata embedded in data files.</p>
          </section>
        </div>
      </template>

      <template v-else>
        <form class="href-form" @submit.prevent="openHref(hrefInput)">
          <input v-model="hrefInput" type="url" placeholder="https://…/catalog.json, collection.json, item.json, or a Zarr store, netCDF or TIFF file" aria-label="STAC document or data file URL" />
          <button type="submit" title="Click to fetch, inspect and validate this URL">Open</button>
        </form>
        <p class="examples">
          Try:
          <button
            v-for="ex in exampleUrls"
            :key="ex.href"
            type="button"
            class="link"
            :title="`Click to open and inspect this example\n${ex.href}`"
            @click="openHref(ex.href)"
          >{{ ex.label }}</button>
        </p>
        <p class="explain">
          Populated fields are shown alongside every field allowed at the same location (dotted = allowed but absent; red = present
          but not placed there by any selected or declared schema). Expand cards to load child documents or embedded asset metadata
          (Zarr, netCDF, TIFF), and use + / − on fields to test local rewrites — all changes stay in the shareable URL.
        </p>
        <p v-if="state.rewrites.length" class="rewrites-banner" role="status">
          <strong>✎ Rewrites applied:</strong>
          {{ state.rewrites.length }} change{{ state.rewrites.length === 1 ? '' : 's' }} to {{ rewrittenDocs }}
          document{{ rewrittenDocs === 1 ? '' : 's' }} or node{{ rewrittenDocs === 1 ? '' : 's' }}. The tree, JSON (copy and
          download) and validation reflect the rewritten versions; the remote originals are unchanged.
          <button type="button" title="Click to discard all local rewrites and restore the original documents" @click="resetRewrites()">Undo all</button>
        </p>
        <div class="tree">
          <DocCard
            v-if="hrefRoot"
            :entry="hrefRoot"
            :sources="sources"
            :group="state.groupFields"
            :focus="state.focus"
            :selected-doc="state.selected"
            :selected-pointers="selectedPointers"
            @select="select"
            @toggle="toggle"
            @more="loadMore"
            @field="openField"
            @schema="openSchema"
            @edit="editField"
            @reset="resetRewrites"
            @data="toggleData"
          />
          <template v-if="detached && !find(hrefRoot, detached.key)">
            <h3 class="detached">Selected document (outside the loaded tree)</h3>
            <DocCard
              :entry="detached"
              :sources="sources"
              :group="state.groupFields"
              :focus="state.focus"
              :selected-doc="state.selected"
              :selected-pointers="selectedPointers"
              @select="select"
              @toggle="toggle"
              @more="loadMore"
              @field="openField"
              @schema="openSchema"
              @edit="editField"
              @reset="resetRewrites"
              @data="toggleData"
            />
          </template>
          <section v-if="embeddedView" class="embedded-section" aria-labelledby="embedded-view-heading">
            <h3 id="embedded-view-heading">Embedded in the data: {{ embeddedView.label }}</h3>
            <p class="explain">
              The nodes of the {{ READER_LABEL[embeddedView.kind] }}, each shown within the fields its format and its declared or
              recognised conventions (and the selected ones) allow, and validated against them.
              <template v-if="embeddedView.kind === 'netcdf'">The netCDF header is read by HTTP range requests (only the metadata
                blocks of a netCDF-4 file); classic files, and files on servers without range requests, are downloaded up to 64 MiB.</template>
              <template v-else-if="embeddedView.kind === 'tiff'">The TIFF header and image directories are read by HTTP range requests;
                GeoTIFF keys and GDAL metadata are decoded from their tags.</template>
            </p>
            <p v-if="embeddedView.status === 'loading'" class="explain">Loading…</p>
            <p v-else-if="embeddedView.status === 'error'" class="error">⚠ {{ embeddedView.error }}</p>
            <p v-for="note in embeddedView.notes" :key="note" class="explain">ⓘ {{ note }}</p>
            <NodeCard
              v-for="node in embeddedView.nodes"
              :key="node.key"
              :entry="node"
              :group="state.groupFields"
              :focus="state.focus"
              :selected-doc="state.selected"
              :selected-pointers="selectedPointers"
              editable
              in-data-section
              @select="select"
              @field="openField"
              @schema="openSchema"
              @edit="editField"
              @reset="resetRewrites"
            />
          </section>
        </div>
      </template>
    </main>

    <div v-if="jsonOpen" id="json-pane" ref="jsonEl" class="json">
      <FieldInfo
        v-if="fieldPanel"
        :name="fieldPanel.name"
        :source="fieldPanel.source"
        :sources="fieldPanel.sources"
        :doc="fieldPanel.doc"
        :places="fieldPanel.places"
        :vendored="fieldPanel.vendored"
        :counterparts="fieldPanel.counterparts"
        :counterparts-title="fieldPanel.counterpartsTitle"
        :software="fieldPanel.software"
        :precedence="fieldPanel.precedence"
        :definer="fieldPanel.definer"
        :container="fieldPanel.container"
        @close="state.field = ''"
        @place="showPlace"
      />
      <SchemaInfo
        v-else-if="schemaPanel"
        :source="schemaPanel.source"
        :info="schemaPanel.info"
        :sources="schemaPanel.sources"
        :places="schemaPanel.places"
        :here="schemaPanel.here"
        :focused="state.focus === schemaPanel.source"
        @close="state.schema = ''"
        @field="showSchemaField"
        @place="showSchemaPlace"
        @focus="toggleFocus(schemaPanel.source)"
      />
      <JsonView
        class="json-view"
        :doc="selectedDocument?.doc"
        :title="jsonTitle"
        :href="selectedDocument?.href"
        :rewrites="selectedDocument?.rewrites"
        :index="jsonIndex"
        :sources="selectedDocument?.sources ?? []"
        :pointers="jsonPointers"
        @field="selectJsonField"
      />
    </div>

    <Splitter
      v-model="sideWidth"
      class="split split-side"
      label="Resize sidebar"
      controls="side-pane"
      :direction="1"
      :min="MIN_SIDE"
      :max="maxSide"
      :measure="() => widthOf(sideEl)"
    />
    <Splitter
      v-if="jsonOpen"
      v-model="jsonWidth"
      class="split split-json"
      label="Resize JSON panel"
      controls="json-pane"
      :direction="-1"
      :min="MIN_JSON"
      :max="maxJson"
      :measure="() => widthOf(jsonEl)"
    />
  </div>
</template>

<style scoped>
.app {
  --side-col: 300px;
  --json-col: minmax(320px, 38%);
  display: grid;
  grid-template-columns: var(--side-col) minmax(0, 1fr) var(--json-col);
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas: 'top top top' 'side main json';
  height: 100vh;
}
.top {
  grid-area: top;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 10px 18px;
  background: var(--pane);
}
.brand h1 {
  margin: 0;
  font: 700 18px var(--sans);
  color: var(--slate-900);
}
.brand .home {
  color: inherit;
  text-decoration: none;
}
.brand .home:hover {
  text-decoration: underline;
}
.brand p {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--slate-500);
}
.modes {
  display: flex;
  gap: 4px;
  background: var(--field);
  padding: 3px;
  border-radius: 8px;
}
.modes button,
.tabs button {
  border: 0;
  background: none;
  padding: 5px 12px;
  border-radius: 6px;
  font: 500 13px var(--sans);
  color: var(--slate-600);
  cursor: pointer;
}
.modes button.on,
.tabs button.on {
  background: var(--bg);
  color: var(--slate-900);
}
.app.no-json {
  --json-col: 0;
}
.json-toggle {
  margin-left: auto;
  font-size: 12px;
  border: 0;
  background: var(--field);
  color: var(--slate-800);
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
}
.json-toggle:hover {
  background: var(--slate-200);
}
.gh {
  font-size: 12px;
  color: var(--indigo-600);
}
.side {
  grid-area: side;
  overflow: auto;
  padding: 4px 10px 40px;
  background: var(--pane);
}
/* Sidebar sub-panels: flat, collapsible, with a plain heading naming them and counting what is selected. */
.panel {
  margin-bottom: 8px;
  background: var(--layer);
  border-radius: 8px;
}
.panel > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 6px;
  list-style: none;
  cursor: pointer;
  border-radius: 8px;
}
.panel > summary::-webkit-details-marker {
  display: none;
}
.panel > summary::before {
  content: '▸';
  color: var(--slate-500);
  font-size: 11px;
  width: 10px;
}
.panel[open] > summary::before {
  content: '▾';
}
.panel > summary:focus-visible {
  outline: 2px solid var(--indigo-500);
  outline-offset: 1px;
}
.panel-body {
  padding: 2px 10px 10px;
}
.count {
  margin-left: auto;
  font: 600 11px var(--sans);
  color: var(--slate-600);
  background: var(--field);
  border-radius: 999px;
  padding: 0 7px;
}
.panel > summary .reset + .count {
  margin-left: 0;
}
.panel > summary .reset {
  margin-left: auto;
}
.reset {
  border: 0;
  background: none;
  color: var(--slate-500);
  cursor: pointer;
  font: 600 14px/1 var(--sans);
  padding: 2px 4px;
  border-radius: 4px;
  flex: none;
}
.reset:hover {
  color: var(--indigo-600);
  background: var(--hover);
}
.setting-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.setting-row > label,
.setting-row > span {
  flex: 1;
  min-width: 0;
}
.theme-row {
  margin-top: 6px;
}
.theme-row > label {
  flex: none;
  font-size: 13px;
  color: var(--text);
}
.theme-row > select {
  border: 0;
  border-radius: var(--radius-md);
  background: var(--field);
  color: var(--text-strong);
  font-size: 12px;
  padding: 2px 6px;
}
.side h2 {
  margin: 0;
  font: 700 13px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--slate-700);
}
.side label {
  display: block;
  font-size: 13px;
  margin: 3px 0;
}
.side select {
  font-size: 13px;
  padding: 3px 6px;
}
.hint {
  font-size: 11px;
  color: var(--slate-500);
}
.focus {
  font-size: 12px;
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.main {
  grid-area: main;
  overflow: auto;
  padding: 12px 18px 60px;
  background: var(--bg);
}
.json {
  grid-area: json;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--pane);
}
.json-view {
  flex: 1;
  min-height: 0;
}
.app.embed {
  --side-col: 260px;
  --json-col: minmax(300px, 40%);
  grid-template-rows: minmax(0, 1fr);
  grid-template-areas: 'side main json';
}
.app.embed.no-json {
  --json-col: 0;
}
.split {
  align-self: stretch;
}
/* Hit areas extend right of each border, away from the sidebar and main-pane scrollbars. */
.split-side {
  grid-area: side;
  justify-self: end;
  margin-right: -8px;
}
.split-json {
  grid-area: json;
  justify-self: start;
  margin-left: -1px;
}
.embed-bar {
  display: flex;
  gap: 12px;
  align-items: baseline;
  margin: 0 0 8px;
  font-size: 12px;
}
.embed-bar a {
  color: var(--indigo-600);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.tabs {
  display: flex;
  gap: 4px;
  background: var(--field);
  padding: 3px;
  border-radius: 8px;
}
.explain {
  font-size: 12px;
  color: var(--slate-500);
  margin: 4px 0 8px;
  flex: 1;
  min-width: 260px;
}
.progress {
  position: relative;
  height: 22px;
  border-radius: 6px;
  background: var(--indigo-100);
  overflow: hidden;
  margin-bottom: 8px;
}
.progress .bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--indigo-300);
  transition: width 0.2s;
}
.progress span {
  position: relative;
  font-size: 12px;
  padding-left: 8px;
  line-height: 22px;
  color: var(--indigo-800);
}
.error {
  color: var(--red-700);
  font-size: 13px;
}
.href-form {
  display: flex;
  gap: 6px;
}
.href-form input {
  flex: 1;
  font-size: 13px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: var(--field);
  color: var(--slate-900);
}
.href-form button {
  padding: 0 14px;
  border-radius: 6px;
  border: 0;
  background: var(--indigo-600);
  color: var(--white);
  cursor: pointer;
}
.examples {
  font-size: 12px;
  color: var(--slate-500);
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 6px 0;
}
.link {
  border: 0;
  background: none;
  color: var(--indigo-600);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.findings {
  margin-top: 14px;
  font-size: 12px;
  background: var(--layer);
  border-radius: 8px;
  padding: 8px 12px;
}
.findings summary {
  cursor: pointer;
  font-weight: 600;
}
.findings li.conflict,
.findings li.error {
  color: var(--red-700);
}
.findings li.warn {
  color: var(--amber-700);
}
.detached {
  font: 600 12px var(--sans);
  color: var(--slate-500);
  margin: 18px 0 0;
}
.main-panel {
  margin-top: 14px;
  padding: 14px 16px 16px;
  background: var(--layer);
  border-radius: 10px;
}
.tree > .main-panel:first-child,
.matrices > .main-panel:first-of-type {
  margin-top: 8px;
}
.panel-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}
.panel-head h3 {
  margin: 0;
  font: 700 17px/1.25 var(--sans);
  color: var(--slate-900);
}
.panel-tag {
  font: 500 11px var(--sans);
  color: var(--slate-600);
  background: var(--field);
  border-radius: 4px;
  padding: 1px 6px;
}
.panel-desc {
  font-size: 12px;
  color: var(--slate-500);
  margin: 0 0 10px;
  line-height: 1.5;
}
.matrix-legend {
  font-size: 12px;
  color: var(--slate-600);
  margin: 2px 0 8px;
  line-height: 1.7;
}
.matrix-legend .mark {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--slate-600);
  background: var(--slate-600);
  vertical-align: middle;
}
.matrix-legend .mark.presence {
  background: var(--bg);
  border-style: dashed;
}
.matrix-legend .mark.partial {
  background: linear-gradient(90deg, var(--slate-600) 50%, var(--bg) 50%);
}
.embedded-section {
  margin-top: 16px;
  padding: 14px 16px 16px;
  background: var(--layer);
  border-radius: 10px;
}
.embedded-section h3 {
  margin: 0 0 4px;
  font: 700 17px/1.25 var(--sans);
  color: var(--slate-900);
}
.rewrites-banner {
  margin: 4px 0 10px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--amber-900);
  background: var(--amber-100);
  border-radius: 6px;
}
.rewrites-banner button {
  margin-left: 6px;
  font: 600 12px var(--sans);
  border: 0;
  border-radius: 5px;
  background: var(--bg);
  color: var(--amber-800);
  padding: 1px 8px;
  cursor: pointer;
}
@media (max-width: 1100px) {
  .app {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto auto;
    grid-template-areas: 'top' 'side' 'main' 'json';
    height: auto;
  }
  .json {
    height: 70vh;
  }
  .split {
    display: none;
  }
}
</style>
