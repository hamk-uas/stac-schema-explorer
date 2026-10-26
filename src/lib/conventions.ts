import crosswalkDocument from '../../schemas/hamk-uas.github.io/stac-schema-explorer/schemas/crosswalk.json';
import registryDocument from '../../schemas/hamk-uas.github.io/stac-schema-explorer/schemas/registry.json';
import { normalizeSchemaUrl } from './extensions';

/**
 * Data formats and the conventions that add fields to their embedded metadata (the counterparts of STAC core and STAC
 * extensions), from the registry and STAC crosswalk this repository publishes with its embedded-metadata schemas.
 */

export type ConventionKind = 'zarr-convention' | 'attribute-convention' | 'format-extension' | 'de-facto';

export interface DataFormat {
    id: string;
    title: string;
    schema: string;
    specification: string;
    description: string;
    mediaTypes: string[];
    nodeTypes: string[];
}

export interface KnownConvention {
    id: string;
    kind: ConventionKind;
    title: string;
    description: string;
    formats: string[];
    authored: boolean;
    specification: string;
    declaration?: { zarrConventions?: { uuid: string }; conventionsAttribute?: string };
    detection?: string[][];
    versions: { version: string; schema: string; specification?: string }[];
}

export interface CrosswalkEntry {
    id: string;
    embedded: { schema: string; path: string[]; nodes: 'root' | 'any' | string[] };
    stac: { schema?: string; paths: (string | number)[][]; in: ('asset' | 'document')[] };
    relation: 'same' | 'converted' | 'related';
    conversion?: string;
    note: string;
}

export const DATA_FORMATS = registryDocument.formats as DataFormat[];
export const KNOWN_CONVENTIONS = registryDocument.conventions as KnownConvention[];
export const CROSSWALK = crosswalkDocument.entries as CrosswalkEntry[];

/** Headings of the convention kinds, in the order the picker lists them. */
export const CONVENTION_KINDS: { kind: ConventionKind; title: string; hint: string }[] = [
    { kind: 'zarr-convention', title: 'Zarr conventions', hint: 'Declared in a node\'s zarr_conventions attribute (github.com/zarr-conventions).' },
    { kind: 'attribute-convention', title: 'Attribute conventions', hint: 'Declared in the global Conventions attribute of netCDF and Zarr.' },
    { kind: 'format-extension', title: 'Format extensions', hint: 'Recognised from their tags in TIFF files.' },
    { kind: 'de-facto', title: 'Tool conventions', hint: 'Written by software and recognised from their keys; not declared.' },
];

export const DEFAULT_CONVENTIONS: readonly string[] = ['proj', 'spatial', 'multiscales', 'cf', 'acdd']
    .map((id) => KNOWN_CONVENTIONS.find((c) => c.id === id)!.versions[0].schema);

/** Format schemas by URL. */
export function formatOfSchema(url: string): DataFormat | undefined {
    return DATA_FORMATS.find((format) => format.schema === normalizeSchemaUrl(url));
}

/** The known convention and version of a schema URL. */
export function conventionOfSchema(url: string): { convention: KnownConvention; version: string } | undefined {
    const normalized = normalizeSchemaUrl(url);
    for (const convention of KNOWN_CONVENTIONS) {
        const version = convention.versions.find((v) => v.schema === normalized);
        if (version) return { convention, version: version.version };
    }
    return undefined;
}

/** True for a schema of the embedded-metadata layer: a format schema or a known convention's schema. */
export function isEmbeddedSchema(url: string): boolean {
    return !!formatOfSchema(url) || !!conventionOfSchema(url);
}

/** `proj@v0.1`, `cf@1.13`… for known convention schemas; other URLs stay as they are. */
export function toConventionShortId(url: string): string {
    const known = conventionOfSchema(url);
    return known ? `${known.convention.id}@${known.version}` : normalizeSchemaUrl(url);
}

export function fromConventionShortId(id: string): string {
    const match = /^([a-z0-9-]+)@(\S+)$/.exec(id.trim());
    const convention = match && KNOWN_CONVENTIONS.find((c) => c.id === match[1]);
    const version = convention?.versions.find((v) => v.version === match![2]);
    return version ? version.schema : normalizeSchemaUrl(id);
}

/** The schema URLs a convention's fields are documented by: the convention itself, or the format for its core fields. */
const schemaMatches = (entry: CrosswalkEntry, schemaUrl: string) => entry.embedded.schema === normalizeSchemaUrl(schemaUrl);

/**
 * STAC fields that a field of embedded metadata corresponds to; `path` is the field's path in its node, such as
 * `['attributes', 'title']`. A field holding an object (`gdal_metadata`) also gets the correspondences of its contents.
 */
export function stacCounterparts(schemaUrl: string, path: readonly string[]): CrosswalkEntry[] {
    return CROSSWALK.filter((entry) => schemaMatches(entry, schemaUrl)
        && entry.embedded.path.slice(0, path.length).every((segment, i) => segment === '*' || segment === path[i]));
}

/** Embedded fields that a STAC field corresponds to (by the field's key, and its extension schema unless it is core). */
export function embeddedCounterparts(field: string, extensionUrl?: string): CrosswalkEntry[] {
    return CROSSWALK.filter((entry) => entry.stac.paths.some((path) => path[0] === field)
        && (!entry.stac.schema || !extensionUrl || entry.stac.schema === normalizeSchemaUrl(extensionUrl)));
}

/** A readable name of the schema an embedded field comes from: `Zarr v3`, `proj v0.1 (Zarr convention)`, `CF 1.13`. */
export function embeddedSchemaLabel(url: string): string {
    const format = formatOfSchema(url);
    if (format) return format.title;
    const known = conventionOfSchema(url);
    return known ? `${known.convention.title} ${known.version}` : url;
}
