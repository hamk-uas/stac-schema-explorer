// Prints where each field of the given schemas is placed, without the browser:
//   pnpm explore -- <schema url or name@version> …   (STAC version from the V environment variable, default 1.1.0)
//   DUMP=Feature pnpm explore   also prints the example document of that type.
import { fromShortId } from '../src/lib/extensions';
import { probe } from '../src/lib/probe';
import { EXTENSIONS, fixtureStore } from './helpers';

const args = process.argv.slice(2).filter((a) => !a.startsWith('-')).map(fromShortId);
const urls = args.length ? args : EXTENSIONS;
const started = performance.now();
const result = await probe(fixtureStore(), process.env.V || '1.1.0', urls);
console.log('time', Math.round(performance.now() - started), 'ms');
for (const info of result.sources) {
    console.log('SOURCE', info.title, info.prefixes.join('|'), info.fields.join(','), info.unsampled.length ? `UNSAMPLED ${info.unsampled}` : '', info.error ?? '');
}
for (const template of Object.values(result.templates)) {
    console.log('=====', template.type, 'valid', template.valid, template.errors, 'N/A', template.notApplicable);
    const byLocation = new Map<string, string[]>();
    for (const p of template.placements) {
        const source = p.source === 'core' ? 'core' : result.sources.find((s) => s.key === p.source)?.title;
        const location = p.location || '/';
        byLocation.set(location, [...(byLocation.get(location) ?? []), `${source}:${p.field}${p.kind === 'presence' ? '(presence)' : ''}`]);
    }
    for (const [location, fields] of byLocation) console.log('  ', location, '=>', fields.join('  '));
    for (const conflict of template.conflicts) console.log('   CONFLICT', conflict);
}
if (process.env.DUMP) console.log(JSON.stringify(result.templates[process.env.DUMP as 'Feature'].doc, null, 1));
