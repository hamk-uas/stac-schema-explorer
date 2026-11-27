import { sourceLabel } from './colors';
import type { PropertyDoc, SourceInfo } from './model';
import { requirementText } from './requirement';
import type { FieldView } from './tree';

export const STATE_TEXT = {
    populated: 'populated',
    possible: 'allowed here, not populated',
    unexpected: 'populated, but no selected or declared schema places it here',
};

export const EDIT_TEXT = {
    added: 'added by a rewrite (example value)',
    removed: 'removed by a rewrite',
};

export function firstSentence(text: string | undefined): string | undefined {
    if (!text) return undefined;
    const end = text.search(/\.\s/);
    if (end > 0 && end < 200) return text.slice(0, end + 1);
    return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

/** Tooltip text for a field pill or a field key in the JSON view. */
export function fieldTitle(field: FieldView, sources: SourceInfo[]): string {
    const how = field.kind === 'presence'
        ? 'the schema does not validate the value here, but its presence satisfies the extension\'s "at least one field" requirement'
        : field.kind === 'validated' ? 'validated here by the schema' : '';
    // Placed fields (with a kind) are required or optional where they are placed.
    const need = field.kind ? requirementText(field.required, true) : '';
    const doc = sources.find((s) => s.key === field.source)?.docs[field.name];
    const about = doc ? [`${doc.title ?? ''}${doc.title ? ' — ' : ''}${doc.type}`, firstSentence(doc.description)] : [];
    const state = field.edit ? EDIT_TEXT[field.edit] : STATE_TEXT[field.state];
    return [field.name, ...about, '', sourceLabel(field.source, sources), state, ...(need ? [need] : []), how, '', 'Click for details.']
        .filter((line, i, all) => line !== undefined && !(line === '' && all[i - 1] === ''))
        .join('\n');
}

/** Tooltip text for a nested property inside a field's object value in the JSON view. */
export function propertyTitle(prop: PropertyDoc): string {
    const heading = `${prop.title ?? ''}${prop.title ? ' — ' : ''}${prop.type}`;
    const need = prop.required ? 'Required here' : 'Optional here';
    return [prop.name, heading, firstSentence(prop.description), '', need]
        .filter((line, i, all) => line !== undefined && !(line === '' && all[i - 1] === ''))
        .join('\n');
}
