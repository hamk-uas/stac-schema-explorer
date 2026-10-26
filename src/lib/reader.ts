import type { ReaderKind, ReaderRequest, ReaderResponse } from '../reader.worker';
import type { MetadataNode } from './readers/netcdf';

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (value: { nodes: MetadataNode[]; notes: string[] }) => void; reject: (error: Error) => void }>();

/** Reads the metadata embedded in a netCDF or TIFF file in a worker, created when first needed. */
export function readEmbeddedFile(kind: ReaderKind, href: string): Promise<{ nodes: MetadataNode[]; notes: string[] }> {
    if (!worker) {
        worker = new Worker(new URL('../reader.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<ReaderResponse>) => {
            const response = event.data;
            const entry = pending.get(response.id);
            if (!entry) return;
            pending.delete(response.id);
            if (response.kind === 'error') entry.reject(new Error(response.message));
            else entry.resolve({ nodes: response.nodes, notes: response.notes });
        };
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage({ id, kind, href } satisfies ReaderRequest);
    });
}
