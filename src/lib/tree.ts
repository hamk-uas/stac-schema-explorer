import { isProbeableLocation } from './base-docs';
import { CORE_KEYS, prefixOf } from './fields';
import { CORE, type Json, type JsonObject, type PlacementKind, type SourceInfo, type SourceKey, type TypeTemplate } from './model';
import { getAt, joinPointer, objectLocations, splitPointer } from './pointer';

export type ObjectKind =
    | 'root' | 'properties' | 'summaries' | 'asset' | 'item-asset' | 'link' | 'provider' | 'band' | 'dimension' | 'variable'
    | 'column' | 'other';

/**
 * - `populated`: present in the document.
 * - `possible`: allowed here by the schemas but absent (only in views of real documents).
 * - `unexpected`: present, but no schema the document is compared with (selected or declared) places this field here.
 */
export type FieldState = 'populated' | 'possible' | 'unexpected';

/** A rewrite of the document: the field was added, or removed (and is shown although absent). */
export type FieldEdit = 'added' | 'removed';

/** How the rewrites of a document mark its fields, per object. */
export interface FieldEdits {
    at(pointer: string, field: string): FieldEdit | undefined;
    /** Removed fields of an object, which are shown although absent. */
    removedAt(pointer: string): string[];
}

export interface FieldView {
    name: string;
    /** Source key, `?prefix` for fields of an unknown prefix, or `?` for other unknown fields. */
    source: SourceKey;
    state: FieldState;
    kind?: PlacementKind;
    edit?: FieldEdit;
}

export interface ObjectView {
    pointers: string[];
    shape: string;
    kind: ObjectKind;
    label: string;
    /** Names of merged siblings (asset keys, dimension names, band names). */
    names: string[];
    fields: FieldView[];
    children: ObjectView[];
}

export const MAP_KEYS = new Set(['assets', 'item_assets', 'cube:dimensions', 'cube:variables', 'table:tables', 'storage:schemes', 'renders']);

/** Replaces array indices and keys of known maps with `*`, so equivalent objects of different documents match. */
export function shapeOf(pointer: string): string {
    const segments = splitPointer(pointer);
    return segments
        .map((segment, i) => (/^\d+$/.test(segment) || (i > 0 && MAP_KEYS.has(segments[i - 1])) ? '*' : segment))
        .reduce((acc, s) => joinPointer(acc, s), '');
}

export function kindOf(pointer: string): ObjectKind {
    if (pointer === '') return 'root';
    const segments = splitPointer(pointer);
    const parent = segments[segments.length - 2];
    const last = segments[segments.length - 1];
    if (segments.length === 1 && last === 'properties') return 'properties';
    if (segments.length === 1 && last === 'summaries') return 'summaries';
    if (segments.length === 2 && parent === 'assets') return 'asset';
    if (segments.length === 2 && parent === 'item_assets') return 'item-asset';
    if (parent === 'links') return 'link';
    if (parent === 'providers') return 'provider';
    if (parent === 'bands') return 'band';
    if (parent === 'cube:dimensions') return 'dimension';
    if (parent === 'cube:variables') return 'variable';
    if (parent === 'table:columns') return 'column';
    return 'other';
}

const KIND_ORDER: ObjectKind[] = ['root', 'properties', 'summaries', 'provider', 'asset', 'item-asset', 'band', 'dimension', 'variable', 'column', 'link', 'other'];

function nameOf(pointer: string, node: Json | undefined): string {
    const segments = splitPointer(pointer);
    const last = segments[segments.length - 1] ?? '';
    const kind = kindOf(pointer);
    const obj = node && typeof node === 'object' && !Array.isArray(node) ? (node as JsonObject) : undefined;
    if (kind === 'link') return typeof obj?.rel === 'string' ? obj.rel : last;
    if ((kind === 'band' || kind === 'column' || kind === 'provider') && typeof obj?.name === 'string') return obj.name;
    return last;
}

function labelOf(kind: ObjectKind, pointer: string, names: string[]): string {
    const list = names.length > 4 ? `${names.slice(0, 3).join(', ')}, … (${names.length})` : names.join(', ');
    switch (kind) {
        case 'root': return '';
        case 'properties': return 'properties';
        case 'summaries': return 'summaries';
        case 'asset': return `Asset ${list}`;
        case 'item-asset': return `Item Asset ${list}`;
        case 'link': return `Link ${list}`;
        case 'provider': return `Provider ${list}`;
        case 'band': return `Band ${list}`;
        case 'dimension': return `cube:dimensions › ${list}`;
        case 'variable': return `cube:variables › ${list}`;
        case 'column': return `table:columns › ${list}`;
        default: {
            const segments = splitPointer(pointer);
            const tail = segments.slice(-2).map((s) => (/^\d+$/.test(s) ? `[${s}]` : s)).join(' › ');
            return names.length > 1 ? `${tail.replace(/[^›]*$/, '')} ${list}` : tail;
        }
    }
}

function fieldSignature(fields: FieldView[]): string {
    return fields.map((f) => `${f.source}|${f.name}|${f.state}|${f.kind ?? ''}|${f.edit ?? ''}`).sort().join(',');
}

function signature(node: ObjectView): string {
    return `${node.shape}#${fieldSignature(node.fields)}#[${node.children.map(signature).join(';')}]`;
}

function absorb(target: ObjectView, node: ObjectView): void {
    target.pointers.push(...node.pointers);
    for (const name of node.names) if (!target.names.includes(name)) target.names.push(name);
    target.children.forEach((child, i) => node.children[i] && absorb(child, node.children[i]));
}

function relabel(node: ObjectView): void {
    node.label = labelOf(node.kind, node.pointers[0], node.names);
    node.children.forEach(relabel);
}

/** Merges siblings of the same shape whose fields and children are identical. */
function mergeSiblings(nodes: ObjectView[]): ObjectView[] {
    const out: ObjectView[] = [];
    const bySignature = new Map<string, ObjectView>();
    for (const node of nodes) {
        node.children = mergeSiblings(node.children);
        const key = node.kind === 'root' || node.kind === 'properties' || node.kind === 'summaries' ? `${node.pointers[0]}` : signature(node);
        const existing = bySignature.get(key);
        if (existing && existing.kind === node.kind) absorb(existing, node);
        else {
            bySignature.set(key, node);
            out.push(node);
        }
    }
    out.forEach(relabel);
    return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

function buildTree(doc: JsonObject, locations: string[], fieldsAt: (pointer: string) => FieldView[]): ObjectView {
    const nodes = new Map<string, ObjectView>();
    const sorted = [...new Set(['', ...locations])].sort((a, b) => splitPointer(a).length - splitPointer(b).length);
    for (const pointer of sorted) {
        const kind = kindOf(pointer);
        const name = nameOf(pointer, getAt(doc, pointer));
        nodes.set(pointer, { pointers: [pointer], shape: shapeOf(pointer), kind, label: '', names: name ? [name] : [], fields: fieldsAt(pointer), children: [] });
    }
    for (const pointer of sorted) {
        if (pointer === '') continue;
        const segments = splitPointer(pointer);
        let parent: ObjectView | undefined;
        for (let n = segments.length - 1; n >= 0 && !parent; n--) {
            parent = nodes.get(segments.slice(0, n).reduce((acc, s) => joinPointer(acc, s), ''));
        }
        parent?.children.push(nodes.get(pointer)!);
    }
    const root = nodes.get('')!;
    return mergeSiblings([root])[0];
}

function pruneEmpty(node: ObjectView, keep: (node: ObjectView) => boolean): ObjectView {
    node.children = node.children.map((c) => pruneEmpty(c, keep)).filter((c) => c.fields.length > 0 || c.children.length > 0 || keep(c));
    return node;
}

const ALWAYS_SHOWN: ObjectKind[] = ['properties', 'asset', 'item-asset'];

/** The conceptual view of a template: every placement, all populated. */
export function templateView(template: TypeTemplate, showCore: boolean): ObjectView {
    const visible = template.placements.filter((p) => showCore || p.source !== CORE);
    const locations = [...new Set([...visible.map((p) => p.location), ...objectLocations(template.doc).filter((l) => ALWAYS_SHOWN.includes(kindOf(l)))])];
    const tree = buildTree(template.doc, locations, (pointer) =>
        visible.filter((p) => p.location === pointer).map((p) => ({ name: p.field, source: p.source, state: 'populated' as const, kind: p.kind })));
    return pruneEmpty(tree, (n) => ALWAYS_SHOWN.includes(n.kind));
}

/**
 * The view of a real document against the template of its type: populated fields are highlighted within all fields
 * the schemas would allow at the same place. `edits` marks the fields rewritten in `doc`; removed ones are kept as chips.
 */
export function documentView(doc: JsonObject, template: TypeTemplate | undefined, sources: SourceInfo[], showCore: boolean, edits?: FieldEdits): ObjectView {
    // When several schemas claim a prefix, the most specific one (fewest prefixes) owns it.
    const bySpecificity = [...sources].sort((a, b) => a.prefixes.length - b.prefixes.length);
    const knownPrefixes = new Map<string, SourceKey>();
    for (const s of bySpecificity) for (const p of s.prefixes) if (!knownPrefixes.has(p)) knownPrefixes.set(p, s.key);
    const ownerByField = new Map<string, SourceKey>();
    for (const source of sources) for (const field of source.fields) if (knownPrefixes.get(prefixOf(field) ?? '') === source.key) ownerByField.set(field, source.key);
    for (const source of sources) for (const field of source.fields) if (!ownerByField.has(field)) ownerByField.set(field, source.key);

    const possibleByShape = new Map<string, Map<string, { source: SourceKey; kind: PlacementKind }>>();
    for (const p of template?.placements ?? []) {
        if (!showCore && p.source === CORE) continue;
        const shape = shapeOf(p.location);
        const map = possibleByShape.get(shape) ?? new Map();
        const current = map.get(p.field);
        const better = !current
            || (current.source !== ownerByField.get(p.field) && p.source === ownerByField.get(p.field))
            || (current.source === p.source && p.kind === 'validated');
        if (better) map.set(p.field, { source: p.source, kind: p.kind });
        possibleByShape.set(shape, map);
    }

    const fieldsAt = (pointer: string): FieldView[] => {
        const node = getAt(doc, pointer);
        if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
        const present = new Set(Object.keys(node));
        const removed = edits?.removedAt(pointer).filter((name) => !present.has(name)) ?? [];
        const possible = possibleByShape.get(shapeOf(pointer)) ?? new Map();
        const out: FieldView[] = [];
        const mark = (field: FieldView): FieldView => {
            const edit = edits?.at(pointer, field.name);
            return edit ? { ...field, edit } : field;
        };
        for (const [name, { source, kind }] of possible) out.push(mark({ name, source, kind, state: present.has(name) ? 'populated' : 'possible' }));
        for (const name of [...present, ...removed]) {
            if (possible.has(name)) continue;
            // A removed field that no schema places here is shown as it was, but absent.
            const state = present.has(name) ? 'unexpected' : 'possible';
            const owner = ownerByField.get(name);
            if (owner === CORE && !showCore) continue;
            // Summaries may summarize any field of the Items, so known fields there are never out of place.
            if (owner) out.push(mark({ name, source: owner, state: pointer === '/summaries' && state === 'unexpected' ? 'populated' : state }));
            else if (prefixOf(name)) out.push(mark({ name, source: knownPrefixes.get(prefixOf(name)!) ?? `?${prefixOf(name)}`, state }));
            else if (!CORE_KEYS.has(name) && pointer !== '/summaries' && kindOf(pointer) !== 'dimension' && kindOf(pointer) !== 'variable' && kindOf(pointer) !== 'column') {
                out.push(mark({ name, source: '?', state }));
            }
        }
        return out;
    };

    const shapes = new Set(possibleByShape.keys());
    const locations = objectLocations(doc).filter((l) => isProbeableLocation(l) && (shapes.has(shapeOf(l)) || ALWAYS_SHOWN.includes(kindOf(l)) || fieldsAt(l).some((f) => (f.state === 'unexpected' && f.source !== '?') || f.edit)));
    const tree = buildTree(doc, locations, fieldsAt);
    return pruneEmpty(tree, (n) => ALWAYS_SHOWN.includes(n.kind));
}

export interface FieldGroup {
    source: SourceKey;
    label: string;
    fields: FieldView[];
    /** Every field of the source is here. */
    complete: boolean;
}

export function groupFields(fields: FieldView[], sources: SourceInfo[]): FieldGroup[] {
    const groups = new Map<SourceKey, FieldView[]>();
    for (const field of fields) groups.set(field.source, [...(groups.get(field.source) ?? []), field]);
    return [...groups.entries()].map(([source, list]) => {
        const info = sources.find((s) => s.key === source);
        const complete = !!info && info.fields.length > 1 && info.fields.every((f) => list.some((l) => l.name === f));
        let label: string;
        if (source === CORE) label = 'core';
        else if (source.startsWith('?')) label = source === '?' ? list.map((f) => f.name).join(', ') : `${source.slice(1)}:*`;
        else if (info && info.prefixes.length > 0) label = prefixedLabel(list, info);
        else label = list.length > 2 ? `${list[0].name}, … (${list.length})` : list.map((f) => f.name).join(', ');
        return { source, label, fields: list, complete };
    });
}

/**
 * `cube:*` when every field of an own prefix is here; otherwise the fields by name (shortened when there are many).
 * Other schemas' fields (`cf:cell_methods` validated by the Observatory extension) are always listed by name.
 */
function prefixedLabel(list: FieldView[], info: SourceInfo): string {
    const parts: string[] = [];
    for (const prefix of info.prefixes) {
        const here = list.filter((f) => prefixOf(f.name) === prefix);
        const all = info.fields.filter((f) => prefixOf(f) === prefix);
        if (here.length === 0) continue;
        if (here.length === all.length && all.length > 1) parts.push(`${prefix}:*`);
        else if (here.length <= 2) parts.push(...here.map((f) => f.name));
        else parts.push(`${here[0].name}, … (${here.length} of ${all.length} ${prefix}:)`);
    }
    const foreign = list.filter((f) => !info.prefixes.includes(prefixOf(f.name) ?? ''));
    parts.push(...foreign.map((f) => f.name));
    return parts.join(', ');
}

/** Pointers of every field of a view, keyed `<object pointer>|<field>`, for highlighting in the JSON view. */
export function fieldIndex(view: ObjectView): Map<string, FieldView> {
    const index = new Map<string, FieldView>();
    const visit = (node: ObjectView) => {
        for (const pointer of node.pointers) for (const field of node.fields) index.set(`${pointer}|${field.name}`, field);
        node.children.forEach(visit);
    };
    visit(view);
    return index;
}
