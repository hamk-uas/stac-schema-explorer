import { fromConventionShortId, toConventionShortId } from './conventions';
import { ALL_CORES } from './cores';
import { fromShortId, toShortId } from './extensions';
import { STAC_VERSIONS } from './model';
import type { Rewrite } from './rewrites';

const sourceId = (source: string) => (source === 'core' || source.startsWith('?') ? source : toShortId(source));
const sourceUrl = (id: string) => (id === 'core' || id.startsWith('?') ? id : fromShortId(id));

/** `add|<schema>|<document>|<pointer>|<field>` (or `remove|…`): the value is regenerated from the template. */
function writeRewrite(r: Rewrite): string {
    return [r.op, sourceId(r.source), r.doc, r.pointer, r.field].join('|');
}

function readRewrite(value: string): Rewrite | undefined {
    const parts = value.split('|');
    if (parts.length < 5 || (parts[0] !== 'add' && parts[0] !== 'remove')) return undefined;
    // A field name has no `|`; the pointer takes whatever is left between the document and the field.
    return { op: parts[0], source: sourceUrl(parts[1]), doc: parts[2], pointer: parts.slice(3, -1).join('|'), field: parts[parts.length - 1] };
}

export type Mode = 'example' | 'href';

export interface AppState {
    mode: Mode;
    stacVersion: string;
    extensions: string[];
    /** Schemas of conventions of embedded metadata (Zarr conventions, CF, ACDD, …), the counterparts of extensions. */
    conventions: string[];
    href: string;
    /** Selected document: `catalog`, `subcatalog`, `collection`, `item` in the example, or a document URL. */
    selected: string;
    /** Selected object pointer within the selected document. */
    pointer: string;
    /** Cores (`stac` and data format ids) whose fields are shown, like selected extensions and conventions. */
    cores: string[];
    groupFields: boolean;
    /** Include the extensions a real document declares in its template. */
    includeDeclared: boolean;
    view: 'tree' | 'matrix';
    /** Schema whose fields are emphasized; other fields are dimmed. */
    focus: string;
    /** Field shown in the field information panel: `<source key>|<field name>`. */
    field: string;
    /** Schema (extension, convention, format or core) shown in the information panel instead of a field. */
    schema: string;
    /** Local changes to real documents, in the order they were made. */
    rewrites: Rewrite[];
    /** Embedded in another app (an iframe): no page header. */
    embed: boolean;
}

export function defaultState(): AppState {
    return {
        mode: 'example',
        stacVersion: STAC_VERSIONS[0],
        extensions: [],
        conventions: [],
        href: '',
        selected: 'collection',
        pointer: '',
        cores: [...ALL_CORES],
        groupFields: true,
        includeDeclared: true,
        view: 'tree',
        focus: '',
        field: '',
        schema: '',
        rewrites: [],
        embed: false,
    };
}

export function readState(search: string): AppState {
    const params = new URLSearchParams(search);
    const state = defaultState();
    if (params.has('href')) state.href = params.get('href') ?? '';
    state.mode = params.get('mode') === 'href' || (params.get('mode') === null && state.href) ? 'href' : 'example';
    const version = params.get('v');
    if (version && (STAC_VERSIONS as readonly string[]).includes(version)) state.stacVersion = version;
    if (params.has('ext')) state.extensions = params.getAll('ext').flatMap((v) => v.split(' ')).filter(Boolean).map(fromShortId);
    if (params.has('conv')) state.conventions = params.getAll('conv').flatMap((v) => v.split(' ')).filter(Boolean).map(fromConventionShortId);
    state.selected = params.get('sel') ?? (state.mode === 'href' ? state.href : state.selected);
    state.pointer = params.get('ptr') ?? '';
    // All cores unless listed; `core=` (empty) for none.
    if (params.has('core')) state.cores = params.getAll('core').flatMap((v) => v.split(' ')).filter((id) => ALL_CORES.includes(id));
    state.groupFields = params.get('group') !== '0';
    state.includeDeclared = params.get('declared') !== '0';
    state.view = params.get('view') === 'matrix' ? 'matrix' : 'tree';
    const focus = params.get('focus');
    state.focus = focus ? (focus === 'core' ? 'core' : fromShortId(focus)) : '';
    const field = params.get('field');
    if (field && field.includes('|')) {
        const at = field.indexOf('|');
        const source = field.slice(0, at);
        state.field = `${source === 'core' ? 'core' : fromShortId(source)}|${field.slice(at + 1)}`;
    }
    const schema = params.get('schema');
    if (schema && !state.field) state.schema = schema === 'core' || schema.startsWith('?') ? schema : fromShortId(schema);
    state.rewrites = params.getAll('rw').map(readRewrite).filter((r): r is Rewrite => !!r);
    state.embed = params.get('embed') === '1';
    return state;
}

export function writeState(state: AppState): string {
    const params = new URLSearchParams();
    params.set('mode', state.mode);
    if (state.stacVersion !== STAC_VERSIONS[0]) params.set('v', state.stacVersion);
    for (const url of state.extensions) params.append('ext', toShortId(url));
    for (const url of state.conventions) params.append('conv', toConventionShortId(url));
    if (state.href) params.set('href', state.href);
    if (state.selected && !(state.mode === 'href' && state.selected === state.href)) params.set('sel', state.selected);
    if (state.pointer) params.set('ptr', state.pointer);
    if (ALL_CORES.some((id) => !state.cores.includes(id))) {
        if (state.cores.length === 0) params.set('core', '');
        for (const id of ALL_CORES.filter((c) => state.cores.includes(c))) params.append('core', id);
    }
    if (!state.groupFields) params.set('group', '0');
    if (!state.includeDeclared) params.set('declared', '0');
    if (state.view === 'matrix') params.set('view', 'matrix');
    if (state.focus) params.set('focus', state.focus === 'core' ? 'core' : toShortId(state.focus));
    if (state.field) {
        const at = state.field.indexOf('|');
        const source = state.field.slice(0, at);
        params.set('field', `${source === 'core' ? 'core' : toShortId(source)}|${state.field.slice(at + 1)}`);
    } else if (state.schema) {
        params.set('schema', state.schema === 'core' || state.schema.startsWith('?') ? state.schema : toShortId(state.schema));
    }
    for (const rewrite of state.rewrites) params.append('rw', writeRewrite(rewrite));
    if (state.embed) params.set('embed', '1');
    return `?${params.toString().replaceAll('%40', '@').replaceAll('%2F', '/').replaceAll('%3A', ':').replaceAll('%7C', '|')}`;
}
