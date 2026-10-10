import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwind()],
  server: { port: 5173, proxy: { '/v1': 'http://localhost:3060' } },
  build: { sourcemap: true },
});
