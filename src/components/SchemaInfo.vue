<script setup lang="ts">
import { computed } from 'vue';

import { colorOf, sourceLabel } from '../lib/colors';
import { CONVENTION_KINDS, conventionOfSchema, DATA_FORMATS, formatOfSchema } from '../lib/conventions';
import type { EmbeddedSourceInfo } from '../lib/embedded-probe';
import { repoUrl } from '../lib/extensions';
import { inlineMarkdown } from '../lib/markdown';
import { CORE, type SourceInfo } from '../lib/model';
import { isVendored } from '../lib/vendored';
import type { FieldPlace } from './FieldInfo.vue';

/** Information on a schema whose fields are grouped together: STAC core, an extension, a data format or a convention. */
const props = defineProps<{
    source: string;
    info?: SourceInfo | EmbeddedSourceInfo;
    sources: SourceInfo[];
    /** Object or node types where the schema places fields. */
    places: FieldPlace[];
    /** Fields of the schema in the clicked object (a grouped chip), listed first. */
    here: string[];
    /** The schema's fields are highlighted (others dimmed). */
    focused: boolean;
}>();
const emit = defineEmits<{ close: []; field: [name: string]; place: [place: FieldPlace]; focus: [] }>();

const format = computed(() => formatOfSchema(props.source));
const known = computed(() => conventionOfSchema(props.source));
const embedded = computed(() => !!format.value || !!known.value || (!!props.info && 'kind' in props.info));
const unknown = computed(() => props.source.startsWith('?'));

const kind = computed(() => {
    if (props.source === CORE) return 'STAC core';
    if (unknown.value) return 'Unknown';
    if (format.value || (props.info && 'kind' in props.info && props.info.kind === 'format')) return 'Data format';
    const conventionKind = known.value?.convention.kind ?? (props.info && 'kind' in props.info ? props.info.kind : undefined);
    if (conventionKind) return CONVENTION_KINDS.find((k) => k.kind === conventionKind)?.title.replace(/s$/, '') ?? 'Data convention';
    return 'STAC extension';
});

const description = computed(() => {
    if (props.source === CORE) {
        return 'The fields the STAC specification itself defines for Catalogs, Collections and Items (GeoJSON Features), including Common Metadata, links and assets.';
    }
    return props.info?.description ?? known.value?.convention.description ?? format.value?.description;
});

const formats = computed(() => {
    if (format.value || !props.info || !('formats' in props.info)) return [];
    return props.info.formats.map((id) => DATA_FORMATS.find((f) => f.id === id)?.title ?? id);
});

const links = computed(() => {
    const out: { label: string; href: string; title: string }[] = [];
    if (unknown.value) return out;
    if (props.source === CORE) {
        const version = props.info?.version;
        out.push({ label: 'specification ↗', href: `https://github.com/radiantearth/stac-spec/tree/${version ? `v${version}` : 'master'}`, title: 'STAC specification' });
        return out;
    }
    const specification = known.value?.convention.versions.find((v) => v.version === known.value?.version)?.specification
        ?? known.value?.convention.specification ?? format.value?.specification;
    if (specification) out.push({ label: 'specification ↗', href: specification, title: 'Specification' });
    const repo = repoUrl(props.source);
    if (repo && repo !== specification) out.push({ label: 'site ↗', href: repo, title: 'Repository (README)' });
    out.push({ label: 'schema ↗', href: props.source, title: 'Published JSON Schema' });
    if (isVendored(props.source)) {
        const { host, pathname } = new URL(props.source);
        out.push({ label: 'documented copy ↗', href: `https://github.com/hamk-uas/stac-schema-explorer/blob/main/schemas/${host}${pathname}`, title: 'Copy with titles and descriptions, vendored by this app' });
    }
    return out;
});

const hereSet = computed(() => new Set(props.here));
const fields = computed(() => props.info?.fields ?? []);
const fieldTitle = (name: string) => {
    const doc = props.info?.docs[name];
    return [doc?.title, doc?.type, 'Click for details.'].filter(Boolean).join('\n');
};
</script>

<template>
  <section class="schema-info" :style="{ '--c': colorOf(source) }" aria-label="Schema information">
    <header>
      <span class="marker" :class="{ square: embedded }" aria-hidden="true" />
      <span class="title">{{ sourceLabel(source, info ? [info, ...sources] : sources) }}</span>
      <span class="kind">{{ kind }}</span>
      <button type="button" class="close" aria-label="Close schema information" @click="emit('close')">×</button>
    </header>
    <p v-if="links.length || info?.prefixes.length" class="links">
      <code v-for="p in info?.prefixes ?? []" :key="p" class="prefix">{{ p }}:</code>
      <a v-for="link in links" :key="link.label" :href="link.href" target="_blank" rel="noopener" :title="link.title">{{ link.label }}</a>
    </p>
    <!-- v-html is safe: inlineMarkdown escapes everything except the code spans and links it creates. -->
    <p v-if="description" class="description" v-html="inlineMarkdown(description)" />
    <p v-else-if="unknown && source !== '?'" class="missing">
      The document uses fields with the prefix <code>{{ source.slice(1) }}:</code>, but no selected or declared extension defines them.
    </p>
    <p v-else-if="unknown" class="missing">Fields that no selected or declared schema defines.</p>
    <p v-else class="missing">The schema has no description of itself.</p>
    <p v-if="info?.error" class="error">{{ info.error }}</p>
    <p v-if="formats.length" class="row"><span class="label">Formats</span> {{ formats.join(', ') }}</p>
    <div v-if="places.length" class="places">
      <span class="label">Fields allowed in</span>
      <ul>
        <li v-for="place in places" :key="`${place.type} ${place.label}`">
          <button type="button" :class="place.kind" :title="place.locations.join('\n')" @click="emit('place', place)">{{ place.label }}</button>
        </li>
      </ul>
    </div>
    <div v-if="here.length" class="fields">
      <span class="label">Here ({{ here.length }})</span>
      <ul>
        <li v-for="name in here" :key="name">
          <button type="button" :title="fieldTitle(name)" @click="emit('field', name)">{{ name }}</button>
        </li>
      </ul>
    </div>
    <details v-if="fields.length > here.length" class="fields" :open="!here.length">
      <summary><span class="label">All fields ({{ fields.length }})</span></summary>
      <ul>
        <li v-for="name in fields" :key="name">
          <button type="button" :class="{ here: hereSet.has(name) }" :title="fieldTitle(name)" @click="emit('field', name)">{{ name }}</button>
        </li>
      </ul>
    </details>
    <p v-if="info?.unsampled.length" class="missing">No valid example value could be generated for: {{ info.unsampled.join(', ') }}</p>
    <p class="actions">
      <button type="button" class="toggle" :aria-pressed="focused" @click="emit('focus')">
        {{ focused ? 'Stop highlighting its fields' : 'Highlight its fields' }}
      </button>
    </p>
  </section>
</template>

<style scoped>
.schema-info {
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
  align-items: center;
  gap: 8px;
}
.marker {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c);
  flex: none;
}
.marker.square {
  border-radius: 2px;
}
.title {
  font: 600 14px var(--sans);
  color: #1e293b;
}
.kind {
  font: 500 10px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #475569;
  background: #f1f5f9;
  border-radius: 4px;
  padding: 1px 5px;
}
.close {
  margin-left: auto;
  border: 0;
  background: none;
  font-size: 18px;
  cursor: pointer;
  color: #64748b;
}
.links {
  margin: 4px 0 8px;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  flex-wrap: wrap;
}
.links a {
  color: #4f46e5;
}
.prefix {
  font-size: 11px;
}
.label {
  font: 600 11px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  margin-right: 6px;
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
.error {
  color: #b91c1c;
  font-size: 12px;
}
.row {
  margin: 0 0 8px;
  font-size: 12px;
  color: #334155;
}
.places,
.fields {
  margin-bottom: 8px;
}
.fields summary {
  cursor: pointer;
}
.places ul,
.fields ul {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.places button,
.fields button {
  font: 500 11px var(--sans);
  border: 1.5px solid var(--c);
  border-radius: 999px;
  background: white;
  padding: 1px 8px;
  cursor: pointer;
  color: #334155;
}
.fields button {
  font-family: var(--mono);
}
.fields button.here {
  background: color-mix(in srgb, var(--c) 14%, white);
}
.places button.presence {
  border-style: dashed;
}
.actions {
  margin: 4px 0 0;
}
.toggle {
  font: 500 12px var(--sans);
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: white;
  padding: 2px 10px;
  cursor: pointer;
  color: #334155;
}
.toggle[aria-pressed='true'] {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, white);
}
:deep(code) {
  font-family: var(--mono);
  background: #f1f5f9;
  border-radius: 3px;
  padding: 0 3px;
}
</style>
