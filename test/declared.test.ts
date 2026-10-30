import { describe, expect, it } from 'vitest';

import { extensionWithoutVersion } from '../src/lib/extensions';
import type { JsonObject, TypeTemplate } from '../src/lib/model';
import { documentView, undeclaredExtensions } from '../src/lib/tree';

const DATACUBE = 'https://stac-extensions.github.io/datacube/v2.3.0/schema.json';
const DATACUBE_OLD = 'https://stac-extensions.github.io/datacube/v2.2.0/schema.json';
const SAT = 'https://stac-extensions.github.io/sat/v1.2.0/schema.json';
const same = (a: string, b: string) => extensionWithoutVersion(a) === extensionWithoutVersion(b);

const sources = [
    { key: DATACUBE, url: DATACUBE, title: 'Datacube', prefixes: ['cube'], fields: ['cube:dimensions'], unsampled: [], docs: {} },
    { key: SAT, url: SAT, title: 'Satellite', prefixes: ['sat'], fields: ['sat:orbit_state'], unsampled: [], docs: {} },
];
const template: TypeTemplate = {
    type: 'Collection', stacVersion: '1.1.0', conflicts: [], notApplicable: [], valid: true, errors: [], doc: {},
    placements: [
        { source: DATACUBE, field: 'cube:dimensions', location: '', kind: 'validated' },
        { source: SAT, field: 'sat:orbit_state', location: '/summaries', kind: 'presence' },
    ],
};

describe('undeclared extensions', () => {
    it('compares extensions without their versions', () => {
        expect(extensionWithoutVersion(DATACUBE)).toBe(extensionWithoutVersion(DATACUBE_OLD));
        expect(extensionWithoutVersion(DATACUBE)).not.toBe(extensionWithoutVersion(SAT));
        expect(extensionWithoutVersion('https://example.com/ext/schema.json')).toBe('https://example.com/ext/schema.json');
    });

    it('finds fields of extensions the document does not declare, outside summaries', () => {
        const doc: JsonObject = { type: 'Collection', 'cube:dimensions': {}, summaries: { 'sat:orbit_state': ['ascending'] } };
        const view = documentView(doc, template, sources, false);
        expect(undeclaredExtensions(view, [], same)).toEqual([{ source: DATACUBE, fields: ['cube:dimensions'] }]);
        // Any version of the extension counts as declared.
        expect(undeclaredExtensions(view, [DATACUBE_OLD], same)).toEqual([]);
    });

    it('ignores absent fields', () => {
        const view = documentView({ type: 'Collection' }, template, sources, false);
        expect(undeclaredExtensions(view, [], same)).toEqual([]);
    });
});
