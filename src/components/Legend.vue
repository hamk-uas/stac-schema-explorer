<template>
  <ul class="legend">
    <li><span class="doc">▯ Collection</span> STAC document: a separate JSON file</li>
    <li><span class="node">◫ Zarr v3 group</span> node of metadata embedded in a data file (Zarr, netCDF, TIFF), not STAC</li>
    <li><span class="glyph">{}</span> object inside a document <span class="glyph">[{}]</span> object in an array</li>
    <li><span class="geo">properties</span> GeoJSON Feature properties of an Item</li>
    <li><span class="chip">cube:*</span> fields validated there by the schema; <code>prefix:*</code> means all fields of that prefix, otherwise they are named</li>
    <li><span class="chip presence">cube:*</span> presence only: the value is not validated there, but counts towards the extension's “use at least one field” rule</li>
    <li><span class="chip possible">cf:*</span> allowed, not populated (STAC URL view)</li>
    <li><span class="chip unexpected">foo:bar</span> populated, but no selected schema places it there</li>
  </ul>
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
  color: #475569;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.doc {
  display: inline-block;
  font: 700 11px var(--sans);
  color: #0f766e;
  border: 1px solid #e2e8f0;
  border-left: 3px solid #0d9488;
  border-radius: 4px;
  padding: 0 5px;
  background: #f0fdfa;
}
.glyph {
  font: 600 11px var(--mono);
  color: #94a3b8;
}
.node {
  display: inline-block;
  font: 700 11px var(--sans);
  color: #334155;
  border: 1px dashed #94a3b8;
  border-left: 3px solid #475569;
  border-radius: 4px;
  padding: 0 5px;
  background: #f8fafc;
}
.geo {
  font: 500 11px var(--mono);
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 4px;
  padding: 0 5px;
}
.chip {
  --c: #2563eb;
  display: inline-block;
  font: 500 11px var(--mono);
  padding: 0 6px;
  border-radius: 999px;
  border: 1.5px solid var(--c);
  color: color-mix(in srgb, var(--c) 80%, black);
  background: color-mix(in srgb, var(--c) 12%, white);
}
.chip.presence {
  border-style: dashed;
}
.chip.possible {
  background: transparent;
  border-style: dotted;
  border-color: color-mix(in srgb, var(--c) 50%, white);
  color: color-mix(in srgb, var(--c) 45%, #94a3b8);
}
.chip.unexpected {
  border-color: #dc2626;
  background: #fef2f2;
  color: #b91c1c;
  text-decoration: underline wavy #dc2626 1px;
}
.note {
  font-size: 11px;
  color: #94a3b8;
  margin: 8px 0 0;
}
</style>
