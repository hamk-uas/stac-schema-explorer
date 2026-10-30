import { PREFIXES_WITHOUT_SCHEMA } from './extensions';
import { CORE, type SourceInfo, type SourceKey } from './model';

const PALETTE = ['#2563eb', '#db2777', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#4f46e5', '#0d9488', '#7c3aed', '#65a30d', '#a16207', '#0369a1', '#c026d3'];
const assigned = new Map<SourceKey, string>();

/** A stable color per schema for the page lifetime. */
export function colorOf(source: SourceKey): string {
    if (source === CORE) return '#64748b';
    if (source.startsWith('?')) return '#dc2626';
    let color = assigned.get(source);
    if (!color) {
        color = PALETTE[assigned.size % PALETTE.length];
        assigned.set(source, color);
    }
    return color;
}

export function sourceLabel(source: SourceKey, sources: SourceInfo[]): string {
    if (source === CORE) return 'STAC core';
    if (source === '?') return 'unknown field';
    if (source.startsWith('?')) {
        const spec = PREFIXES_WITHOUT_SCHEMA[source.slice(1)];
        return spec ? `${spec.title} (${source.slice(1)}:, no STAC extension schema)` : `unknown extension (${source.slice(1)}:)`;
    }
    const info = sources.find((s) => s.key === source);
    return info ? `${info.title}${info.version ? ` v${info.version}` : ''}` : source;
}

export function versionOf(source: SourceKey, sources: SourceInfo[]): string | undefined {
    return sources.find((s) => s.key === source)?.version;
}
