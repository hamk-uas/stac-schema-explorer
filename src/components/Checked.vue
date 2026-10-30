<script setup lang="ts">
import { computed } from 'vue';

import { isStale, monthsSince, STALE_MONTHS } from '../lib/layers';

/**
 * How current our information is: when it was checked, the latest release then, and (when looked up) a newer release
 * since. `version` is the version our information describes, for specifications that we document one version of.
 */
const props = defineProps<{ date: string; latest?: string; version?: string; source?: string; note?: string; live?: string }>();

const months = computed(() => monthsSince(props.date));
const stale = computed(() => isStale(props.date));
const behind = computed(() => !!props.version && !!props.latest && props.version.replace(/^v/, '') !== props.latest.replace(/^v/, ''));
const newer = computed(() => !!props.live && props.live !== props.latest);
</script>

<template>
  <span class="checked">
    <a v-if="source" :href="source" target="_blank" rel="noopener" :title="note ?? 'Where this was checked'">checked {{ date }}</a>
    <span v-else :title="note">checked {{ date }}</span>
    <template v-if="latest">
      <span v-if="version && !behind" class="ok">· the latest release</span>
      <span v-else-if="behind" class="warn">· latest release then: {{ latest }}</span>
      <span v-else>· latest release then: {{ latest }}</span>
    </template>
    <span v-if="stale" class="warn" :title="`Checks older than ${STALE_MONTHS} months may be outdated`">· {{ months }} months ago, may be outdated</span>
    <span v-if="newer" class="warn" title="Looked up on PyPI now">· newer release now: {{ live }}</span>
    <span v-else-if="live" class="ok" title="Looked up on PyPI now">· still the latest</span>
  </span>
</template>

<style scoped>
.checked {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 11px;
  color: #64748b;
}
.checked a {
  color: inherit;
  text-decoration: underline dotted;
}
.ok {
  color: #0f766e;
}
.warn {
  color: #b45309;
  font-weight: 600;
}
</style>
