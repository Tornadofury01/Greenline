import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Shared folders live outside /app so the pipeline and scoring can use them too.
    alias: {
      '@content': root('../content'),
      '@shared': root('../shared'),
      '@scoring': root('../scoring'),
    },
  },
  server: { fs: { allow: ['..'] } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Greenline',
        short_name: 'Greenline',
        description: 'Compare crop rotations for North Texas fields using NASA Earth data.',
        theme_color: '#2f6b3a',
        background_color: '#f6f4ec',
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
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
});
