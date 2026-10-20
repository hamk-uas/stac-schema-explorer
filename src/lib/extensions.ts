/** Extensions discussed in the Observatory project, offered as quick-select buttons. */
export interface KnownExtension {
    name: string;
    title: string;
    versions: { version: string; url: string }[];
    note?: string;
}

const se = (name: string, title: string, versions: string[], note?: string): KnownExtension => ({
    name,
    title,
    versions: versions.map((version) => ({ version, url: `https://stac-extensions.github.io/${name}/v${version}/schema.json` })),
    note,
});

export const KNOWN_EXTENSIONS: readonly KnownExtension[] = [
    se('datacube', 'Datacube', ['2.3.0', '2.2.0']),
    se('cf', 'CF', ['1.0.0']),
    se('themes', 'Themes', ['1.0.0']),
    {
        name: 'semantics',
        title: 'Semantics',
        versions: [{ version: '0.1.0', url: 'https://hamk-uas.github.io/stac-semantics/v0.1.0/schema.json' }],
        note: 'hamk-uas/stac-semantics',
    },
    {
        name: 'observatory',
        title: 'Observatory',
        versions: [{ version: 'dev', url: 'https://sklvarjo.github.io/observatory-stac-extension/schema.json' }],
        note: 'sklvarjo/observatory-stac-extension',
    },
    se('table', 'Table', ['1.3.0', '1.2.0']),
    se('classification', 'Classification', ['2.0.0']),
    se('eo', 'EO', ['2.0.0']),
    se('raster', 'Raster', ['2.0.0']),
    se('projection', 'Projection', ['2.0.0']),
    se('file', 'File Info', ['2.1.0']),
    se('zarr', 'Zarr', ['1.1.0']),
    se('scientific', 'Scientific', ['1.0.0']),
    se('attribution', 'Attribution', ['0.1.0']),
    se('processing', 'Processing', ['1.2.0']),
    se('product', 'Product', ['1.0.0']),
    se('timestamps', 'Timestamps', ['1.1.0']),
    se('version', 'Version', ['1.2.0']),
    se('language', 'Language', ['1.0.0']),
    se('contacts', 'Contacts', ['0.1.1']),
    se('storage', 'Storage', ['2.0.0']),
    se('render', 'Render', ['2.0.0']),
    se('sat', 'Satellite', ['1.2.0']),
    se('view', 'View', ['1.1.0']),
    se('grid', 'Grid', ['1.1.0']),
    se('mgrs', 'MGRS', ['1.0.0']),
    se('ceos-ard', 'CEOS-ARD', ['0.2.0']),
    {
        name: 'eopf',
        title: 'EOPF',
        versions: [{ version: '1.2.0', url: 'https://cs-si.github.io/eopf-stac-extension/v1.2.0/schema.json' }],
        note: 'cs-si/eopf-stac-extension',
    },
    se('item-assets', 'Item Assets', ['1.0.0'], 'core in STAC 1.1.0'),
];

export const DEFAULT_EXTENSIONS: readonly string[] = [
    'https://stac-extensions.github.io/datacube/v2.3.0/schema.json',
    'https://stac-extensions.github.io/cf/v1.0.0/schema.json',
    'https://stac-extensions.github.io/themes/v1.0.0/schema.json',
    'https://hamk-uas.github.io/stac-semantics/v0.1.0/schema.json',
];

const STAC_EXTENSIONS_URL = /^https:\/\/stac-extensions\.github\.io\/([a-z0-9-]+)\/v([0-9][^/]*)\/schema\.json$/;

export function normalizeSchemaUrl(url: string): string {
    return url.trim().replace(/#$/, '');
}

/** `https://stac-extensions.github.io/cf/v1.0.0/schema.json` ↔ `cf@1.0.0`; other URLs stay as they are. */
export function toShortId(url: string): string {
    const match = STAC_EXTENSIONS_URL.exec(normalizeSchemaUrl(url));
    return match ? `${match[1]}@${match[2]}` : normalizeSchemaUrl(url);
}

export function fromShortId(id: string): string {
    const trimmed = id.trim();
    const match = /^([a-z0-9-]+)@v?([0-9][^/\s]*)$/.exec(trimmed);
    if (match) return `https://stac-extensions.github.io/${match[1]}/v${match[2]}/schema.json`;
    return normalizeSchemaUrl(trimmed);
}

/** Best-effort name and version of an extension from its schema URL; `known` for quick-select extensions. */
export function describeUrl(url: string): { name: string; version?: string; known: boolean } {
    const normalized = normalizeSchemaUrl(url);
    for (const known of KNOWN_EXTENSIONS) {
        const hit = known.versions.find((v) => v.url === normalized);
        if (hit) return { name: known.title, version: hit.version === 'dev' ? undefined : hit.version, known: true };
    }
    const match = /\/([a-z0-9_-]+)\/v?(\d+\.\d+\.\d+[^/]*)\/[^/]*$/i.exec(normalized);
    if (match) return { name: match[1], version: match[2], known: false };
    const parts = new URL(normalized).pathname.split('/').filter(Boolean);
    return { name: parts.length > 1 ? parts[parts.length - 2] : new URL(normalized).hostname, known: false };
}
