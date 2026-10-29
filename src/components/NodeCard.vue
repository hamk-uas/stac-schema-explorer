<script setup lang="ts">
import { computed } from 'vue';

import { embeddedSchemaLabel } from '../lib/conventions';
import type { NodeEntry } from '../lib/embedded-docs';
import type { SourceInfo } from '../lib/model';
import FieldChips from './FieldChips.vue';
import ObjectNode from './ObjectNode.vue';

/** A node of metadata embedded in data (a Zarr group or array, a netCDF group or variable, a TIFF file or image). */
const props = defineProps<{
    entry: NodeEntry;
    group: boolean;
    focus: string;
    selectedDoc: string;
    selectedPointers: string[];
}>();
const emit = defineEmits<{
    /** Select a node and objects in it; `names` are the fields to show in them (a clicked chip). */
    select: [key: string, pointers: string[], names?: string[]];
    field: [source: string, name: string, sources: SourceInfo[]];
    /** A grouped chip was clicked: the schema, its fields in the object, and the node's sources. */
    schema: [source: string, names: string[], sources: SourceInfo[]];
}>();

const isSelected = computed(() => props.selectedDoc === props.entry.key);

function pick(pointers: string[], source: string, name: string) {
    emit('select', props.entry.key, pointers, [name]);
    emit('field', source, name, props.entry.sources);
}

function pickGroup(pointers: string[], source: string, names: string[]) {
    emit('select', props.entry.key, pointers, names);
    emit('schema', source, names, props.entry.sources);
}
const pointers = computed(() => (isSelected.value ? props.selectedPointers : []));
const DOCUMENT: Record<string, string> = { 'zarr-v3': 'zarr.json', 'zarr-v2': '.zgroup/.zarray + .zattrs', netcdf: 'netCDF header', tiff: 'TIFF directory' };
const validityTitle = computed(() => {
    if (props.entry.valid === undefined) return 'Validating…';
    const checked = [props.entry.formatTitle, ...props.entry.conventions.map(embeddedSchemaLabel)].join(', ');
    return props.entry.valid ? `Valid against ${checked}` : `Validation errors:\n${(props.entry.errors ?? []).join('\n')}`;
});
const notApplicable = computed(() => (props.entry.notApplicable ?? []).map(embeddedSchemaLabel));
</script>

<template>
  <div class="node" :class="{ selected: isSelected }">
    <header>
      <button type="button" class="select" :aria-pressed="isSelected" @click="emit('select', entry.key, [''])">
        <span class="node-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14"><ellipse cx="8" cy="3.5" rx="5.5" ry="2" fill="none" stroke="currentColor" stroke-width="1.3" /><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
        </span>
        <span class="format">{{ entry.formatTitle }}</span>
        <span class="type">{{ entry.nodeType }}</span>
        <span class="tag" :title="`Metadata embedded in the data (${DOCUMENT[entry.format] ?? entry.format}), not a STAC document`">embedded in the data</span>
        <span class="title">{{ entry.title || 'root' }}</span>
      </button>
      <span class="validity" :class="{ ok: entry.valid, bad: entry.valid === false }" :title="validityTitle">
        {{ entry.valid === undefined ? '…' : entry.valid ? '✓ valid' : `✗ ${entry.errors?.length ?? 0} error(s)` }}
      </span>
      <a v-if="entry.href" class="open" :href="entry.href" target="_blank" rel="noopener" title="Open the metadata document in a new tab">↗</a>
    </header>
    <div class="body">
      <div v-if="entry.view.fields.length" class="root-fields" :class="{ selected: pointers.includes('') }" @click.stop="emit('select', entry.key, [''])">
        <span class="glyph">node</span>
        <FieldChips :fields="entry.view.fields" :sources="entry.sources" :group="group" :focus="focus" @field="(s: string, n: string) => pick([''], s, n)" @group="(s: string, names: string[]) => pickGroup([''], s, names)" />
      </div>
      <ObjectNode
        v-for="child in entry.view.children"
        :key="child.pointers[0]"
        :node="child"
        :sources="entry.sources"
        :group="group"
        :focus="focus"
        :selected="pointers"
        @select="(p: string[], names?: string[]) => emit('select', entry.key, p, names)"
        @field="(s: string, n: string) => emit('field', s, n, entry.sources)"
        @schema="(s: string, n: string[]) => emit('schema', s, n, entry.sources)"
      />
      <div v-if="notApplicable.length" class="na" title="These selected conventions define no field for this node type">
        not applicable: {{ notApplicable.join(', ') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.node {
  --accent: #475569;
  margin: 8px 0;
  border: 1px dashed #94a3b8;
  border-left: 4px solid var(--accent);
  border-radius: 10px;
  background: #f8fafc;
}
.node.selected {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid #e2e8f0;
}
.select {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.node-icon {
  color: var(--accent);
  display: inline-flex;
}
.format {
  font: 700 13px var(--sans);
  color: #0f172a;
}
.type {
  font: 600 11px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #475569;
}
.tag {
  font: 500 10px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #334155;
  background: #e2e8f0;
  border-radius: 4px;
  padding: 1px 5px;
}
.title {
  font: 500 13px var(--mono);
  color: #334155;
  overflow-wrap: anywhere;
}
.validity {
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
}
.validity.ok {
  color: #0f766e;
}
.validity.bad {
  color: #b91c1c;
}
.open {
  color: #64748b;
  text-decoration: none;
}
.body {
  padding: 6px 10px 8px;
}
.root-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.root-fields.selected {
  background: #e0e7ff;
  outline: 1px solid #a5b4fc;
}
.glyph {
  font: 600 11px var(--mono);
  color: #94a3b8;
}
.na {
  margin-top: 6px;
  font-size: 11px;
  color: #64748b;
}
</style>
