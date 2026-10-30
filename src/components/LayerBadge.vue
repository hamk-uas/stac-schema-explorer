<script setup lang="ts">
import { LAYERS, type Layer } from '../lib/layers';

/** The layer something belongs to: a symbol with its name, so that the symbol is never the only cue. */
const props = defineProps<{ layer: Layer; label?: string }>();
</script>

<template>
  <span class="layer" :class="props.layer" :title="`${LAYERS[props.layer].title}: ${LAYERS[props.layer].about}`">
    <span class="symbol" aria-hidden="true">{{ LAYERS[props.layer].symbol }}</span>
    <span>{{ props.label ?? LAYERS[props.layer].title }}</span>
  </span>
</template>

<style scoped>
.layer {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font: 600 10px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #475569;
  background: #f1f5f9;
  border-radius: 4px;
  padding: 1px 5px;
  white-space: nowrap;
}
.symbol {
  font-size: 11px;
  text-transform: none;
  letter-spacing: 0;
}
</style>
