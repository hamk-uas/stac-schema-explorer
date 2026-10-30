import type { JsonObject, SourceInfo, StacType, TypeTemplate } from './model';
import type { DataView } from './embedded-docs';
import type { ObjectView, Undeclared } from './tree';

/** A STAC document (separate JSON file) in the catalog tree. */
export interface DocEntry {
    key: string;
    type: StacType;
    /** Role in the example hierarchy ("root", "sub-catalog"), or the link relation in a real catalog. */
    role?: string;
    title: string;
    href?: string;
    /** The document as shown, validated and downloaded: `original` with its rewrites applied. */
    doc?: JsonObject;
    /** The document as loaded, of a real document. */
    original?: JsonObject;
    /** Number of rewrites applied to `original`. */
    rewrites?: number;
    view?: ObjectView;
    template?: TypeTemplate;
    sources?: SourceInfo[];
    stacVersion?: string;
    errors?: string[];
    /** Undefined while validating. */
    valid?: boolean;
    status: 'idle' | 'loading' | 'ready' | 'error';
    error?: string;
    expanded: boolean;
    children: DocEntry[];
    /** Child links not yet shown. */
    remaining: { href: string; rel: string; title?: string }[];
    itemsHref?: string;
    /** Extensions of the template this document is shown against. */
    templateUrls?: string[];
    /** Show only the header (the example sub-catalog repeats the root catalog). */
    compact?: boolean;
    /** The data files of its assets whose embedded metadata can be read. */
    data?: DataView[];
    /** Extensions whose fields a real document uses without declaring them. */
    undeclared?: Undeclared[];
}

export const TYPE_LABEL: Record<StacType, string> = { Catalog: 'Catalog', Collection: 'Collection', Feature: 'Item' };
