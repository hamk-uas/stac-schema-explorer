// Prints every title and description that the vendored schemas add to upstream, for review.
//   node scripts/review.mjs [filter]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDependency, localPath } from './manifest.mjs';
import { annotations, valueList, walkSchemas } from './schema-tools.mjs';
import { vendoredUrls } from './vendored.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const filter = process.argv[2] ?? '';
for (const url of vendoredUrls()) {
    if (isDependency(url) || !url.includes(filter)) continue;
    const read = (dir) => JSON.parse(readFileSync(join(root, dir, localPath(url)), 'utf8'));
    const upstream = annotations(read('upstream'));
    const schema = read('schemas');
    const lines = [];
    walkSchemas(schema, (node, pointer) => {
        const short = pointer.replace(/\/(properties|definitions|allOf|anyOf|oneOf|items)(?=\/|$)/g, (m, k) => (k === 'properties' ? '.' : k === 'definitions' ? '#' : k === 'items' ? '[]' : `~${k}`)).replace(/\.\//g, '.');
        const title = upstream.has(`${pointer}/title`) ? '' : node.title;
        const description = upstream.has(`${pointer}/description`) ? '' : node.description;
        if ('const' in node && valueList(node) === undefined && (title || description)) lines.push(`    = ${JSON.stringify(node.const)}: ${title ?? ''}${description ? ` — ${description}` : ''}`);
        else if (title || description) lines.push(`  ${short}  [${title ?? node.title ?? ''}] ${description ?? ''}`);
    });
    if (lines.length) console.log(`${localPath(url)}\n${lines.join('\n')}`);
}
