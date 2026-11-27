<script setup lang="ts">
import { computed, ref } from 'vue';

import { colorOf, sourceLabel } from '../lib/colors';
import { formatOfSchema } from '../lib/conventions';
import { buildMatrix, type MatrixCell, type MatrixGroup } from '../lib/matrix';
import type { SourceInfo } from '../lib/model';

const props = defineProps<{
    groups: MatrixGroup[];
    sources: SourceInfo[];
    /** Sources whose fields are left out (core and format fields unless shown). */
    hidden: string[];
    focus: string;
    /** Source keys whose row groups are collapsed. */
    collapsed?: string[];
    /** Label of the top-level column: `top level` of a STAC object, `node` of embedded metadata. */
    topLabel?: string;
    intro?: string;
    /** Explain the marks. */
    legend?: boolean;
}>();
const emit = defineEmits<{
    select: [type: string, pointers: string[], field: string];
    field: [source: string, name: string];
    schema: [source: string];
    toggleGroup: [source: string];
}>();

const hoveredCol = ref<string | null>(null);
const collapsedSet = computed(() => new Set(props.collapsed ?? []));
const isCollapsed = (source: string) => collapsedSet.value.has(source);
const matrix = computed(() => buildMatrix(props.groups, props.sources, new Set(props.hidden)));
const typeSpans = computed(() => props.groups
    .map((g) => ({ type: g.type, label: g.label, tone: g.tone, count: matrix.value.columns.filter((c) => c.type === g.type).length }))
    .filter((t) => t.count > 0));
const groupStarts = computed(() => {
    const starts = new Set<string>();
    let lastType: string | undefined;
    for (const col of matrix.value.columns) {
        if (col.type !== lastType) starts.add(col.key);
        lastType = col.type;
    }
    return starts;
});
const rows = computed(() => {
    const counts = new Map<string, number>();
    for (const row of matrix.value.rows) counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
    const out: { header?: string; count?: number; source: string; field?: string }[] = [];
    let last = '';
    for (const row of matrix.value.rows) {
        if (row.source !== last) out.push({ header: sourceLabel(row.source, props.sources), count: counts.get(row.source) ?? 0, source: row.source });
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
    const locs = c.locations.filter(Boolean);
    return [
        `${field}: ${how}`,
        ...(c.partial && locs.length ? ['only in some of these objects:', ...locs] : locs),
        'Click to open field details and highlight it in the example JSON.',
    ].join('\n');
}

function fieldTitle(source: string, field: string): string {
    const doc = props.sources.find((s) => s.key === source)?.docs[field];
    return [doc?.title, doc?.type, 'Click to open field details.'].filter(Boolean).join('\n');
}

/** Finds the non-core extension/convention that owns a column path segment (e.g. `table:columns[]`, `cube:variables{}`, `multiscales`). */
function segmentColor(segment: string): string | undefined {
    const clean = segment.replace(/(?:\[\]|\{\})$/, '');
    const colon = clean.indexOf(':');
    const prefix = colon > 0 ? clean.slice(0, colon) : undefined;
    const isCore = (key: string) => key === 'core' || !!formatOfSchema(key) || props.hidden.includes(key);
    for (const s of props.sources) {
        if (isCore(s.key) || s.key.startsWith('?')) continue;
        if (prefix && s.prefixes.includes(prefix)) return colorOf(s.key);
        if (s.fields.includes(clean) || s.fields.includes(`${clean}s`)) return colorOf(s.key);
    }
    return undefined;
}

function colSegments(path: string[]): { text: string; color?: string }[] {
    if (!path.length) return [{ text: props.topLabel ?? 'top level' }];
    return path.map((text) => ({ text, color: segmentColor(text) }));
}
</script>

<template>
  <div class="matrix-wrap">
    <p v-if="intro || legend" class="intro">
      {{ intro }}
      <template v-if="legend">
        <span class="mark validated" /> validated by the schema, <span class="mark presence" /> presence only (counts towards the
        extension's “at least one field” requirement), <span class="mark validated partial" /> only in some objects of that kind
        (hover for details). Click a cell to see field details and the example JSON.
      </template>
    </p>
    <p v-if="!matrix.rows.length" class="empty">No fields to place.</p>
    <div v-else class="scroll">
      <table @mouseleave="hoveredCol = null">
        <thead>
          <tr>
            <th class="corner" rowspan="2" @mouseenter="hoveredCol = null">Field</th>
            <th v-for="t in typeSpans" :key="t.type" :colspan="t.count" class="type" :class="`type-${t.tone}`" @mouseenter="hoveredCol = null">{{ t.label }}</th>
          </tr>
          <tr>
            <th
              v-for="col in matrix.columns"
              :key="col.key"
              class="col"
              :class="[`type-${col.tone}`, { 'group-start': groupStarts.has(col.key), 'col-hover': hoveredCol === col.key }]"
              @mouseenter="hoveredCol = col.key"
            >
              <span class="col-label"><template v-for="(seg, si) in colSegments(col.path)" :key="si"><template v-if="si > 0"> › </template><span :class="{ 'ext-seg': seg.color }" :style="seg.color ? { '--c': seg.color } : undefined">{{ seg.text }}</span></template></span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(row, i) in rows" :key="i">
            <tr v-if="row.header" class="source-row" :class="{ collapsed: isCollapsed(row.source) }" @mouseenter="hoveredCol = null">
              <th :colspan="matrix.columns.length + 1" :style="{ '--c': colorOf(row.source) }">
                <button
                  type="button"
                  class="twisty"
                  :aria-expanded="!isCollapsed(row.source)"
                  :aria-label="isCollapsed(row.source) ? `Expand ${row.header} rows` : `Collapse ${row.header} rows`"
                  :title="isCollapsed(row.source) ? `Click to expand ${row.header} (${row.count} fields)` : `Click to collapse ${row.header} (${row.count} fields)`"
                  @click="emit('toggleGroup', row.source)"
                >{{ isCollapsed(row.source) ? '▸' : '▾' }}</button>
                <button type="button" class="source-name" :title="`Click to open schema details for ${row.header}`" @click="emit('schema', row.source)">{{ row.header }}</button>
                <span v-if="isCollapsed(row.source)" class="collapsed-count">({{ row.count }} hidden)</span>
              </th>
            </tr>
            <tr v-else-if="!isCollapsed(row.source)" class="data-row" :class="{ dimmed: focus && focus !== row.source }">
              <th class="field" :style="{ '--c': colorOf(row.source) }" @mouseenter="hoveredCol = null">
                <button type="button" :title="fieldTitle(row.source, row.field!)" @click="emit('field', row.source, row.field!)">{{ row.field }}</button>
              </th>
              <td
                v-for="col in matrix.columns"
                :key="col.key"
                :class="[`type-${col.tone}`, { 'group-start': groupStarts.has(col.key), 'col-hover': hoveredCol === col.key }]"
                @mouseenter="hoveredCol = col.key"
              >
                <button
                  v-if="cell(row.source, row.field!, col.key)"
                  type="button"
                  class="mark"
                  :class="[cell(row.source, row.field!, col.key)!.kind, { partial: cell(row.source, row.field!, col.key)!.partial }]"
                  :style="{ '--c': colorOf(row.source) }"
                  :title="cellTitle(row.field!, cell(row.source, row.field!, col.key)!)"
                  :aria-label="`${row.field} in ${col.type} ${col.path.length ? col.path.join(' › ') : (topLabel ?? 'top level')} (${cell(row.source, row.field!, col.key)!.kind})`"
                  @click="emit('select', col.type, cell(row.source, row.field!, col.key)!.locations, row.field!); emit('field', row.source, row.field!)"
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
.matrix-wrap {
  /* Opaque equivalent of `--layer` over `--bg`, so sticky headers and field names stay opaque while blending into the panel. */
  --surface: var(--layer-opaque);
}
.intro {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 10px;
  line-height: 1.7;
}
.scroll {
  overflow: auto;
  border-radius: var(--radius-md);
  max-height: calc(100vh - 230px);
}
table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}
thead th {
  position: sticky;
  background: var(--surface);
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
}
th.type {
  font: 700 12px var(--sans);
  padding: 4px 6px;
  border-left: 2px solid var(--border);
}
th.type-Catalog {
  color: var(--indigo-600);
}
th.type-Collection {
  color: var(--teal-700);
}
th.type-Feature {
  color: var(--amber-700);
}
th.type-node {
  color: var(--slate-600);
}
.empty {
  font-size: 12px;
  color: var(--slate-400);
  margin: 4px 0 0;
}
th.col {
  height: 130px;
  vertical-align: bottom;
  padding: 4px 2px;
  border-bottom: 1px solid var(--slate-200);
  font: 500 11px var(--sans);
  color: var(--slate-600);
}
th.col.group-start,
td.group-start {
  border-left: 2px solid var(--slate-200);
}
th.col > .col-label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  white-space: nowrap;
}
th.col .ext-seg {
  color: color-mix(in srgb, var(--c) 80%, var(--ink));
  font-weight: 600;
}
.source-row th {
  text-align: left;
  font: 600 12px var(--sans);
  padding: 12px 8px 2px;
  color: color-mix(in srgb, var(--c) 80%, var(--ink));
  position: sticky;
  left: 0;
  background: var(--surface);
}
.source-row button {
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.source-row .twisty {
  display: inline-block;
  width: 14px;
  margin-right: 4px;
  color: var(--muted);
  text-align: center;
}
.source-row .twisty:hover {
  color: var(--text-strong);
}
.source-row .source-name:hover {
  text-decoration: underline;
}
.source-row .collapsed-count {
  margin-left: 6px;
  font: 400 11px var(--sans);
  color: var(--muted);
}
th.field {
  position: sticky;
  left: 0;
  background: var(--surface);
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
  color: color-mix(in srgb, var(--c) 80%, var(--ink));
}
th.field button:hover {
  text-decoration: underline;
}
td {
  text-align: center;
  padding: 2px 4px;
}
/* Opaque hover tints, since sticky headers and field names stay in place over scrolled cells. */
tr.data-row:hover td,
tr.data-row:hover th.field,
th.col.col-hover,
td.col-hover {
  background: color-mix(in srgb, var(--ink) 5%, var(--surface));
}
tr.data-row:hover td.col-hover {
  background: color-mix(in srgb, var(--ink) 9%, var(--surface));
}
tr.dimmed {
  opacity: 0.25;
}
.mark {
  display: inline-block;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid var(--c, var(--slate-600));
  background: var(--c, var(--slate-600));
  padding: 0;
  cursor: pointer;
  vertical-align: middle;
}
.mark.presence {
  background: var(--surface);
  border-style: dashed;
}
.mark.partial {
  background: linear-gradient(90deg, var(--c, var(--slate-600)) 50%, var(--surface) 50%);
}
</style>
