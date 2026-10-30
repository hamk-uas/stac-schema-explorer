import softwareDocument from '../../schemas/hamk-uas.github.io/stac-schema-explorer/schemas/software.json';
import { conventionOfSchema, formatOfSchema } from './conventions';
import { normalizeSchemaUrl, toShortId } from './extensions';
import { CORE } from './model';

/**
 * Software that reads or writes the fields of STAC and of embedded metadata, from the software list this repository
 * publishes beside its registry and crosswalk: which fields each program interprets, passes through or writes, and which
 * source it trusts when STAC and the data (or two conventions) say the same thing.
 */

/** A registry convention, a registry format, or a STAC extension by name (`core` for STAC core); some of its fields. */
export interface SoftwareTarget {
    convention?: string;
    format?: string;
    stac?: string;
    fields?: string[][];
    formats?: string[];
}

export interface SoftwareSupport extends SoftwareTarget {
    read?: 'interpret' | 'pass-through';
    write?: 'write' | 'pass-through';
    since?: string;
    note?: string;
    source: string;
}

export interface PrecedenceStep extends SoftwareTarget {
    label: string;
}

export interface PrecedenceRule {
    topic: string;
    order: PrecedenceStep[];
    ignores?: PrecedenceStep[];
    missing?: string;
    note?: string;
    source: string;
}

export interface Software {
    id: string;
    title: string;
    kind: 'library' | 'loader' | 'server';
    url: string;
    description: string;
    extends?: string[];
    supports: SoftwareSupport[];
    precedence?: PrecedenceRule[];
}

export const SOFTWARE = softwareDocument.software as Software[];

/** The target a schema is in the software list: its convention or format id, or its STAC extension name. */
export function schemaTarget(source: string): SoftwareTarget | undefined {
    if (source === CORE) return { stac: 'core' };
    if (source.startsWith('?')) return undefined;
    const format = formatOfSchema(source);
    if (format) return { format: format.id };
    const known = conventionOfSchema(source);
    if (known) return { convention: known.convention.id };
    const short = toShortId(source);
    return { stac: short.includes('@') ? short.slice(0, short.indexOf('@')) : normalizeSchemaUrl(source) };
}

const pathMatches = (pattern: readonly string[], path: readonly string[]) =>
    pattern.length === path.length && pattern.every((segment, i) => segment === '*' || segment === path[i]);

/** True when `target` names the schema of `of` and, given a field path, one of its fields (all when it lists none). */
function targets(target: SoftwareTarget, of: SoftwareTarget, path?: readonly string[]): boolean {
    const same = (target.convention !== undefined && target.convention === of.convention)
        || (target.format !== undefined && target.format === of.format)
        || (target.stac !== undefined && target.stac === of.stac);
    return same && (!path || !target.fields || target.fields.some((f) => pathMatches(f, path)));
}

/** A program's support for a field or schema; `through` lists the programs built on it that use it the same way. */
export interface SoftwareUse {
    software: Software;
    supports: SoftwareSupport[];
    through: Software[];
}

const byId = new Map(SOFTWARE.map((s) => [s.id, s]));

/** The programs a program is built on, nearest first. */
function ancestors(software: Software): Software[] {
    const out: Software[] = [];
    const queue = [...(software.extends ?? [])];
    for (let id = queue.shift(); id; id = queue.shift()) {
        const parent = byId.get(id);
        if (!parent || out.includes(parent)) continue;
        out.push(parent);
        queue.push(...(parent.extends ?? []));
    }
    return out;
}

/**
 * The software that reads or writes a field (`path`: its path in a node, or its name in STAC), or any field of a schema
 * (no `path`). For a field, entries naming it come before entries for the whole schema. Programs that only inherit the
 * support of what they are built on are listed under it.
 */
export function softwareFor(source: string, path?: readonly string[]): SoftwareUse[] {
    const of = schemaTarget(source);
    if (!of) return [];
    const direct = new Map<string, SoftwareUse>();
    for (const software of SOFTWARE) {
        const matching = software.supports.filter((s) => targets(s, of, path));
        const specific = path ? matching.filter((s) => s.fields) : matching;
        const supports = specific.length ? specific : matching;
        if (supports.length) direct.set(software.id, { software, supports, through: [] });
    }
    for (const software of SOFTWARE) {
        if (direct.has(software.id)) continue;
        const parent = ancestors(software).find((a) => direct.has(a.id));
        if (parent) direct.get(parent.id)!.through.push(software);
    }
    return [...direct.values()];
}

/** A precedence rule involving a field: the position of the step it is in, or that it is ignored. */
export interface PrecedenceUse {
    software: Software;
    rule: PrecedenceRule;
    /** Index of the matching step in `rule.order`; -1 when the field is ignored. */
    step: number;
}

export function precedenceFor(source: string, path: readonly string[]): PrecedenceUse[] {
    const of = schemaTarget(source);
    if (!of) return [];
    const out: PrecedenceUse[] = [];
    for (const software of SOFTWARE) {
        for (const rule of software.precedence ?? []) {
            const step = rule.order.findIndex((s) => targets(s, of, path));
            if (step >= 0) out.push({ software, rule, step });
            else if (rule.ignores?.some((s) => targets(s, of, path))) out.push({ software, rule, step: -1 });
        }
    }
    return out;
}
