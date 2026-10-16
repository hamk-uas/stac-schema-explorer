import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SchemaStore, type FetchJson } from '../src/lib/schemas';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Reads schemas from test/fixtures; a missing one is downloaded once and saved there. */
export const fixtureFetch: FetchJson = async (url) => {
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
