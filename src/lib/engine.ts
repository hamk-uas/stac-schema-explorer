import type { EngineRequest, EngineResponse } from '../engine.worker';
import type { JsonObject, ProbeProgress, ProbeResult } from './model';

type Pending = { resolve: (value: never) => void; reject: (error: Error) => void; onProgress?: (p: ProbeProgress) => void };
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** Runs schema probing in a Web Worker so the page stays responsive. */
export class Engine {
    private readonly worker = new Worker(new URL('../engine.worker.ts', import.meta.url), { type: 'module' });
    private readonly pending = new Map<number, Pending>();
    private nextId = 1;

    constructor() {
        this.worker.onmessage = (event: MessageEvent<EngineResponse>) => {
            const message = event.data;
            const entry = this.pending.get(message.id);
            if (!entry) return;
            if (message.kind === 'progress') return entry.onProgress?.(message.progress);
            this.pending.delete(message.id);
            if (message.kind === 'error') entry.reject(new Error(message.message));
            else if (message.kind === 'probe') entry.resolve(message.result as never);
            else entry.resolve(message.errors as never);
        };
    }

    private send<T>(request: WithoutId<EngineRequest>, onProgress?: (p: ProbeProgress) => void): Promise<T> {
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (value: never) => void, reject, onProgress });
            this.worker.postMessage({ ...request, id });
        });
    }

    probe(stacVersion: string, urls: string[], onProgress?: (p: ProbeProgress) => void): Promise<ProbeResult> {
        return this.send<ProbeResult>({ kind: 'probe', stacVersion, urls }, onProgress);
    }

    validate(doc: JsonObject, stacVersion: string, urls: string[]): Promise<string[]> {
        return this.send<string[]>({ kind: 'validate', doc, stacVersion, urls });
    }
}
