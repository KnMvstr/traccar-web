import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { prepareData } from './scripts/prepare-data.mjs';

export default defineConfig({ plugins: [react(), {
  name: 'completed-benchmark-refresh',
  configureServer(server) {
    prepareData();
    const timer = setInterval(() => prepareData(), 5000);
    server.httpServer?.once('close', () => clearInterval(timer));
  },
}], server: { watch: { ignored: ['**/public/data/**'] } } });
