import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

import { DEFAULT_DEMO_FIELD_ID } from './src/config.js';

const root = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  // The demo field: the one setting in src/config.js, or VITE_DEMO_FIELD_ID (shell or .env.local).
  // Only this field is precached for offline use; the other 299 are cached when opened.
  const DEMO_FIELD_ID = loadEnv(mode, process.cwd(), 'VITE_').VITE_DEMO_FIELD_ID || process.env.VITE_DEMO_FIELD_ID || DEFAULT_DEMO_FIELD_ID;

  return {
    resolve: {
      // Shared folders live outside /app so the pipeline and scoring can use them too.
      alias: {
        '@content': root('../content'),
        '@shared': root('../shared'),
        '@scoring': root('../scoring'),
      },
    },
    server: { fs: { allow: ['..'] } },
    build: {
      rollupOptions: {
        output: {
          // Field files go to assets/fields/<id>-<hash>.js so the service worker can treat them separately.
          chunkFileNames: (c) => (c.facadeModuleId?.includes('/shared/fields/') ? 'assets/fields/[name]-[hash].js' : 'assets/[name]-[hash].js'),
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Greenline',
          short_name: 'Greenline',
          description: 'Compare crop rotations for North Texas fields using NASA Earth data.',
          theme_color: '#f3eee1',
          background_color: '#f3eee1',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // App shell + bundled JSON are precached; map tiles are NOT (they need a connection).
          // v2 fields are packed into public/v2f/ (scripts/pack-v2-fields.mjs): only the demo field is precached.
          globPatterns: ['**/*.{js,css,html,svg,png,json}', `v2f/${DEMO_FIELD_ID}.json.gz`],
          // v1 field files (assets/fields/) and v2 field files (assets/ec-NNN-*.js): precache only the demo field.
          globIgnores: ['**/history/**', '**/assets/fields/!(' + DEMO_FIELD_ID + ')-*.js', '**/assets/ec-!(' + DEMO_FIELD_ID.slice(3) + ')-*.js'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          runtimeCaching: [{
            urlPattern: ({ url }) => url.pathname.includes('/assets/fields/') || /\/assets\/ec-\d+-/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'greenline-fields', expiration: { maxEntries: 80 } },
          }, {
            // v2 field files are not hashed (same name after a re-run): show the cached copy, refresh it in the background
            urlPattern: ({ url }) => url.pathname.includes('/v2f/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'greenline-v2-fields', expiration: { maxEntries: 80 } },
          }],
        },
      }),
    ],
  };
});
