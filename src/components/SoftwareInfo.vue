<script setup lang="ts">
import { DATA_FORMATS } from '../lib/conventions';
import type { PrecedenceUse, SoftwareSupport, SoftwareUse } from '../lib/software';

/** Which software reads or writes a field or schema, and, for a field, which source each program prefers. */
defineProps<{
    uses: SoftwareUse[];
    precedence?: PrecedenceUse[];
}>();

const READ = { interpret: 'interprets', 'pass-through': 'keeps as metadata' } as const;
const WRITE = { write: 'writes', 'pass-through': 'writes as given' } as const;
const formatTitle = (id: string) => DATA_FORMATS.find((f) => f.id === id)?.title ?? id;

function where(support: SoftwareSupport): string {
    return support.formats ? `in ${support.formats.map(formatTitle).join(', ')}` : '';
}
</script>

<template>
  <div v-if="uses.length" class="software">
    <span class="label">Software</span>
    <ul>
      <li v-for="use in uses" :key="use.software.id">
        <a class="name" :href="use.software.url" target="_blank" rel="noopener" :title="use.software.description">{{ use.software.title }}</a>
        <span v-for="(support, i) in use.supports" :key="i" class="support">
          <span v-if="support.read" class="level" :class="support.read">{{ READ[support.read] }}</span>
          <span v-if="support.write" class="level" :class="support.write === 'write' ? 'writes' : 'pass-through'">{{ WRITE[support.write] }}</span>
          <span v-if="support.since" class="since">since {{ support.since }}</span>
          <span v-if="where(support)" class="since">{{ where(support) }}</span>
          <span v-if="support.note" class="note">{{ support.note }}</span>
          <a class="source" :href="support.source" target="_blank" rel="noopener" title="Where this is documented">source ↗</a>
        </span>
        <span v-if="use.through.length" class="through">likewise, built on it: {{ use.through.map((s) => s.title).join(', ') }}</span>
      </li>
    </ul>
  </div>
  <div v-if="precedence?.length" class="precedence">
    <span class="label">When sources say the same thing</span>
    <ul>
      <li v-for="(p, i) in precedence" :key="i">
        <strong>{{ p.software.title }}</strong> — {{ p.rule.topic }}<span v-if="p.step < 0" class="ignored">: ignores this field</span>
        <ol>
          <li v-for="(step, j) in p.rule.order" :key="j" :class="{ here: j === p.step }">{{ step.label }}<span v-if="j === p.step" class="mark"> ← this field</span></li>
        </ol>
        <p v-if="p.rule.ignores?.length" class="detail">Ignores {{ p.rule.ignores.map((s) => s.label).join('; ') }}.</p>
        <p v-if="p.rule.missing" class="detail">When none is present: {{ p.rule.missing }}</p>
        <p v-if="p.rule.note" class="detail">{{ p.rule.note }}</p>
        <a class="source" :href="p.rule.source" target="_blank" rel="noopener">source ↗</a>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.software,
.precedence {
  margin-top: 10px;
}
.label {
  font: 600 11px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}
ul {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
  display: grid;
  gap: 6px;
}
li {
  font-size: 12px;
  color: #334155;
}
.name {
  font-weight: 600;
  color: #4f46e5;
  margin-right: 6px;
}
.support {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px;
  margin-right: 8px;
}
.support + .support {
  display: flex;
  margin: 2px 0 0 12px;
}
.level {
  font: 600 10px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
  padding: 0 5px;
  color: #475569;
  background: #f1f5f9;
}
.level.interpret {
  color: #0f766e;
  background: #ccfbf1;
}
.level.writes {
  color: #3730a3;
  background: #e0e7ff;
}
.since {
  font-size: 11px;
  color: #64748b;
}
.note,
.through,
.detail {
  color: #475569;
}
.through {
  display: block;
  margin-left: 12px;
  font-size: 11px;
}
.source {
  font-size: 11px;
  color: #4f46e5;
}
ol {
  margin: 2px 0 2px 18px;
  padding: 0;
}
ol li.here {
  font-weight: 600;
}
.mark {
  font-weight: 400;
  color: #0f766e;
}
.ignored {
  color: #b45309;
  font-weight: 600;
}
.detail {
  margin: 2px 0;
}
</style>
