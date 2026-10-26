import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isAuthored } from './manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function files(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : name.endsWith('.json') ? [path] : [];
    });
}

function urlsUnder(dir) {
    const base = join(root, dir);
    return files(base).map((path) => `https://${relative(base, path).replaceAll('\\', '/')}`).sort();
}

/** URLs of every vendored schema under `schemas/` (or `upstream/`), derived from their location; authored ones excluded. */
export function vendoredUrls(dir = 'schemas') {
    return urlsUnder(dir).filter((url) => !isAuthored(url));
}

/** URLs of the documents this repository authors under `schemas/`: format and convention schemas and their registry. */
export function authoredUrls() {
    return urlsUnder('schemas').filter(isAuthored);
}
