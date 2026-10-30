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
    layer: 'driver' | 'library' | 'package';
    /** The library a driver is part of. */
    partOf?: string;
    url: string;
    /** PyPI package name, to look up its latest release. */
    pypi?: string;
    checked?: { date: string; release?: string; source?: string };
    description: string;
    /** Software it is built on and whose interpretation it takes over. */
    extends?: string[];
    /** Software it depends on without taking over its interpretation. */
    uses?: string[];
    supports: SoftwareSupport[];
    precedence?: PrecedenceRule[];
}

export const SOFTWARE = softwareDocument.software as Software[];
const byId = new Map(SOFTWARE.map((s) => [s.id, s]));

/** The software a driver is part of, or the software itself. */
const root = (software: Software) => (software.partOf ? byId.get(software.partOf) ?? software : software);
/** When the claims were last checked, and the latest release then: a driver's are its library's. */
export const checkedOf = (software: Software) => software.checked ?? root(software).checked;
export const pypiOf = (software: Software) => software.pypi ?? root(software).pypi;

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

/**
 * How a program takes part for a field or schema: its own claims, and the programs it takes them over from (the drivers
 * of a library, the libraries a package extends), when it has no claims of its own or in addition to them.
 */
export interface SoftwareUse {
    software: Software;
    supports: SoftwareSupport[];
    through: Software[];
}

/** What a program takes interpretation over from: the software it extends, and a library's drivers. */
const providers = (software: Software) => [
    ...(software.extends ?? []).map((id) => byId.get(id)).filter((s): s is Software => !!s),
    ...SOFTWARE.filter((s) => s.partOf === software.id),
];

/**
 * The software that reads or writes a field (`path`: its path in a node, or its name in STAC), or any field of a schema
 * (no `path`). For a field, claims naming it come before claims for the whole schema. A program without claims of its
 * own is listed with the programs it takes them over from.
 */
export function softwareFor(source: string, path?: readonly string[]): SoftwareUse[] {
    const of = schemaTarget(source);
    if (!of) return [];
    const own = new Map<string, SoftwareSupport[]>();
    for (const software of SOFTWARE) {
        const matching = software.supports.filter((s) => targets(s, of, path));
        const specific = path ? matching.filter((s) => s.fields) : matching;
        const supports = specific.length ? specific : matching;
        if (supports.length) own.set(software.id, supports);
    }
    const out: SoftwareUse[] = [];
    for (const software of SOFTWARE) {
        // The nearest programs with claims of their own, along each line of what it is built on.
        const through: Software[] = [];
        const seen = new Set<string>([software.id]);
        const queue = providers(software);
        for (let next = queue.shift(); next; next = queue.shift()) {
            if (seen.has(next.id)) continue;
            seen.add(next.id);
            if (own.has(next.id)) through.push(next);
            else queue.push(...providers(next));
        }
        const supports = own.get(software.id) ?? [];
        if (supports.length || through.length) out.push({ software, supports, through });
    }
    return out;
}

/** The latest release of a package on PyPI, looked up once per page (PyPI allows cross-origin requests). */
const releases = new Map<string, Promise<string | undefined>>();
export function latestRelease(pypi: string): Promise<string | undefined> {
    let release = releases.get(pypi);
    if (!release) {
        release = fetch(`https://pypi.org/pypi/${encodeURIComponent(pypi)}/json`)
            .then((response) => (response.ok ? response.json() as Promise<{ info?: { version?: string } }> : undefined))
            .then((json) => json?.info?.version)
            .catch(() => undefined);
        releases.set(pypi, release);
    }
    return release;
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
