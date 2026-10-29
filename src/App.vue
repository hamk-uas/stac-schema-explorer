<script setup lang="ts">
import { computed, markRaw, onMounted, reactive, ref, shallowRef, watch } from 'vue';

import ConventionPicker from './components/ConventionPicker.vue';
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
import { nodeConventions, READER_LABEL, readableAssets, readerKind, realNodeView, templateEntries, zarrDocument, zarrMetadataUrls, type NodeEntry, type ReaderKind } from './lib/embedded-docs';
import type { EmbeddedProbeResult, EmbeddedSourceInfo } from './lib/embedded-probe';
import { Engine } from './lib/engine';
import { describeUrl, normalizeSchemaUrl } from './lib/extensions';
import { conceptPath, stacMatrixGroups, type MatrixGroup } from './lib/matrix';
import { CORE, STAC_TYPES, STAC_VERSIONS, type JsonObject, type ProbeProgress, type ProbeResult, type SourceInfo, type StacType } from './lib/model';
import { getAt, joinPointer, objectLocations } from './lib/pointer';
import { readEmbeddedFile } from './lib/reader';
import { addedSchemas, applyRewrites, declareConventionsAttribute, declareStacExtensions, declareZarrConventions, fieldEdits, templateValue, toggleRewrite, type Rewrite } from './lib/rewrites';
import { fetchDoc, fetchItems, stacVersionFor, type RealDoc } from './lib/stac';
import { documentView, fieldIndex, templateView, type FieldView } from './lib/tree';
import { readState, writeState, type AppState } from './lib/url-state';
import { isVendored } from './lib/vendored';

const state = reactive<AppState>(readState(location.search));
watch(() => writeState(state), (search) => {
    if (search !== location.search) history.replaceState(null, '', search + location.hash);
});

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
async function runEmbeddedProbe() {
    const id = ++embeddedRunId;
    embeddedError.value = '';
    if (state.conventions.length === 0) {
        embeddedResult.value = undefined;
        return;
    }
    try {
        const probed = await engine.probeEmbedded([...state.conventions]);
        if (id === embeddedRunId) embeddedResult.value = markRaw(probed);
    } catch (error) {
        if (id === embeddedRunId) embeddedError.value = error instanceof Error ? error.message : String(error);
    }
}
watch(() => state.conventions.join('\n'), runEmbeddedProbe, { immediate: true });
const embeddedSources = computed<EmbeddedSourceInfo[]>(() => embeddedResult.value?.sources ?? []);
const exampleNodes = computed<NodeEntry[]>(() => (embeddedResult.value ? templateEntries(embeddedResult.value, state.showCore) : []));

/** Metadata embedded in a data asset (a Zarr store, a netCDF or TIFF file), read from the data and shown as node cards. */
interface EmbeddedView {
    label: string;
    href: string;
    kind: ReaderKind;
    status: 'loading' | 'ready' | 'error';
    error?: string;
    /** What the reader left out or how it had to read the file. */
    notes: string[];
    nodes: NodeEntry[];
    /** The nodes as read, before rewrites, and the metadata document they were read from. */
    document?: { format: string; nodes: { path: string; node: JsonObject }[]; read?: string };
}
const embeddedView = ref<EmbeddedView>();

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

/** Reads the embedded metadata of a data asset and checks each node against its format and conventions. */
async function openEmbedded(href: string, label: string, kind: ReaderKind, json?: unknown) {
    const view: EmbeddedView = reactive({ label, href, kind, status: 'loading', nodes: [], notes: [] });
    embeddedView.value = view;
    try {
        let document: { format: string; nodes: { path: string; node: JsonObject }[]; read?: string };
        if (kind === 'zarr') document = await readZarr(href, json);
        else {
            const read = await readEmbeddedFile(kind, href);
            document = { format: kind, nodes: read.nodes };
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
async function buildNodes(view: EmbeddedView) {
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
        const rewritten = applyRewrites(node, own, (r) => templateValue(template, r));
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
            view: realNodeView(node, template, nodeSources, format.schema, state.showCore, fieldEdits(own)), sources: nodeSources, conventions, rewrites: own.length });
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
            key, type, title, doc: template.doc, template, sources: probed.sources, view: templateView(template, state.showCore),
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
        ? declareStacExtensions(applyRewrites(original, rewrites, (r) => templateValue(template, r)), addedSchemas(rewrites))
        : original;
    entry.doc = markRaw(doc);
    entry.rewrites = rewrites.length;
    entry.stacVersion = version;
    entry.templateUrls = urls;
    entry.template = markRaw(template);
    entry.sources = markRaw(probed.sources);
    entry.view = markRaw(documentView(doc, template, probed.sources, state.showCore, fieldEdits(rewrites)));
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
    if (!kind) {
        try { json = await fetchJson(trimmed); } catch { /* reported by the STAC loader below */ }
    }
    if (kind || zarrDocument(json as never)) {
        hrefRoot.value = undefined;
        await openEmbedded(trimmed, trimmed, kind ?? 'zarr', json);
        const opened = embeddedView.value as EmbeddedView | undefined;
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
    if (hrefRoot.value === root && !embeddedView.value) {
        const zarr = firstZarrAsset(root);
        if (zarr) await openEmbedded(zarr.href, zarr.label, 'zarr');
    }
}

/**
 * The first Zarr asset of the loaded documents, breadth first and preferring the `data` role, read without a click:
 * its metadata is a few small JSON documents. netCDF and TIFF files can need large downloads and stay behind their links.
 */
function firstZarrAsset(root: DocEntry): { href: string; label: string } | undefined {
    const queue = [root];
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
        if (entry.status === 'ready' && entry.doc && entry.href) {
            const assets = readableAssets(entry.doc, entry.href).filter((a) => a.kind === 'zarr');
            const rolesOf = (key: string) => ((entry!.doc!.assets as Record<string, { roles?: unknown }>)[key]?.roles);
            const asset = assets.find((a) => {
                const roles = rolesOf(a.key);
                return Array.isArray(roles) && roles.includes('data');
            }) ?? assets[0];
            if (asset) return { href: asset.href, label: `asset ${asset.key} of ${entry.title}` };
        }
        queue.push(...entry.children);
    }
    return undefined;
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
watch(() => state.showCore, () => {
    const refresh = (e: DocEntry) => {
        if (e.doc && e.template && e.sources) e.view = markRaw(documentView(e.doc, e.template, e.sources, state.showCore, fieldEdits(rewritesOf(e.key))));
    };
    walk(hrefRoot.value, refresh);
    if (detached.value) refresh(detached.value);
});

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
    const view = embeddedView.value;
    if (view?.status === 'ready' && view.nodes.some((n) => changed.has(n.key))) {
        buildNodes(view).catch((error: unknown) => {
            view.status = 'error';
            view.error = error instanceof Error ? error.message : String(error);
        });
    }
});

/** Adds or removes a field of a real document or node in some of its objects, or undoes its rewrite. */
function editField(doc: string, pointers: string[], field: FieldView) {
    let source = field.source;
    // Format fields of a node are shown as core fields; their template placements are those of the format schema.
    const node = doc.startsWith('node:') ? embeddedView.value?.nodes.find((n) => n.key === doc) : undefined;
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

const widthOf = (el: HTMLElement | undefined) => el?.getBoundingClientRect().width ?? 0;
const maxSide = () => widthOf(appEl.value) - (jsonOpen.value ? widthOf(jsonEl.value) : 0) - MIN_MAIN;
const maxJson = () => widthOf(appEl.value) - widthOf(sideEl.value) - MIN_MAIN;
const paneStyle = computed(() => ({
    ...(sideWidth.value === undefined ? {} : { '--side-col': `min(${sideWidth.value}px, 50vw)` }),
    ...(jsonWidth.value === undefined || !jsonOpen.value ? {} : { '--json-col': `min(${jsonWidth.value}px, 70vw)` }),
}));

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
const currentNodes = computed(() => (state.mode === 'example' ? exampleNodes.value : embeddedView.value?.nodes ?? []));
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

function openField(source: string, name: string, context?: SourceInfo[]) {
    fieldContext.value = context ? markRaw(context) : undefined;
    state.field = `${source}|${name}`;
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
                byLabel.set(label, place);
            }
            places.push(...byLabel.values());
        }
    }
    const embedded = embeddedSources.value.find((s) => s.key === source) ?? (pool.find((s) => s.key === source) as EmbeddedSourceInfo | undefined);
    for (const template of embeddedResult.value?.nodes ?? []) {
        for (const p of template.placements) {
            if (p.source !== source || p.field !== name) continue;
            places.push({ label: [template.formatTitle, template.nodeType, ...(p.location ? [p.location.slice(1)] : [])].join(' › '), type: `node:${template.key}`, locations: [p.location], kind: p.kind });
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
    return { source, name, doc, places, counterparts, counterpartsTitle, sources: pool, vendored: source === 'core' ? true : isVendored(source) };
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
    state.schema = source;
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

const fullAppUrl = computed(() => {
    const url = new URL(location.href);
    url.searchParams.delete('embed');
    return url.toString();
});

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
    { label: 'Arctic TROPOMI CH4 Item', href: 'https://cardsmirror.blob.core.windows.net/arctic-tropomi-ch4-l3/stac/arctic-tropomi-ch4-l3-2021/arctic-tropomi-ch4-l3-2021.json' },
    { label: 'Arctic TROPOMI CH4 Zarr store', href: 'https://cardsmirror.blob.core.windows.net/arctic-tropomi-ch4-l3/arctic_tropomi_ch4_l3_2021.zarr' },
    { label: 'HIKET CO₂ flux netCDF', href: 'https://lake.fmi.fi/hiket-data/fmi/co2-flux-land-finland-jsbach-himmeli/CO2_FLUX_LAND_FINLAND_MOD_2015_HOUR_JSBACH-HIMMELI_FMI_V01.nc' },
    { label: 'Sentinel-2 L2A COG (Earth Search)', href: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/Q/WD/2020/7/S2A_36QWD_20200701_0_L2A/B04.tif' },
    { label: 'EOPF Sentinel-2 L1C (API)', href: 'https://stac.core.eopf.eodc.eu/collections/sentinel-2-l1c' },
    { label: 'Earth Search Sentinel-2 L2A (API)', href: 'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a' },
];

onMounted(() => {
    if (state.mode === 'href' && state.href) void openHref(state.href, true);
});
</script>

<template>
  <div ref="appEl" class="app" :class="{ 'no-json': !jsonOpen, embed: state.embed }" :style="paneStyle">
    <header v-if="!state.embed" class="top">
      <div class="brand">
        <h1>STAC Schema Explorer</h1>
        <p>Where can each field of STAC core and STAC extensions go? Derived by probing the JSON Schemas themselves.</p>
      </div>
      <nav class="modes" aria-label="View">
        <button type="button" :class="{ on: state.mode === 'example' }" @click="setMode('example')">Example catalog</button>
        <button type="button" :class="{ on: state.mode === 'href' }" @click="setMode('href')">Explore a STAC URL</button>
      </nav>
      <button type="button" class="json-toggle" @click="jsonOpen = !jsonOpen">{{ jsonOpen ? 'Hide JSON' : 'Show JSON' }}</button>
      <a class="gh" href="https://github.com/hamk-uas/stac-schema-explorer" target="_blank" rel="noopener">About / source</a>
    </header>

    <aside id="side-pane" ref="sideEl" class="side">
      <section>
        <h2>STAC version</h2>
        <select v-model="state.stacVersion" :disabled="state.mode === 'href'" aria-label="STAC version">
          <option v-for="v in STAC_VERSIONS" :key="v" :value="v">{{ v }}</option>
        </select>
        <p v-if="state.mode === 'href'" class="hint">Each document is compared with the core schemas of its own <code>stac_version</code>.</p>
      </section>
      <section>
        <h2>Extensions</h2>
        <ExtensionPicker v-model="state.extensions" :sources="sources" @focus="focusFromPicker" />
      </section>
      <section>
        <h2>Data conventions</h2>
        <p class="hint">Conventions of metadata embedded in data files (Zarr, netCDF, TIFF): the counterparts of STAC extensions.</p>
        <ConventionPicker v-model="state.conventions" :sources="embeddedSources" @focus="focusFromPicker" />
      </section>
      <section>
        <h2>Display</h2>
        <label><input v-model="state.showCore" type="checkbox" /> Show STAC core and data format fields</label>
        <label><input v-model="state.groupFields" type="checkbox" /> Group fields by extension</label>
        <label v-if="state.mode === 'href'"><input v-model="state.includeDeclared" type="checkbox" /> Include extensions the documents declare</label>
        <div v-if="state.focus" class="focus">
          Highlighting <span class="swatch" :style="{ background: colorOf(state.focus) }" /> {{ sourceLabel(state.focus, sources) }}
          <button type="button" class="link" @click="state.focus = ''">clear</button>
        </div>
      </section>
      <section>
        <h2>Legend</h2>
        <Legend />
      </section>
    </aside>

    <main class="main">
      <p v-if="state.embed" class="embed-bar">
        <strong>STAC Schema Explorer</strong>
        <button type="button" class="link" @click="jsonOpen = !jsonOpen">{{ jsonOpen ? 'hide JSON' : 'show JSON' }}</button>
        <a :href="fullAppUrl" target="_blank" rel="noopener">open full app ↗</a>
      </p>
      <div v-if="busy" class="progress" role="status">
        <div class="bar" :style="{ width: `${Math.round(100 * (progress?.done ?? 0) / (progress?.total || 1))}%` }" />
        <span>Probing schemas… {{ progress?.label }}</span>
      </div>
      <p v-if="engineError" class="error">{{ engineError }}</p>

      <template v-if="state.mode === 'example'">
        <div class="toolbar">
          <div class="tabs">
            <button type="button" :class="{ on: state.view === 'tree' }" @click="state.view = 'tree'">Catalog tree</button>
            <button type="button" :class="{ on: state.view === 'matrix' }" @click="state.view = 'matrix'">Placement matrix</button>
          </div>
          <p class="explain">
            The <em>extreme case</em>: every field of the selected schemas placed everywhere the schemas allow it, in an example that
            validates against STAC {{ state.stacVersion }} core and every selected extension.
          </p>
        </div>
        <div v-if="state.view === 'tree' && exampleRoot" class="tree">
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
          <section class="embedded-section" aria-labelledby="embedded-heading">
            <h3 id="embedded-heading">Embedded in the data</h3>
            <p class="explain">
              Metadata stored in the data files of assets, not in STAC: the nodes of each format the selected data conventions apply to,
              with every field placed where the format and convention schemas allow it.
              <template v-if="!state.showCore">Format fields (the counterparts of STAC core) are shown with “Show STAC core and data format fields”.</template>
            </p>
            <p v-if="embeddedError" class="error">{{ embeddedError }}</p>
            <p v-if="state.conventions.length === 0" class="explain">Select data conventions to see where their fields go.</p>
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
        <template v-else-if="state.view === 'matrix'">
          <MatrixView
            v-if="result"
            :groups="stacGroups"
            :sources="result.sources"
            :hidden="state.showCore ? [] : [CORE]"
            :focus="state.focus"
            intro="Where each field can be placed, per STAC object type and conceptual location."
            legend
            @select="selectFromMatrix"
            @field="(s: string, n: string) => openField(s, n)"
            @schema="(s: string) => openSchema(s)"
          />
          <section class="embedded-section" aria-labelledby="embedded-matrix-heading">
            <h3 id="embedded-matrix-heading">Embedded in the data</h3>
            <p class="explain">
              One matrix per data format: the conventions of different formats are distinct, as are their node types. A convention
              that applies to several formats (CF to netCDF and Zarr) appears in each.
              <template v-if="!state.showCore">Format fields (the counterparts of STAC core) are shown with “Show STAC core and data format fields”.</template>
            </p>
            <p v-if="state.conventions.length === 0" class="explain">Select data conventions to see where their fields go.</p>
            <MatrixView
              v-for="m in embeddedMatrices"
              :key="m.format.id"
              :groups="m.groups"
              :sources="m.sources"
              :hidden="state.showCore ? [] : [m.format.schema]"
              :focus="state.focus"
              :intro="`${m.format.title}: ${m.groups.map((g) => g.label).join(' and ')} nodes.`"
              top-label="node"
              class="format-matrix"
              @select="selectFromMatrix"
              @field="(s: string, n: string) => openField(s, n, m.sources)"
              @schema="(s: string) => openSchema(s, [], m.sources)"
            />
          </section>
        </template>
      </template>

      <template v-else>
        <form class="href-form" @submit.prevent="openHref(hrefInput)">
          <input v-model="hrefInput" type="url" placeholder="https://…/catalog.json, collection.json, item.json, or a Zarr store, netCDF or TIFF file" aria-label="STAC document or data file URL" />
          <button type="submit">Open</button>
        </form>
        <p class="examples">
          Try:
          <button v-for="ex in EXAMPLE_URLS" :key="ex.href" type="button" class="link" @click="openHref(ex.href)">{{ ex.label }}</button>
        </p>
        <p class="explain">
          Populated fields are highlighted within the fields the schemas would allow at the same place (dotted = allowed but
          absent; red = present but not placed there by any selected schema). Expand a document to load its children. The first
          Zarr asset found is read automatically; other data assets are read from their “embedded metadata” links.
          Use + and − on a field to add it with an example value or remove it: a local rewrite, kept in the share link.
        </p>
        <p v-if="state.rewrites.length" class="rewrites-banner" role="status">
          <strong>✎ Rewrites applied:</strong>
          {{ state.rewrites.length }} change{{ state.rewrites.length === 1 ? '' : 's' }} to {{ rewrittenDocs }}
          document{{ rewrittenDocs === 1 ? '' : 's' }} or node{{ rewrittenDocs === 1 ? '' : 's' }}. The tree, the JSON (copy and
          download) and validation show the rewritten versions; the originals are unchanged.
          <button type="button" @click="resetRewrites()">Undo all</button>
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
            @embedded="(href: string, label: string, kind: ReaderKind) => openEmbedded(href, label, kind)"
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
              @embedded="(href: string, label: string, kind: ReaderKind) => openEmbedded(href, label, kind)"
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
        :pointers="jsonPointers"
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
  border-bottom: 1px solid #e2e8f0;
  background: white;
}
.brand h1 {
  margin: 0;
  font: 700 18px var(--sans);
  color: #0f172a;
}
.brand p {
  margin: 2px 0 0;
  font-size: 12px;
  color: #64748b;
}
.modes {
  display: flex;
  gap: 4px;
  background: #f1f5f9;
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
  color: #475569;
  cursor: pointer;
}
.modes button.on,
.tabs button.on {
  background: white;
  color: #0f172a;
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.12);
}
.app.no-json {
  --json-col: 0;
}
.json-toggle {
  margin-left: auto;
  font-size: 12px;
  border: 1px solid #cbd5e1;
  background: white;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.gh {
  font-size: 12px;
  color: #4f46e5;
}
.side {
  grid-area: side;
  overflow: auto;
  padding: 12px 14px 40px;
  border-right: 1px solid #e2e8f0;
  background: white;
}
.side section {
  margin-bottom: 18px;
}
.side h2 {
  margin: 0 0 6px;
  font: 600 12px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #475569;
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
  color: #64748b;
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
  background: #f8fafc;
}
.json {
  grid-area: json;
  border-left: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  min-height: 0;
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
  color: #4f46e5;
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
  background: #e2e8f0;
  padding: 3px;
  border-radius: 8px;
}
.explain {
  font-size: 12px;
  color: #64748b;
  margin: 4px 0 8px;
  flex: 1;
  min-width: 260px;
}
.progress {
  position: relative;
  height: 22px;
  border-radius: 6px;
  background: #e0e7ff;
  overflow: hidden;
  margin-bottom: 8px;
}
.progress .bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: #a5b4fc;
  transition: width 0.2s;
}
.progress span {
  position: relative;
  font-size: 12px;
  padding-left: 8px;
  line-height: 22px;
  color: #3730a3;
}
.error {
  color: #b91c1c;
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
  border: 1px solid #cbd5e1;
  border-radius: 6px;
}
.href-form button {
  padding: 0 14px;
  border-radius: 6px;
  border: 1px solid #4f46e5;
  background: #4f46e5;
  color: white;
  cursor: pointer;
}
.examples {
  font-size: 12px;
  color: #64748b;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 6px 0;
}
.link {
  border: 0;
  background: none;
  color: #4f46e5;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.findings {
  margin-top: 14px;
  font-size: 12px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 12px;
}
.findings summary {
  cursor: pointer;
  font-weight: 600;
}
.findings li.conflict,
.findings li.error {
  color: #b91c1c;
}
.findings li.warn {
  color: #b45309;
}
.detached {
  font: 600 12px var(--sans);
  color: #64748b;
  margin: 18px 0 0;
}
.embedded-section {
  margin-top: 22px;
  padding-top: 10px;
  border-top: 1px dashed #cbd5e1;
}
.format-matrix {
  margin-top: 14px;
}
.embedded-section h3 {
  margin: 0 0 4px;
  font: 600 14px var(--sans);
  color: #334155;
}
.rewrites-banner {
  margin: 4px 0 10px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #78350f;
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-left-width: 4px;
  border-radius: 6px;
}
.rewrites-banner button {
  margin-left: 6px;
  font: 600 12px var(--sans);
  border: 1px solid #d97706;
  border-radius: 5px;
  background: white;
  color: #92400e;
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
