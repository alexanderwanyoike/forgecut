import { defineConfig } from 'vite';

export default defineConfig({ base: './', build: { target: 'esnext', minify: false, reportCompressedSize: false, rollupOptions: { input: { main: 'index.html', sandbox: 'sandbox.html' } } } });
