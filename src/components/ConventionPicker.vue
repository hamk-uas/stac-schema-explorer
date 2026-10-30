<script setup lang="ts">
import { computed, ref } from 'vue';

import { colorOf } from '../lib/colors';
import { CONVENTION_KINDS, conventionOfSchema, fromConventionShortId, KNOWN_CONVENTIONS, toConventionShortId } from '../lib/conventions';
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

function label(url: string) {
    const known = conventionOfSchema(url);
    const kind = CONVENTION_KINDS.find((k) => k.kind === known?.convention.kind)?.title.replace(/s$/, '');
    return { title: known?.convention.title ?? info(url)?.title ?? url, version: known?.version, kind: kind ?? 'Convention', authored: known?.convention.authored ?? false };
}

function toggle(url: string) {
    const key = normalizeSchemaUrl(url);
    emit('update:modelValue', selected.value.has(key) ? props.modelValue.filter((u) => normalizeSchemaUrl(u) !== key) : [...props.modelValue, key]);
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
      <li v-if="modelValue.length === 0" class="none">No conventions: embedded metadata is not shown.</li>
      <li v-for="url in modelValue" :key="url" :class="{ failed: info(url)?.error }">
        <span class="square" :style="{ background: colorOf(normalizeSchemaUrl(url)) }" />
        <button type="button" class="name" :title="`Highlight ${label(url).title} fields\n${url}`" @click="emit('focus', normalizeSchemaUrl(url))">
          {{ label(url).title }}
          <span v-if="label(url).version" class="ver">{{ label(url).version }}</span>
          <span class="kind">{{ label(url).kind }}</span>
          <span v-if="label(url).authored" class="unofficial" title="No official JSON Schema exists; this app's schema describes the convention">unofficial schema</span>
        </button>
        <a v-if="repoUrl(url)" :href="repoUrl(url)" target="_blank" rel="noopener" class="icon text" :title="`Open the repository (README)\n${repoUrl(url)}`" :aria-label="`Repository of ${label(url).title}`">site ↗</a>
        <a :href="url" target="_blank" rel="noopener" class="icon text" :title="`Open the JSON Schema\n${url}`" :aria-label="`JSON Schema of ${label(url).title}`">schema ↗</a>
        <button type="button" class="icon" :title="`Remove ${toConventionShortId(url)}`" :aria-label="`Remove ${label(url).title}`" @click="toggle(url)">×</button>
        <div v-if="info(url)?.error" class="error">{{ info(url)?.error }}</div>
      </li>
    </ul>

    <form class="add" @submit.prevent="add">
      <input v-model="input" type="text" placeholder="schema URL or name@version" aria-label="Convention schema URL or name@version" />
      <button type="submit">Add</button>
    </form>
    <p v-if="inputError" class="error">{{ inputError }}</p>

    <div class="quick-head">
      <h3>Quick select</h3>
      <button type="button" class="link" @click="emit('update:modelValue', [])">clear</button>
    </div>
    <template v-for="group in CONVENTION_KINDS" :key="group.kind">
      <h4 class="kind-title" :title="group.hint">{{ group.title }}</h4>
      <div class="quick">
        <template v-for="convention in KNOWN_CONVENTIONS.filter((c) => c.kind === group.kind)" :key="convention.id">
          <button
            v-for="v in convention.versions"
            :key="v.schema"
            type="button"
            class="q"
            :class="{ on: selected.has(v.schema) }"
            :aria-pressed="selected.has(v.schema)"
            :style="selected.has(v.schema) ? { '--c': colorOf(v.schema) } : undefined"
            :title="`${convention.title} ${v.version}: ${convention.description}\nFormats: ${convention.formats.join(', ')}\n${v.schema}`"
            @click="toggle(v.schema)"
          >
            {{ convention.title }}<span class="ver">{{ v.version }}</span>
          </button>
        </template>
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
  background: #f1f5f9;
}
.selected li.failed .name {
  color: #b91c1c;
}
.none {
  color: #64748b;
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
  color: #1e293b;
  cursor: pointer;
  padding: 0;
  min-width: 0;
}
.ver {
  font-size: 11px;
  color: #64748b;
  margin-left: 3px;
}
.kind,
.unofficial {
  font-size: 10px;
  color: #475569;
  background: #f1f5f9;
  border-radius: 3px;
  padding: 0 4px;
  margin-left: 4px;
}
.unofficial {
  color: #92400e;
  background: #fef3c7;
}
.icon {
  border: 0;
  background: none;
  color: #64748b;
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
  color: #b91c1c;
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
  border: 1px solid #cbd5e1;
  border-radius: 5px;
}
.add button {
  font-size: 12px;
  border: 1px solid #cbd5e1;
  border-radius: 5px;
  background: white;
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
  color: #475569;
  flex: 1;
}
.kind-title {
  margin: 8px 0 4px;
  font: 600 11px var(--sans);
  color: #64748b;
}
.link {
  border: 0;
  background: none;
  color: #4f46e5;
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
  --c: #94a3b8;
  font: 500 12px var(--sans);
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  background: white;
  color: #334155;
  cursor: pointer;
}
.q.on {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, white);
  color: color-mix(in srgb, var(--c) 75%, black);
}
.q .ver {
  font-size: 10px;
}
</style>
