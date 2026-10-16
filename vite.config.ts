import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // Relative base: works on GitHub Pages under /<repo>/ and on any other static host.
    base: './',
    plugins: [vue()],
    worker: { format: 'es' },
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        testTimeout: 60_000,
    },
});
