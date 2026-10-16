import type { Json, JsonObject } from './model';

export function escapePointerSegment(segment: string): string {
    return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

export function unescapePointerSegment(segment: string): string {
    return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function joinPointer(base: string, ...segments: (string | number)[]): string {
    return base + segments.map((s) => '/' + escapePointerSegment(String(s))).join('');
}

export function splitPointer(pointer: string): string[] {
    if (pointer === '' || pointer === '/') return [];
    return pointer.slice(1).split('/').map(unescapePointerSegment);
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getAt(doc: Json, pointer: string): Json | undefined {
    let node: Json | undefined = doc;
    for (const segment of splitPointer(pointer)) {
        if (Array.isArray(node)) node = node[Number(segment)];
        else if (isObject(node)) node = node[segment];
        else return undefined;
    }
    return node;
}

/** Pointers of every plain object in a document, parents first. */
export function objectLocations(doc: Json): string[] {
    const out: string[] = [];
    const visit = (node: Json, pointer: string) => {
        if (Array.isArray(node)) node.forEach((child, i) => visit(child, joinPointer(pointer, i)));
        else if (isObject(node)) {
            out.push(pointer);
            for (const [key, child] of Object.entries(node)) visit(child, joinPointer(pointer, key));
        }
    };
    visit(doc, '');
    return out;
}
