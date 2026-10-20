import { normalizeSchemaUrl } from './extensions';
import type { FetchJson } from './schemas';

// Vendored schemas, loaded on demand: `schemas/<host>/<path>` is the copy of `https://<host>/<path>`.
const loaders = import.meta.glob('../../schemas/**/*.json', { import: 'default' }) as Record<string, () => Promise<unknown>>;

const BY_URL = new Map(Object.entries(loaders).map(([path, load]) => [`https://${path.replace(/^.*\/schemas\//, '')}`, load]));

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
