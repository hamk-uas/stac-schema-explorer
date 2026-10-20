// Drafts missing titles and descriptions in the vendored schemas and turns `enum` into `oneOf` lists of titled
// constants. Only fills gaps: existing titles and descriptions (upstream or edited) are never changed, so it is safe
// to re-run after editing. Review the result with `git diff` and `node scripts/report.mjs`.
//
// Sources, in order: the schema's README tables (field tables, and value tables for enums), labels from
// stac-utils/stac-fields (used by STAC Browser), the same field elsewhere in the schema, and finally the field name.
//
//   node scripts/draft-docs.mjs [filter]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDependency, localPath, VENDORED } from './manifest.mjs';
import { documentation, documentationNode, documentationSites, inCondition, valueList, walkSchemas } from './schema-tools.mjs';
import { vendoredUrls } from './vendored.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = join(root, '.cache');
const filter = process.argv[2] ?? '';

async function cached(url, name) {
    const path = join(cacheDir, name);
    if (existsSync(path)) return readFileSync(path, 'utf8');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const text = await response.text();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return text;
}

// ---- README tables -------------------------------------------------------------------------------------------------

/** Heading, header or name cell → plain text. */
function plain(cell) {
    return cell
        .replace(/<[^>]+>/g, '')
        .replace(/\\\|/g, '|')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Markdown description cell → one or more plain sentences (inline code kept). */
function clean(cell) {
    let text = cell
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\\\|/g, '|')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
        .replace(/\(#[^)]*\)/g, '')
        .replace(/\*\*(?:STRONGLY )?(?:REQUIRED|RECOMMENDED)\.?\*\*\.?\s*/gi, '')
        .replace(/^(?:STRONGLY )?RECOMMENDED\.\s*/i, '')
        .replace(/\*\*DEPRECATED\.?\*\*\.?\s*/gi, 'Deprecated. ')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
        .replace(/``([^`]+)``/g, '`$1`')
        .replace(/\s*\((?:see|cf\.) (?:below|above|chapter[^)]*|the [^)]*section[^)]*)\)/gi, '')
        .replace(/,\s*see (?:below|above|common metadata for more details)\.?/gi, '.')
        .replace(/(^|\.)\s*See (?:the )?(?:chapter|list|below|above)[^.]*\.?/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    if (text && /^[a-z]/.test(text) && !/^[a-z]+:/.test(text)) text = text[0].toUpperCase() + text.slice(1);
    if (text && /[\w)`"]$/.test(text)) text += '.';
    return text;
}

function fieldName(cell) {
    const code = /`([^`]+)`/.exec(cell);
    const text = plain(code ? code[1] : cell).replace(/\\_/g, '_');
    return text.split(/\s|\//)[0].replace(/^"|"$/g, '');
}

/** All tables of a markdown document with the heading they appear under. */
function parseTables(markdown) {
    const tables = [];
    const headings = [];
    const lines = markdown.replaceAll('\r\n', '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const heading = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
        if (heading) {
            headings.length = heading[1].length - 1;
            headings[heading[1].length - 1] = plain(heading[2]);
            continue;
        }
        if (!lines[i].trim().startsWith('|') || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) continue;
        const split = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
        const header = split(lines[i]).map((h) => plain(h).replace(/[*_]/g, '').toLowerCase());
        const rows = [];
        let j = i + 2;
        for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(split(lines[j]));
        tables.push({ heading: headings.filter(Boolean).at(-1) ?? '', headings: headings.filter(Boolean), header, rows });
        i = j - 1;
    }
    return tables;
}

const FIELD_HEADERS = ['field name', 'field', 'name', 'property', 'element'];

function fieldRows(tables) {
    const out = [];
    for (const table of tables) {
        const nameAt = table.header.findIndex((h) => FIELD_HEADERS.includes(h));
        const descriptionAt = table.header.findIndex((h) => h.startsWith('description'));
        if (nameAt < 0 || descriptionAt < 0) continue;
        for (const row of table.rows) {
            const name = fieldName(row[nameAt] ?? '');
            const description = clean(row[descriptionAt] ?? '');
            if (name && description) out.push({ name, description, heading: table.heading, headings: table.headings, source: table.source });
        }
    }
    return out;
}

/** Tables that explain values: first column a value, some column a description or meaning. */
function valueRows(tables) {
    const out = [];
    for (const table of tables) {
        if (FIELD_HEADERS.includes(table.header[0]) && table.header.some((h) => h === 'type')) continue;
        const descriptionAt = table.header.findIndex((h) => /description|meaning|explanation/.test(h));
        const rangeAt = table.header.findIndex((h) => /band range|wavelength/.test(h));
        if (descriptionAt <= 0 && rangeAt <= 0) continue;
        for (const row of table.rows) {
            const value = fieldName(row[0] ?? '');
            const description = descriptionAt > 0 ? clean(row[descriptionAt] ?? '')
                : clean(`Wavelength range ${plain(row[rangeAt] ?? '')} ${/\((.+)\)/.exec(table.header[rangeAt])?.[1] ?? ''}`);
            if (value && description) out.push({ value, description, heading: table.heading });
        }
    }
    return out;
}

const tokens = (text) => new Set(text.toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !['object', 'objects', 'fields', 'field', 'the', 'and', 'definitions'].includes(t)));

/** The README that documents a schema file best: catalog.json ↔ catalog-spec.md, field groups ↔ common-metadata.md. */
function ownsSchema(readme, url) {
    const file = url.split('/').at(-1).replace(/\.json$/, '');
    const doc = (readme ?? '').split('/').at(-1).replace(/\.md$/, '');
    if (doc === `${file}-spec`) return true;
    const groups = ['basics', 'datetime', 'instrument', 'licensing', 'provider', 'bands', 'data-values', 'common'];
    return groups.includes(file) && doc === 'common-metadata';
}

function bestRow(rows, name, path, url) {
    const candidates = rows.filter((row) => row.name === name);
    if (candidates.length <= 1) return { row: candidates[0], ambiguous: false };
    const context = tokens(path.slice(0, -1).join(' '));
    const scored = candidates.map((row) => {
        const heading = tokens(row.headings.join(' '));
        let score = ownsSchema(row.source, url) ? 0.5 : 0;
        for (const t of heading) if (context.has(t) || [...context].some((c) => c.startsWith(t) || t.startsWith(c))) score += 1;
        return { row, score };
    }).sort((a, b) => b.score - a.score);
    const distinct = new Set(candidates.map((c) => c.description)).size;
    return { row: scored[0].row, ambiguous: distinct > 1 && scored[0].score === scored[1].score };
}

// ---- titles --------------------------------------------------------------------------------------------------------

function humanize(name) {
    const bare = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
    const words = bare.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    return words.split(' ').map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

const VALUE_TITLES = { nan: 'NaN (not a number)', inf: 'Positive infinity', '-inf': 'Negative infinity', Feature: 'Item (GeoJSON Feature)', ltr: 'Left to right', rtl: 'Right to left' };

function valueTitle(value) {
    if (typeof value !== 'string') return JSON.stringify(value);
    if (VALUE_TITLES[value]) return VALUE_TITLES[value];
    if (/[/:.]/.test(value) || /^[A-Z0-9_.+-]+$/.test(value) || /\d/.test(value) || value.length <= 2 || /^[A-Z]/.test(value)) return value;
    return humanize(value);
}

function fieldsLabel(stacFields, path) {
    const name = path.at(-1);
    let entry = stacFields.metadata[name];
    for (let i = path.length - 2; i >= 0 && entry === undefined; i--) {
        const parent = stacFields.metadata[path[i]];
        if (parent && typeof parent === 'object' && parent.items && parent.items[name]) entry = parent.items[name];
    }
    if (entry && typeof entry === 'object' && entry.alias) entry = stacFields.metadata[entry.alias];
    if (typeof entry === 'string') return { label: entry };
    return entry && typeof entry === 'object' ? { label: entry.label, explain: entry.explain, mapping: entry.mapping } : {};
}

// ---- main ----------------------------------------------------------------------------------------------------------

const stacFields = JSON.parse(await cached('https://raw.githubusercontent.com/stac-utils/stac-fields/main/fields.json', 'stac-fields.json'));
const readmeFor = new Map();
for (const entry of VENDORED) for (const url of entry.schemas) readmeFor.set(url, entry.readmes);

const schemas = new Map(vendoredUrls().map((url) => [url, JSON.parse(readFileSync(join(root, 'schemas', localPath(url)), 'utf8'))]));
const resolve = (url) => schemas.get(url);
const ambiguous = [];
const changed = new Set();

/** README tables of a schema: those of its manifest entry, or of the entry whose schemas share its directory. */
async function tablesFor(url) {
    let readmes = readmeFor.get(url);
    if (!readmes) {
        const dir = url.replace(/\/[^/]+$/, '/');
        const owner = [...readmeFor.keys()].find((u) => u.startsWith(dir) || dir.startsWith(u.replace(/\/[^/]+$/, '/')));
        readmes = owner ? readmeFor.get(owner) : [];
    }
    const all = [];
    for (const readme of readmes) {
        const markdown = await cached(readme, `readme/${localPath(readme)}`);
        all.push(...parseTables(markdown).map((table) => ({ ...table, source: readme })));
    }
    return all;
}

function set(node, key, value, url) {
    if (node[key] || !value) return;
    node[key] = value;
    changed.add(url);
}

/** enum → oneOf of titled constants (not inside conditions, where values are never offered as choices). */
function convertEnums(schema, url, values) {
    walkSchemas(schema, (node, pointer, context) => {
        if (!Array.isArray(node.enum) || inCondition(context)) return;
        if (node.oneOf || valueList(node)) {
            ambiguous.push(`${localPath(url)}${pointer}: enum next to oneOf, left as is`);
            return;
        }
        const names = [...context.parents.map((p) => p.name), context.name].filter(Boolean);
        const field = [...names].reverse().find((n) => !['items', 'properties'].includes(n));
        const mapping = fieldsLabel(stacFields, names.length ? names : [field ?? '']).mapping ?? {};
        const list = node.enum.map((value) => {
            const explained = values.find((v) => v.value === String(value));
            const branch = { const: value, title: mapping[value] ?? valueTitle(value) };
            if (explained) branch.description = explained.description;
            return branch;
        });
        const rebuilt = {};
        for (const [key, value] of Object.entries(node)) {
            if (key === 'enum') rebuilt.oneOf = list;
            else rebuilt[key] = value;
        }
        for (const key of Object.keys(node)) delete node[key];
        Object.assign(node, rebuilt);
        changed.add(url);
    });
}

for (const [url, schema] of schemas) {
    if (isDependency(url) || !url.includes(filter)) continue;
    const core = url.includes('schemas.stacspec.org');
    const tables = await tablesFor(url);
    const rows = fieldRows(tables);
    const values = valueRows(tables);
    convertEnums(schema, url, values);
    const sites = documentationSites(schema, { core });

    // Decide text per property, then where it goes: on the definition the property references, unless properties
    // referencing the same definition mean different things (datacube's shared `description` for dimensions and
    // variables), in which case each property gets its own text next to its `$ref`.
    const drafts = sites.map((site) => {
        const { row, ambiguous: unsure } = bestRow(rows, site.name, site.path, url);
        const label = fieldsLabel(stacFields, site.path);
        const target = documentationNode(site.node, url, resolve);
        if (row && !documentation(site.node, url, resolve).description && unsure) ambiguous.push(`${localPath(url)}${site.pointer}: chose "${row.heading}"`);
        return { site, target, title: label.label ?? humanize(site.name), description: row?.description ?? label.explain };
    });
    for (const draft of drafts) {
        const sharing = drafts.filter((other) => other.target.node === draft.target.node && other.description);
        const conflicting = new Set(sharing.map((other) => other.description)).size > 1;
        const { node, url: at } = conflicting ? { node: draft.site.node, url } : draft.target;
        const existing = documentation(draft.site.node, url, resolve);
        if (!existing.title) set(node, 'title', draft.title, at);
        if (!existing.description) set(node, 'description', draft.description, at);
    }
    // The same field declared again elsewhere in the schema (another branch or placement) gets the same text.
    for (const site of sites) {
        if (documentation(site.node, url, resolve).description) continue;
        const twin = sites.find((other) => other !== site && other.name === site.name && documentation(other.node, url, resolve).description
            && (site.name.includes(':') || other.path.slice(0, -1).join('/') === site.path.slice(0, -1).join('/')));
        const { node, url: at } = documentationNode(site.node, url, resolve);
        if (twin) set(node, 'description', documentation(twin.node, url, resolve).description, at);
    }
}

for (const url of changed) {
    writeFileSync(join(root, 'schemas', localPath(url)), `${JSON.stringify(schemas.get(url), null, 2)}\n`);
}
console.log(`updated ${changed.size} schemas`);
if (ambiguous.length) console.log(`review:\n  ${ambiguous.join('\n  ')}`);
