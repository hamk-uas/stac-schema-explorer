<script setup lang="ts">
import { computed, ref } from 'vue';

import { colorOf } from '../lib/colors';
import type { Json } from '../lib/model';
import { joinPointer } from '../lib/pointer';
import type { FieldView } from '../lib/tree';

defineOptions({ name: 'JsonNode' });

const props = defineProps<{
    value: Json;
    pointer: string;
    parent: string;
    name?: string | number;
    index: Map<string, FieldView>;
    highlighted: Set<string>;
    depth: number;
    last: boolean;
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
const keyStyle = computed(() => (field.value ? { '--c': colorOf(field.value.source) } : undefined));
const open = computed(() => (isArray.value ? '[' : '{'));
const close = computed(() => (isArray.value ? ']' : '}'));
const primitive = computed(() => JSON.stringify(props.value));
const primitiveClass = computed(() => (props.value === null ? 'null' : typeof props.value));
</script>

<template>
  <div class="node" :class="{ hl: highlighted.has(pointer) }" :data-pointer="pointer">
    <span v-if="name !== undefined && typeof name === 'string'" class="key" :class="field ? [`field`, `state-${field.state}`] : []" :style="keyStyle">"{{ name }}"</span><span v-if="typeof name === 'string'" class="punct">: </span>
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
            :highlighted="highlighted"
            :depth="depth + 1"
            :last="i === entries.length - 1"
          />
        </div>
        <span class="punct">{{ close }}</span><span v-if="!last" class="punct">,</span>
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
.children {
  padding-left: 16px;
  border-left: 1px dotted var(--slate-200);
}
.hl {
  background: var(--indigo-50);
  outline: 1px solid var(--indigo-200);
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
