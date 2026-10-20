// Downloads the pristine upstream copies of the vendored schemas and everything they `$ref` into `upstream/`, and
// seeds `schemas/` with a copy of any schema not yet vendored there. Existing enriched copies are never overwritten.
//
//   node scripts/fetch-upstream.mjs           fetch missing upstream copies
//   node scripts/fetch-upstream.mjs --force   re-download all upstream copies (then run the tests to see changes)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { localPath, VENDORED } from './manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const force = process.argv.includes('--force');

function refsOf(node, base, out) {
    if (Array.isArray(node)) return node.forEach((child) => refsOf(child, base, out));
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) {
            const target = new URL(value, base);
            target.hash = '';
            if (!target.host.endsWith('json-schema.org')) out.add(target.toString());
        } else if (key !== 'const' && key !== 'enum' && key !== 'examples' && key !== 'default') refsOf(value, base, out);
    }
}

async function download(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const text = (await response.text()).replace(/^\uFEFF/, '');
    JSON.parse(text);
    return text.replaceAll('\r\n', '\n');
}

const queue = VENDORED.flatMap((entry) => entry.schemas);
const seen = new Set();
let fetched = 0;
while (queue.length > 0) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const upstream = join(root, 'upstream', localPath(url));
    let text;
    if (!force && existsSync(upstream)) text = readFileSync(upstream, 'utf8');
    else {
        text = await download(url);
        mkdirSync(dirname(upstream), { recursive: true });
        writeFileSync(upstream, text.endsWith('\n') ? text : `${text}\n`);
        fetched += 1;
    }
    const vendored = join(root, 'schemas', localPath(url));
    if (!existsSync(vendored)) {
        mkdirSync(dirname(vendored), { recursive: true });
        // The vendored copy's `$id` is the URL it is published at: upstream ids end in `#` or have typos (v1.1.0
        // common.json declares `…/commonjson`), which breaks registering schemas by id.
        const schema = JSON.parse(text);
        if ('$id' in schema) schema.$id = url;
        writeFileSync(vendored, `${JSON.stringify(schema, null, 2)}\n`);
    }
    const refs = new Set();
    refsOf(JSON.parse(text), url, refs);
    queue.push(...refs);
}
console.log(`${seen.size} schemas, ${fetched} downloaded`);
