<script setup lang="ts">
import { computed, ref } from 'vue';

import { colorOf } from '../lib/colors';
import { CONVENTION_KINDS, conventionOfSchema, fromConventionShortId, KNOWN_CONVENTIONS, toConventionShortId, type KnownConvention } from '../lib/conventions';
import type { EmbeddedSourceInfo } from '../lib/embedded-probe';
import { normalizeSchemaUrl, repoUrl } from '../lib/extensions';

/** Conventions of metadata embedded in data: the counterparts of STAC extensions, listed apart from them. */
const props = defineProps<{ modelValue: string[]; sources: EmbeddedSourceInfo[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: string[]]; focus: [source: string] }>();

const input = ref('');
const inputError = ref('');
const selected = computed(() => new Set(props.modelValue.map(normalizeSchemaUrl)));

function info(url: string) {
    return props.sources.find((s) => s.key === normalizeSchemaUrl(url));
}

function knownOf(url: string): KnownConvention | undefined {
    return conventionOfSchema(url)?.convention;
}

function activeUrl(convention: KnownConvention): string | undefined {
    return convention.versions.find((v) => selected.value.has(v.schema))?.schema;
}

function label(url: string) {
    const known = conventionOfSchema(url);
    const kind = CONVENTION_KINDS.find((k) => k.kind === known?.convention.kind)?.title.replace(/s$/, '');
    return { title: known?.convention.title ?? info(url)?.title ?? url, version: known?.version, kind: kind ?? 'Convention', authored: known?.convention.authored ?? false };
}

function toggle(url: string) {
    const key = normalizeSchemaUrl(url);
    emit('update:modelValue', selected.value.has(key) ? props.modelValue.filter((u) => normalizeSchemaUrl(u) !== key) : [...props.modelValue, key]);
}

function toggleKnown(convention: KnownConvention) {
    const urls = new Set(convention.versions.map((v) => v.schema));
    if (convention.versions.some((v) => selected.value.has(v.schema))) {
        emit('update:modelValue', props.modelValue.filter((u) => !urls.has(normalizeSchemaUrl(u))));
    } else {
        emit('update:modelValue', [...props.modelValue, convention.versions[0].schema]);
    }
}

function changeVersion(oldUrl: string, newUrl: string) {
    const oldKey = normalizeSchemaUrl(oldUrl);
    const newKey = normalizeSchemaUrl(newUrl);
    if (oldKey === newKey) return;
    const next: string[] = [];
    for (const u of props.modelValue) {
        const key = normalizeSchemaUrl(u);
        const target = key === oldKey ? newKey : key;
        if (!next.includes(target)) next.push(target);
    }
    emit('update:modelValue', next);
}

function quickTitle(convention: KnownConvention): string {
    const latest = convention.versions[0];
    const active = activeUrl(convention);
    const versions = convention.versions.length > 1 ? `Versions: ${convention.versions.map((v) => v.version).join(', ')}` : '';
    return [
        `${convention.title}: ${convention.description}`,
        `Formats: ${convention.formats.join(', ')}`,
        versions,
        active ?? latest.schema,
        active ? 'Click to remove this convention.' : `Click to add ${latest.version}${convention.versions.length > 1 ? ' (version can be changed in the list above)' : ''}.`,
    ].filter(Boolean).join('\n');
}

function add() {
    const value = input.value.trim();
    if (!value) return;
    const url = fromConventionShortId(value);
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
    } catch {
        inputError.value = 'Enter a schema URL or name@version (for example proj@v0.1).';
        return;
    }
    inputError.value = '';
    if (!selected.value.has(url)) emit('update:modelValue', [...props.modelValue, url]);
    input.value = '';
}
</script>

<template>
  <div class="picker">
    <ul class="selected">
      <li v-if="modelValue.length === 0" class="none">No data conventions selected.</li>
      <li v-for="url in modelValue" :key="url" :class="{ failed: info(url)?.error }">
        <span class="square" :style="{ background: colorOf(normalizeSchemaUrl(url)) }" />
        <button
          type="button"
          class="name"
          :title="`${url}\nClick to toggle highlighting ${label(url).title} fields and view schema information.`"
          @click="emit('focus', normalizeSchemaUrl(url))"
        >
          {{ label(url).title }}
          <span v-if="label(url).version && !(knownOf(url) && knownOf(url)!.versions.length > 1)" class="ver">{{ label(url).version }}</span>
          <span class="kind">{{ label(url).kind }}</span>
          <span v-if="label(url).authored" class="unofficial" title="No official JSON Schema exists; this app's schema describes the convention">unofficial schema</span>
        </button>
        <select
          v-if="knownOf(url) && knownOf(url)!.versions.length > 1"
          class="ver-select"
          :value="normalizeSchemaUrl(url)"
          :aria-label="`Version of ${label(url).title}`"
          title="Change convention schema version"
          @change="changeVersion(url, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="v in knownOf(url)!.versions" :key="v.schema" :value="v.schema">{{ v.version }}</option>
        </select>
        <a v-if="repoUrl(url)" :href="repoUrl(url)" target="_blank" rel="noopener" class="icon text" :title="`Open the repository (README) in a new tab\n${repoUrl(url)}`" :aria-label="`Repository of ${label(url).title}`">site ↗</a>
        <a v-if="/^https?:\/\//i.test(url)" :href="url" target="_blank" rel="noopener" class="icon text" :title="`Open the JSON Schema in a new tab\n${url}`" :aria-label="`JSON Schema of ${label(url).title}`">schema ↗</a>
        <button type="button" class="icon" :title="`Click to remove ${toConventionShortId(url)}`" :aria-label="`Remove ${label(url).title}`" @click="toggle(url)">×</button>
        <div v-if="info(url)?.error" class="error">{{ info(url)?.error }}</div>
      </li>
    </ul>

    <form class="add" @submit.prevent="add">
      <input v-model="input" type="text" placeholder="schema URL or name@version" aria-label="Convention schema URL or name@version" />
      <button type="submit" title="Click to add and probe this convention schema">Add</button>
    </form>
    <p v-if="inputError" class="error">{{ inputError }}</p>

    <div class="quick-head">
      <h3>Quick select</h3>
      <button type="button" class="link" title="Click to remove all selected data conventions" @click="emit('update:modelValue', [])">clear</button>
    </div>
    <template v-for="group in CONVENTION_KINDS" :key="group.kind">
      <h4 class="kind-title" :title="group.hint">{{ group.title }}</h4>
      <div class="quick">
        <button
          v-for="convention in KNOWN_CONVENTIONS.filter((c) => c.kind === group.kind)"
          :key="convention.id"
          type="button"
          class="q"
          :class="{ on: !!activeUrl(convention) }"
          :aria-pressed="!!activeUrl(convention)"
          :style="activeUrl(convention) ? { '--c': colorOf(activeUrl(convention)!) } : undefined"
          :title="quickTitle(convention)"
          @click="toggleKnown(convention)"
        >{{ convention.title }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.selected {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.selected li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 6px;
}
.selected li:hover {
  background: var(--hover);
}
.selected li.failed .name {
  color: var(--red-700);
}
.none {
  color: var(--slate-500);
  font-size: 12px;
}
.square {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex: none;
}
.name {
  flex: 1;
  text-align: left;
  border: 0;
  background: none;
  font: 500 13px var(--sans);
  color: var(--slate-800);
  cursor: pointer;
  padding: 0;
  min-width: 0;
}
.ver {
  font-size: 11px;
  color: var(--slate-500);
  margin-left: 3px;
}
.ver-select {
  border: 0;
  border-radius: 4px;
  background: var(--field);
  color: var(--slate-700);
  font: 500 11px var(--sans);
  padding: 1px 4px;
  cursor: pointer;
}
.kind,
.unofficial {
  font-size: 10px;
  color: var(--slate-600);
  background: var(--field);
  border-radius: 3px;
  padding: 0 4px;
  margin-left: 4px;
}
.unofficial {
  color: var(--amber-800);
  background: var(--amber-100);
}
.icon {
  border: 0;
  background: none;
  color: var(--slate-500);
  cursor: pointer;
  font-size: 14px;
  text-decoration: none;
  padding: 0 2px;
}
.icon.text {
  font-size: 11px;
}
.error {
  flex-basis: 100%;
  font-size: 11px;
  padding-left: 16px;
  color: var(--red-700);
}
.add {
  display: flex;
  gap: 4px;
}
.add input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 4px 6px;
  border: 0;
  border-radius: 5px;
  background: var(--field);
  color: var(--slate-900);
}
.add button {
  font-size: 12px;
  border: 0;
  border-radius: 5px;
  padding: 0 8px;
  background: var(--field);
  color: var(--slate-800);
  cursor: pointer;
}
.quick-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 14px;
}
.quick-head h3 {
  margin: 0;
  font: 600 12px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--slate-600);
  flex: 1;
}
.kind-title {
  margin: 8px 0 4px;
  font: 600 11px var(--sans);
  color: var(--slate-500);
}
.link {
  border: 0;
  background: none;
  color: var(--indigo-600);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.q {
  --c: var(--slate-400);
  font: 500 12px var(--sans);
  padding: 3px 8px;
  border-radius: 4px;
  border: 0;
  background: var(--field);
  color: var(--slate-600);
  cursor: pointer;
}
.q:hover {
  background: var(--slate-200);
}
/* Selected: tinted and bold, so that the state does not rest on colour alone. */
.q.on {
  font-weight: 600;
  background: color-mix(in srgb, var(--c) var(--pick-fill), transparent);
  color: color-mix(in srgb, var(--c) var(--pick-text), var(--ink));
}
.q .ver {
  font-size: 10px;
}
</style>
