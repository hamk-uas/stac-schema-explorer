<script setup lang="ts">
import { computed } from 'vue';

import { colorOf, sourceLabel } from '../lib/colors';
import { buildMatrix, type MatrixCell, type MatrixGroup } from '../lib/matrix';
import type { SourceInfo } from '../lib/model';

const props = defineProps<{
    groups: MatrixGroup[];
    sources: SourceInfo[];
    /** Sources whose fields are left out (core and format fields unless shown). */
    hidden: string[];
    focus: string;
    /** Label of the top-level column: `top level` of a STAC object, `node` of embedded metadata. */
    topLabel?: string;
    intro?: string;
    /** Explain the marks. */
    legend?: boolean;
}>();
const emit = defineEmits<{ select: [type: string, pointers: string[], field: string]; field: [source: string, name: string] }>();

const matrix = computed(() => buildMatrix(props.groups, props.sources, new Set(props.hidden)));
const typeSpans = computed(() => props.groups
    .map((g) => ({ type: g.type, label: g.label, tone: g.tone, count: matrix.value.columns.filter((c) => c.type === g.type).length }))
    .filter((t) => t.count > 0));
const rows = computed(() => {
    const out: { header?: string; source: string; field?: string }[] = [];
    let last = '';
    for (const row of matrix.value.rows) {
        if (row.source !== last) out.push({ header: sourceLabel(row.source, props.sources), source: row.source });
        out.push(row);
        last = row.source;
    }
    return out;
});

function cell(source: string, field: string, column: string): MatrixCell | undefined {
    return matrix.value.cells.get(`${source}|${field}|${column}`);
}

function cellTitle(field: string, c: MatrixCell): string {
    const how = c.kind === 'validated' ? 'validated by the schema' : 'presence satisfies the extension requirement (value not validated)';
    return `${field}: ${how}${c.partial ? `\nonly in some of these objects:\n${c.locations.join('\n')}` : `\n${c.locations.join('\n')}`}`;
}

function fieldTitle(source: string, field: string): string {
    const doc = props.sources.find((s) => s.key === source)?.docs[field];
    return [doc?.title, doc?.type, 'Click for details.'].filter(Boolean).join('\n');
}
</script>

<template>
  <div class="matrix-wrap">
    <p v-if="intro || legend" class="intro">
      {{ intro }}
      <template v-if="legend">
        <span class="mark validated" /> validated by the schema, <span class="mark presence" /> presence only (counts towards the
        extension's “at least one field” requirement), <span class="mark validated partial" /> only in some objects of that kind
        (hover for details). Click a cell to see it in the example JSON.
      </template>
    </p>
    <p v-if="!matrix.rows.length" class="empty">No fields to place.</p>
    <div v-else class="scroll">
      <table>
        <thead>
          <tr>
            <th class="corner" rowspan="2">Field</th>
            <th v-for="t in typeSpans" :key="t.type" :colspan="t.count" class="type" :class="`type-${t.tone}`">{{ t.label }}</th>
          </tr>
          <tr>
            <th v-for="col in matrix.columns" :key="col.key" class="col" :class="`type-${col.tone}`">
              <span>{{ col.path.length ? col.path.join(' › ') : (topLabel ?? 'top level') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(row, i) in rows" :key="i">
            <tr v-if="row.header" class="source-row">
              <th :colspan="matrix.columns.length + 1" :style="{ '--c': colorOf(row.source) }">{{ row.header }}</th>
            </tr>
            <tr v-else :class="{ dimmed: focus && focus !== row.source }">
              <th class="field" :style="{ '--c': colorOf(row.source) }">
                <button type="button" :title="fieldTitle(row.source, row.field!)" @click="emit('field', row.source, row.field!)">{{ row.field }}</button>
              </th>
              <td v-for="col in matrix.columns" :key="col.key" :class="`type-${col.tone}`">
                <button
                  v-if="cell(row.source, row.field!, col.key)"
                  type="button"
                  class="mark"
                  :class="[cell(row.source, row.field!, col.key)!.kind, { partial: cell(row.source, row.field!, col.key)!.partial }]"
                  :style="{ '--c': colorOf(row.source) }"
                  :title="cellTitle(row.field!, cell(row.source, row.field!, col.key)!)"
                  @click="emit('select', col.type, cell(row.source, row.field!, col.key)!.locations, row.field!)"
                />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.intro {
  font-size: 12px;
  color: #475569;
  margin: 0 0 10px;
  line-height: 1.7;
}
.scroll {
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: white;
  max-height: calc(100vh - 230px);
}
table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}
thead th {
  position: sticky;
  background: white;
  z-index: 1;
}
thead tr:first-child th {
  top: 0;
}
thead tr:nth-child(2) th {
  top: 25px;
}
.corner {
  left: 0;
  z-index: 2;
  text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid #e2e8f0;
}
th.type {
  font: 700 12px var(--sans);
  padding: 4px;
  border-bottom: 1px solid #e2e8f0;
  border-left: 2px solid #e2e8f0;
}
th.type-Catalog {
  color: #4f46e5;
}
th.type-Collection {
  color: #0f766e;
}
th.type-Feature {
  color: #b45309;
}
th.type-node {
  color: #475569;
}
.empty {
  font-size: 12px;
  color: #94a3b8;
}
th.col {
  height: 130px;
  vertical-align: bottom;
  padding: 4px 2px;
  border-bottom: 1px solid #e2e8f0;
  font: 500 11px var(--sans);
  color: #475569;
}
th.col span {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  white-space: nowrap;
}
.source-row th {
  text-align: left;
  font: 600 12px var(--sans);
  padding: 6px 8px 2px;
  color: color-mix(in srgb, var(--c) 80%, black);
  border-top: 1px solid #e2e8f0;
  position: sticky;
  left: 0;
}
th.field {
  position: sticky;
  left: 0;
  background: white;
  text-align: left;
  padding: 2px 8px 2px 16px;
  white-space: nowrap;
}
th.field button {
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  font: 500 12px var(--mono);
  color: color-mix(in srgb, var(--c) 80%, black);
}
th.field button:hover {
  text-decoration: underline;
}
td {
  text-align: center;
  padding: 2px 4px;
  border-left: 1px solid #f1f5f9;
}
tr:hover td,
tr:hover th.field {
  background: #f8fafc;
}
tr.dimmed {
  opacity: 0.25;
}
.mark {
  display: inline-block;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid var(--c, #475569);
  background: var(--c, #475569);
  padding: 0;
  cursor: pointer;
  vertical-align: middle;
}
.mark.presence {
  background: white;
  border-style: dashed;
}
.mark.partial {
  background: linear-gradient(90deg, var(--c, #475569) 50%, white 50%);
}
</style>
