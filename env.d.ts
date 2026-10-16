/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<object, object, unknown>;
    export default component;
}

declare module 'ajv-formats-draft2019' {
    import type Ajv from 'ajv';
    export default function addFormats(ajv: Ajv): Ajv;
}
