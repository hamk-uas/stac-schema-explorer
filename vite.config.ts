import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Publishes the schemas this repository authors (schemas/hamk-uas.github.io/stac-schema-explorer/schemas/) at
 * `<site>/schemas/`, the base of their `$id`s on GitHub Pages.
 */
function publishAuthoredSchemas(): Plugin {
    let outDir = 'dist';
    return {
        name: 'publish-authored-schemas',
        apply: 'build',
        configResolved(config) {
            outDir = config.build.outDir;
        },
        closeBundle() {
            const source = fileURLToPath(new URL('./schemas/hamk-uas.github.io/stac-schema-explorer/schemas/', import.meta.url));
            cpSync(source, `${outDir}/schemas`, { recursive: true });
        },
    };
}

export default defineConfig({
    // Relative base: works on GitHub Pages under /<repo>/ and on any other static host.
    base: './',
    plugins: [vue(), publishAuthoredSchemas()],
    worker: { format: 'es' },
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        testTimeout: 60_000,
    },
});
