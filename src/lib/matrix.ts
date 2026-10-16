import { isProbeableLocation } from './base-docs';
import { CORE, STAC_TYPES, type PlacementKind, type SourceInfo, type SourceKey, type StacType, type TypeTemplate } from './model';
import { joinPointer, objectLocations, splitPointer } from './pointer';
import { kindOf, MAP_KEYS } from './tree';

export interface MatrixColumn {
    key: string;
    type: StacType;
    /** Conceptual path, e.g. `['Asset', 'Band']`; empty for the top level. */
    path: string[];
    /** Concrete locations in the template document that this column stands for. */
    locations: string[];
}

export interface MatrixCell {
    kind: PlacementKind;
    /** Locations of the column where the field is placed. */
    locations: string[];
    /** Placed in only some of the column's locations (e.g. only in temporal `cube:dimensions`). */
    partial: boolean;
}

export interface MatrixRow {
    source: SourceKey;
    field: string;
}

export interface PlacementMatrix {
    columns: MatrixColumn[];
    rows: MatrixRow[];
    cells: Map<string, MatrixCell>;
}

const KIND_LABEL: Record<string, string> = {
    properties: 'properties',
    summaries: 'summaries',
    asset: 'Asset',
    'item-asset': 'Item Asset',
    link: 'Link',
    provider: 'Provider',
    band: 'Band',
    dimension: 'cube:dimension',
    variable: 'cube:variable',
    column: 'table:column',
};

export function conceptPath(pointer: string, locations: Set<string>): string[] {
    const segments = splitPointer(pointer);
    const path: string[] = [];
    for (let n = 1; n <= segments.length; n++) {
        const prefix = segments.slice(0, n).reduce((acc, s) => joinPointer(acc, s), '');
        if (!locations.has(prefix) || MAP_KEYS.has(segments[n - 1])) continue;
        const kind = kindOf(prefix);
        path.push(KIND_LABEL[kind] ?? (/^\d+$/.test(segments[n - 1]) ? `${segments[n - 2]}[]` : segments[n - 1]));
    }
    return path;
}

export const TYPE_LABEL: Record<StacType, string> = { Catalog: 'Catalog', Collection: 'Collection', Feature: 'Item' };

export function buildMatrix(templates: Record<StacType, TypeTemplate>, sources: SourceInfo[], showCore: boolean): PlacementMatrix {
    const columns = new Map<string, MatrixColumn>();
    const cells = new Map<string, MatrixCell>();
    const rowKeys = new Set<string>();

    for (const type of STAC_TYPES) {
        const template = templates[type];
        const locations = new Set(objectLocations(template.doc).filter(isProbeableLocation));
        for (const location of locations) {
            // Maps such as `assets` or `cube:dimensions` are structure, not places for fields.
            if (MAP_KEYS.has(splitPointer(location).at(-1) ?? '')) continue;
            const path = conceptPath(location, locations);
            const key = `${type} ${path.join(' › ')}`;
            const column = columns.get(key) ?? { key, type, path, locations: [] };
            column.locations.push(location);
            columns.set(key, column);
        }
        for (const p of template.placements) {
            if (!showCore && p.source === CORE) continue;
            const key = `${type} ${conceptPath(p.location, locations).join(' › ')}`;
            const cellKey = `${p.source}|${p.field}|${key}`;
            rowKeys.add(`${p.source}|${p.field}`);
            const cell = cells.get(cellKey) ?? { kind: p.kind, locations: [], partial: false };
            if (p.kind === 'validated') cell.kind = 'validated';
            cell.locations.push(p.location);
            cells.set(cellKey, cell);
        }
    }
    for (const [cellKey, cell] of cells) {
        const column = columns.get(cellKey.split('|')[2])!;
        cell.partial = cell.locations.length < column.locations.length;
    }

    const usedColumns = [...columns.values()].filter((c) => [...cells.keys()].some((k) => k.endsWith(`|${c.key}`)));
    const order = sources.map((s) => s.key);
    const rows = [...rowKeys]
        .map((k) => ({ source: k.slice(0, k.indexOf('|')), field: k.slice(k.indexOf('|') + 1) }))
        .sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source)
            || (sources.find((s) => s.key === a.source)?.fields.indexOf(a.field) ?? 0) - (sources.find((s) => s.key === b.source)?.fields.indexOf(b.field) ?? 0));
    return { columns: usedColumns, rows, cells };
}
