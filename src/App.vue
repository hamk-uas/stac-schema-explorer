<script setup lang="ts">
import { computed, markRaw, onMounted, reactive, ref, shallowRef, watch } from 'vue';

import DocCard from './components/DocCard.vue';
import ExtensionPicker from './components/ExtensionPicker.vue';
import JsonView from './components/JsonView.vue';
import Legend from './components/Legend.vue';
import MatrixView from './components/MatrixView.vue';
import { colorOf, sourceLabel } from './lib/colors';
import { TYPE_LABEL, type DocEntry } from './lib/docs';
import { Engine } from './lib/engine';
import { normalizeSchemaUrl } from './lib/extensions';
import { STAC_TYPES, STAC_VERSIONS, type ProbeProgress, type ProbeResult, type StacType } from './lib/model';
import { fetchDoc, fetchItems, stacVersionFor, type RealDoc } from './lib/stac';
import { documentView, fieldIndex, templateView } from './lib/tree';
import { readState, writeState, type AppState } from './lib/url-state';

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
    entry.remaining = [...real.childLinks];
    entry.itemsHref = real.itemsHref;
    entry.status = 'ready';
}

function declaredOf(entry: DocEntry): string[] {
    const declared = entry.doc?.stac_extensions;
    return Array.isArray(declared) ? declared.filter((u): u is string => typeof u === 'string') : [];
}

async function analyze(entry: DocEntry) {
    if (!entry.doc) return;
    const version = stacVersionFor(entry.doc.stac_version);
    const urls = [...new Set([...state.extensions, ...(state.includeDeclared ? declaredOf(entry) : [])].map(normalizeSchemaUrl))];
    entry.stacVersion = version;
    entry.templateUrls = urls;
    const probed = await engine.probe(version, urls);
    entry.template = markRaw(probed.templates[entry.type]);
    entry.sources = markRaw(probed.sources);
    entry.view = markRaw(documentView(entry.doc, entry.template, probed.sources, state.showCore));
    if (entry.valid === undefined) {
        const errors = await engine.validate(entry.doc, version, declaredOf(entry).map(normalizeSchemaUrl));
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
    hrefRoot.value = newEntry(trimmed);
    const root = hrefRoot.value;
    await load(root);
    if (root.status === 'ready') {
        root.expanded = true;
        await loadMore(root);
    }
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
        if (e.doc && e.template && e.sources) e.view = markRaw(documentView(e.doc, e.template, e.sources, state.showCore));
    };
    walk(hrefRoot.value, refresh);
    if (detached.value) refresh(detached.value);
});

// ---- Selection and JSON panel ----------------------------------------------------------------------------------

const selectedPointers = ref<string[]>([state.pointer || '']);
const jsonOpen = ref(true);

function select(key: string, pointers: string[]) {
    state.selected = key;
    selectedPointers.value = pointers;
    state.pointer = pointers.find((p) => p !== '') ?? '';
    jsonOpen.value = true;
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
const selectedEntry = computed(() => find(currentRoot.value, state.selected) ?? (state.mode === 'href' && detached.value?.key === state.selected ? detached.value : undefined));
const jsonIndex = computed(() => (selectedEntry.value?.view ? fieldIndex(selectedEntry.value.view) : new Map()));
const jsonTitle = computed(() => (selectedEntry.value ? `${TYPE_LABEL[selectedEntry.value.type]} — ${selectedEntry.value.title}` : ''));

// A shared link may select a document deeper than what is loaded: load it on its own.
watch(() => [state.mode, state.selected, hrefRoot.value?.status], () => {
    if (state.mode !== 'href' || !state.selected || !/^https?:/.test(state.selected)) return;
    if (find(hrefRoot.value, state.selected) || hrefRoot.value?.status === 'loading' || detached.value?.key === state.selected) return;
    detached.value = newEntry(state.selected, 'selected');
    void load(detached.value);
});

function selectFromMatrix(type: string, pointers: string[]) {
    select(EXAMPLE_KEYS[type as StacType], pointers);
}

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
    { label: 'EOPF Sentinel-2 L1C (API)', href: 'https://stac.core.eopf.eodc.eu/collections/sentinel-2-l1c' },
    { label: 'Earth Search Sentinel-2 L2A (API)', href: 'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a' },
];

onMounted(() => {
    if (state.mode === 'href' && state.href) void openHref(state.href, true);
});
</script>

<template>
  <div class="app" :class="{ 'no-json': !jsonOpen }">
    <header class="top">
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

    <aside class="side">
      <section>
        <h2>STAC version</h2>
        <select v-model="state.stacVersion" :disabled="state.mode === 'href'" aria-label="STAC version">
          <option v-for="v in STAC_VERSIONS" :key="v" :value="v">{{ v }}</option>
        </select>
        <p v-if="state.mode === 'href'" class="hint">Each document is compared with the core schemas of its own <code>stac_version</code>.</p>
      </section>
      <section>
        <h2>Extensions</h2>
        <ExtensionPicker v-model="state.extensions" :sources="sources" @focus="toggleFocus" />
      </section>
      <section>
        <h2>Display</h2>
        <label><input v-model="state.showCore" type="checkbox" /> Show STAC core fields</label>
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
          />
          <details v-if="findings.length" class="findings" open>
            <summary>Findings ({{ findings.length }})</summary>
            <ul>
              <li v-for="(f, i) in findings" :key="i" :class="f.type">{{ f.text }}</li>
            </ul>
          </details>
        </div>
        <MatrixView v-else-if="state.view === 'matrix' && result" :result="result" :show-core="state.showCore" :focus="state.focus" @select="selectFromMatrix" />
      </template>

      <template v-else>
        <form class="href-form" @submit.prevent="openHref(hrefInput)">
          <input v-model="hrefInput" type="url" placeholder="https://…/catalog.json, collection.json or item.json" aria-label="STAC URL" />
          <button type="submit">Open</button>
        </form>
        <p class="examples">
          Try:
          <button v-for="ex in EXAMPLE_URLS" :key="ex.href" type="button" class="link" @click="openHref(ex.href)">{{ ex.label }}</button>
        </p>
        <p class="explain">
          Populated fields are highlighted within the fields the schemas would allow at the same place (dotted = allowed but
          absent; red = present but not placed there by any selected schema). Expand a document to load its children.
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
            />
          </template>
        </div>
      </template>
    </main>

    <JsonView
      v-if="jsonOpen"
      class="json"
      :doc="selectedEntry?.doc"
      :title="jsonTitle"
      :href="selectedEntry?.href"
      :index="jsonIndex"
      :pointers="selectedPointers"
    />
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) minmax(320px, 38%);
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
  grid-template-columns: 300px minmax(0, 1fr) 0;
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
}
</style>
