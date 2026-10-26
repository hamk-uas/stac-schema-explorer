# STAC Schema Explorer

A web app for understanding [SpatioTemporal Asset Catalog (STAC)](https://stacspec.org) core spec and STAC extensions:
**where in the STAC hierarchy, and where within each STAC object, can each field go?** And, for the metadata embedded in
the data files of assets (Zarr, netCDF, TIFF): which fields do their formats and conventions define, where do they go,
and which STAC fields carry the same information?

Live app: <https://hamk-uas.github.io/stac-schema-explorer/>

Reading extension JSON Schemas by hand to find out, say, whether `cf:cell_methods` may appear in an asset, in a band,
in a `cube:variables` entry or in Collection `summaries` is slow and error-prone. This app answers the question by
asking the schemas themselves.

## Views

- **Example catalog**: a conceptual catalog tree (Catalog → sub-catalog, Collection → Item) showing the *extreme case*:
  every field of the selected schemas placed everywhere the schemas allow it. Separate JSON documents are cards,
  objects inside a document are indented rows (`{}` objects, `[{}]` objects in arrays), Item `properties` are a green
  GeoJSON box, and fields are chips coloured by extension. Click a chip to see its field's information and the field in
  the JSON panel (a chip group lists its fields and highlights them), an object to highlight it in the JSON panel. The
  generated example documents validate against STAC core and every selected extension and can be copied or downloaded.
- **Placement matrix**: every field × every conceptual location (Collection › Asset › Band, Item › properties ›
  cube:variable, …) on one screen, for comparing extensions with each other. Below it, one matrix per data format the
  selected conventions apply to (Zarr v3, Zarr v2, netCDF, TIFF), since each format has its own node types and
  conventions: its node types and their containers (`attributes`, `tags`, …) against its format and convention fields.
  Click a cell to see the field in the example JSON.
- **Explore a STAC URL**: open a Catalog, Collection or Item (static or STAC API) and browse its children. Each object
  shows its populated fields highlighted within all fields the schemas would allow at the same place: dotted chips are
  allowed but absent, red chips are present but not placed there by any selected schema. Documents are validated
  against STAC core and the extensions they declare.
- **Field information**: click any field (a chip, or a row of the matrix) to see what it means: its title, description
  and type, the allowed values with their meanings, and every place it can go. The text comes from the schemas; see
  [Vendored schemas](#vendored-schemas). Where a field has a counterpart on the other side of the
  [STAC crosswalk](#embedded-metadata-schemas), it is listed too: the STAC field of an embedded field (`proj:code` of
  the Zarr `proj` convention is `proj:code` of the Projection extension), or the embedded fields of a STAC field.
- **Embedded in the data**: below the example catalog, the nodes of the data formats (Zarr v3 and v2 groups and arrays,
  netCDF groups and variables, TIFF files and images) that the selected **data conventions** apply to, with every field
  placed where the format and convention schemas allow it. Data conventions are chosen apart from extensions, with their
  own quick-select list grouped by kind: Zarr conventions, attribute conventions (CF, ACDD), format extensions
  (GeoTIFF) and tool conventions (GDAL, xarray, EOPF). Format fields, the counterparts of STAC core, are shown with
  STAC core fields.
- **Explore embedded metadata**: open a Zarr store (or its `zarr.json` or `.zmetadata`), a netCDF file or a TIFF/COG
  file, or follow the “embedded metadata of asset …” link of a STAC document with such an asset. Every node is shown
  within the fields its format and its declared (`zarr_conventions`, `Conventions`) or recognised conventions allow,
  and validated against them. netCDF and TIFF files are read in a worker
  ([src/reader.worker.ts](src/reader.worker.ts)) by HTTP range requests, fetching only their headers: netCDF-4 with
  [h5wasm](https://github.com/usnistgov/h5wasm), TIFF with [geotiff.js](https://geotiffjs.github.io/). Classic netCDF
  files, and netCDF files on servers without range requests, are downloaded instead, up to 64 MiB. The readers
  ([src/lib/readers](src/lib/readers)) produce the same nodes as the Observatory's: the format schemas below are their
  contract.

Extensions are chosen from quick-select buttons (the extensions discussed in the
[Observatory](https://github.com/hamk-uas/observatory) project) or added as any JSON Schema URL or `name@version`
(short for `https://stac-extensions.github.io/<name>/v<version>/schema.json`).

All state is kept in the URL, so any view can be shared by copying the address.

| Parameter | Meaning |
| --- | --- |
| `mode` | `example` or `href` |
| `v` | STAC version of the example (`1.1.0` default, `1.0.0`) |
| `ext` | an extension, repeatable: `name@version` or a schema URL; `noext=1` for none |
| `conv` | a data convention, repeatable: `name@version` (`proj@v0.1`, `cf@1.13`) or a schema URL; `noconv=1` for none; absent for the defaults |
| `href` | STAC document, or data file to explore: a Zarr store or metadata document, a netCDF or TIFF file |
| `sel`, `ptr` | selected document (`catalog`, `subcatalog`, `collection`, `item`, a URL, or `node:…` for a node of embedded metadata) and object (JSON Pointer) |
| `view` | `matrix` for the placement matrix |
| `focus` | an extension whose fields are highlighted (others dimmed) |
| `field` | field shown in the field information panel: `<extension>\|<field>`, e.g. `cf@1.0.0\|cf:cell_methods`, or `core\|license` |
| `core=1`, `group=0`, `declared=0` | show STAC core fields; list fields one by one; ignore extensions declared by explored documents |
| `embed=1` | embedded in another app: no page header, a link to open the full app instead |

### Embedding

Other apps can show a STAC document in the explorer in an `<iframe>` (the Observatory plans this for its `?debug` mode):

```text
https://hamk-uas.github.io/stac-schema-explorer/?embed=1&mode=href&href=<URL-encoded STAC document URL>
```

The explorer then loads the document and its children, compares them with the extensions they declare (add `ext`
parameters to compare with more) and keeps its state in its own URL. Use `noext=1` to start without the default
extensions. The document's server must allow cross-origin requests.

## How it works

Everything runs in the browser. Vendored schemas (below) are bundled; other schemas are fetched from their published
URLs when selected. A Web Worker ([src/engine.worker.ts](src/engine.worker.ts)) does the work with
[Ajv](https://ajv.js.org).

1. **Field discovery** ([src/lib/fields.ts](src/lib/fields.ts)). An extension's fields are the property keys its schema
   defines at "container" level (object root, Item `properties`, assets, bands, `cube:variables` entries, Table columns
   and so on), found by following `$ref`, `allOf`/`anyOf`/`oneOf`, `if`/`then`/`else` and `not`. The extension's own
   prefixes come from the conventional `"patternProperties": {"^(?!cube:)": {}}`, or the most frequent prefix. Fields of
   *other* extensions that a schema validates (for example `cf:cell_methods` in Table columns in the Observatory
   extension) are reported too, attributed to the schema that validates them.
2. **Example values** ([src/lib/sampler.ts](src/lib/sampler.ts)). A value valid against each field's subschema is
   generated from the schema (with readable hints for well-known fields) and checked with Ajv.
3. **Placement probing** ([src/lib/probe.ts](src/lib/probe.ts)). Starting from minimal valid Catalog, Collection and
   Item documents with one link, provider, asset and item asset each, every field is tried in every object of the
   document:
   - The schema **validates** a field at a location if the document passes with a valid value there but fails with an
     invalid one. Invalid values that the schema also rejects under an unknown key (every entry of `item_assets` must be
     an object, for example) are not counted.
   - A field's placement is **presence only** if the schema does not validate the value there, but the field's
     presence satisfies the extension's "use at least one of my fields" rule (typical for `summaries`).
   - Each extension is probed with its own fields removed from elsewhere, so each alternative of an
     `anyOf` (Datacube in Item `properties` *or* in assets) is found.
   - Fields that need company (`cube:variables` requires `cube:dimensions`) are tried together.
   - Placed fields create new objects (`bands[0]`, `cube:variables` entries, Table columns), which are probed in
     further rounds, as are earlier locations, since one placement can enable another: STAC 1.1.0 allows `bands` in
     Item `properties` only when an asset has `bands`.
   - Before a placement is accepted, every other schema must still accept the document; otherwise it is reported as a
     conflict.
4. **Field documentation** ([src/lib/field-docs.ts](src/lib/field-docs.ts)). Title and description are the nearest ones
   along the field's `$ref` chain; the type is computed from the schema (`array of (string or null)`,
   `object: name → Variable Object`); allowed values come from `oneOf` lists of titled constants (or `enum`).
5. **Embedded placement probing** ([src/lib/embedded-probe.ts](src/lib/embedded-probe.ts)). The fields of a format or
   convention schema are the keys it defines for a node and the entries of its `attributes`, `tags` and `geo_keys`.
   Starting from a minimal valid node of each format and node type (with the `zarr_conventions` entry a Zarr convention
   requires), each field is added with an example value and kept unless it adds validation errors, so required
   companions (`spatial:dimensions` of an array) are kept in any order; a convention whose node still fails cannot apply
   there (`multiscales` in an array). As for STAC, a field is validated where an invalid value fails and presence-only
   where any value passes.

   Conventions compose like STAC extensions. A convention whose container entries have a prefix (`proj:`, `spatial:`)
   owns only those; its other entries are objects of other conventions to which it adds fields. The spatial schema, for
   example, defines a `multiscales` key only to add `spatial:shape` and `spatial:transform` to the `layout` items of the
   multiscales convention. Such fields are placed in a last pass, only inside the objects a selected convention
   supplies (`attributes › multiscales › layout[]` when multiscales is selected too), never on their own: selecting
   spatial alone does not place `multiscales`.

### Limitations

- Only what the schemas check is found. Prose rules of an extension's README that its schema does not enforce are
  invisible; so is anything a schema accepts without looking at it. `summaries` may summarize any Item field, but only
  fields whose schemas validate (or require) them there are shown.
- The extreme case combines conditional placements. Each placement is valid in the context of the others, but not
  necessarily on its own (see the `bands` example above).
- Placement is probed in the objects of the example only. Schemas rarely distinguish assets by role, so one asset
  stands for all; dimension entries do differ (`x`, `y`, `time`), which is why the example has three.
- If no valid example value can be generated for a field, the field is listed under the extension in the sidebar and
  may be missing from the results.
- Exploring a URL needs the server to allow cross-origin requests (CORS), as do custom schema URLs.
- In STAC 1.0.0 the example Collection has `item_assets` even without the Item Assets extension, which 1.0.0 core does
  not validate.
- The placement matrix of embedded metadata shows the example nodes of the selected conventions; real Zarr, netCDF and
  TIFF nodes are compared in the explore view. A Zarr store without consolidated metadata shows only the node
  that was opened. Reading a netCDF or TIFF file also needs CORS on its server (the Earth Genome COGs, for example,
  have none). Long TIFF tag arrays (tile offsets) are shown by their length, and at most 64 TIFF images are read.

## Vendored schemas

Most published STAC schemas have no descriptions and list allowed values without explaining them; the explanations are
in the extensions' READMEs. This repository therefore vendors STAC core (1.0.0 and 1.1.0), the extensions of the
quick-select list and the Zarr conventions `proj`, `spatial` and `multiscales`
([zarr-conventions](https://github.com/zarr-conventions)) in [schemas/](schemas), as copies that add a title and a
description to every field and turn every `enum` into a `oneOf` of titled (and, where documented, described) constants.
The [Observatory](https://github.com/hamk-uas/observatory) uses these copies, adding its own Finnish and Swedish
translations of STAC core.

- [schemas/](schemas)`/<host>/<path>` is the documented copy of `https://<host>/<path>`; its `$id` is that URL (upstream
  ids end in `#` or, for v1.1.0 `common.json`, have a typo). Dependencies (GeoJSON, PROJJSON) are unmodified.
- [upstream/](upstream) holds the published originals. The tests ([test/vendored.test.ts](test/vendored.test.ts)) check
  that each copy validates exactly like its original (annotations removed, value lists turned back into `enum`), keeps
  every upstream title and description, documents every field, and lists each allowed value exactly once: a value listed
  twice fails the `oneOf`.
- Fields that only a dependency defines (the GeoJSON `type` of an Item) are documented by an annotation-only property
  in the STAC schema; such a property accepts anything, so the copy still validates exactly like the original.
- Schemas whose own repositories document every field are not vendored: the Semantics extension
  ([hamk-uas/stac-semantics](https://github.com/hamk-uas/stac-semantics)) and the Observatory extension
  ([sklvarjo/observatory-stac-extension](https://github.com/sklvarjo/observatory-stac-extension)).
- The texts come from the extensions' and the STAC specification's README tables (Apache License 2.0) and, for titles,
  from [stac-utils/stac-fields](https://github.com/stac-utils/stac-fields), with corrections where the READMEs are wrong
  (for example the Raster histogram `max`) and notes where README and schema disagree (Datacube `type` versus
  `variable_type`). The Zarr convention texts come from their READMEs (Apache License 2.0).

To vendor another schema, add it to [scripts/manifest.mjs](scripts/manifest.mjs), then:

```sh
node scripts/fetch-upstream.mjs     # download the original (and what it references) into upstream/ and schemas/
node scripts/draft-docs.mjs <name>  # draft missing titles and descriptions from the README tables; never overwrites
node scripts/report.mjs             # list what is still undocumented
node scripts/review.mjs <name>      # print the added texts for review
```

Edit the files in `schemas/` directly to improve the texts; `pnpm test` keeps them honest.

## Embedded metadata schemas

Data files carry metadata of their own: Zarr `zarr.json` documents, netCDF attributes, TIFF tags. Deciding what to put
in STAC, what in the data and what in both needs the same answer as for STAC fields: what does each field mean, and
where may it go? This repository therefore also describes the metadata **embedded** in data assets, with the same
treatment as STAC:

| STAC | Embedded metadata |
| --- | --- |
| STAC core (Catalog, Collection, Item) | **Format schemas**: Zarr v3 and v2 nodes, netCDF groups and variables, TIFF files and images |
| STAC extensions, declared in `stac_extensions` | **Conventions**: Zarr conventions declared in `zarr_conventions`; CF and ACDD declared in the `Conventions` attribute; GeoTIFF, GDAL, xarray and EOPF recognised from their keys |

Every schema validates one **node** of a format document: a Zarr group or array (its `zarr.json`, or for Zarr v2 its
`.zgroup`/`.zarray` with `.zattrs` as `attributes`), a netCDF group or variable, or a TIFF file or image (Image File
Directory). Conventions add their fields to the node's `attributes` (Zarr, netCDF) or `tags`/`geo_keys`/`gdal_metadata`
(TIFF), exactly as the published Zarr convention schemas do. netCDF and TIFF have no JSON form of their own, so their
format schemas define one: what `ncdump -h` shows, and named TIFF tags with decoded GeoKeys and GDAL metadata.

Zarr conventions are vendored like extensions (above). No official JSON Schema exists for Zarr core, netCDF, TIFF, CF,
ACDD, GeoTIFF, GDAL, xarray or EOPF metadata, so this repository **authors** unofficial ones, each saying so in its
description, in
[schemas/hamk-uas.github.io/stac-schema-explorer/schemas/](schemas/hamk-uas.github.io/stac-schema-explorer/schemas).
They have no upstream copy; the build publishes them at their `$id`,
`https://hamk-uas.github.io/stac-schema-explorer/schemas/<name>/<version>/schema.json`, with:

- [registry.json](schemas/hamk-uas.github.io/stac-schema-explorer/schemas/registry.json): the formats (schema, media
  types, node types) and conventions (kind, formats, versions and how each is declared or recognised). Zarr conventions
  are identified by the UUID of their `zarr_conventions` entry, which stays the same when a schema moves; their names
  are only labels (TESSERA writes `spatial:` where the convention says `spatial`).
- [crosswalk.json](schemas/hamk-uas.github.io/stac-schema-explorer/schemas/crosswalk.json): where embedded fields
  correspond to STAC fields (`proj:code` in both, ACDD `title` and STAC `title`, GeoTIFF `ProjectedCRSGeoKey` and
  `proj:code`, …): the same value, the same value after a named conversion, or related information in different forms.

The CF attribute descriptions are those of the CF Conventions 1.13 Appendices A and F (public domain, CC0 1.0); the
others summarise their specifications in our own words and link to them. The tests
([test/authored.test.ts](test/authored.test.ts)) check that every authored schema compiles, documents every field and
lists allowed values as titled constants, that the registry and crosswalk point to existing schemas and fields, and
that the embedded metadata of the Observatory lab's catalogs (Arctic CH4, Blue Marble and TESSERA Zarr v3, EOPF Zarr v2,
a HIKET netCDF-4 file and an Earth Genome COG, in [test/fixtures/embedded](test/fixtures/embedded)) validates. The
reader tests ([test/readers.test.ts](test/readers.test.ts)) check that what the netCDF and TIFF readers produce from
generated files validates as well.

## Development

Requires Node.js 22 and pnpm.

```sh
pnpm install
pnpm dev          # development server
pnpm test         # unit tests, including the vendored-schema checks
pnpm build        # type check and production build into dist/
pnpm explore -- cf@1.0.0   # print placements in the terminal
```

Tests and `pnpm explore` read schemas from [schemas/](schemas), then [test/fixtures](test/fixtures) (non-vendored
schemas such as Semantics); a schema missing from both is downloaded once into `test/fixtures`. Delete a fixture to
refresh it.

## Deployment

[.github/workflows/pages.yml](.github/workflows/pages.yml) tests, builds and deploys to GitHub Pages on every push to
`main`. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The build uses
relative paths, so it also works from any other static host or subdirectory.
