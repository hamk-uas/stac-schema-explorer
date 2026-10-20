import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function files(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : name.endsWith('.json') ? [path] : [];
    });
}

/** URLs of every schema under `schemas/` (or `upstream/`), derived from their location. */
export function vendoredUrls(dir = 'schemas') {
    const base = join(root, dir);
    return files(base).map((path) => `https://${relative(base, path).replaceAll('\\', '/')}`).sort();
}
