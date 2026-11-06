/// <reference lib="webworker" />
// Reads metadata embedded in binary data files. Kept apart from the schema engine: netCDF range reads are synchronous and
// would stall probing, and the readers' wasm and decoders are loaded only when a file is opened.
import type { MetadataNode, ReaderNote } from './lib/readers';

export type ReaderKind = 'netcdf' | 'tiff';
export type ReaderRequest = { id: number; kind: ReaderKind; href: string };
export type ReaderResponse =
    | { id: number; kind: 'read'; nodes: MetadataNode[]; notes: string[] }
    | { id: number; kind: 'error'; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A reader's note in the app's English. */
function noteText(note: ReaderNote): string {
    if (note.code === 'deferred-values') return `Long tag values are shown by their length only: ${note.params.tags}.`;
    return `Only the first ${note.params.count} of ${note.params.total} images are read.`;
}

async function read(request: ReaderRequest): Promise<{ nodes: MetadataNode[]; notes: string[] }> {
    if (request.kind === 'tiff') {
        const { readTiff } = await import('./lib/readers/tiff');
        const { nodes, notes } = await readTiff(request.href);
        return { nodes, notes: notes.map(noteText) };
    }
    const { readNetCDF } = await import('./lib/readers/netcdf');
    try {
        return { nodes: await readNetCDF(request.href, { rangeRequests: true }), notes: [] };
    } catch (ranged) {
        // Classic netCDF files, and servers without range requests, are downloaded instead (up to 64 MiB).
        try {
            return { nodes: await readNetCDF(request.href), notes: [`Read by downloading the file: range requests failed (${message(ranged)}).`] };
        } catch (downloaded) {
            throw new Error(`${message(downloaded)} (range requests also failed: ${message(ranged)})`);
        }
    }
}

scope.onmessage = async (event: MessageEvent<ReaderRequest>) => {
    const request = event.data;
    try {
        const { nodes, notes } = await read(request);
        scope.postMessage({ id: request.id, kind: 'read', nodes, notes } satisfies ReaderResponse);
    } catch (error) {
        const text = error instanceof TypeError ? `${message(error)} (network error or the server does not allow cross-origin requests)` : message(error);
        scope.postMessage({ id: request.id, kind: 'error', message: text } satisfies ReaderResponse);
    }
};
