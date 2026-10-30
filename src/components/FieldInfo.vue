<script setup lang="ts">
import { computed } from 'vue';

import { colorOf, sourceLabel } from '../lib/colors';
import { PREFIXES_WITHOUT_SCHEMA } from '../lib/extensions';
import type { SchemaLayer } from '../lib/layers';
import { inlineMarkdown } from '../lib/markdown';
import type { FieldDoc, SourceInfo } from '../lib/model';
import type { PrecedenceUse, SoftwareUse } from '../lib/software';
import Checked from './Checked.vue';
import LayerBadge from './LayerBadge.vue';
import SoftwareInfo from './SoftwareInfo.vue';

export interface FieldPlace {
    label: string;
    type: string;
    locations: string[];
    kind: 'validated' | 'presence';
}

/** A field on the other side of the STAC/embedded-metadata crosswalk. */
export interface FieldCounterpart {
    label: string;
    relation: 'same' | 'converted' | 'related';
    note: string;
}

const props = defineProps<{
    name: string;
    source: string;
    sources: SourceInfo[];
    doc?: FieldDoc;
    places: FieldPlace[];
    vendored: boolean;
    /** Where the field's information also lives: STAC fields of an embedded field, embedded fields of a STAC field. */
    counterparts?: FieldCounterpart[];
    counterpartsTitle?: string;
    /** Software that reads or writes the field, and the sources each program prefers for what it says. */
    software?: SoftwareUse[];
    precedence?: PrecedenceUse[];
    /** The layer of the schema that defines the field, its version and how current our information is. */
    definer?: SchemaLayer;
    /** The formats that contain an embedded field, and the member of the node it is in (none: the node's top level). */
    container?: { formats: string[]; member?: string };
}>();
const emit = defineEmits<{ close: []; place: [place: FieldPlace] }>();

const schemaLink = computed(() => props.doc?.definedAt.split('#')[0]);
/** A field of a prefix that another specification defines without a STAC extension schema (openEO's `openeo:status`). */
const withoutSchema = computed(() => {
    const spec = props.source.startsWith('?') ? PREFIXES_WITHOUT_SCHEMA[props.source.slice(1)] : undefined;
    return spec ? { ...spec, field: spec.fields[props.name] } : undefined;
});
const RELATION = { same: 'same value', converted: 'same value, converted', related: 'related' } as const;
const vendoredLink = computed(() => {
    if (!props.vendored || !schemaLink.value) return undefined;
    const { host, pathname } = new URL(schemaLink.value);
    return `https://github.com/hamk-uas/stac-schema-explorer/blob/main/schemas/${host}${pathname}`;
});
</script>

<template>
  <section class="field-info" :style="{ '--c': colorOf(source) }">
    <header>
      <code class="name">{{ name }}</code>
      <span v-if="doc?.title" class="title">{{ doc.title }}</span>
      <button type="button" class="close" aria-label="Close field information" @click="emit('close')">×</button>
    </header>
    <p class="source">
      <span class="role">defined by</span>
      <LayerBadge v-if="definer" :layer="definer.layer" :label="definer.kind" />
      <span class="dot" />{{ sourceLabel(source, sources) }}
      <span v-if="definer?.maturity" class="maturity" title="Maturity the convention states">{{ definer.maturity }}</span>
      <a v-if="schemaLink" :href="schemaLink" target="_blank" rel="noopener" title="Published JSON Schema">schema ↗</a>
      <a v-if="vendoredLink" :href="vendoredLink" target="_blank" rel="noopener" title="Copy with titles and descriptions, vendored by this app">documented copy ↗</a>
      <Checked
        v-if="definer?.checked"
        :date="definer.checked.date"
        :latest="definer.checked.latest"
        :version="definer.version"
        :source="definer.checked.source"
        :note="definer.checked.note"
      />
    </p>
    <p v-if="container" class="source">
      <span class="role">contained in</span>
      <LayerBadge layer="format" :label="container.formats.length === 1 ? 'Format' : 'Formats'" />
      {{ container.formats.join(', ') }}
      <span class="member">{{ container.member ? `in the node's ${container.member}` : 'at the top level of the node' }}</span>
    </p>
    <template v-if="doc">
      <p class="type"><span class="label">Type</span> <code>{{ doc.type }}</code></p>
      <!-- v-html is safe: inlineMarkdown escapes everything except the code spans and links it creates. -->
      <p v-if="doc.description" class="description" v-html="inlineMarkdown(doc.description)" />
      <p v-else class="missing">The schema has no description for this field.</p>
      <table v-if="doc.values?.length" class="values">
        <thead><tr><th>Value</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr v-for="v in doc.values" :key="JSON.stringify(v.value)">
            <td><code>{{ JSON.stringify(v.value) }}</code></td>
            <td><strong v-if="v.title">{{ v.title }}</strong><span v-if="v.title && v.description"> — </span><span v-if="v.description" v-html="inlineMarkdown(v.description)" /></td>
          </tr>
        </tbody>
      </table>
    </template>
    <template v-else-if="withoutSchema">
      <!-- v-html is safe: inlineMarkdown escapes everything except the code spans and links it creates. -->
      <p v-if="withoutSchema.field" class="description" v-html="inlineMarkdown(withoutSchema.field)" />
      <p class="description"><strong>{{ withoutSchema.title }}.</strong> <span v-html="inlineMarkdown(withoutSchema.description)" />{{ ' ' }}<a :href="withoutSchema.url" target="_blank" rel="noopener">specification ↗</a></p>
    </template>
    <p v-else class="missing">No schema information found for this field.</p>
    <div v-if="places.length" class="places">
      <span class="label">Allowed in</span>
      <ul>
        <li v-for="place in places" :key="`${place.type} ${place.label}`">
          <button type="button" :class="place.kind" :title="place.locations.join('\n')" @click="emit('place', place)">{{ place.label }}</button>
        </li>
      </ul>
    </div>
    <div v-if="counterparts?.length" class="counterparts">
      <span class="label">{{ counterpartsTitle ?? 'Corresponds to' }}</span>
      <ul>
        <li v-for="c in counterparts" :key="c.label">
          <code>{{ c.label }}</code>
          <span class="relation" :class="c.relation">{{ RELATION[c.relation] }}</span>
          <span class="note">{{ c.note }}</span>
        </li>
      </ul>
    </div>
    <SoftwareInfo :uses="software ?? []" :precedence="precedence" />
  </section>
</template>

<style scoped>
.field-info {
  padding: 10px 14px 12px;
  border-bottom: 1px solid #e2e8f0;
  background: color-mix(in srgb, var(--c) 5%, white);
  border-left: 4px solid var(--c);
  max-height: 45vh;
  overflow: auto;
  font-size: 13px;
}
header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.name {
  font: 700 14px var(--mono);
  color: color-mix(in srgb, var(--c) 80%, black);
}
.title {
  font: 600 14px var(--sans);
  color: #1e293b;
}
.close {
  margin-left: auto;
  border: 0;
  background: none;
  font-size: 18px;
  cursor: pointer;
  color: #64748b;
}
.source {
  margin: 4px 0 6px;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: #475569;
  flex-wrap: wrap;
}
.source + .source {
  margin-top: -2px;
}
.role {
  min-width: 74px;
  font: 600 10px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
}
.maturity {
  font: 600 10px var(--sans);
  color: #92400e;
  background: #fef3c7;
  border-radius: 4px;
  padding: 0 5px;
}
.member {
  color: #64748b;
}
.source a {
  color: #4f46e5;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--c);
  display: inline-block;
  margin-right: -2px;
}
.label {
  font: 600 11px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  margin-right: 6px;
}
.type {
  margin: 0 0 6px;
}
.type code {
  font-size: 12px;
}
.description {
  margin: 0 0 8px;
  line-height: 1.5;
  color: #1e293b;
}
.missing {
  color: #b45309;
  font-size: 12px;
}
.values {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
  margin-bottom: 8px;
}
.values th {
  text-align: left;
  font: 600 11px var(--sans);
  color: #64748b;
  border-bottom: 1px solid #e2e8f0;
  padding: 2px 6px 2px 0;
}
.values td {
  padding: 3px 6px 3px 0;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: top;
}
.places ul {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.places button {
  font: 500 11px var(--sans);
  border: 1.5px solid var(--c);
  border-radius: 999px;
  background: white;
  padding: 1px 8px;
  cursor: pointer;
  color: #334155;
}
.places button.presence {
  border-style: dashed;
}
.counterparts {
  margin-top: 10px;
}
.counterparts ul {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
  display: grid;
  gap: 4px;
}
.counterparts li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
}
.relation {
  font: 600 10px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
  padding: 0 5px;
  color: #475569;
  background: #f1f5f9;
}
.relation.same,
.relation.converted {
  color: #0f766e;
  background: #ccfbf1;
}
.note {
  flex-basis: 100%;
  color: #475569;
}
:deep(code) {
  font-family: var(--mono);
  background: #f1f5f9;
  border-radius: 3px;
  padding: 0 3px;
}
</style>
