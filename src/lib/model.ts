export type StacType = 'Catalog' | 'Collection' | 'Feature';

export const STAC_TYPES: readonly StacType[] = ['Catalog', 'Collection', 'Feature'];

export const STAC_VERSIONS = ['1.1.0', '1.0.0'] as const;
export type StacVersion = (typeof STAC_VERSIONS)[number];

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type { FieldDoc, ValueDoc } from './field-docs';
import type { FieldDoc } from './field-docs';

/** `core` stands for the STAC core schema of the object type; other keys are extension schema URLs. */
export type SourceKey = string;
export const CORE: SourceKey = 'core';

/**
 * How a schema relates to a field at a location:
 * - `validated`: the schema checks the field's value there (an invalid value fails validation).
 * - `presence`: the schema does not check the value, but the field's presence there satisfies the
 *   extension's "use at least one of my fields" requirement (typical for `summaries`).
 */
export type PlacementKind = 'validated' | 'presence';

export interface Placement {
    source: SourceKey;
    field: string;
    /** JSON Pointer of the object that holds the field. */
    location: string;
    kind: PlacementKind;
}

export interface Conflict {
    source: SourceKey;
    field: string;
    location: string;
    /** The other schema that rejects the field when it is placed there. */
    rejectedBy: SourceKey;
}

export interface SourceInfo {
    key: SourceKey;
    url: string;
    title: string;
    /** Field prefixes such as `cube`; empty for unprefixed extensions like Themes. */
    prefixes: string[];
    version?: string;
    /** The schema's own description of itself. */
    description?: string;
    /** Fields found in the schema. */
    fields: string[];
    /** Fields for which no valid example value could be generated. */
    unsampled: string[];
    /** Title, description, type and allowed values of each field, from the schema. */
    docs: Record<string, FieldDoc>;
    error?: string;
}

export interface TypeTemplate {
    type: StacType;
    stacVersion: string;
    /** The "extreme case" document: every field placed everywhere a schema allows it. */
    doc: JsonObject;
    placements: Placement[];
    conflicts: Conflict[];
    /** Extensions that place no field in this object type. */
    notApplicable: SourceKey[];
    valid: boolean;
    errors: string[];
}

export interface ProbeResult {
    stacVersion: string;
    sources: SourceInfo[];
    templates: Record<StacType, TypeTemplate>;
}

export interface ProbeProgress {
    done: number;
    total: number;
    label: string;
}
