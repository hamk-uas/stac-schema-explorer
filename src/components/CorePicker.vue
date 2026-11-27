<script setup lang="ts">
import { computed } from 'vue';

import { colorOf } from '../lib/colors';
import { DATA_FORMATS } from '../lib/conventions';
import { ALL_CORES, CORES, type Core } from '../lib/cores';
import { LAYERS } from '../lib/layers';
import { STAC_VERSIONS } from '../lib/model';

/**
 * The cores that STAC documents and data files are built on: STAC itself and the data formats. Like extensions and
 * conventions, a selected core shows its fields; its documents or nodes are shown either way.
 */
const props = defineProps<{ modelValue: string[]; stacVersion: string; explore: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string[]]; 'update:stacVersion': [value: string]; focus: [source: string] }>();

const selected = computed(() => CORES.filter((core) => props.modelValue.includes(core.id)));
const set = (ids: string[]) => emit('update:modelValue', ALL_CORES.filter((id) => ids.includes(id)));
const toggle = (id: string) => set(props.modelValue.includes(id) ? props.modelValue.filter((c) => c !== id) : [...props.modelValue, id]);

/** Toggling STAC selects it (at its current version, defaulting to latest) or hides it. */
function toggleStac() {
    toggle('stac');
}

function links(core: Core): { label: string; href: string; title: string }[] {
    if (core.id === 'stac') {
        return [{ label: 'spec ↗', href: `https://github.com/radiantearth/stac-spec/tree/v${props.stacVersion}`, title: `Open the STAC ${props.stacVersion} specification in a new tab` }];
    }
    const format = DATA_FORMATS.find((f) => f.id === core.id)!;
    return [
        { label: 'spec ↗', href: format.specification, title: `Open the ${format.title} specification in a new tab` },
        { label: 'schema ↗', href: format.schema, title: 'Open this app\'s unofficial JSON Schema for the format in a new tab' },
    ];
}
</script>

<template>
  <div class="picker">
    <ul class="selected">
      <li v-if="selected.length === 0" class="none">No cores selected: STAC core and format-native fields are hidden.</li>
      <li v-for="core in selected" :key="core.id">
        <span class="marker" :class="{ square: core.layer === 'format' }" :style="{ background: colorOf(core.source) }" />
        <button
          type="button"
          class="name"
          :title="[core.description, `Click to toggle highlighting ${core.title} fields and view schema information.`].filter(Boolean).join('\n')"
          @click="emit('focus', core.source)"
        >
          {{ core.title }}
          <span class="kind"><span aria-hidden="true">{{ LAYERS[core.layer].symbol }}</span> {{ core.layer === 'standard' ? 'Standard' : 'Format' }}</span>
        </button>
        <select
          v-if="core.id === 'stac'"
          class="ver-select"
          :value="stacVersion"
          aria-label="STAC specification version"
          title="Change STAC specification version"
          @change="emit('update:stacVersion', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="v in STAC_VERSIONS" :key="v" :value="v">v{{ v }}</option>
        </select>
        <a v-for="link in links(core)" :key="link.label" :href="link.href" target="_blank" rel="noopener" class="icon text" :title="link.title">{{ link.label }}</a>
        <button type="button" class="icon" :title="`Click to hide ${core.title} fields`" :aria-label="`Remove ${core.title}`" @click="toggle(core.id)">×</button>
      </li>
    </ul>
    <p v-if="explore && modelValue.includes('stac')" class="hint">Explored documents are validated against the STAC version in their own <code>stac_version</code>.</p>

    <div class="quick-head">
      <h3>Quick select</h3>
      <button type="button" class="link" title="Click to select all cores" @click="set([...ALL_CORES])">all</button>
      <button type="button" class="link" title="Click to hide all core fields" @click="set([])">clear</button>
    </div>
    <div class="quick">
      <button
        type="button"
        class="q"
        :class="{ on: modelValue.includes('stac') }"
        :aria-pressed="modelValue.includes('stac')"
        :style="modelValue.includes('stac') ? { '--c': colorOf('core') } : undefined"
        :title="modelValue.includes('stac') ? `STAC v${stacVersion} core fields are shown.\nClick to hide STAC core fields.` : `SpatioTemporal Asset Catalog (STAC) core specification.\nClick to show STAC v${stacVersion} core fields (version can be changed in the list above).`"
        @click="toggleStac"
      >STAC</button>
      <button
        v-for="core in CORES.filter((c) => c.layer === 'format')"
        :key="core.id"
        type="button"
        class="q square"
        :class="{ on: modelValue.includes(core.id) }"
        :aria-pressed="modelValue.includes(core.id)"
        :style="modelValue.includes(core.id) ? { '--c': colorOf(core.source) } : undefined"
        :title="`${core.title}: ${core.description}\nClick to ${modelValue.includes(core.id) ? 'hide' : 'show'} ${core.title} format fields.`"
        @click="toggle(core.id)"
      >{{ core.title }}</button>
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
  background: var(--hover);
}
.none {
  color: var(--slate-500);
  font-size: 12px;
}
.marker {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.marker.square {
  border-radius: 2px;
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
.kind {
  font-size: 10px;
  color: var(--slate-600);
  background: var(--field);
  border-radius: 3px;
  padding: 0 4px;
  margin-left: 4px;
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
.hint {
  margin: 0 0 6px;
  font-size: 11px;
  color: var(--slate-500);
}
.quick-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 10px;
}
.quick-head h3 {
  margin: 0;
  font: 600 12px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--slate-600);
  flex: 1;
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
  margin-top: 4px;
}
.q {
  --c: var(--slate-400);
  font: 500 12px var(--sans);
  padding: 3px 8px;
  border-radius: 999px;
  border: 0;
  background: var(--field);
  color: var(--slate-600);
  cursor: pointer;
}
.q:hover {
  background: var(--slate-200);
}
.q.square {
  border-radius: 4px;
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
