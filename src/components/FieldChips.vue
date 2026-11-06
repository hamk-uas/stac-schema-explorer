<script setup lang="ts">
import { computed, ref } from 'vue';

import { colorOf, sourceLabel, versionLabel } from '../lib/colors';
import type { SourceInfo } from '../lib/model';
import { requirementText } from '../lib/requirement';
import { groupFields, type FieldGroup, type FieldView } from '../lib/tree';

const props = defineProps<{
    fields: FieldView[];
    sources: SourceInfo[];
    group: boolean;
    focus: string;
    /** Fields of a real document can be rewritten: added, removed, or their rewrite undone. */
    editable?: boolean;
}>();
const emit = defineEmits<{
    field: [source: string, name: string];
    /** A chip of several fields of one source was clicked (to list them). */
    group: [source: string, names: string[]];
    /** Add, remove, or undo the rewrite of a field. */
    edit: [field: FieldView];
}>();

const expanded = ref(new Set<string>());
const groups = computed(() => groupFields(props.fields, props.sources));

function toggle(group: FieldGroup) {
    if (group.fields.length === 1) return emit('field', group.source, group.fields[0].name);
    const source = group.source;
    const next = new Set(expanded.value);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    expanded.value = next;
    emit('group', source, group.fields.map((f) => f.name));
}

const STATE_TEXT = {
    populated: 'populated',
    possible: 'allowed here, not populated',
    unexpected: 'populated, but no selected or declared schema places it here',
};

function fieldTitle(field: FieldView): string {
    const how = field.kind === 'presence'
        ? 'the schema does not validate the value here, but its presence satisfies the extension\'s "at least one field" requirement'
        : field.kind === 'validated' ? 'validated here by the schema' : '';
    // Placed fields (with a kind) are required or optional where they are placed.
    const need = field.kind ? requirementText(field.required, true) : '';
    const doc = docOf(field);
    const about = doc ? [`${doc.title ?? ''}${doc.title ? ' — ' : ''}${doc.type}`, firstSentence(doc.description)] : [];
    const state = field.edit ? EDIT_TEXT[field.edit] : STATE_TEXT[field.state];
    return [field.name, ...about, '', sourceLabel(field.source, props.sources), state, ...(need ? [need] : []), how, '', 'Click for details.']
        .filter((line, i, all) => line !== undefined && !(line === '' && all[i - 1] === ''))
        .join('\n');
}

/** The marker of a required field: `*` always, `(*)` when a condition holds. */
function requiredMark(field: FieldView): string {
    if (!field.required) return '';
    return field.required.when === undefined ? '*' : '(*)';
}

/** A field button's name for assistive technology, which does not hear the marker. */
function pickLabel(field: FieldView): string {
    return field.required ? `${field.name}, ${requirementText(field.required, true)}` : field.name;
}

const EDIT_TEXT = { added: 'added by a rewrite (example value)', removed: 'removed by a rewrite' };

/** The edit button of a field: add an absent field, remove a present one, or undo its rewrite. */
function editAction(field: FieldView): { symbol: string; label: string } {
    if (field.edit === 'added') return { symbol: '×', label: `Undo adding ${field.name}` };
    if (field.edit === 'removed') return { symbol: '+', label: `Restore ${field.name}` };
    if (field.state === 'possible') return { symbol: '+', label: `Add ${field.name} with an example value (rewrite)` };
    return { symbol: '−', label: `Remove ${field.name} (rewrite)` };
}

function docOf(field: FieldView) {
    return props.sources.find((s) => s.key === field.source)?.docs[field.name];
}

function firstSentence(text: string | undefined): string | undefined {
    if (!text) return undefined;
    const end = text.search(/\.\s/);
    if (end > 0 && end < 200) return text.slice(0, end + 1);
    return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

function groupState(group: FieldGroup): string {
    if (group.fields.every((f) => f.state === 'unexpected')) return 'unexpected';
    if (group.fields.some((f) => f.state === 'populated')) return 'populated';
    if (group.fields.some((f) => f.state === 'unexpected')) return 'populated';
    return 'possible';
}

function groupTitle(group: FieldGroup): string {
    if (group.fields.length === 1) return fieldTitle(group.fields[0]);
    const lines = group.fields.map((f) => {
        const title = docOf(f)?.title;
        return `• ${f.name}${title ? ` (${title})` : ''}${f.kind === 'presence' ? ', presence only' : ''}${f.required ? `, ${requirementText(f.required)}` : ''} — ${f.edit ? EDIT_TEXT[f.edit] : STATE_TEXT[f.state]}`;
    });
    return `${sourceLabel(group.source, props.sources)}\n${lines.join('\n')}\n\nClick to ${expanded.value.has(group.source) ? 'collapse' : 'list the fields'}.`;
}

function counts(group: FieldGroup): string {
    const populated = group.fields.filter((f) => f.state !== 'possible').length;
    return populated === group.fields.length ? '' : `${populated}/${group.fields.length}`;
}

/** The version shown after a source's name (see versionLabel). */
function version(source: string): string | undefined {
    const value = props.sources.find((s) => s.key === source)?.version;
    return value ? versionLabel(value) : undefined;
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
          :class="[`state-${groupState(g)}`, { presence: g.fields.every((f) => f.kind === 'presence'), dimmed: dimmed(g.source), open: expanded.has(g.source), edited: g.fields.some((f) => f.edit) }]"
          :style="{ '--c': colorOf(g.source) }"
          :title="groupTitle(g)"
          @click.stop="toggle(g)"
        >
          <span class="name">{{ g.label }}</span>
          <span v-if="counts(g)" class="count">{{ counts(g) }}</span>
          <span v-if="version(g.source)" class="ver">{{ version(g.source) }}</span>
        </button>
        <template v-if="expanded.has(g.source)">
          <span
            v-for="f in g.fields"
            :key="f.name"
            class="chip field sub"
            :class="[`state-${f.state}`, f.edit ? `edit-${f.edit}` : '', { presence: f.kind === 'presence', dimmed: dimmed(f.source) }]"
            :style="{ '--c': colorOf(f.source) }"
          >
            <button type="button" class="pick" :title="fieldTitle(f)" :aria-label="pickLabel(f)" @click.stop="emit('field', f.source, f.name)">{{ f.name }}<span v-if="requiredMark(f)" class="req" aria-hidden="true">{{ requiredMark(f) }}</span></button>
            <button v-if="editable" type="button" class="edit" :title="editAction(f).label" :aria-label="editAction(f).label" @click.stop="emit('edit', f)">{{ editAction(f).symbol }}</button>
          </span>
        </template>
      </template>
    </template>
    <template v-else>
      <span
        v-for="f in fields"
        :key="`${f.source}|${f.name}`"
        class="chip field"
        :class="[`state-${f.state}`, f.edit ? `edit-${f.edit}` : '', { presence: f.kind === 'presence', dimmed: dimmed(f.source) }]"
        :style="{ '--c': colorOf(f.source) }"
      >
        <button type="button" class="pick" :title="fieldTitle(f)" :aria-label="pickLabel(f)" @click.stop="emit('field', f.source, f.name)">
          <span class="name">{{ f.name }}</span>
          <span v-if="requiredMark(f)" class="req" aria-hidden="true">{{ requiredMark(f) }}</span>
          <span v-if="version(f.source)" class="ver">{{ version(f.source) }}</span>
        </button>
        <button v-if="editable" type="button" class="edit" :title="editAction(f).label" :aria-label="editAction(f).label" @click.stop="emit('edit', f)">{{ editAction(f).symbol }}</button>
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
  border: 1.5px solid color-mix(in srgb, var(--c) var(--edge), transparent);
  color: color-mix(in srgb, var(--c) 80%, var(--ink));
  background: color-mix(in srgb, var(--c) 12%, var(--white));
  white-space: nowrap;
  transition: opacity 0.15s;
}
button.chip {
  cursor: pointer;
}
button.chip:hover,
.chip.field:hover {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 25%, transparent);
}
.chip .pick {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  color: inherit;
  text-decoration: inherit;
  cursor: pointer;
  min-width: 0;
}
.chip .edit {
  border: 0;
  border-left: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
  background: none;
  margin-left: 1px;
  padding: 0 0 0 5px;
  font: 700 12px/1 var(--sans);
  color: inherit;
  cursor: pointer;
}
.chip .edit:hover {
  color: var(--amber-700);
}
/* Rewritten fields: amber, the colour of caution, and a removed field struck through. */
.chip.edit-added,
.chip.edit-removed,
button.chip.edited {
  outline: 2px solid var(--amber-500);
  outline-offset: 1px;
}
.chip.edit-removed {
  outline-style: dashed;
}
.chip.edit-removed .pick {
  text-decoration: line-through;
  text-decoration-color: var(--amber-700);
}
button.chip.open {
  background: color-mix(in srgb, var(--c) 22%, var(--white));
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
  border-color: color-mix(in srgb, var(--c) calc(var(--edge) * 0.6), transparent);
  color: color-mix(in srgb, var(--c) 45%, var(--slate-400));
}
.chip.state-unexpected {
  border-color: var(--red-600);
  background: var(--red-50);
  color: var(--red-700);
  text-decoration: underline wavy var(--red-600) 1px;
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
/* Required here: `*` always, `(*)` when a condition holds. */
.req {
  margin-left: 1px;
  font-weight: 700;
}
.count {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--c) 25%, var(--white));
}
</style>
