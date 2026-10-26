<script setup lang="ts">
import type { SourceInfo } from '../lib/model';
import type { ObjectView } from '../lib/tree';
import FieldChips from './FieldChips.vue';

defineOptions({ name: 'ObjectNode' });

const props = defineProps<{
    node: ObjectView;
    sources: SourceInfo[];
    group: boolean;
    focus: string;
    selected: string[];
}>();
const emit = defineEmits<{
    /** Select objects; `names` are the fields to show in them (a clicked chip). */
    select: [pointers: string[], names?: string[]];
    field: [source: string, name: string];
}>();

function pickField(source: string, name: string) {
    emit('select', props.node.pointers, [name]);
    emit('field', source, name);
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
      <FieldChips :fields="node.fields" :sources="sources" :group="group" :focus="focus" @field="pickField" @group="(_: string, names: string[]) => emit('select', node.pointers, names)" />
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
        @select="(p: string[], names?: string[]) => emit('select', p, names)"
        @field="(s: string, n: string) => emit('field', s, n)"
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
  background: #f1f5f9;
}
.row.selected {
  background: #e0e7ff;
  outline: 1px solid #a5b4fc;
}
.glyph {
  font: 600 11px var(--mono);
  color: #94a3b8;
  min-width: 26px;
  text-align: center;
}
.label {
  font: 500 13px var(--mono);
  color: #334155;
}
.children {
  margin-left: 14px;
  padding-left: 10px;
  border-left: 1px solid #e2e8f0;
}
.kind-properties {
  margin: 4px 0;
  border-radius: 8px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
}
.kind-properties > .children {
  border-left-color: #bbf7d0;
}
.kind-summaries > .row .label {
  font-style: italic;
}
.tag {
  font: 500 10px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  background: #f1f5f9;
  border-radius: 4px;
  padding: 1px 5px;
}
.tag.geojson {
  color: #15803d;
  background: #dcfce7;
}
</style>
