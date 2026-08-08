import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The demo is a static bundle. Its only backend coordinate is the Vision OS
 * platform service; it knows no module path, no database, no model endpoint.
 */
const platform = process.env.VOS_PLATFORM_URL ?? 'http://127.0.0.1:8808';

/**
 * The Atlas backend, reached under `/atlas` so it cannot collide with the
 * platform's `/api`. Used by the invoice-extraction check page only.
 *
 * Override with `ATLAS_API_URL=http://127.0.0.1:8000 npm run dev` to point at a
 * local backend.
 */
const atlas = process.env.ATLAS_API_URL ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5280,
    strictPort: true,
    proxy: {
      '/atlas': {
        target: atlas,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/atlas/, ''),
      },
      '/api': { target: platform, changeOrigin: true },
      '/ws': { target: platform, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
});
