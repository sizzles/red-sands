import { defineConfig } from 'vite';
export default defineConfig({
  /*
   * Loopback by default on purpose — this binds a dev server on a machine that
   * may be on someone else's network, and the capture harness spins up its own
   * server regardless. To reach it from a phone use `npm run dev:lan`, which
   * passes --host on the CLI and overrides this.
   */
  server: { host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 4000 },
  optimizeDeps: { include: ['three'] },
});
