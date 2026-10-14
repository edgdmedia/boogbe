import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwind()],
  // API_PROXY_TARGET: E2E on a machine where 3060 is taken (see playwright.config.ts).
  server: { port: 5173, proxy: { '/v1': process.env.API_PROXY_TARGET ?? 'http://localhost:3060' } },
  build: { sourcemap: true },
});
