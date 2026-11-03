<script setup lang="ts">
import { LAYERS, STALE_MONTHS } from '../lib/layers';
</script>

<template>
  <ul class="legend">
    <li><span class="doc">▯ Collection</span> STAC document: a separate JSON file</li>
    <li><span class="node">◫ Zarr v3 group</span> node of metadata embedded in a data file (Zarr, netCDF, TIFF), not STAC</li>
    <li><span class="glyph">{}</span> object inside a document <span class="glyph">[{}]</span> object in an array</li>
    <li><span class="geo">properties</span> GeoJSON Feature properties of an Item</li>
    <li><span class="chip">cube:*</span> fields validated there by the schema; <code>prefix:*</code> means all fields of that prefix, otherwise they are named</li>
    <li><span class="chip presence">cube:*</span> presence only: the value is not validated there, but counts towards the extension's “use at least one field” rule</li>
    <li><span class="chip possible">cf:*</span> allowed, not populated (explored URLs)</li>
    <li><span class="chip unexpected">foo:bar</span> populated, but no selected or declared schema places it there (declared: in <code>stac_extensions</code>, <code>zarr_conventions</code> or <code>Conventions</code>)</li>
    <li><span class="chip added">cube:dimensions ×</span> <span class="chip possible removed">sci:doi +</span> added or removed by a rewrite (explored URLs: + adds, − removes, × undoes)</li>
  </ul>
  <h3 class="layers-title">Layers</h3>
  <p class="note">Field and schema information say in which layer something is defined, contained, read or written:</p>
  <ul class="legend">
    <li v-for="(layer, key) in LAYERS" :key="key"><span class="layer-symbol" aria-hidden="true">{{ layer.symbol }}</span> <strong>{{ layer.title }}</strong>: {{ layer.about }}</li>
  </ul>
  <p class="note">
    Each says when we checked it and the latest release then; checks older than {{ STALE_MONTHS }} months are flagged as
    possibly outdated, and the latest releases of Python packages are looked up on PyPI.
  </p>
  <p class="note">
    Click a field to see its meaning, type and allowed values, a field group to list its fields, an object to highlight it
    in the JSON, an extension name to highlight its fields everywhere.
  </p>
</template>

<style scoped>
.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 12px;
  color: var(--slate-600);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.doc {
  display: inline-block;
  font: 700 11px var(--sans);
  color: var(--teal-700);
  border-radius: 4px;
  padding: 0 5px;
  background: var(--layer);
}
.glyph {
  font: 600 11px var(--mono);
  color: var(--slate-400);
}
.node {
  display: inline-block;
  font: 700 11px var(--sans);
  color: var(--slate-700);
  border-radius: 4px;
  padding: 0 5px;
  background: var(--layer);
}
.geo {
  font: 500 11px var(--mono);
  background: color-mix(in srgb, var(--green-100) 60%, transparent);
  border-radius: 4px;
  padding: 0 5px;
}
.chip {
  --c: var(--blue-600);
  display: inline-block;
  font: 500 11px var(--mono);
  padding: 0 6px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, var(--c) var(--edge), transparent);
  color: color-mix(in srgb, var(--c) 80%, var(--ink));
  background: color-mix(in srgb, var(--c) 12%, var(--white));
}
.chip.presence {
  border-style: dashed;
}
.chip.possible {
  background: transparent;
  border-style: dotted;
  border-color: color-mix(in srgb, var(--c) calc(var(--edge) * 0.6), transparent);
  color: color-mix(in srgb, var(--c) 45%, var(--slate-400));
}
.chip.unexpected {
  border-color: var(--red-600);
  background: var(--red-50);
  color: var(--red-700);
  text-decoration: underline wavy var(--red-600) 1px;
}
.chip.added,
.chip.removed {
  outline: 2px solid var(--amber-500);
  outline-offset: 1px;
  margin: 2px 2px 2px 0;
}
.chip.removed {
  outline-style: dashed;
  text-decoration: line-through var(--amber-700);
}
.note {
  font-size: 11px;
  color: var(--slate-400);
  margin: 8px 0 0;
}
.layers-title {
  margin: 12px 0 0;
  font: 600 11px var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--slate-600);
}
.layer-symbol {
  display: inline-block;
  width: 1.3em;
}
</style>
