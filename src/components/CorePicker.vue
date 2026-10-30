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

/** STAC is shown in one version at a time: choosing a version selects STAC, choosing the shown one deselects it. */
function pickStac(version: string) {
    const shown = props.modelValue.includes('stac') && props.stacVersion === version;
    if (shown) return set(props.modelValue.filter((c) => c !== 'stac'));
    emit('update:stacVersion', version);
    if (!props.modelValue.includes('stac')) set([...props.modelValue, 'stac']);
}

function links(core: Core): { label: string; href: string; title: string }[] {
    if (core.id === 'stac') {
        return [{ label: 'spec ↗', href: `https://github.com/radiantearth/stac-spec/tree/v${props.stacVersion}`, title: `STAC specification ${props.stacVersion}` }];
    }
    const format = DATA_FORMATS.find((f) => f.id === core.id)!;
    return [
        { label: 'spec ↗', href: format.specification, title: `${format.title} specification` },
        { label: 'schema ↗', href: format.schema, title: 'Unofficial JSON Schema of the format, authored by this app' },
    ];
}
</script>

<template>
  <div class="picker">
    <ul class="selected">
      <li v-if="selected.length === 0" class="none">No cores: STAC core and data format fields are hidden.</li>
      <li v-for="core in selected" :key="core.id">
        <span class="marker" :class="{ square: core.layer === 'format' }" :style="{ background: colorOf(core.source) }" />
        <button type="button" class="name" :title="`Highlight ${core.title} fields\n${core.description}`" @click="emit('focus', core.source)">
          {{ core.title }}
          <span v-if="core.id === 'stac'" class="ver">{{ stacVersion }}</span>
          <span class="kind"><span aria-hidden="true">{{ LAYERS[core.layer].symbol }}</span> {{ core.layer === 'standard' ? 'Standard' : 'Format' }}</span>
        </button>
        <a v-for="link in links(core)" :key="link.label" :href="link.href" target="_blank" rel="noopener" class="icon text" :title="link.title">{{ link.label }}</a>
        <button type="button" class="icon" :title="`Hide ${core.title} fields`" :aria-label="`Remove ${core.title}`" @click="toggle(core.id)">×</button>
      </li>
    </ul>
    <p v-if="explore && modelValue.includes('stac')" class="hint">Explored documents are compared with the STAC version of their own <code>stac_version</code>.</p>

    <div class="quick-head">
      <h3>Quick select</h3>
      <button type="button" class="link" @click="set([...ALL_CORES])">all</button>
      <button type="button" class="link" @click="set([])">clear</button>
    </div>
    <div class="quick">
      <button
        v-for="v in STAC_VERSIONS"
        :key="v"
        type="button"
        class="q"
        :class="{ on: modelValue.includes('stac') && stacVersion === v }"
        :aria-pressed="modelValue.includes('stac') && stacVersion === v"
        :style="modelValue.includes('stac') && stacVersion === v ? { '--c': colorOf('core') } : undefined"
        :title="`STAC ${v}: show the fields of the STAC specification, in the example of version ${v}`"
        @click="pickStac(v)"
      >STAC<span class="ver">{{ v }}</span></button>
      <button
        v-for="core in CORES.filter((c) => c.layer === 'format')"
        :key="core.id"
        type="button"
        class="q square"
        :class="{ on: modelValue.includes(core.id) }"
        :aria-pressed="modelValue.includes(core.id)"
        :style="modelValue.includes(core.id) ? { '--c': colorOf(core.source) } : undefined"
        :title="`${core.title}: ${core.description}`"
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
  background: #f1f5f9;
}
.none {
  color: #64748b;
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
.kind {
  font-size: 10px;
  color: #475569;
  background: #f1f5f9;
  border-radius: 3px;
  padding: 0 4px;
  margin-left: 4px;
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
.hint {
  margin: 0 0 6px;
  font-size: 11px;
  color: #64748b;
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
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
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
.q.square {
  border-radius: 4px;
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
