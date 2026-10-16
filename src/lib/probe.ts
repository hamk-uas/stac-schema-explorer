import type { ValidateFunction } from 'ajv';

import { baseDocument, isProbeableLocation } from './base-docs';
import { describeUrl, normalizeSchemaUrl } from './extensions';
import { collectFields } from './fields';
import {
    CORE, STAC_TYPES, type Conflict, type Json, type JsonObject, type Placement, type PlacementKind, type ProbeProgress,
    type ProbeResult, type SourceInfo, type SourceKey, type StacType, type TypeTemplate,
} from './model';
import { CORE_FIELD_SAMPLES, CORE_FIELDS_BY_VERSION, FIELD_HINTS, Sampler } from './sampler';
import { getAt, joinPointer, objectLocations } from './pointer';
import { coreSchemaUrl, formatErrors, type SchemaStore } from './schemas';

interface Source {
    key: SourceKey;
    /** The URL that documents list in `stac_extensions`. */
    declaration?: string;
    fields: string[];
    samples: Map<string, Json[]>;
    validators: Partial<Record<StacType, ValidateFunction>>;
}

const INVALID_VALUES: Json[] = ['\u00a7invalid\u00a7', -1234.5, true, null, [], {}, ['\u00a7'], { '\u00a7': '\u00a7' }];
const CONTROL_KEY = 'zzunknownprobefield';
const MAX_ROUNDS = 6;

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findDeclaration(schema: unknown): string | undefined {
    let found: string | undefined;
    const visit = (node: unknown) => {
        if (found || node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(visit);
        const record = node as Record<string, unknown>;
        const contains = record.contains as Record<string, unknown> | undefined;
        if (contains && typeof contains.const === 'string') {
            found = contains.const;
            return;
        }
        Object.values(record).forEach(visit);
    };
    visit(schema);
    return found;
}

function invalidCandidates(valid: Json): Json[] {
    const type = Array.isArray(valid) ? 'array' : valid === null ? 'null' : typeof valid;
    const differentType = INVALID_VALUES.filter((v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v) !== type);
    return [...differentType, ...INVALID_VALUES.filter((v) => !differentType.includes(v))];
}

function summaryForms(samples: Json[]): Json[] {
    const out: Json[] = [];
    for (const sample of samples) {
        out.push([sample]);
        if (typeof sample === 'number') out.push({ minimum: sample, maximum: sample });
        out.push(sample);
    }
    return out;
}

async function prepareSources(store: SchemaStore, stacVersion: string, urls: readonly string[]): Promise<{ sources: Source[]; infos: SourceInfo[] }> {
    const sampler = new Sampler(store);
    const sources: Source[] = [];
    const infos: SourceInfo[] = [];

    const coreValidators: Partial<Record<StacType, ValidateFunction>> = {};
    for (const type of STAC_TYPES) coreValidators[type] = await store.validator(coreSchemaUrl(type, stacVersion));
    const coreFields = CORE_FIELDS_BY_VERSION[stacVersion] ?? CORE_FIELDS_BY_VERSION['1.1.0'];
    sources.push({
        key: CORE,
        fields: coreFields,
        samples: new Map(coreFields.map((f) => [f, CORE_FIELD_SAMPLES[f]])),
        validators: coreValidators,
    });
    infos.push({ key: CORE, url: coreSchemaUrl('Catalog', stacVersion).replace(/catalog-spec.*$/, ''), title: 'STAC core', prefixes: [], version: stacVersion, fields: coreFields, unsampled: [] });

    const unique = [...new Set(urls.map(normalizeSchemaUrl))];
    const loaded = await Promise.all(unique.map(async (url) => {
        try {
            return { url, validator: await store.validator(url) };
        } catch (error) {
            return { url, error: error instanceof Error ? error.message : String(error) };
        }
    }));

    for (const entry of loaded) {
        const { name, version, known } = describeUrl(entry.url);
        const schema = store.getDocument(entry.url) as { title?: unknown } | undefined;
        const title = !known && typeof schema?.title === 'string' ? schema.title.replace(/ Extension$/i, '') : name;
        if (!entry.validator) {
            infos.push({ key: entry.url, url: entry.url, title: name, prefixes: [], version, fields: [], unsampled: [], error: entry.error });
            continue;
        }
        const { prefixes, fields } = collectFields(store, entry.url);
        const samples = new Map<string, Json[]>();
        const unsampled: string[] = [];
        for (const [field, refs] of fields) {
            const candidates = [...(FIELD_HINTS[field] ?? [])];
            for (const ref of refs) candidates.push(...sampler.samplesAt(ref.schemaUrl, ref.pointer));
            const checks = refs.map((ref) => store.subValidator(ref.schemaUrl, ref.pointer)).filter((v): v is ValidateFunction => v !== null);
            const accepted = checks.length > 0 ? candidates.filter((c) => checks.some((check) => check(c) === true)) : candidates;
            const seen = new Set<string>();
            const unique = accepted.filter((c) => !seen.has(JSON.stringify(c)) && seen.add(JSON.stringify(c)));
            if (unique.length === 0) unsampled.push(field);
            samples.set(field, unique.length > 0 ? unique.slice(0, 4) : candidates.slice(0, 2));
        }
        const declaration = findDeclaration(schema) ?? entry.url;
        const validators: Partial<Record<StacType, ValidateFunction>> = {};
        for (const type of STAC_TYPES) validators[type] = entry.validator;
        sources.push({ key: entry.url, declaration, fields: [...fields.keys()], samples, validators });
        infos.push({ key: entry.url, url: entry.url, title, prefixes, version, fields: [...fields.keys()], unsampled });
    }
    return { sources, infos };
}

interface FieldResult {
    field: string;
    value: Json;
    kind: PlacementKind;
}

class TypeProbe {
    readonly doc: JsonObject;
    readonly placements: Placement[] = [];
    readonly conflicts: Conflict[] = [];
    /** Number of placements when a (source, location) pair was last probed. */
    private readonly probedAt = new Map<string, number>();
    /** (source, location) pairs where the source rejects no invalid value of its fields. */
    private readonly inert = new Set<string>();
    private readonly passing = new Map<SourceKey, boolean>();

    constructor(private readonly type: StacType, stacVersion: string, private readonly sources: Source[]) {
        this.doc = baseDocument(type, stacVersion);
        this.doc.stac_extensions = sources.filter((s) => s.declaration).map((s) => s.declaration!);
        for (const source of sources) this.passing.set(source.key, this.validate(source));
    }

    private validate(source: Source): boolean {
        return source.validators[this.type]!(this.doc) === true;
    }

    private lastErrorPath(source: Source): string | undefined {
        return source.validators[this.type]!.errors?.[0]?.instancePath;
    }

    /**
     * Work for one round: every (source, location) pair with fields not yet placed there, unless the document has
     * not changed since that pair was last probed. Placements can unlock others (STAC 1.1.0 allows `bands` in Item
     * `properties` only when an asset has `bands`), so locations are revisited until nothing changes.
     */
    pending(): { source: Source; location: string }[] {
        const work: { source: Source; location: string }[] = [];
        const locations = objectLocations(this.doc).filter(isProbeableLocation);
        for (const source of this.sources) {
            for (const location of locations) {
                const key = `${source.key} ${location}`;
                if (this.inert.has(key)) continue;
                if (this.probedAt.get(key) !== this.placements.length) work.push({ source, location });
            }
        }
        return work;
    }

    private ownValuePath(source: Source, location: string): boolean {
        return this.placements.some((p) => p.source === source.key && (location + '/').startsWith(joinPointer(p.location, p.field) + '/'));
    }

    probeLocation(source: Source, location: string): void {
        this.probedAt.set(`${source.key} ${location}`, this.placements.length);
        if (source.fields.length === 0 || this.ownValuePath(source, location)) return;
        const placedHere = new Set(this.placements.filter((p) => p.source === source.key && p.location === location).map((p) => p.field));
        const unplaced = source.fields.filter((f) => !placedHere.has(f));
        if (unplaced.length === 0) return;

        // Probe without the source's own fields elsewhere, so that alternatives of an `anyOf` are each detected.
        const removed: { holder: JsonObject; field: string; value: Json }[] = [];
        if (source.key !== CORE) {
            for (const p of this.placements) {
                if (p.source !== source.key || p.location === location) continue;
                const holder = getAt(this.doc, p.location);
                if (isObject(holder) && p.field in holder) {
                    removed.push({ holder, field: p.field, value: holder[p.field] });
                    delete holder[p.field];
                }
            }
        }
        const restoreAnchors = () => removed.forEach(({ holder, field, value }) => (holder[field] = value));
        const removeAnchors = () => removed.forEach(({ holder, field }) => delete holder[field]);

        let results: FieldResult[] = [];
        const holder = getAt(this.doc, location);
        if (isObject(holder)) {
            const plain = this.probeFields(source, location, holder, unplaced);
            results = plain.results;
            let inert = plain.inert;
            const unresolved = unplaced.filter((f) => !results.some((r) => r.field === f));
            if (unresolved.length > 0 && removed.length > 0) {
                restoreAnchors();
                const anchored = this.probeFields(source, location, holder, unresolved);
                removeAnchors();
                results.push(...anchored.results);
                inert = anchored.inert && (plain.inert || plain.results.length === 0);
            }
            // The schema validates nothing of its own here; later changes elsewhere are unlikely to alter that.
            if (inert && results.length === 0) this.inert.add(`${source.key} ${location}`);
        }
        restoreAnchors();
        if (isObject(holder)) this.accept(source, location, holder, results);
    }

    private probeFields(source: Source, location: string, holder: JsonObject, fields: string[]): { results: FieldResult[]; inert: boolean } {
        const original = new Map<string, Json>(fields.filter((f) => f in holder).map((f) => [f, holder[f]]));
        const restore = () => {
            for (const f of fields) {
                if (original.has(f)) holder[f] = original.get(f)!;
                else delete holder[f];
            }
        };
        const candidates = (f: string): Json[] => {
            const samples = source.samples.get(f) ?? [];
            const forms = location === '/summaries' ? summaryForms(samples) : samples;
            return original.has(f) ? [original.get(f)!, ...forms] : forms;
        };
        const baseOk = this.validate(source);

        if (baseOk) {
            // Cheap pre-check: if no invalid value is rejected anywhere at this location, nothing is governed here.
            const rejected = INVALID_VALUES.some((bad) => {
                holder[CONTROL_KEY] = bad;
                const generic = !this.validate(source);
                delete holder[CONTROL_KEY];
                if (generic) return false;
                for (const f of fields) holder[f] = bad;
                const ok = this.validate(source);
                return !ok;
            });
            restore();
            if (!rejected) return { results: [], inert: true };
        }

        const results: FieldResult[] = [];
        const chosen = new Map<string, Json>();
        // A value rejected under any key (e.g. every entry of `item_assets` must be an object) says nothing about
        // the field, so each invalid value is also tried under a control key next to the valid field.
        const rejectsControl = (bad: Json): boolean => {
            holder[CONTROL_KEY] = bad;
            const ok = this.validate(source);
            delete holder[CONTROL_KEY];
            return !ok;
        };
        const governs = (f: string, valid: Json): boolean => {
            const fails = invalidCandidates(valid).some((bad) => {
                holder[f] = valid;
                if (rejectsControl(bad)) return false;
                holder[f] = bad;
                return !this.validate(source);
            });
            holder[f] = valid;
            return fails;
        };

        for (const f of fields) {
            for (const value of candidates(f)) {
                holder[f] = value;
                if (!this.validate(source)) continue;
                chosen.set(f, value);
                if (governs(f, value)) results.push({ field: f, value, kind: 'validated' });
                else if (!baseOk && !original.has(f)) results.push({ field: f, value, kind: 'presence' });
                break;
            }
            restore();
        }

        // Fields that need company (e.g. `cube:variables` requires `cube:dimensions`): try them together, dropping
        // whichever field the validator blames until the rest pass.
        const unresolved = fields.filter((f) => !chosen.has(f));
        if (unresolved.length > 0) {
            const together = new Set(fields);
            for (let attempt = 0; attempt <= fields.length; attempt++) {
                restore();
                for (const f of together) {
                    const value = chosen.get(f) ?? candidates(f)[0];
                    if (value !== undefined) holder[f] = value;
                }
                if (this.validate(source)) {
                    for (const f of unresolved) {
                        if (together.has(f) && f in holder && governs(f, holder[f])) results.push({ field: f, value: holder[f], kind: 'validated' });
                    }
                    break;
                }
                const path = this.lastErrorPath(source) ?? '';
                const culprit = [...together].find((f) => (path + '/').startsWith(joinPointer(location, f) + '/'));
                if (!culprit) break;
                together.delete(culprit);
            }
            restore();
        }
        return { results, inert: false };
    }

    private accept(source: Source, location: string, holder: JsonObject, results: FieldResult[]): void {
        if (results.length === 0) return;
        // Fast path: place everything at once and check the other schemas once.
        const previousValues = results.map(({ field }) => ({ field, had: field in holder, value: holder[field] }));
        for (const { field, value } of results) holder[field] = structuredClone(value);
        const othersPass = this.sources.every((other) => other === source || !this.passing.get(other.key) || this.validate(other));
        if (othersPass) {
            for (const { field, kind } of results) this.placements.push({ source: source.key, field, location, kind });
            for (const other of this.sources) if (!this.passing.get(other.key)) this.passing.set(other.key, this.validate(other));
            return;
        }
        for (const { field, had, value } of previousValues) {
            if (had) holder[field] = value;
            else delete holder[field];
        }

        for (const { field, value, kind } of results) {
            const had = field in holder;
            const previous = holder[field];
            holder[field] = structuredClone(value);
            const rejectedBy = this.sources.find((other) => other !== source && this.passing.get(other.key) && !this.validate(other));
            if (rejectedBy) {
                if (had) holder[field] = previous;
                else delete holder[field];
                if (!this.conflicts.some((c) => c.source === source.key && c.field === field && c.location === location)) {
                    this.conflicts.push({ source: source.key, field, location, rejectedBy: rejectedBy.key });
                }
                continue;
            }
            this.placements.push({ source: source.key, field, location, kind });
            for (const other of this.sources) if (!this.passing.get(other.key)) this.passing.set(other.key, this.validate(other));
        }
    }

    finish(stacVersion: string): TypeTemplate {
        const used = new Set(this.placements.map((p) => p.source));
        const applicable = this.sources.filter((s) => s.key === CORE || used.has(s.key));
        this.doc.stac_extensions = applicable.filter((s) => s.declaration).map((s) => s.declaration!);
        const errors: string[] = [];
        for (const source of applicable) {
            const validator = source.validators[this.type]!;
            if (validator(this.doc) !== true) errors.push(...formatErrors(validator.errors, source.key));
        }
        return {
            type: this.type,
            stacVersion,
            doc: this.doc,
            placements: this.placements,
            conflicts: this.conflicts,
            notApplicable: this.sources.filter((s) => s.key !== CORE && !used.has(s.key)).map((s) => s.key),
            valid: errors.length === 0,
            errors,
        };
    }
}

/**
 * Builds, for each STAC object type, the "extreme case" document in which every field of the given schemas
 * is placed everywhere the schemas allow it, and reports where each field was placed and why.
 */
export async function probe(
    store: SchemaStore,
    stacVersion: string,
    extensionUrls: readonly string[],
    onProgress?: (progress: ProbeProgress) => void,
): Promise<ProbeResult> {
    onProgress?.({ done: 0, total: 1, label: 'Loading schemas' });
    const { sources, infos } = await prepareSources(store, stacVersion, extensionUrls);
    const usable = sources.filter((s) => Object.keys(s.validators).length > 0);
    const templates = {} as Record<StacType, TypeTemplate>;

    for (const [index, type] of STAC_TYPES.entries()) {
        const typeProbe = new TypeProbe(type, stacVersion, usable);
        for (let round = 0; round < MAX_ROUNDS; round++) {
            const work = typeProbe.pending();
            if (work.length === 0) break;
            for (const [i, { source, location }] of work.entries()) {
                if (i % 25 === 0) {
                    onProgress?.({ done: index * MAX_ROUNDS + round + i / work.length, total: STAC_TYPES.length * MAX_ROUNDS, label: `${type}: round ${round + 1}` });
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
                typeProbe.probeLocation(source, location);
            }
        }
        templates[type] = typeProbe.finish(stacVersion);
    }
    onProgress?.({ done: 1, total: 1, label: 'Done' });
    return { stacVersion, sources: infos, templates };
}
