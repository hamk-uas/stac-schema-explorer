# STAC schema explorer: repository guide

## Purpose and ecosystem role

This is a standalone Vue/TypeScript tool for understanding **where STAC core and
extension fields are allowed**, inspecting examples/remote catalogs and checking
their validation. It treats metadata embedded in data assets (Zarr, netCDF, TIFF)
and its conventions the same way, and relates it to STAC through a crosswalk.
It also maintains documented copies of published schemas.
It is not itself an Observatory instance or a data-production pipeline.

Observatory consumes these enriched schemas through its pinned
`schemas/stac-schema-explorer` submodule and adds Finnish/Swedish STAC field
translations. The separate `observatory-stac-extension` and `stac-semantics`
repos own their own documented schemas; this app offers them by URL rather than
vendoring/redefining their contracts. `cards-zarr-optim` produces STAC/Zarr that
tools can inspect; `hiket-viz` consumes Observatory, not this app's internal Vue
components.

All repositories are pre-alpha and APIs can change with coordination. Keep
changes to query/embedding and schema-copy contracts explicit, but do not require
all downstream applications to update simultaneously. Read another repo's own
instructions when crossing into it. A schema explorer can retain its own compact
technical visual language; it need not adopt Observatory instance branding.

## Code map and invariants

| Location | Responsibility |
| --- | --- |
| [src/App.vue](src/App.vue) | App orchestration, URL state, selection, remote/example flows and layout. |
| [src/components](src/components) | Document cards, object/JSON trees, field chips/info, extension picker, matrix and legend; `NodeCard` and `ConventionPicker` for embedded metadata. |
| [src/lib](src/lib) | Schema loading/probing, STAC fetching, documentation, model/tree construction, colors and URL helpers. Embedded metadata: [conventions.ts](src/lib/conventions.ts) (registry, crosswalk, short ids), [embedded-probe.ts](src/lib/embedded-probe.ts) (node placement probing, worker side), [embedded-docs.ts](src/lib/embedded-docs.ts) (node cards, reader kind of assets, Zarr documents), [readers](src/lib/readers) (netCDF and TIFF readers, ports of the Observatory's). [rewrites.ts](src/lib/rewrites.ts): local rewrites of real documents and nodes. [software.ts](src/lib/software.ts): which software reads/writes which fields, and its source precedence. |
| [src/engine.worker.ts](src/engine.worker.ts), [src/lib/engine.ts](src/lib/engine.ts) | Worker-backed probing/validation protocol. |
| [src/reader.worker.ts](src/reader.worker.ts), [src/lib/reader.ts](src/lib/reader.ts) | Separate, lazily created worker reading netCDF/TIFF files. netCDF-4 range reads are synchronous XHR: keep them out of the engine worker and the page. |
| [schemas](schemas) | Reviewed, documentation-enriched schema source consumed by this app and Observatory: vendored copies, plus authored embedded-metadata schemas under `schemas/hamk-uas.github.io/stac-schema-explorer/schemas/`. |
| [upstream](upstream) | Pristine published originals/dependencies used to prove enrichment preserves validation. |
| [scripts](scripts), [test](test) | Fetching/drafting/review tooling and validation/engine regression tests. |

- Keep costly Ajv probing/validation off the main UI thread through the existing
  worker. Use `SchemaStore` for normalized URLs, `$ref`/JSON Pointer resolution,
  caching and JSON Schema draft 7/2019/2020 handling.
- Placement is derived from schemas and probing, not an ever-growing manually
  maintained field-location matrix. Distinguish valid placement, observed
  presence, unprobed state and validation failure.
- Preserve shareable URL state: selected schemas, STAC version, document/pointer,
  view, focus and embedding. Use [url-state.ts](src/lib/url-state.ts), not a
  second query grammar. Keep remote CORS/load failures visible.
- Cores (`core`: STAC and the data formats, [cores.ts](src/lib/cores.ts)),
  extensions (`ext`) and data conventions (`conv`) are chosen the same way: a
  selected schema shows its fields; documents and nodes appear either way.
  Cores share one slate color. Data conventions are visibly apart from
  extensions: their own picker grouped by kind, square markers, and node cards
  marked "embedded in the data" (`NodeCard`).
  Data files of a STAC document's assets are shown inside its `DocCard`, in
  slate dashed sections that must never look like its STAC objects; Zarr is
  read when the document loads, netCDF/TIFF only on request or for a share link.
  Reuse `templateView`/`documentView`, `FieldChips`, `FieldInfo` and `SchemaInfo` for nodes;
  only the probing differs (format nodes instead of STAC objects).
- The information panel above the JSON describes what the JSON highlights: a
  field chip or matrix cell opens `FieldInfo`, a grouped chip, picker name or
  matrix schema header opens `SchemaInfo`, and selecting objects without
  fields closes the panel. Do not let it show something the JSON no longer
  highlights.
- Rewrites (`rw`) change only the explorer's copy of a real document or node:
  keep the loaded `original` and derive the shown `doc` by applying them in
  order, taking added values from the template (never storing values in the
  URL). Anything showing a rewritten document must say so (banner, card badge,
  "rewritten" JSON marker, amber chip outlines). Example templates are not
  editable.
- Remote catalogs are explored incrementally; do not eagerly download entire
  trees to render the first screen.
- This app is browser-side/static. Relative Vite deployment paths and embedded
  layout behavior must work at a domain root and a subdirectory.
- Never change accepted/rejected STAC documents just to obtain nicer schema
  documentation. Preserve `$id`, upstream annotations and validation constraints.
  GeoJSON/PROJJSON dependency copies remain unmodified.

## Schema maintenance: source versus generated data

[README.md](README.md) documents the enrichment procedure. `schemas` is reviewed
source data, **not disposable build output**; `dist` is build output.

1. Add/update source schema and documentation URLs in
   [scripts/manifest.mjs](scripts/manifest.mjs).
2. `node scripts/fetch-upstream.mjs` fetches originals/references to `upstream`
   and seeds missing enriched copies. `--force` deliberately refreshes originals;
   it does not overwrite existing enriched copies.
3. `node scripts/draft-docs.mjs <name>` drafts missing documentation and titled
   enum alternatives. It is assistance, not authoritative scientific prose:
   review additions against the sources and existing text.
4. Use `node scripts/report.mjs <name>`, `node scripts/review.mjs <name>` and
   `git diff` to review gaps/changes. Omit the name for all schemas.
5. Run focused vendoring tests, then affected engine checks. Upstream changes
   require reconciling enriched validation structure, not just fetching files.

Do not hand-edit `upstream` to make tests pass or enrich its prose. Preserve
upstream attribution/license notices. Tests compare canonicalized schema
constraints, original annotations, dependency identity and documentation/value-list
completeness. Treat them as the acceptance gate for enrichment.

### Embedded-metadata schemas

Format and convention schemas for metadata embedded in data assets (README
"Embedded metadata schemas") have the same roles as STAC core and extensions.
Zarr conventions are vendored through the manifest like extensions. Schemas
without an official JSON Schema (Zarr core, netCDF, TIFF, CF, ACDD, GeoTIFF,
GDAL, xarray, EOPF) are **authored** under `AUTHORED_BASE`
(`scripts/manifest.mjs`), have no upstream copy, say "Unofficial JSON Schema"
in their description and are published at their `$id` by `vite.config.ts`.

- Every schema validates one format **node** (Zarr group/array, netCDF
  group/variable, TIFF file/image); conventions add fields under `attributes`,
  `tags`, `geo_keys` or `gdal_metadata`. Keep this contract: Observatory and the
  published Zarr convention schemas rely on it.
- `registry.json` and `crosswalk.json` are contracts read by Observatory. Identify
  Zarr conventions by UUID, not name or URL. Changing ids, paths, relations or
  conversion names requires coordinated Observatory changes.
- `software.json` is published beside them and names conventions and formats by
  their registry ids and STAC extensions by name. Conventions say who *defines*
  fields (never overlapping); software says who *uses* them (overlapping freely).
  Every capability or precedence claim needs a cited source (docs or source code)
  and the version it depends on; leave out what cannot be verified, and recheck
  claims when the software changes.
- Show where things sit with the shared layers of [layers.ts](src/lib/layers.ts)
  (📜 standard, 🤝 convention/extension, 💾 format, 🔌 driver, 🧰 library,
  🖥️ package/app) through `LayerBadge`, always with a text label. Each software
  entry is in one layer (drivers `partOf` their library). When re-verifying a
  program or specification, update its `checked` date and latest release in
  `software.json` or `registry.json`; the UI flags checks older than three months
  and looks up newer PyPI releases at runtime.
- Do not copy text whose licence does not allow it: CF text is CC0; ACDD, OGC
  and GDAL texts are summarised in our own words with links.
- `test/authored.test.ts` checks documentation, registry/crosswalk/software targets and
  that the lab catalogs' metadata in `test/fixtures/embedded` validates. Fixtures
  must not contain personal data from source files (names, emails, user names).

Documentation drafting caches remote source material under `.cache`.
Engine tests first use vendored schemas, then `test/fixtures`, then fetch/cache
missing schemas. A first run or deliberate fixture refresh can require network,
especially for Semantics and the mutable Observatory schema; do not describe
the whole suite as unconditionally offline. Refresh specific caches intentionally.

## UI style guide

Keep the interface compact, technical and inspection-oriented. Extend the existing
components rather than introducing another design library.

- **Palette:** light slate page (`#f8fafc`), white/pale panels, dark slate text
  (`#0f172a`), subtle slate borders and indigo actions (`#4f46e5`/`#6366f1`).
  Use teal/green for valid states, amber for caution and red for errors. Reuse
  established meanings; a new color should not introduce an ambiguous new state.
- **Identity colors:** document accents distinguish Catalog (indigo), Collection
  (teal) and Item/Feature (amber). Extension identity comes from `colorOf` in
  [colors.ts](src/lib/colors.ts) and the shared `--c` convention; do not invent
  per-component extension color maps. Keep labels/icons alongside color.
- **Typography:** system sans for prose/controls, the existing Cascadia/SF
  Mono/Menlo/Consolas stack for JSON, field names, pointers and values. Keep
  compact hierarchy (currently mostly 11-14px) but do not further shrink text
  to solve overflow. Preserve zoomability, wrapping and scan-friendly alignment.
- **Layout:** toolbar, extension sidebar, flexible main view and JSON/details
  pane. Desktop panes scroll independently; `Splitter.vue` handles resize the
  sidebar and JSON pane (pointer or keyboard, persisted per full/embedded mode
  in `localStorage`, not share URLs). The existing <=1100px layout stacks
  sections, hides the splitters and constrains the JSON pane. Embedded mode
  removes site chrome,
  not core navigation/inspection capability. Avoid fixed widths that defeat
  the narrow-screen mode.
- **Components:** reuse `DocCard`, `ExtensionPicker`, `FieldChips`, `FieldInfo`,
  `SchemaInfo`, `MatrixView`, `JsonView`, `ObjectNode` and `JsonNode` for corresponding roles.
  Maintain selection and validation styling consistently across tree, matrix
  and JSON views.
- **Accessibility:** use keyboard-native selection/expand controls, visible focus,
  named icon-only actions and non-color validity/presence cues. Explain loading,
  missing schemas and errors in text. Do not make hover or a clickable container
  the only way to perform an action.
- **Localization/theme scope:** the standalone app currently has English UI and
  a light theme; Observatory's schema translations do not localize this app.
  Do not claim multilingual/dark support without implementing and checking it.
  If introducing either, centralize strings/tokens rather than duplicating
  conditional colors/translations throughout components.
- **Motion:** keep inspection interactions calm; any new animation/programmatic
  scrolling needs a reduced-motion alternative without hiding state feedback.

## Development and checks

Use Node >=22 and pnpm as pinned in [package.json](package.json).

- `pnpm install`, `pnpm dev` for development.
- `pnpm test` runs Vitest; use a specific test file for a focused change.
- `pnpm typecheck` and `pnpm build` validate the TypeScript/Vue app and production
  bundle. `pnpm explore` provides the repository's exploration command.
- For UI changes inspect example and remote-data flows, selection in the
  tree/matrix/JSON views, share URLs, embedded mode and the stacked layout.
- [.github/workflows/pages.yml](.github/workflows/pages.yml) tests/builds and
  publishes `dist` on `main`. Publishing is separate from local verification.

## TODO: observed discrepancies and decisions

- [ ] Centralize semantic UI tokens: literal slate/indigo/status colors and
  spacing are repeated in `App.vue`, components and [src/style.css](src/style.css).
  Preserve the standalone tool's identity, not an assumed Observatory rebrand.
- [ ] Establish consistent explicit focus-visible styling; current components
  mostly rely on browser defaults. Audit icon-only accessible names in
  `ExtensionPicker.vue` and related controls rather than relying only on `title`.
- [ ] Make `DocCard.vue` header selection keyboard-operable; its clickable
  header is not itself a native interactive control, unlike its expand button.
- [ ] Check contrast and non-color distinctions for extension/validity/presence
  states in `Legend.vue`, `FieldChips.vue` and `colors.ts`.
- [ ] Decide the localization/theme contract before claiming seamless
  multilingual Observatory embedding. The current app is English/light only.
- [ ] Reconcile README embedding plans with the existing `embed=1` implementation;
  distinguish app support from downstream integration still to be done.
- [ ] Establish an explicit software license; attribution of Apache-licensed
  source documentation in the README is not a repository-wide license.
- [ ] Embedded metadata: the netCDF/TIFF readers duplicate the Observatory's
  (`@observatory/data` `readNetCDFMetadata`, `readTiffMetadata`); until one
  shared package exists, change both together.
- [ ] Software and standards, after the layers and versions slice: a software
  picker that marks which fields a program interprets, writes or ignores; 📜 standards
  as presets of conventions with requirement levels (GeoZarr, still a draft over the
  zarr-conventions; COG; CF-compliant netCDF); more software (QGIS, R terra/stars,
  xpystac, geotiff.js, zarr-python) once their behaviour is verified; currency of
  vendored STAC extension versions. Add the geo-embeddings Zarr
  convention (`geoemb:`, used by TESSERA) when it has a released schema (its declared
  `refs/tags/v1` schema URL did not resolve when last checked).

## Keep this guide current

Update this file alongside changes to schema provenance/enrichment, probing,
URL/embedding contracts, repository relationships, commands or UI conventions.
Add newly learned high-value invariants, link to details, and revise/remove
resolved TODOs. Distinguish observed limitations from planned work and avoid
recording transient cache state or unverified assumptions as architectural facts.
