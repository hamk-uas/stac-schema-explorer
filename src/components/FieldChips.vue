<script setup lang="ts">
import { computed, ref } from 'vue';

import { colorOf, sourceLabel } from '../lib/colors';
import type { SourceInfo } from '../lib/model';
import { groupFields, type FieldGroup, type FieldView } from '../lib/tree';

const props = defineProps<{
    fields: FieldView[];
    sources: SourceInfo[];
    group: boolean;
    focus: string;
}>();

const expanded = ref(new Set<string>());
const groups = computed(() => groupFields(props.fields, props.sources));

function toggle(source: string) {
    const next = new Set(expanded.value);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    expanded.value = next;
}

const STATE_TEXT = {
    populated: 'populated',
    possible: 'allowed here, not populated',
    unexpected: 'populated, but no selected schema places it here',
};

function fieldTitle(field: FieldView): string {
    const how = field.kind === 'presence'
        ? 'the schema does not validate the value here, but its presence satisfies the extension\'s "at least one field" requirement'
        : field.kind === 'validated' ? 'validated here by the schema' : '';
    return [`${field.name}`, sourceLabel(field.source, props.sources), STATE_TEXT[field.state], how].filter(Boolean).join('\n');
}

function groupState(group: FieldGroup): string {
    if (group.fields.every((f) => f.state === 'unexpected')) return 'unexpected';
    if (group.fields.some((f) => f.state === 'populated')) return 'populated';
    if (group.fields.some((f) => f.state === 'unexpected')) return 'populated';
    return 'possible';
}

function groupTitle(group: FieldGroup): string {
    return `${sourceLabel(group.source, props.sources)}\n${group.fields.map((f) => `• ${f.name}${f.kind === 'presence' ? ' (presence only)' : ''} — ${STATE_TEXT[f.state]}`).join('\n')}\n\nClick to ${expanded.value.has(group.source) ? 'collapse' : 'expand'}.`;
}

function counts(group: FieldGroup): string {
    const populated = group.fields.filter((f) => f.state !== 'possible').length;
    return populated === group.fields.length ? '' : `${populated}/${group.fields.length}`;
}

function version(source: string): string | undefined {
    return props.sources.find((s) => s.key === source)?.version;
}

function dimmed(source: string): boolean {
    return !!props.focus && props.focus !== source;
}
</script>

<template>
  <span class="chips">
    <template v-if="group">
      <template v-for="g in groups" :key="g.source">
        <button
          type="button"
          class="chip group"
          :class="[`state-${groupState(g)}`, { presence: g.fields.every((f) => f.kind === 'presence'), dimmed: dimmed(g.source), open: expanded.has(g.source) }]"
          :style="{ '--c': colorOf(g.source) }"
          :title="groupTitle(g)"
          @click.stop="toggle(g.source)"
        >
          <span class="name">{{ g.label }}</span>
          <span v-if="counts(g)" class="count">{{ counts(g) }}</span>
          <span v-if="version(g.source)" class="ver">v{{ version(g.source) }}</span>
        </button>
        <template v-if="expanded.has(g.source)">
          <span
            v-for="f in g.fields"
            :key="f.name"
            class="chip field sub"
            :class="[`state-${f.state}`, { presence: f.kind === 'presence', dimmed: dimmed(f.source) }]"
            :style="{ '--c': colorOf(f.source) }"
            :title="fieldTitle(f)"
          >{{ f.name }}</span>
        </template>
      </template>
    </template>
    <template v-else>
      <span
        v-for="f in fields"
        :key="`${f.source}|${f.name}`"
        class="chip field"
        :class="[`state-${f.state}`, { presence: f.kind === 'presence', dimmed: dimmed(f.source) }]"
        :style="{ '--c': colorOf(f.source) }"
        :title="fieldTitle(f)"
      >
        <span class="name">{{ f.name }}</span>
        <span v-if="version(f.source)" class="ver">v{{ version(f.source) }}</span>
      </span>
    </template>
  </span>
</template>

<style scoped>
.chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  flex: 1 1 0;
  min-width: 180px;
}
.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font: 500 12px/1.2 var(--mono);
  padding: 2px 7px;
  border-radius: 999px;
  border: 1.5px solid var(--c);
  color: color-mix(in srgb, var(--c) 80%, black);
  background: color-mix(in srgb, var(--c) 12%, white);
  white-space: nowrap;
  transition: opacity 0.15s;
}
button.chip {
  cursor: pointer;
}
button.chip.open {
  background: color-mix(in srgb, var(--c) 22%, white);
}
.chip.sub {
  font-size: 11px;
  padding: 1px 6px;
  border-width: 1px;
}
.chip.presence {
  border-style: dashed;
}
.chip.state-possible {
  background: transparent;
  border-style: dotted;
  border-color: color-mix(in srgb, var(--c) 50%, white);
  color: color-mix(in srgb, var(--c) 45%, #94a3b8);
}
.chip.state-unexpected {
  border-color: #dc2626;
  background: #fef2f2;
  color: #b91c1c;
  text-decoration: underline wavy #dc2626 1px;
  text-underline-offset: 3px;
}
.chip.dimmed {
  opacity: 0.22;
}
.ver {
  font-size: 10px;
  font-weight: 400;
  opacity: 0.75;
}
.count {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--c) 25%, white);
}
</style>
