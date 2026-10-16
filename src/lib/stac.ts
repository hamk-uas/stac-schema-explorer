import type { JsonObject, StacType } from './model';

export interface RealDoc {
    href: string;
    json: JsonObject;
    type: StacType;
    title: string;
    childLinks: { href: string; rel: string; title?: string }[];
    /** URL of an `items` link (STAC API) when the document has no `item` links. */
    itemsHref?: string;
}

export function stacVersionFor(version: unknown): string {
    if (typeof version === 'string' && version.startsWith('1.0')) return '1.0.0';
    return '1.1.0';
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toRealDoc(href: string, json: unknown): RealDoc {
    if (!isObject(json)) throw new Error('not a JSON object');
    const type = json.type;
    if (type !== 'Catalog' && type !== 'Collection' && type !== 'Feature') {
        throw new Error(`unsupported "type": ${JSON.stringify(type)} (expected Catalog, Collection or Feature)`);
    }
    const links = Array.isArray(json.links) ? json.links.filter(isObject) : [];
    const resolve = (target: unknown) => {
        try {
            return new URL(String(target), href).toString();
        } catch {
            return undefined;
        }
    };
    const childLinks = links
        .filter((l) => (l.rel === 'child' || l.rel === 'item') && typeof l.href === 'string')
        .map((l) => ({ href: resolve(l.href)!, rel: String(l.rel), title: typeof l.title === 'string' ? l.title : undefined }))
        .filter((l) => l.href);
    const items = links.find((l) => l.rel === 'items' && typeof l.href === 'string');
    return {
        href,
        json,
        type,
        title: typeof json.title === 'string' ? json.title : String(json.id ?? href),
        childLinks,
        itemsHref: childLinks.some((l) => l.rel === 'item') || !items ? undefined : resolve(items.href),
    };
}

const cache = new Map<string, Promise<RealDoc>>();

export function fetchDoc(href: string): Promise<RealDoc> {
    let pending = cache.get(href);
    if (!pending) {
        pending = fetch(href, { headers: { accept: 'application/json, application/geo+json' } })
            .then(async (response) => {
                if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
                return toRealDoc(response.url || href, await response.json());
            });
        pending.catch(() => cache.delete(href));
        cache.set(href, pending);
    }
    return pending;
}

/** Items of a STAC API `items` link, as documents with synthetic hrefs (`<items url>#<id>`). */
export async function fetchItems(href: string, limit: number): Promise<RealDoc[]> {
    const url = new URL(href);
    if (!url.searchParams.has('limit')) url.searchParams.set('limit', String(limit));
    const response = await fetch(url, { headers: { accept: 'application/geo+json, application/json' } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const json = await response.json();
    const features: unknown[] = Array.isArray(json?.features) ? json.features : [];
    return features.slice(0, limit).map((feature) => {
        const self = isObject(feature) && Array.isArray(feature.links)
            ? feature.links.find((l) => isObject(l) && l.rel === 'self' && typeof l.href === 'string')
            : undefined;
        const docHref = isObject(self) ? new URL(String(self.href), href).toString() : `${href}#${isObject(feature) ? String(feature.id) : ''}`;
        const doc = toRealDoc(docHref, feature);
        cache.set(docHref, Promise.resolve(doc));
        return doc;
    });
}
