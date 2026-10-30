import { normalizeSchemaUrl } from './extensions';
import type { FetchJson } from './schemas';

// Vendored schemas, loaded on demand: `schemas/<host>/<path>` is the copy of `https://<host>/<path>`. The registry,
// crosswalk and software list beside the authored schemas are data, imported by conventions.ts and software.ts.
const loaders = import.meta.glob(['../../schemas/**/*.json', '!../../schemas/hamk-uas.github.io/stac-schema-explorer/schemas/{registry,crosswalk,software}.json'],
    { import: 'default' }) as Record<string, () => Promise<unknown>>;

// The first `schemas/` is this repository's directory; authored schemas have another one in their URL path.
const BY_URL = new Map(Object.entries(loaders).map(([path, load]) => [`https://${path.replace(/^.*?\/schemas\//, '')}`, load]));

/** True when this repository vendors the schema (with documented fields and values). */
export function isVendored(url: string): boolean {
    return BY_URL.has(normalizeSchemaUrl(url));
}

export function vendoredUrls(): string[] {
    return [...BY_URL.keys()].sort();
}

/** Serves vendored copies first and falls back to `fetchJson` for everything else. */
export function withVendored(fetchJson: FetchJson): FetchJson {
    return async (url) => {
        const load = BY_URL.get(normalizeSchemaUrl(url));
        return load ? load() : fetchJson(url);
    };
}
