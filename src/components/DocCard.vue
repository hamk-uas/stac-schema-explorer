<script setup lang="ts">
import { computed } from 'vue';

import { sourceLabel } from '../lib/colors';
import { TYPE_LABEL, type DocEntry } from '../lib/docs';
import { READER_LABEL, type DataView } from '../lib/embedded-docs';
import type { SourceInfo } from '../lib/model';
import type { FieldView } from '../lib/tree';
import FieldChips from './FieldChips.vue';
import NodeCard from './NodeCard.vue';
import ObjectNode from './ObjectNode.vue';

defineOptions({ name: 'DocCard' });

const props = defineProps<{
    entry: DocEntry;
    sources: SourceInfo[];
    group: boolean;
    focus: string;
    selectedDoc: string;
    selectedPointers: string[];
}>();
const emit = defineEmits<{
    /** Select a document and objects in it; `names` are the fields to show in them (a clicked chip). */
    select: [key: string, pointers: string[], names?: string[]];
    toggle: [entry: DocEntry];
    more: [entry: DocEntry];
    field: [source: string, name: string, sources: SourceInfo[]];
    /** A grouped chip was clicked: the schema, its fields in the object, and the document's sources. */
    schema: [source: string, names: string[], sources: SourceInfo[]];
    /** Show or hide the embedded metadata of one of the document's data files, reading it when first shown. */
    data: [entry: DocEntry, file: DataView];
    /** Rewrite a field of a document in some of its objects. */
    edit: [key: string, pointers: string[], field: FieldView];
    /** Undo every rewrite of a document. */
    reset: [key: string];
}>();

const docSources = computed(() => props.entry.sources ?? props.sources);

function pick(pointers: string[], source: string, name: string) {
    emit('select', props.entry.key, pointers, [name]);
    emit('field', source, name, docSources.value);
}

function pickGroup(pointers: string[], source: string, names: string[]) {
    emit('select', props.entry.key, pointers, names);
    emit('schema', source, names, docSources.value);
}
const isSelected = computed(() => props.selectedDoc === props.entry.key);
/** Data files shown as sections: Zarr stores and files read or being read; the others are listed compactly until read. */
const shownFiles = computed(() => (props.entry.data ?? []).filter((f) => f.kind === 'zarr' || f.status !== 'idle' || f.expanded));
const unreadFiles = computed(() => {
    const byKind = new Map<string, DataView[]>();
    for (const file of props.entry.data ?? []) {
        if (shownFiles.value.includes(file)) continue;
        byKind.set(file.kind, [...(byKind.get(file.kind) ?? []), file]);
    }
    return [...byKind.entries()].map(([kind, files]) => ({ kind: kind as DataView['kind'], files }));
});
/** Real documents (not the example) can be rewritten. */
const editable = computed(() => !!props.entry.original && props.entry.status === 'ready');
const pointers = computed(() => (isSelected.value ? props.selectedPointers : []));
const notApplicable = computed(() => (props.entry.template?.notApplicable ?? []).map((k) => sourceLabel(k, docSources.value)));
const hasChildren = computed(() => props.entry.children.length > 0 || props.entry.remaining.length > 0 || !!props.entry.itemsHref);
const validityTitle = computed(() => {
    if (props.entry.valid === undefined) return 'Validating…';
    const declared = Array.isArray(props.entry.doc?.stac_extensions) ? props.entry.doc.stac_extensions.length : 0;
    return props.entry.valid
        ? `Valid against STAC core${declared ? ` and ${declared} declared extension schema(s)` : ''}`
        : `Validation errors:\n${(props.entry.errors ?? []).join('\n')}`;
});
const undeclaredTitle = computed(() => [
    'Fields of extensions that stac_extensions does not declare in any version. Validation checks declared extensions only, so these fields are not validated:',
    ...(props.entry.undeclared ?? []).map((u) => `• ${sourceLabel(u.source, docSources.value)}: ${u.fields.join(', ')}`),
    '',
    'Collection summaries and item_assets are not counted: they describe the fields of Items.',
].join('\n'));
</script>

<template>
  <div class="doc" :class="[`type-${entry.type}`, { selected: isSelected }]">
    <header @click="emit('select', entry.key, [''])">
      <button
        v-if="hasChildren"
        type="button"
        class="twisty"
        :aria-label="entry.expanded ? 'Collapse child documents' : 'Expand child documents'"
        :title="entry.expanded ? 'Hide child documents' : 'Show child documents'"
        @click.stop="emit('toggle', entry)"
      >{{ entry.expanded ? '▾' : '▸' }}</button>
      <span v-else class="twisty-space" />
      <span class="doc-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 1.5h6.5L13 5v9.5H3z" fill="none" stroke="currentColor" stroke-width="1.3" /><path d="M9.5 1.5V5H13" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
      </span>
      <span class="type">{{ TYPE_LABEL[entry.type] }}</span>
      <span v-if="entry.type === 'Feature'" class="sub">GeoJSON Feature</span>
      <span v-if="entry.role" class="role">{{ entry.role }}</span>
      <span class="title" :title="entry.href ?? entry.title">{{ entry.title }}</span>
      <span v-if="entry.status === 'loading'" class="status">loading…</span>
      <span v-else-if="entry.status === 'error'" class="status error" :title="entry.error">⚠ {{ entry.error }}</span>
      <span v-else-if="entry.view" class="validity" :class="{ ok: entry.valid, bad: entry.valid === false }" :title="validityTitle">
        {{ entry.valid === undefined ? '…' : entry.valid ? '✓ valid' : `✗ ${entry.errors?.length ?? 0} error(s)` }}
      </span>
      <span v-if="entry.rewrites" class="rewritten" :title="`${entry.rewrites} rewrite(s) applied to this document: it is shown and validated as rewritten`">
        ✎ {{ entry.rewrites }} rewrite{{ entry.rewrites === 1 ? '' : 's' }}
        <button type="button" :aria-label="`Undo the rewrites of ${entry.title}`" @click.stop="emit('reset', entry.key)">undo</button>
      </span>
      <span v-if="entry.undeclared?.length" class="undeclared" :title="undeclaredTitle">
        ⚠ undeclared: {{ entry.undeclared.map((u) => sourceLabel(u.source, docSources)).join(', ') }}
      </span>
      <a v-if="entry.href" class="open" :href="entry.href" target="_blank" rel="noopener" title="Open the JSON in a new tab" @click.stop>↗</a>
    </header>
    <div v-if="entry.view && !entry.compact" class="body">
      <div v-if="entry.view.fields.length" class="root-fields" :class="{ selected: pointers.includes('') }" @click.stop="emit('select', entry.key, [''])">
        <span class="glyph">top level</span>
        <FieldChips :fields="entry.view.fields" :sources="docSources" :group="group" :focus="focus" :editable="editable" @field="(s: string, n: string) => pick([''], s, n)" @group="(s: string, names: string[]) => pickGroup([''], s, names)" @edit="(f: FieldView) => emit('edit', entry.key, [''], f)" />
      </div>
      <ObjectNode
        v-for="child in entry.view.children"
        :key="child.pointers[0]"
        :node="child"
        :sources="docSources"
        :group="group"
        :focus="focus"
        :selected="pointers"
        :editable="editable"
        @select="(p: string[], names?: string[]) => emit('select', entry.key, p, names)"
        @field="(s: string, n: string) => emit('field', s, n, docSources)"
        @schema="(s: string, n: string[]) => emit('schema', s, n, docSources)"
        @edit="(p: string[], f: FieldView) => emit('edit', entry.key, p, f)"
      />
      <div v-if="notApplicable.length && !entry.href" class="na" title="These selected extensions define no field for this object type">
        not applicable: {{ notApplicable.join(', ') }}
      </div>
    </div>
    <section
      v-for="file in shownFiles"
      :key="file.href"
      class="data"
      :aria-label="`Metadata embedded in the ${READER_LABEL[file.kind]} of asset ${file.assets.join(', ')}`"
    >
      <div class="data-head">
        <button type="button" class="data-toggle" :aria-expanded="file.expanded" @click="emit('data', entry, file)">
          <span class="data-twisty" aria-hidden="true">{{ file.expanded ? '▾' : '▸' }}</span>
          <span class="data-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="14" height="14"><ellipse cx="8" cy="3.5" rx="5.5" ry="2" fill="none" stroke="currentColor" stroke-width="1.3" /><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
          </span>
          <span class="data-kind">{{ READER_LABEL[file.kind] }}</span>
          <span class="data-tag">embedded in the data, not STAC</span>
          <span class="data-assets">asset <code v-for="key in file.assets" :key="key">{{ key }}</code></span>
        </button>
        <span v-if="file.status === 'loading'" class="status">reading…</span>
        <span v-else-if="file.status === 'error'" class="status error" :title="file.error">⚠ {{ file.error }}</span>
        <span v-else-if="file.status === 'ready'" class="status">{{ file.nodes.length }} node{{ file.nodes.length === 1 ? '' : 's' }}</span>
        <a class="open" :href="file.href" target="_blank" rel="noopener" :title="`Open the ${READER_LABEL[file.kind]}\n${file.href}`">↗</a>
      </div>
      <div v-if="file.expanded" class="data-nodes">
        <p v-for="note in file.notes" :key="note" class="note">ⓘ {{ note }}</p>
        <NodeCard
          v-for="node in file.nodes"
          :key="node.key"
          :entry="node"
          :group="group"
          :focus="focus"
          :selected-doc="selectedDoc"
          :selected-pointers="selectedPointers"
          editable
          @select="(k: string, p: string[], names?: string[]) => emit('select', k, p, names)"
          @field="(s: string, n: string, src: SourceInfo[]) => emit('field', s, n, src)"
          @schema="(s: string, n: string[], src: SourceInfo[]) => emit('schema', s, n, src)"
          @edit="(k: string, p: string[], f: FieldView) => emit('edit', k, p, f)"
          @reset="(k: string) => emit('reset', k)"
        />
      </div>
    </section>
    <section v-for="group in unreadFiles" :key="group.kind" class="data unread" :aria-label="`${READER_LABEL[group.kind]}s of assets, not read`">
      <div class="data-head">
        <span class="data-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14"><ellipse cx="8" cy="3.5" rx="5.5" ry="2" fill="none" stroke="currentColor" stroke-width="1.3" /><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
        </span>
        <span class="data-kind">{{ READER_LABEL[group.kind] }}{{ group.files.length === 1 ? '' : 's' }}</span>
        <span class="data-tag">embedded in the data, not STAC</span>
        <span class="hint">not read (reading may download the file header): asset</span>
        <button
          v-for="file in group.files"
          :key="file.href"
          type="button"
          class="data-file"
          :title="`Read the embedded metadata of this ${READER_LABEL[file.kind]}\n${file.href}`"
          @click="emit('data', entry, file)"
        ><code>{{ file.assets.join(', ') }}</code> ›</button>
      </div>
    </section>
    <div v-if="entry.expanded && hasChildren" class="child-docs">
      <DocCard
        v-for="child in entry.children"
        :key="child.key"
        :entry="child"
        :sources="sources"
        :group="group"
        :focus="focus"
        :selected-doc="selectedDoc"
        :selected-pointers="selectedPointers"
        @select="(k: string, p: string[], names?: string[]) => emit('select', k, p, names)"
        @toggle="(e: DocEntry) => emit('toggle', e)"
        @more="(e: DocEntry) => emit('more', e)"
        @field="(s: string, n: string, src: SourceInfo[]) => emit('field', s, n, src)"
        @schema="(s: string, n: string[], src: SourceInfo[]) => emit('schema', s, n, src)"
        @edit="(k: string, p: string[], f: FieldView) => emit('edit', k, p, f)"
        @reset="(k: string) => emit('reset', k)"
        @data="(e: DocEntry, f: DataView) => emit('data', e, f)"
      />
      <button v-if="entry.remaining.length || entry.itemsHref" type="button" class="more" @click="emit('more', entry)">
        {{ entry.remaining.length ? `Show more (${entry.remaining.length} not loaded)` : 'Load items' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.doc {
  --accent: #6366f1;
  margin: 8px 0;
  border: 1px solid #e2e8f0;
  border-left: 4px solid var(--accent);
  border-radius: 10px;
  background: white;
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.06);
}
.doc.type-Collection {
  --accent: #0d9488;
}
.doc.type-Feature {
  --accent: #d97706;
}
.doc.selected {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  background: color-mix(in srgb, var(--accent) 7%, white);
  border-radius: 6px 10px 0 0;
  flex-wrap: wrap;
}
.twisty,
.twisty-space {
  width: 18px;
  border: 0;
  background: none;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}
.doc-icon {
  color: var(--accent);
  display: inline-flex;
}
.type {
  font: 700 14px var(--sans);
  color: color-mix(in srgb, var(--accent) 75%, black);
}
.sub,
.role {
  font: 500 11px var(--sans);
  color: #64748b;
}
.role {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 0 5px;
}
.title {
  font: 13px var(--sans);
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 340px;
}
.status {
  font-size: 12px;
  color: #64748b;
}
.status.error {
  color: #b91c1c;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.validity {
  margin-left: auto;
  font: 600 11px var(--sans);
  color: #64748b;
}
.validity.ok {
  color: #15803d;
}
.validity.bad {
  color: #b91c1c;
}
.undeclared {
  font: 600 11px var(--sans);
  color: #92400e;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 4px;
  padding: 0 6px;
  white-space: nowrap;
}
.open {
  font-size: 13px;
  text-decoration: none;
  color: #475569;
}
.body {
  padding: 6px 10px 8px 12px;
}
.root-fields {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 6px;
  cursor: pointer;
  flex-wrap: wrap;
}
.root-fields:hover {
  background: #f1f5f9;
}
.root-fields.selected {
  background: #e0e7ff;
}
.glyph {
  font: 600 10px var(--sans);
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
/* Data files of assets: slate and dashed like the node cards they hold, never like the STAC objects above them. */
.data {
  margin: 0 10px 8px 12px;
  border: 1px dashed #94a3b8;
  border-left: 4px solid #475569;
  border-radius: 8px;
  background: #f1f5f9;
}
.data-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  flex-wrap: wrap;
}
.data-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  color: #334155;
  font: 500 12px var(--sans);
  flex-wrap: wrap;
  text-align: left;
}
.data-twisty {
  width: 14px;
  color: #475569;
}
.data-icon {
  display: inline-flex;
  color: #475569;
}
.data-kind {
  font: 700 12px var(--sans);
  color: #1e293b;
}
.data-tag {
  font: 600 10px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #475569;
  background: #e2e8f0;
  border-radius: 4px;
  padding: 1px 5px;
}
.data-assets code {
  margin-left: 4px;
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  padding: 0 3px;
}
.data-head .status {
  margin-left: auto;
}
.data-nodes {
  padding: 0 8px 4px;
}
.data-nodes .note {
  margin: 2px 0;
  font-size: 11px;
  color: #64748b;
}
.data .hint {
  font-size: 11px;
  color: #64748b;
}
.data-file {
  border: 1px dashed #94a3b8;
  border-radius: 6px;
  background: white;
  color: #334155;
  font: 500 11px var(--sans);
  padding: 0 6px;
  cursor: pointer;
}
.data-file:hover {
  border-color: #475569;
}
.na {
  margin-top: 4px;
  font-size: 11px;
  color: #94a3b8;
}
.child-docs {
  margin: 0 8px 8px 22px;
}
.more {
  margin: 4px 0;
  font-size: 12px;
  border: 1px dashed #cbd5e1;
  background: white;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  color: #475569;
}
</style>
