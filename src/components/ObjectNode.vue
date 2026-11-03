<script setup lang="ts">
import type { SourceInfo } from '../lib/model';
import type { FieldView, ObjectView } from '../lib/tree';
import FieldChips from './FieldChips.vue';

defineOptions({ name: 'ObjectNode' });

const props = defineProps<{
    node: ObjectView;
    sources: SourceInfo[];
    group: boolean;
    focus: string;
    selected: string[];
    editable?: boolean;
}>();
const emit = defineEmits<{
    /** Select objects; `names` are the fields to show in them (a clicked chip). */
    select: [pointers: string[], names?: string[]];
    field: [source: string, name: string];
    /** A grouped chip was clicked: the schema and its fields in this object. */
    schema: [source: string, names: string[]];
    /** Rewrite a field in the objects of this node (merged siblings change together). */
    edit: [pointers: string[], field: FieldView];
}>();

function pickField(source: string, name: string) {
    emit('select', props.node.pointers, [name]);
    emit('field', source, name);
}

function pickGroup(source: string, names: string[]) {
    emit('select', props.node.pointers, names);
    emit('schema', source, names);
}

const ARRAY_KINDS = new Set(['link', 'provider', 'band', 'column']);

function isSelected(): boolean {
    return props.node.pointers.some((p) => props.selected.includes(p));
}
</script>

<template>
  <div class="obj" :class="[`kind-${node.kind}`]">
    <div class="row" :class="{ selected: isSelected() }" @click.stop="emit('select', node.pointers)">
      <span class="glyph" :title="ARRAY_KINDS.has(node.kind) ? 'object in an array' : 'object'">{{ ARRAY_KINDS.has(node.kind) ? '[{}]' : '{}' }}</span>
      <span class="label">{{ node.label }}</span>
      <span v-if="node.kind === 'properties'" class="tag geojson" title="Item properties are the properties of a GeoJSON Feature">GeoJSON Feature properties</span>
      <span v-if="node.kind === 'summaries'" class="tag" title="Collection summaries: values are sets, ranges or JSON Schemas of fields used in the Items">summaries of Item fields</span>
      <FieldChips :fields="node.fields" :sources="sources" :group="group" :focus="focus" :editable="editable" @field="pickField" @group="pickGroup" @edit="(f: FieldView) => emit('edit', node.pointers, f)" />
    </div>
    <div v-if="node.children.length" class="children">
      <ObjectNode
        v-for="child in node.children"
        :key="child.pointers[0]"
        :node="child"
        :sources="sources"
        :group="group"
        :focus="focus"
        :selected="selected"
        :editable="editable"
        @select="(p: string[], names?: string[]) => emit('select', p, names)"
        @field="(s: string, n: string) => emit('field', s, n)"
        @schema="(s: string, n: string[]) => emit('schema', s, n)"
        @edit="(p: string[], f: FieldView) => emit('edit', p, f)"
      />
    </div>
  </div>
</template>

<style scoped>
.obj {
  position: relative;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.row:hover {
  background: var(--hover);
}
.row.selected {
  background: var(--indigo-100);
}
.glyph {
  font: 600 11px var(--mono);
  color: var(--slate-400);
  min-width: 26px;
  text-align: center;
}
.label {
  font: 500 13px var(--mono);
  color: var(--slate-700);
}
.children {
  margin-left: 24px;
}
.kind-properties {
  margin: 4px 0;
  border-radius: 8px;
  background: color-mix(in srgb, var(--green-100) 60%, transparent);
}
.kind-summaries > .row .label {
  font-style: italic;
}
.tag {
  font: 500 10px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--slate-500);
  background: var(--field);
  border-radius: 4px;
  padding: 1px 5px;
}
.tag.geojson {
  color: var(--green-700);
  background: var(--green-100);
}
</style>
