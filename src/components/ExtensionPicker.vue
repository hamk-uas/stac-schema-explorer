<script setup lang="ts">
import { computed, ref } from 'vue';

import { colorOf } from '../lib/colors';
import { describeUrl, fromShortId, KNOWN_EXTENSIONS, normalizeSchemaUrl, repoUrl, toShortId } from '../lib/extensions';
import type { SourceInfo } from '../lib/model';

const props = defineProps<{ modelValue: string[]; sources: SourceInfo[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: string[]]; focus: [source: string]; }>();

const input = ref('');
const inputError = ref('');
const selected = computed(() => new Set(props.modelValue.map(normalizeSchemaUrl)));

function info(url: string) {
    return props.sources.find((s) => s.key === normalizeSchemaUrl(url));
}

function label(url: string) {
    const known = info(url);
    if (known && !known.error) return { title: known.title, version: known.version, prefixes: known.prefixes };
    const { name, version } = describeUrl(url);
    return { title: name, version, prefixes: [] as string[] };
}

function toggle(url: string) {
    const key = normalizeSchemaUrl(url);
    emit('update:modelValue', selected.value.has(key) ? props.modelValue.filter((u) => normalizeSchemaUrl(u) !== key) : [...props.modelValue, key]);
}

function add() {
    const value = input.value.trim();
    if (!value) return;
    const url = fromShortId(value);
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
    } catch {
        inputError.value = 'Enter a schema URL or name@version (for example cf@1.0.0).';
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
      <li v-if="modelValue.length === 0" class="none">No extensions: STAC core only.</li>
      <li v-for="url in modelValue" :key="url" :class="{ failed: info(url)?.error }">
        <span class="dot" :style="{ background: colorOf(normalizeSchemaUrl(url)) }" />
        <button type="button" class="name" :title="`Highlight ${label(url).title} fields\n${url}`" @click="emit('focus', normalizeSchemaUrl(url))">
          {{ label(url).title }}
          <span v-if="label(url).version" class="ver">v{{ label(url).version }}</span>
          <code v-for="p in label(url).prefixes" :key="p" class="prefix">{{ p }}:</code>
        </button>
        <a
          v-if="repoUrl(url)"
          :href="repoUrl(url)"
          target="_blank"
          rel="noopener"
          class="icon text"
          :title="`Open the GitHub repository (README)\n${repoUrl(url)}`"
          :aria-label="`GitHub repository of ${label(url).title}`"
        >site ↗</a>
        <a :href="url" target="_blank" rel="noopener" class="icon text" :title="`Open the JSON Schema\n${url}`" :aria-label="`JSON Schema of ${label(url).title}`">schema ↗</a>
        <button type="button" class="icon" :title="`Remove ${toShortId(url)}`" @click="toggle(url)">×</button>
        <div v-if="info(url)?.error" class="error">{{ info(url)?.error }}</div>
        <div v-else-if="info(url)?.unsampled.length" class="warn" title="No example value valid against the schema could be generated, so these fields may be missing from the results.">
          no valid example for: {{ info(url)?.unsampled.join(', ') }}
        </div>
        <div v-else-if="info(url) && info(url)!.fields.length === 0" class="warn">no fields found in the schema</div>
      </li>
    </ul>

    <form class="add" @submit.prevent="add">
      <input v-model="input" type="text" placeholder="schema URL or name@version" aria-label="Extension schema URL or name@version" />
      <button type="submit">Add</button>
    </form>
    <p v-if="inputError" class="error">{{ inputError }}</p>

    <div class="quick-head">
      <h3>Quick select</h3>
      <button type="button" class="link" @click="emit('update:modelValue', [])">clear</button>
    </div>
    <p class="hint">Extensions discussed in the Observatory project, and those the openEO API recommends or its back-ends use.</p>
    <div class="quick">
      <template v-for="ext in KNOWN_EXTENSIONS" :key="ext.name">
        <button
          v-for="v in ext.versions"
          :key="v.url"
          type="button"
          class="q"
          :class="{ on: selected.has(v.url) }"
          :style="selected.has(v.url) ? { '--c': colorOf(v.url) } : undefined"
          :title="`${ext.title} ${v.version}${ext.note ? ` (${ext.note})` : ''}\n${v.url}`"
          @click="toggle(v.url)"
        >
          {{ ext.title }}<span v-if="ext.versions.length > 1 || v.version === 'dev'" class="ver">{{ v.version }}</span>
        </button>
      </template>
    </div>
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
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
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
.prefix {
  font-size: 11px;
  color: #475569;
  background: #f1f5f9;
  border-radius: 3px;
  padding: 0 3px;
  margin-left: 3px;
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
.error,
.warn {
  flex-basis: 100%;
  font-size: 11px;
  padding-left: 16px;
}
.error {
  color: #b91c1c;
}
.warn {
  color: #b45309;
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
.link {
  border: 0;
  background: none;
  color: #4f46e5;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.hint {
  margin: 2px 0 6px;
  font-size: 11px;
  color: #94a3b8;
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
  border-radius: 999px;
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
