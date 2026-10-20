import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SchemaStore, type FetchJson } from '../src/lib/schemas';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'test', 'fixtures');

/**
 * Vendored schemas (schemas/) first, then test/fixtures; a schema missing from both is downloaded once and saved in
 * test/fixtures (only non-vendored extensions such as Semantics and Observatory live there).
 */
export const fixtureFetch: FetchJson = async (url) => {
    const { host, pathname } = new URL(url);
    const vendored = join(root, 'schemas', host, pathname);
    if (existsSync(vendored)) return JSON.parse(readFileSync(vendored, 'utf8'));
    const file = join(fixtures, url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9.-]+/g, '_'));
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const text = await response.text();
    mkdirSync(fixtures, { recursive: true });
    writeFileSync(file, text);
    return JSON.parse(text);
};

export function fixtureStore(): SchemaStore {
    return new SchemaStore(fixtureFetch);
}
