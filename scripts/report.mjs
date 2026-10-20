// Lists what is still undocumented in the vendored schemas.
//   node scripts/report.mjs [filter]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDependency, localPath } from './manifest.mjs';
import { documentation, documentationSites, inCondition, walkSchemas, valueList } from './schema-tools.mjs';
import { vendoredUrls } from './vendored.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const filter = process.argv[2] ?? '';
const docs = new Map();
const resolve = (url) => {
    if (!docs.has(url)) {
        try {
            docs.set(url, JSON.parse(readFileSync(join(root, 'schemas', localPath(url)), 'utf8')));
        } catch {
            docs.set(url, undefined);
        }
    }
    return docs.get(url);
};

let missing = 0;
let enums = 0;
let untitledValues = 0;
for (const url of vendoredUrls()) {
    if (isDependency(url) || !url.includes(filter)) continue;
    const schema = resolve(url);
    const core = url.includes('schemas.stacspec.org');
    const problems = [];
    for (const site of documentationSites(schema, { core })) {
        const docs = documentation(site.node, url, resolve);
        const lacks = ['title', 'description'].filter((key) => !docs[key]);
        if (lacks.length) problems.push(`  ${site.pointer}  (${site.path.join(' › ')}) lacks ${lacks.join(', ')}`);
    }
    walkSchemas(schema, (node, pointer, context) => {
        if (Array.isArray(node.enum) && !inCondition(context)) {
            enums += 1;
            problems.push(`  ${pointer}  enum ${JSON.stringify(node.enum).slice(0, 80)}`);
        }
        const list = valueList(node);
        for (const [i, value] of (list?.values ?? []).entries()) {
            if (!value.title) {
                untitledValues += 1;
                problems.push(`  ${pointer}/${list.keyword}/${i}  value ${JSON.stringify(value.const)} lacks title`);
            }
        }
    });
    missing += problems.length;
    if (problems.length) console.log(`${localPath(url)}\n${problems.join('\n')}`);
}
console.log(`\n${missing} problems (${enums} enums, ${untitledValues} untitled values)`);
process.exitCode = missing > 0 ? 1 : 0;
