<script setup lang="ts">
import { computed } from 'vue';

import { sourceLabel } from '../lib/colors';
import { TYPE_LABEL, type DocEntry } from '../lib/docs';
import { zarrAssets } from '../lib/embedded-docs';
import type { SourceInfo } from '../lib/model';
import FieldChips from './FieldChips.vue';
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
    select: [key: string, pointers: string[]];
    toggle: [entry: DocEntry];
    more: [entry: DocEntry];
    field: [source: string, name: string, sources: SourceInfo[]];
    /** Explore the embedded metadata of a data asset (a Zarr store). */
    embedded: [href: string, label: string];
}>();

const zarr = computed(() => (props.entry.href ? zarrAssets(props.entry.doc, props.entry.href) : []));

const docSources = computed(() => props.entry.sources ?? props.sources);
const isSelected = computed(() => props.selectedDoc === props.entry.key);
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
      <a v-if="entry.href" class="open" :href="entry.href" target="_blank" rel="noopener" title="Open the JSON in a new tab" @click.stop>↗</a>
    </header>
    <div v-if="entry.view && !entry.compact" class="body">
      <div v-if="entry.view.fields.length" class="root-fields" :class="{ selected: pointers.includes('') }" @click.stop="emit('select', entry.key, [''])">
        <span class="glyph">top level</span>
        <FieldChips :fields="entry.view.fields" :sources="docSources" :group="group" :focus="focus" @field="(s: string, n: string) => emit('field', s, n, docSources)" />
      </div>
      <ObjectNode
        v-for="child in entry.view.children"
        :key="child.pointers[0]"
        :node="child"
        :sources="docSources"
        :group="group"
        :focus="focus"
        :selected="pointers"
        @select="(p: string[]) => emit('select', entry.key, p)"
        @field="(s: string, n: string) => emit('field', s, n, docSources)"
      />
      <div v-if="notApplicable.length && !entry.href" class="na" title="These selected extensions define no field for this object type">
        not applicable: {{ notApplicable.join(', ') }}
      </div>
      <div v-if="zarr.length" class="embedded-links">
        <span class="glyph">data</span>
        <button v-for="asset in zarr" :key="asset.key" type="button" class="embedded-link" :title="`Read the embedded metadata of this Zarr store\n${asset.href}`"
          @click.stop="emit('embedded', asset.href, `asset ${asset.key} of ${entry.title}`)">
          embedded metadata of asset <code>{{ asset.key }}</code> ›
        </button>
      </div>
    </div>
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
        @select="(k: string, p: string[]) => emit('select', k, p)"
        @toggle="(e: DocEntry) => emit('toggle', e)"
        @more="(e: DocEntry) => emit('more', e)"
        @field="(s: string, n: string, src: SourceInfo[]) => emit('field', s, n, src)"
        @embedded="(h: string, l: string) => emit('embedded', h, l)"
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
.embedded-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 3px 6px;
}
.embedded-link {
  border: 1px dashed #94a3b8;
  border-radius: 6px;
  background: #f8fafc;
  color: #334155;
  font: 500 12px var(--sans);
  padding: 1px 8px;
  cursor: pointer;
}
.embedded-link:hover {
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
