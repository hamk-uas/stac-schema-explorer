import type { JsonObject, StacType } from './model';

/**
 * Minimal valid STAC objects with one representative of every core sub-object: a link, a provider, an asset,
 * an item asset and an (empty) summaries object. Extension fields are probed into these.
 */
export function baseDocument(type: StacType, stacVersion: string): JsonObject {
    const common = { stac_version: stacVersion, stac_extensions: [] };
    if (type === 'Catalog') {
        return {
            type: 'Catalog',
            ...common,
            id: 'example-catalog',
            title: 'Example catalog',
            description: 'A catalog',
            links: [{ rel: 'child', href: './collection.json', type: 'application/json' }],
        };
    }
    if (type === 'Collection') {
        return {
            type: 'Collection',
            ...common,
            id: 'example-collection',
            title: 'Example collection',
            description: 'A collection',
            keywords: ['example'],
            license: 'CC-BY-4.0',
            providers: [{ name: 'Example provider', roles: ['producer'] }],
            extent: {
                spatial: { bbox: [[19.0, 59.0, 32.0, 70.0]] },
                temporal: { interval: [['2024-01-01T00:00:00Z', null]] },
            },
            summaries: {},
            links: [{ rel: 'item', href: './item.json', type: 'application/geo+json' }],
            assets: {
                data: { href: 'https://example.com/data.zarr', type: 'application/vnd.zarr; version=3', roles: ['data'], title: 'Data' },
            },
            item_assets: {
                data: { type: 'application/vnd.zarr; version=3', roles: ['data'], title: 'Data' },
            },
        };
    }
    return {
        type: 'Feature',
        ...common,
        id: 'example-item',
        collection: 'example-collection',
        geometry: {
            type: 'Polygon',
            coordinates: [[[19.0, 59.0], [32.0, 59.0], [32.0, 70.0], [19.0, 70.0], [19.0, 59.0]]],
        },
        bbox: [19.0, 59.0, 32.0, 70.0],
        properties: { datetime: '2024-01-01T00:00:00Z' },
        links: [{ rel: 'collection', href: './collection.json', type: 'application/json' }],
        assets: {
            data: { href: 'https://example.com/data.zarr', type: 'application/vnd.zarr; version=3', roles: ['data'], title: 'Data' },
        },
    };
}

/** Locations never probed: geometry, extents and the insides of summary values. */
export function isProbeableLocation(pointer: string): boolean {
    return !/^\/(geometry|extent|bbox|stac_extensions)(\/|$)/.test(pointer) && !/^\/summaries\/./.test(pointer);
}
