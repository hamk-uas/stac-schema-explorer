/// <reference lib="webworker" />
import { CORE, type JsonObject, type ProbeProgress, type ProbeResult, type StacType } from './lib/model';
import { probe } from './lib/probe';
import { coreSchemaUrl, formatErrors, SchemaStore } from './lib/schemas';

export type EngineRequest =
    | { id: number; kind: 'probe'; stacVersion: string; urls: string[] }
    | { id: number; kind: 'validate'; doc: JsonObject; stacVersion: string; urls: string[] };

export type EngineResponse =
    | { id: number; kind: 'progress'; progress: ProbeProgress }
    | { id: number; kind: 'probe'; result: ProbeResult }
    | { id: number; kind: 'validate'; errors: string[] }
    | { id: number; kind: 'error'; message: string };

const store = new SchemaStore();
const probes = new Map<string, Promise<ProbeResult>>();
const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: EngineResponse) {
    scope.postMessage(message);
}

async function validate(doc: JsonObject, stacVersion: string, urls: string[]): Promise<string[]> {
    const type = doc.type as StacType;
    const errors: string[] = [];
    const core = await store.validator(coreSchemaUrl(type, stacVersion));
    if (core(doc) !== true) errors.push(...formatErrors(core.errors, CORE));
    for (const url of urls) {
        try {
            const validator = await store.validator(url);
            if (validator(doc) !== true) errors.push(...formatErrors(validator.errors, url));
        } catch (error) {
            errors.push(`${url}: schema could not be loaded (${error instanceof Error ? error.message : String(error)})`);
        }
    }
    return errors;
}

scope.onmessage = async (event: MessageEvent<EngineRequest>) => {
    const request = event.data;
    try {
        if (request.kind === 'probe') {
            const key = `${request.stacVersion}\n${[...request.urls].sort().join('\n')}`;
            let pending = probes.get(key);
            if (!pending) {
                pending = probe(store, request.stacVersion, request.urls, (progress) => post({ id: request.id, kind: 'progress', progress }));
                pending.catch(() => probes.delete(key));
                probes.set(key, pending);
            }
            post({ id: request.id, kind: 'probe', result: await pending });
        } else {
            post({ id: request.id, kind: 'validate', errors: await validate(request.doc, request.stacVersion, request.urls) });
        }
    } catch (error) {
        post({ id: request.id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
};
