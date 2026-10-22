<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * Vertical drag handle resizing one neighbouring pane. `direction` is 1 when the pane is on the left
 * (dragging right grows it) and -1 when it is on the right. `undefined` means the layout's default width.
 */
const props = defineProps<{
    modelValue: number | undefined;
    measure: () => number;
    min: number;
    max: () => number;
    direction: 1 | -1;
    label: string;
    controls?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: number | undefined] }>();

const dragging = ref(false);
let startX = 0;
let startSize = 0;

const current = computed(() => Math.round(props.modelValue ?? props.measure()));

function clamp(size: number): number {
    return Math.round(Math.min(Math.max(size, props.min), Math.max(props.min, props.max())));
}

function down(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    startX = event.clientX;
    startSize = props.measure();
    dragging.value = true;
    document.body.classList.add('resizing-panes');
}

function move(event: PointerEvent) {
    if (!dragging.value) return;
    emit('update:modelValue', clamp(startSize + props.direction * (event.clientX - startX)));
}

function up(event: PointerEvent) {
    if (!dragging.value) return;
    dragging.value = false;
    document.body.classList.remove('resizing-panes');
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
}

function key(event: KeyboardEvent) {
    const step = event.shiftKey ? 64 : 16;
    const size = props.measure();
    let next: number | undefined;
    if (event.key === 'ArrowLeft') next = size - props.direction * step;
    else if (event.key === 'ArrowRight') next = size + props.direction * step;
    else if (event.key === 'Home') next = props.min;
    else if (event.key === 'End') next = props.max();
    else if (event.key === 'Enter') {
        event.preventDefault();
        emit('update:modelValue', undefined);
        return;
    } else return;
    event.preventDefault();
    emit('update:modelValue', clamp(next));
}
</script>

<template>
  <div
    class="splitter"
    :class="{ dragging }"
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
    :aria-label="label"
    :aria-controls="controls"
    :aria-valuenow="current"
    :aria-valuemin="min"
    :aria-valuemax="Math.round(max())"
    :title="`${label}: drag or use the arrow keys to resize, double-click or Enter to reset`"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @dblclick="emit('update:modelValue', undefined)"
    @keydown="key"
  />
</template>

<style scoped>
.splitter {
  position: relative;
  z-index: 2;
  width: 9px;
  cursor: col-resize;
  touch-action: none;
}
.splitter::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: transparent;
  transition: background-color 0.15s;
}
.splitter:hover::after,
.splitter.dragging::after {
  background: #a5b4fc;
}
.splitter:focus-visible {
  outline: none;
}
.splitter:focus-visible::after {
  background: #4f46e5;
}
@media (prefers-reduced-motion: reduce) {
  .splitter::after {
    transition: none;
  }
}
</style>
