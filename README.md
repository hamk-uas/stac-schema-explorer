# STAC Schema Explorer

An interactive, browser-based tool for **exploring, comparing and communicating geospatial metadata schemas**:
[SpatioTemporal Asset Catalog (STAC)](https://stacspec.org) core and extensions, alongside the metadata **embedded in
data files** (Zarr v3/v2, netCDF, TIFF/GeoTIFF/COG) and their conventions.

**Live app:** <https://hamk-uas.github.io/stac-schema-explorer/>

## Why this exists

Reading nested JSON Schemas by hand to answer everyday metadata design questions — *Can `cf:cell_methods` go in
`table:columns`, `bands`, `cube:variables` or `summaries`? Which fields are required, and under what condition? Where
does the same information live in Zarr or GeoTIFF, and which Python/GDAL libraries actually read it?* — is slow and
error-prone.

STAC Schema Explorer answers those questions directly from the schemas themselves (by probing with Ajv in a Web Worker,
never a hand-maintained table) and encodes the entire view in the URL so you can share concrete examples in GitHub
issues, pull requests, RFCs and documentation.

### Common uses

- **Explore and compare extensions & conventions:** pick any combination of STAC core (`1.1.0` / `1.0.0`), published
  STAC extensions, data format cores (`Zarr v3`, `Zarr v2`, `netCDF`, `TIFF`) and embedded metadata conventions (Zarr
  conventions, CF, ACDD, UNC, GeoTIFF, GDAL, xarray, EOPF).
- **Communicate and review draft schemas:** paste or link any raw JSON Schema URL (for example a draft PR branch on
  GitHub) via `?ext=<schema-url>` or `?conv=<schema-url>` to show exactly where the draft places fields, whether it
  conflicts with existing extensions, and how it validates real documents.
- **Inspect and prototype changes on real catalogs & data files:** open any CORS-enabled STAC Catalog, Collection, Item
  (static or STAC API / openEO), Zarr store, netCDF or TIFF file, see populated vs. allowed vs. unexpected fields, test
  local non-destructive **rewrites** (`+` / `−`), and share the exact state in a link.
- **Bridge STAC and embedded data metadata:** inspect a STAC document together with the Zarr, netCDF or TIFF metadata
  inside its assets, follow **STAC ↔ embedded crosswalk** links between corresponding fields, and see which drivers,
  libraries and packages read, write or prioritize each field.

## Views and capabilities

- **Sidebar pickers (Cores, STAC extensions, Data conventions):**
  - **Cores** are the base schemas documents and data files are built on (STAC `1.1.0` / `1.0.0`, Zarr v3, Zarr v2,
    netCDF, TIFF; COG is a layout profile of TIFF and adds no fields). All cores start selected; clicking a core toggles
    whether its own fields are shown.
  - **STAC extensions** can be toggled from the quick-select list (published community extensions, including those used
    with openEO) or added by `name@version` (short for `https://stac-extensions.github.io/<name>/v<version>/schema.json`)
    or any JSON Schema URL.
  - **Data conventions** are the data-file counterparts of STAC extensions, grouped by kind: Zarr conventions, attribute
    conventions (CF, ACDD, UNC), format extensions (GeoTIFF) and tool conventions (GDAL, xarray, EOPF).
  - Clicking a selected schema's name highlights its fields everywhere (dimming others) and opens its **Schema
    information** panel. Sidebar panel collapse states and pane widths are persisted locally; the app follows the
    system's light or dark colour scheme.
- **Example catalog (Catalog tree):** generates the *extreme case* — a valid Catalog → sub-catalog, Collection → Item
  tree (plus example nodes for selected data formats and conventions) with every field placed everywhere the selected
  schemas allow it. Separate JSON documents are cards, nested objects are indented rows (`{}` objects, `[{}]` array
  items), Item `properties` appear in a tinted GeoJSON block, and fields are colour-coded chips (`*` = always required,
  `(*)` = conditionally required). Generated JSON validates against STAC core and all selected extensions and can be
  copied or downloaded.
- **Placement matrix:** compares every field × every conceptual location (`Collection › Asset › Band`, `Item ›
  properties › cube:variable`, …) on one screen, followed by one matrix per active data format. Hover any mark for
  exact JSON Pointers; click a mark to inspect the field and jump to it in the example JSON.
- **Explore a STAC or data URL:** open a live STAC document (static or STAC API / openEO Collection) and browse its
  children, or open a Zarr store (`zarr.json` / `.zmetadata`), netCDF or TIFF/COG file directly.
  - Populated fields are highlighted alongside every field allowed at the same location (dotted = allowed but absent;
    wavy red = present but not placed there by any selected or declared schema).
  - Documents are validated against STAC core and the extensions they declare in `stac_extensions`. Fields belonging to
    an undeclared extension are flagged as *undeclared* (excluding Collection `summaries` and `item_assets`, which
    describe Items).
  - Asset data files appear inside their STAC document card in dashed *"embedded in the data, not STAC"* sections. Zarr
    stores load automatically; netCDF and TIFF files are listed compactly and read on demand via HTTP range requests in
    a dedicated worker ([src/reader.worker.ts](src/reader.worker.ts)) using [h5wasm](https://github.com/usnistgov/h5wasm)
    and [geotiff.js](https://geotiffjs.github.io/) (classic netCDF files or servers without range support fall back to
    downloading up to 64 MiB). Other assets are grouped by media type and highlight in JSON on click.
  - Fields defined by [openEO API](https://api.openeo.org/1.2.0/#tag/EO-Data-Discovery/STAC) without a STAC extension
    schema (such as `openeo:status`) are recognized and explained rather than flagged as unknown.
- **Local rewrites:** on any explored STAC document or data node, click `+` on an absent field to insert a valid example
  value, `−` on a present field to remove it (struck through; `+` restores), or `×` to undo an addition. Adding a field
  from an undeclared extension or convention also adds its declaration (`stac_extensions`, `zarr_conventions`, or
  `Conventions`). Rewritten views are clearly marked (`✎ rewritten`), validated, copyable/downloadable, and encoded in
  the share URL without modifying any remote data.
- **Field & schema details, crosswalk and software support:** click any field chip, JSON key, or matrix row to inspect
  its title, description, computed type, allowed values, nested object properties, every allowed location (with
  required/optional conditions), **crosswalk** counterparts between STAC and embedded metadata, and **software
  support** organized by layer (📜 Standard, 🤝 Convention/extension, 💾 Format, 🔌 Driver, 🧰 Library, 🖥️ Package/app)
  including source-precedence rules when STAC and embedded metadata overlap. Verification dates and latest releases are
  tracked (checks older than three months are flagged, and Python package releases are checked live against PyPI).

## Sharing views and embedding

All explorer state lives in the URL query string, so copying the browser address shares the exact view.

**Example — demonstrating a draft STAC extension schema alongside Table `v1.3.0` in matrix view:**

```text
https://hamk-uas.github.io/stac-schema-explorer/?ext=table@1.3.0&ext=https://raw.githubusercontent.com/<owner>/<repo>/<branch>/json-schema/schema.json&view=matrix
```

### URL parameters

| Parameter | Meaning |
| --- | --- |
| `mode` | `example` (default) or `href` |
| `v` | STAC version for the example catalog (`1.1.0` default, or `1.0.0`) |
| `core` | Core to show fields for, repeatable: `stac`, `zarr-v3`, `zarr-v2`, `netcdf`, `tiff` (all when omitted; `core=` for none) |
| `ext` | STAC extension, repeatable: `name@version` or a full JSON Schema URL (none when omitted) |
| `conv` | Data convention, repeatable: `name@version` (e.g. `proj@v0.1`, `cf@1.13`) or a schema URL (none when omitted) |
| `href` | Remote STAC document or data file URL (Zarr store/metadata, netCDF, TIFF) to explore |
| `example` | Additional example URL to list under *Try:* in URL mode, repeatable: `Label\|https://…` or `https://…` |
| `sel`, `ptr` | Selected document (`catalog`, `subcatalog`, `collection`, `item`, URL, or `node:…`) and JSON Pointer |
| `view` | `matrix` for the placement matrix (omit for the tree view) |
| `collapse` | Placement-matrix row group to collapse, repeatable: `core`, format id (`zarr-v3`), `name@version` or schema URL |
| `focus` | Schema key (`core`, `name@version`, or schema URL) whose fields are highlighted |
| `field` | Field open in the details panel: `<schema>\|<field>` (e.g. `cf@1.0.0\|cf:cell_methods`, `core\|license`) |
| `schema` | Schema open in the details panel (`core`, `name@version`, or schema URL) |
| `rw` | Local rewrite, repeatable in order: `add\|<schema>\|<document>\|<pointer>\|<field>` or `remove\|…` |
| `group=0`, `declared=0` | Show individual field chips instead of grouped chips; ignore extensions declared by explored documents |
| `theme` | Colour-scheme override: `light` or `dark` (omitted follows the system preference) |
| `embed=1` | Embedded layout for `<iframe>` use: hides the top header and shows a compact bar with an *open full app* link |

### Embedding in an `<iframe>`

```text
https://hamk-uas.github.io/stac-schema-explorer/?embed=1&theme=light&mode=href&href=<URL-encoded STAC or data URL>
```

Add `ext` or `conv` parameters to compare the document against additional schemas, and optionally `theme=light` or
`theme=dark` to match the host page. Explored URLs and custom schema URLs must allow cross-origin requests (CORS).

## How it works

Everything runs client-side in the browser. Vendored schemas are bundled; custom or unvendored schemas are fetched on
demand. Probing and validation run off the main thread in [src/engine.worker.ts](src/engine.worker.ts) using
[Ajv](https://ajv.js.org):

1. **Field discovery** ([src/lib/fields.ts](src/lib/fields.ts)): extracts container-level property keys across `$ref`,
   `allOf`/`anyOf`/`oneOf`, `if`/`then`/`else` and `not`, identifies own prefixes, and also attributes foreign-prefix
   fields validated by a schema.
2. **Example sampling** ([src/lib/sampler.ts](src/lib/sampler.ts)): generates valid example values from each field's
   subschema (with readable hints for common fields) and verifies them with Ajv.
3. **STAC placement probing** ([src/lib/probe.ts](src/lib/probe.ts)): tests every discovered field in every object of
   minimal valid Catalog, Collection and Item documents across multiple rounds (so fields that create child containers
   such as `bands`, `cube:variables` or `table:columns` are probed recursively), distinguishing **validated** vs.
   **presence-only** placements, detecting cross-extension conflicts, and probing **required / conditionally required**
   status ([src/lib/requirement.ts](src/lib/requirement.ts)).
4. **Embedded placement probing** ([src/lib/embedded-probe.ts](src/lib/embedded-probe.ts)): applies the same probing to
   format nodes (Zarr groups/arrays, netCDF groups/variables, TIFF files/images) and composes conventions that extend
   each other's structures (such as `spatial` extending `multiscales` layout items).
5. **Field documentation** ([src/lib/field-docs.ts](src/lib/field-docs.ts)): resolves titles, descriptions, computed
   types, allowed value tables and nested object shapes along `$ref` chains.

### Limitations

- **Schema-only visibility:** prose rules in a README that the JSON Schema does not enforce are not detected; similarly,
  `summaries` can hold any Item field, but only fields validated or required there by a schema appear.
- **Extreme-case context:** conditional placements are valid in the context of the combined example, not necessarily in
  isolation (for example STAC 1.1.0 allows `bands` in Item `properties` only when an asset also has `bands`).
- **Representative example objects:** probing runs against representative objects (one asset, three dimension types `x`,
  `y`, `time`); fields that cannot be sampled are flagged in the sidebar.
- **CORS & APIs:** exploring remote URLs or custom schemas requires CORS. Validation checks STAC **documents**, not
  STAC API / openEO endpoint conformance (item links are followed where present).
- **Embedded data limits:** Zarr stores without consolidated metadata show only the opened node; long TIFF tag arrays
  are summarized by length, and at most 64 TIFF images (IFDs) are read.

## Vendored and authored schemas

### Enriched STAC & Zarr convention schemas

Many published STAC and Zarr convention JSON Schemas omit field descriptions and enum explanations (keeping them in
README tables). This repository maintains reviewed, documentation-enriched copies in [schemas/](schemas) alongside
pristine originals in [upstream/](upstream):

- **STAC core** (`1.0.0`, `1.1.0`) and the **quick-select STAC extensions**
- **Zarr conventions:** `proj`, `spatial`, `multiscales`, `stac`, `nz` ([zarr-conventions](https://github.com/zarr-conventions));
  `cs`, `ref`, `geolocation` ([R-CF](https://github.com/R-CF)); `license`, `uom` ([clbarnes](https://github.com/clbarnes))

Tests ([test/vendored.test.ts](test/vendored.test.ts)) verify that every enriched copy validates identically to its
upstream original, preserves upstream annotations, documents every field, and lists each allowed value once. Texts are
drawn from upstream READMEs (Apache-2.0) and [stac-utils/stac-fields](https://github.com/stac-utils/stac-fields).

To add or refresh a vendored schema, edit [scripts/manifest.mjs](scripts/manifest.mjs) and run:

```sh
node scripts/fetch-upstream.mjs     # fetch originals into upstream/ and seed schemas/
node scripts/draft-docs.mjs <name>  # draft missing titles/descriptions from READMEs
node scripts/report.mjs             # report any undocumented fields
node scripts/review.mjs <name>      # review added documentation
```

### Embedded metadata schemas, crosswalk, software registry & readers

Because Zarr core, netCDF, TIFF, CF, ACDD, UNC, GeoTIFF, GDAL, xarray and EOPF do not publish official JSON Schemas for
their embedded metadata, this repository authors clearly labelled **unofficial JSON Schemas** under
[schemas/hamk-uas.github.io/stac-schema-explorer/schemas/](schemas/hamk-uas.github.io/stac-schema-explorer/schemas) and
publishes them at their `$id` URLs together with:

- [registry.json](schemas/hamk-uas.github.io/stac-schema-explorer/schemas/registry.json) — data formats, convention
  versions, UUID/attribute detection rules, maturity and verification dates.
- [crosswalk.json](schemas/hamk-uas.github.io/stac-schema-explorer/schemas/crosswalk.json) — field-level mappings
  between embedded metadata and STAC fields (`same`, `converted`, `related`).
- [software.json](schemas/hamk-uas.github.io/stac-schema-explorer/schemas/software.json) — verified, source-cited
  read/write support and source-precedence rules across drivers, libraries and packages.

CF attribute descriptions come from CF Conventions 1.13 Appendices A and F (CC0 1.0); other convention texts are
summarised in our own words with links to their specifications. UNC (`unc@draft-v0.2`, proposed as CF chapter 10 in
[cf-conventions#661](https://github.com/cf-convention/cf-conventions/pull/661)) and `unc@v0.1` (as read/written by
[obsarray](https://obsarray.readthedocs.io) 1.1) are modelled separately until included in a CF release.

The browser netCDF and TIFF metadata readers in [src/lib/readers](src/lib/readers) are also exported as
`stac-schema-explorer/readers` (TypeScript source: `readNetCDF`, `readTiff`, `decodeAttributes`, `decodeGeoKeys`,
`parseGDALMetadata`), depending only on peer libraries (`h5wasm`, `netcdfjs`, `geotiff`) provided by the consuming app.

## Development and deployment

Requires Node.js >= 22 and pnpm.

```sh
pnpm install
pnpm dev                    # local dev server
pnpm test                   # unit, vendored-schema, authored-schema & reader tests
pnpm typecheck              # TypeScript / Vue type check
pnpm build                  # type check and production build into dist/
pnpm explore -- cf@1.0.0    # print probed placements in the terminal
```

Tests and `pnpm explore` resolve schemas from [schemas/](schemas), then [test/fixtures](test/fixtures), caching any
other fetched schema once under `test/fixtures`.

[.github/workflows/pages.yml](.github/workflows/pages.yml) tests, builds and deploys `dist/` to GitHub Pages on pushes
to `main`. The build uses relative paths and works at a domain root or any subdirectory.

## License

Copyright 2026 HAMK Häme University of Applied Sciences. Licensed under the [Apache License, Version 2.0](LICENSE); see
[NOTICE](NOTICE) for third-party schema and documentation attributions.
