<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { JsonObject } from '../lib/model';
import type { FieldView } from '../lib/tree';
import JsonNode from './JsonNode.vue';

const props = defineProps<{
    doc: JsonObject | undefined;
    title: string;
    href?: string;
    index: Map<string, FieldView>;
    pointers: string[];
}>();

const container = ref<HTMLElement>();
const highlighted = computed(() => new Set(props.pointers.filter((p) => p !== '')));
const copied = ref(false);

async function copy() {
    if (!props.doc) return;
    await navigator.clipboard.writeText(JSON.stringify(props.doc, null, 2));
    copied.value = true;
    setTimeout(() => (copied.value = false), 1200);
}

function download() {
    if (!props.doc) return;
    const blob = new Blob([JSON.stringify(props.doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${String(props.doc.id ?? 'stac')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

watch(() => [props.pointers, props.doc], async () => {
    await nextTick();
    const first = props.pointers.find((p) => p !== '');
    const target = first !== undefined ? container.value?.querySelector(`[data-pointer="${CSS.escape(first)}"]`) : undefined;
    if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else if (container.value) container.value.scrollTop = 0;
}, { immediate: true });
</script>

<template>
  <section class="json-panel">
    <div class="bar">
      <strong class="title" :title="title">{{ title }}</strong>
      <span class="spacer" />
      <a v-if="href" :href="href" target="_blank" rel="noopener">open ↗</a>
      <button type="button" :disabled="!doc" @click="copy">{{ copied ? 'copied' : 'copy' }}</button>
      <button type="button" :disabled="!doc" @click="download">download</button>
    </div>
    <div ref="container" class="scroll">
      <JsonNode
        v-if="doc"
        :value="doc"
        pointer=""
        parent=""
        :index="index"
        :highlighted="highlighted"
        :depth="0"
        :last="true"
      />
      <p v-else class="empty">Select a document in the tree.</p>
    </div>
  </section>
</template>

<style scoped>
.json-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: #fcfcfd;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #e2e8f0;
  background: white;
  font-size: 12px;
}
.title {
  font: 600 13px var(--sans);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.bar button {
  font-size: 12px;
  border: 1px solid #cbd5e1;
  background: white;
  border-radius: 5px;
  padding: 2px 8px;
  cursor: pointer;
}
.scroll {
  overflow: auto;
  padding: 10px 14px 40px;
  flex: 1;
  min-height: 0;
}
.empty {
  color: #94a3b8;
}
</style>
