import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import { isDependency, localPath } from '../scripts/manifest.mjs';
import { annotations, canonicalize, documentation, documentationSites, inCondition, valueList, walkSchemas } from '../scripts/schema-tools.mjs';
import { vendoredUrls } from '../scripts/vendored.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (dir: string, url: string) => JSON.parse(readFileSync(join(root, dir, localPath(url)), 'utf8'));
const urls: string[] = vendoredUrls('upstream');
const enriched = urls.filter((url) => !isDependency(url));
const resolve = (url: string) => {
    try {
        return read('schemas', url);
    } catch {
        return undefined;
    }
};

describe('vendored schemas', () => {
    it('vendor exactly the upstream schemas', () => {
        expect(vendoredUrls('schemas')).toEqual(urls);
    });

    it.each(urls)('%s validates exactly like upstream', (url) => {
        expect(canonicalize(read('schemas', url))).toEqual(canonicalize(read('upstream', url)));
    });

    it.each(urls)('%s keeps every upstream title and description', (url) => {
        const ours = annotations(read('schemas', url));
        for (const [pointer, text] of annotations(read('upstream', url))) expect(ours.get(pointer), pointer).toBe(text);
    });

    it.each(urls)('%s has its URL as $id', (url) => {
        const schema = read('schemas', url);
        if ('$id' in schema) expect(schema.$id).toBe(url);
    });

    it.each(urls.filter(isDependency))('%s is an unmodified dependency', (url) => {
        const { $id: _ours, ...ours } = read('schemas', url);
        const { $id: _theirs, ...theirs } = read('upstream', url);
        expect(ours).toEqual(theirs);
    });

    it.each(enriched)('%s documents every field', (url) => {
        const missing = documentationSites(read('schemas', url), { core: url.includes('schemas.stacspec.org') })
            .filter((site: { node: object }) => {
                const docs = documentation(site.node, url, resolve);
                return !docs.title || !docs.description;
            })
            .map((site: { pointer: string }) => site.pointer);
        expect(missing).toEqual([]);
    });

    it.each(enriched)('%s lists allowed values as titled constants', (url) => {
        const schema = read('schemas', url);
        const problems: string[] = [];
        const ajv = new Ajv({ strict: false });
        walkSchemas(schema, (node: Record<string, unknown>, pointer: string, context: unknown) => {
            if (Array.isArray(node.enum) && !inCondition(context)) problems.push(`${pointer}: enum`);
            const list = valueList(node);
            if (!list) return;
            // Each value must match exactly one branch: a value listed twice fails here.
            const validate = ajv.compile({ [list.keyword]: list.values });
            for (const value of list.values) {
                if (!value.title) problems.push(`${pointer}: ${JSON.stringify(value.const)} has no title`);
                if (!validate(value.const)) problems.push(`${pointer}: ${JSON.stringify(value.const)} is listed more than once`);
            }
        });
        expect(problems).toEqual([]);
    });
});
