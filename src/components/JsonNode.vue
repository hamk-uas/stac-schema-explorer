<script setup lang="ts">
import { computed, ref } from 'vue';

import { colorOf } from '../lib/colors';
import { fieldTitle, propertyTitle } from '../lib/field-tooltip';
import type { Json, ObjectDoc, SourceInfo } from '../lib/model';
import { joinPointer } from '../lib/pointer';
import type { FieldView } from '../lib/tree';

defineOptions({ name: 'JsonNode' });

const props = defineProps<{
    value: Json;
    pointer: string;
    parent: string;
    name?: string | number;
    index: Map<string, FieldView>;
    sources: SourceInfo[];
    highlighted: Set<string>;
    depth: number;
    last: boolean;
    /** Nested object shapes of the enclosing field or property, for tooltips on its keys. */
    objectDocs?: ObjectDoc[];
    /** True when the enclosing object is a map of arbitrary keys whose values follow `objectDocs`. */
    mapValues?: boolean;
}>();

const emit = defineEmits<{
    field: [source: string, name: string, parent: string];
}>();

const isArray = computed(() => Array.isArray(props.value));
const isObject = computed(() => props.value !== null && typeof props.value === 'object' && !isArray.value);
const entries = computed((): [string | number, Json][] => {
    if (Array.isArray(props.value)) return props.value.map((v, i) => [i, v]);
    if (isObject.value) return Object.entries(props.value as Record<string, Json>);
    return [];
});
const collapsed = ref(Array.isArray(props.value) && props.value.length > 30);
const field = computed(() => (typeof props.name === 'string' ? props.index.get(`${props.parent}|${props.name}`) : undefined));
const fieldDoc = computed(() => (field.value ? props.sources.find((s) => s.key === field.value!.source)?.docs[field.value!.name] : undefined));
const propDoc = computed(() => {
    if (field.value || props.mapValues || typeof props.name !== 'string' || !props.objectDocs?.length) return undefined;
    for (const obj of props.objectDocs) {
        const match = obj.properties.find((p) => p.name === props.name);
        if (match) return match;
    }
    return undefined;
});
const keyTitle = computed(() => {
    if (field.value) return fieldTitle(field.value, props.sources);
    if (propDoc.value) return propertyTitle(propDoc.value);
    return undefined;
});
const childObjectDocs = computed((): ObjectDoc[] | undefined => {
    if (field.value) return fieldDoc.value?.objects;
    if (propDoc.value) return propDoc.value.objects;
    if (isArray.value || props.mapValues) return props.objectDocs;
    return undefined;
});
const childMapValues = computed((): boolean => {
    if (field.value) return !!fieldDoc.value?.isMap;
    if (propDoc.value) return !!propDoc.value.isMap;
    return false;
});
const keyStyle = computed(() => (field.value ? { '--c': colorOf(field.value.source) } : undefined));
const open = computed(() => (isArray.value ? '[' : '{'));
const close = computed(() => (isArray.value ? ']' : '}'));
const primitive = computed(() => JSON.stringify(props.value));
const primitiveClass = computed(() => (props.value === null ? 'null' : typeof props.value));
/** Indentation is text rather than CSS padding so that copied selections stay valid JSON. */
const indent = computed(() => '  '.repeat(props.depth));

function onKeyClick() {
    if (!field.value || window.getSelection()?.toString()) return;
    emit('field', field.value.source, field.value.name, props.parent);
}
</script>

<template>
  <div class="node" :class="{ hl: highlighted.has(pointer) }" :data-pointer="pointer">
    <span v-if="depth > 0" class="indent">{{ indent }}</span><span v-if="name !== undefined && typeof name === 'string'" class="key" :class="field ? ['field', `state-${field.state}`] : propDoc ? ['prop'] : []" :style="keyStyle" :title="keyTitle" @click="onKeyClick">"{{ name }}"</span><span v-if="typeof name === 'string'" class="punct">: </span>
    <template v-if="isArray || isObject">
      <span class="punct toggle" @click="collapsed = !collapsed">{{ open }}</span>
      <template v-if="collapsed || entries.length === 0">
        <span v-if="entries.length" class="ellipsis" @click="collapsed = false">… {{ entries.length }} {{ isArray ? 'items' : 'keys' }}</span><span class="punct">{{ close }}</span><span v-if="!last" class="punct">,</span>
      </template>
      <template v-else>
        <div class="children">
          <JsonNode
            v-for="([k, v], i) in entries"
            :key="String(k)"
            :value="v"
            :pointer="joinPointer(pointer, k)"
            :parent="pointer"
            :name="k"
            :index="index"
            :sources="sources"
            :highlighted="highlighted"
            :depth="depth + 1"
            :last="i === entries.length - 1"
            :object-docs="childObjectDocs"
            :map-values="childMapValues"
            @field="(s: string, n: string, p: string) => emit('field', s, n, p)"
          />
        </div>
        <span v-if="depth > 0" class="indent">{{ indent }}</span><span class="punct">{{ close }}</span><span v-if="!last" class="punct">,</span>
      </template>
    </template>
    <template v-else>
      <span class="prim" :class="primitiveClass">{{ primitive }}</span><span v-if="!last" class="punct">,</span>
    </template>
  </div>
</template>

<style scoped>
.node {
  font: 12px/1.55 var(--mono);
  white-space: pre-wrap;
  word-break: break-word;
}
.indent {
  white-space: pre;
}
.hl {
  background: var(--indigo-50);
  border-radius: 3px;
}
.key {
  color: var(--slate-900);
}
.key.field {
  color: color-mix(in srgb, var(--c) 85%, var(--ink));
  background: color-mix(in srgb, var(--c) 14%, var(--white));
  border-radius: 3px;
  padding: 0 2px;
  font-weight: 600;
  cursor: pointer;
}
.key.field:hover {
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--c) 35%, transparent);
}
.key.prop {
  text-decoration: underline dotted var(--slate-300) 1px;
  text-underline-offset: 2px;
}
.key.field.state-unexpected {
  background: var(--red-100);
  color: var(--red-700);
  text-decoration: underline wavy var(--red-600) 1px;
}
.punct {
  color: var(--slate-400);
}
.toggle {
  cursor: pointer;
}
.ellipsis {
  color: var(--indigo-500);
  cursor: pointer;
  font-style: italic;
  padding: 0 4px;
}
.prim.string {
  color: var(--emerald-700);
}
.prim.number {
  color: var(--amber-700);
}
.prim.boolean,
.prim.null {
  color: var(--violet-600);
}
</style>
