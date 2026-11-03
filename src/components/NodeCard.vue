<script setup lang="ts">
import { computed } from 'vue';

import { embeddedSchemaLabel } from '../lib/conventions';
import type { NodeEntry } from '../lib/embedded-docs';
import type { SourceInfo } from '../lib/model';
import type { FieldView } from '../lib/tree';
import FieldChips from './FieldChips.vue';
import ObjectNode from './ObjectNode.vue';

/** A node of metadata embedded in data (a Zarr group or array, a netCDF group or variable, a TIFF file or image). */
const props = defineProps<{
    entry: NodeEntry;
    group: boolean;
    focus: string;
    selectedDoc: string;
    selectedPointers: string[];
    /** A node read from data, which can be rewritten (not a node template of the example). */
    editable?: boolean;
    /** Shown within a section that already says it is embedded in the data, so the card need not repeat it. */
    inDataSection?: boolean;
}>();
const emit = defineEmits<{
    /** Select a node and objects in it; `names` are the fields to show in them (a clicked chip). */
    select: [key: string, pointers: string[], names?: string[]];
    field: [source: string, name: string, sources: SourceInfo[]];
    /** A grouped chip was clicked: the schema, its fields in the object, and the node's sources. */
    schema: [source: string, names: string[], sources: SourceInfo[]];
    /** Rewrite a field of the node in some of its objects. */
    edit: [key: string, pointers: string[], field: FieldView];
    /** Undo every rewrite of the node. */
    reset: [key: string];
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
        <span v-if="!inDataSection" class="tag" :title="`Metadata embedded in the data (${DOCUMENT[entry.format] ?? entry.format}), not a STAC document`">embedded in the data</span>
        <span class="title" :title="entry.title || 'root'">{{ entry.title || 'root' }}</span>
      </button>
      <span class="validity" :class="{ ok: entry.valid, bad: entry.valid === false }" :title="validityTitle">
        {{ entry.valid === undefined ? '…' : entry.valid ? '✓ valid' : `✗ ${entry.errors?.length ?? 0} error(s)` }}
      </span>
      <span v-if="entry.rewrites" class="rewritten" :title="`${entry.rewrites} rewrite(s) applied to this node: it is shown and validated as rewritten`">
        ✎ {{ entry.rewrites }} rewrite{{ entry.rewrites === 1 ? '' : 's' }}
        <button type="button" :aria-label="`Undo the rewrites of node ${entry.title || 'root'}`" @click="emit('reset', entry.key)">undo</button>
      </span>
      <a v-if="entry.href" class="open" :href="entry.href" target="_blank" rel="noopener" title="Open the metadata document in a new tab">↗</a>
    </header>
    <div class="body">
      <div v-if="entry.view.fields.length" class="root-fields" :class="{ selected: pointers.includes('') }" @click.stop="emit('select', entry.key, [''])">
        <span class="glyph">node</span>
        <FieldChips :fields="entry.view.fields" :sources="entry.sources" :group="group" :focus="focus" :editable="editable" @field="(s: string, n: string) => pick([''], s, n)" @group="(s: string, names: string[]) => pickGroup([''], s, names)" @edit="(f: FieldView) => emit('edit', entry.key, [''], f)" />
      </div>
      <ObjectNode
        v-for="child in entry.view.children"
        :key="child.pointers[0]"
        :node="child"
        :sources="entry.sources"
        :group="group"
        :focus="focus"
        :selected="pointers"
        :editable="editable"
        @select="(p: string[], names?: string[]) => emit('select', entry.key, p, names)"
        @field="(s: string, n: string) => emit('field', s, n, entry.sources)"
        @schema="(s: string, n: string[]) => emit('schema', s, n, entry.sources)"
        @edit="(p: string[], f: FieldView) => emit('edit', entry.key, p, f)"
      />
      <div v-if="notApplicable.length" class="na" title="These selected conventions define no field for this node type">
        not applicable: {{ notApplicable.join(', ') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.node {
  --accent: var(--slate-600);
  margin: 8px 0;
  border-radius: 8px;
  background: var(--layer);
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
}
.node.selected > header {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
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
  color: var(--slate-900);
}
.type {
  font: 600 11px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--slate-600);
}
.tag {
  font: 500 10px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--slate-700);
  background: var(--field);
  border-radius: 4px;
  padding: 1px 5px;
}
/* The path takes the space left and shortens (in full in its tooltip) before the heading wraps. */
.title {
  flex: 1 1 4em;
  min-width: 0;
  font: 500 13px var(--mono);
  color: var(--slate-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.validity {
  font-size: 12px;
  color: var(--slate-500);
  white-space: nowrap;
}
.validity.ok {
  color: var(--teal-700);
}
.validity.bad {
  color: var(--red-700);
}
.open {
  color: var(--slate-500);
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
  background: var(--indigo-100);
}
.glyph {
  font: 600 11px var(--mono);
  color: var(--slate-400);
}
.na {
  margin-top: 6px;
  font-size: 11px;
  color: var(--slate-500);
}
</style>
