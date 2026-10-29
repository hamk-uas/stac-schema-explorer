import { conventionOfSchema } from './conventions';
import { CORE, type Json, type JsonObject, type Placement } from './model';
import { getAt, joinPointer } from './pointer';
import { shapeOf, type FieldEdit, type FieldEdits } from './tree';

/**
 * A local change to a real document (a STAC document or a node of embedded metadata): a field added with the example
 * value of its template, or a present field removed. The original document is kept; the rewritten one is shown,
 * validated, copied and downloaded.
 */
export interface Rewrite {
    op: 'add' | 'remove';
    /** Key of the document: its URL, or `node:<metadata document>#<path>` for a node of embedded metadata. */
    doc: string;
    /** Object the field is in (JSON Pointer). */
    pointer: string;
    field: string;
    /** Schema of the field: `core`, an extension, format or convention schema URL, or `?…` for unknown fields. */
    source: string;
}

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const clone = <T extends Json>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Schemas whose fields the rewrites add and that a document must declare (not core, formats or unknown fields). */
export function addedSchemas(rewrites: readonly Rewrite[], exclude: readonly string[] = []): string[] {
    return [...new Set(rewrites.filter((r) => r.op === 'add' && r.source !== CORE && !r.source.startsWith('?') && !exclude.includes(r.source)).map((r) => r.source))];
}

/** The template's example value of a field at the place of `pointer` (same shape), preferring the field's own schema. */
export function templateValue(template: { doc: JsonObject; placements: Placement[] } | undefined, rewrite: Rewrite): Json | undefined {
    if (!template) return undefined;
    const shape = shapeOf(rewrite.pointer);
    const candidates = template.placements.filter((p) => p.field === rewrite.field && shapeOf(p.location) === shape);
    const placement = candidates.find((p) => p.source === rewrite.source) ?? candidates[0];
    return placement ? getAt(template.doc, joinPointer(placement.location, rewrite.field)) : undefined;
}

/** Applies rewrites in order to a copy of `doc`; a rewrite whose object is missing (inside an undone addition) is skipped. */
export function applyRewrites(doc: JsonObject, rewrites: readonly Rewrite[], valueOf: (rewrite: Rewrite) => Json | undefined): JsonObject {
    const out = clone(doc);
    for (const rewrite of rewrites) {
        const target = getAt(out, rewrite.pointer);
        if (!isObject(target)) continue;
        if (rewrite.op === 'remove') delete target[rewrite.field];
        else {
            const value = valueOf(rewrite);
            if (value !== undefined) target[rewrite.field] = clone(value);
        }
    }
    return out;
}

/** Adds the schema URLs of added extension fields to `stac_extensions`. */
export function declareStacExtensions(doc: JsonObject, schemas: readonly string[]): JsonObject {
    const declared = Array.isArray(doc.stac_extensions) ? doc.stac_extensions : [];
    const missing = schemas.filter((url) => !declared.includes(url));
    return missing.length ? { ...doc, stac_extensions: [...declared, ...missing] } : doc;
}

/**
 * Declares the conventions of added fields in a node of embedded metadata: a Zarr convention by its `zarr_conventions`
 * entry (taken from the template, which declares it), an attribute convention (CF, ACDD) by a token of the root's
 * `Conventions` attribute. Returns the node unchanged when there is nothing to declare.
 */
export function declareZarrConventions(node: JsonObject, schemas: readonly string[], template: JsonObject | undefined): JsonObject {
    const attributes = isObject(node.attributes) ? node.attributes : undefined;
    if (!attributes) return node;
    const declared = Array.isArray(attributes.zarr_conventions) ? attributes.zarr_conventions : [];
    const offered = isObject(template?.attributes) && Array.isArray(template.attributes.zarr_conventions) ? template.attributes.zarr_conventions : [];
    const additions: Json[] = [];
    for (const url of schemas) {
        const uuid = conventionOfSchema(url)?.convention.declaration?.zarrConventions?.uuid;
        if (!uuid || declared.some((d) => isObject(d) && d.uuid === uuid)) continue;
        const entry = offered.find((d) => isObject(d) && d.uuid === uuid);
        additions.push(entry ? clone(entry) : { uuid, schema_url: url });
    }
    return additions.length ? { ...node, attributes: { ...attributes, zarr_conventions: [...declared, ...additions] } } : node;
}

/** `CF-1.13`, `ACDD-1.3`: the `Conventions` token of an attribute convention schema, if it has one. */
export function conventionsToken(url: string): string | undefined {
    const known = conventionOfSchema(url);
    const pattern = known?.convention.declaration?.conventionsAttribute;
    const name = pattern ? /^\^([A-Za-z]+)-/.exec(pattern)?.[1] : undefined;
    return name && known ? `${name}-${known.version.replace(/^v/, '')}` : undefined;
}

/** Adds tokens to the `Conventions` attribute of a root node (netCDF and Zarr global attributes). */
export function declareConventionsAttribute(root: JsonObject, schemas: readonly string[]): JsonObject {
    const attributes = isObject(root.attributes) ? root.attributes : undefined;
    if (!attributes) return root;
    const current = typeof attributes.Conventions === 'string' ? attributes.Conventions : '';
    const present = current.split(/[\s,]+/).filter(Boolean);
    const tokens = schemas.map(conventionsToken).filter((t): t is string => !!t && !present.some((p) => p.split('-')[0] === t.split('-')[0]));
    if (!tokens.length) return root;
    const separator = current.includes(',') ? ', ' : ' ';
    return { ...root, attributes: { ...attributes, Conventions: [current, ...tokens].filter(Boolean).join(separator) } };
}

/** How the rewrites of one document mark its fields (see {@link FieldEdits}). */
export function fieldEdits(rewrites: readonly Rewrite[]): FieldEdits | undefined {
    if (!rewrites.length) return undefined;
    const marks = new Map<string, FieldEdit>();
    for (const r of rewrites) marks.set(`${r.pointer}|${r.field}`, r.op === 'add' ? 'added' : 'removed');
    return {
        at: (pointer, field) => marks.get(`${pointer}|${field}`),
        removedAt: (pointer) => rewrites.filter((r) => r.pointer === pointer && r.op === 'remove').map((r) => r.field),
    };
}

/**
 * Toggles the rewrite of a field in some objects (merged siblings): undoes existing rewrites of it (and of fields within
 * an addition being undone), or adds one per object.
 */
export function toggleRewrite(rewrites: readonly Rewrite[], doc: string, pointers: readonly string[], field: string, source: string, present: boolean): Rewrite[] {
    const mine = (r: Rewrite) => r.doc === doc && pointers.includes(r.pointer) && r.field === field;
    if (rewrites.some(mine)) {
        const inside = pointers.map((p) => joinPointer(p, field));
        return rewrites.filter((r) => !mine(r) && !(r.doc === doc && inside.some((p) => r.pointer === p || r.pointer.startsWith(`${p}/`))));
    }
    return [...rewrites, ...pointers.map((pointer): Rewrite => ({ op: present ? 'remove' : 'add', doc, pointer, field, source }))];
}
