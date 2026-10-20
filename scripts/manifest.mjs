// Schemas vendored (and enriched with titles and descriptions) by this repository, with the documents that describe
// them. Schemas that `$ref` other documents pull those in automatically as unmodified dependencies.
//
// Not vendored, because their own repositories maintain titles and descriptions: the Semantics extension
// (hamk-uas/stac-semantics) and the Observatory extension (sklvarjo/observatory-stac-extension).

const SPEC = 'https://raw.githubusercontent.com/radiantearth/stac-spec';
const EXT = (name, version) => ({
    schemas: [`https://stac-extensions.github.io/${name}/v${version}/schema.json`],
    readmes: [`https://raw.githubusercontent.com/stac-extensions/${name}/v${version}/README.md`],
});

/** @type {{ schemas: string[]; readmes: string[] }[]} */
export const VENDORED = [
    {
        schemas: ['catalog-spec/json-schema/catalog.json', 'collection-spec/json-schema/collection.json', 'item-spec/json-schema/item.json']
            .map((path) => `https://schemas.stacspec.org/v1.1.0/${path}`),
        readmes: ['catalog-spec/catalog-spec.md', 'collection-spec/collection-spec.md', 'item-spec/item-spec.md',
            'commons/common-metadata.md', 'commons/assets.md', 'commons/links.md'].map((path) => `${SPEC}/v1.1.0/${path}`),
    },
    {
        schemas: ['catalog-spec/json-schema/catalog.json', 'collection-spec/json-schema/collection.json', 'item-spec/json-schema/item.json']
            .map((path) => `https://schemas.stacspec.org/v1.0.0/${path}`),
        readmes: ['catalog-spec/catalog-spec.md', 'collection-spec/collection-spec.md', 'item-spec/item-spec.md',
            'item-spec/common-metadata.md'].map((path) => `${SPEC}/v1.0.0/${path}`),
    },
    EXT('datacube', '2.3.0'),
    EXT('datacube', '2.2.0'),
    EXT('cf', '1.0.0'),
    EXT('themes', '1.0.0'),
    EXT('table', '1.3.0'),
    EXT('table', '1.2.0'),
    EXT('classification', '2.0.0'),
    EXT('eo', '2.0.0'),
    EXT('raster', '2.0.0'),
    EXT('projection', '2.0.0'),
    EXT('file', '2.1.0'),
    EXT('zarr', '1.1.0'),
    EXT('scientific', '1.0.0'),
    EXT('attribution', '0.1.0'),
    EXT('processing', '1.2.0'),
    EXT('product', '1.0.0'),
    EXT('timestamps', '1.1.0'),
    EXT('version', '1.2.0'),
    EXT('language', '1.0.0'),
    EXT('contacts', '0.1.1'),
    EXT('storage', '2.0.0'),
    EXT('render', '2.0.0'),
    EXT('sat', '1.2.0'),
    EXT('view', '1.1.0'),
    EXT('grid', '1.1.0'),
    EXT('mgrs', '1.0.0'),
    EXT('ceos-ard', '0.2.0'),
    EXT('item-assets', '1.0.0'),
    {
        schemas: ['https://cs-si.github.io/eopf-stac-extension/v1.2.0/schema.json'],
        readmes: ['https://raw.githubusercontent.com/CS-SI/eopf-stac-extension/v1.2.0/README.md'],
    },
];

/** Hosts whose schemas are only dependencies: vendored unmodified, never enriched. */
export const DEPENDENCY_HOSTS = ['geojson.org', 'proj.org', 'json-schema.org'];

/** `https://host/path` → `host/path`, the relative location under `schemas/` and `upstream/`. */
export function localPath(url) {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
}

export function isDependency(url) {
    return DEPENDENCY_HOSTS.includes(new URL(url).host);
}
