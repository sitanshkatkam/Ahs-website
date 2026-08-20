import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: {
    // Lets Settings show which build is actually running on a phone.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    // The share URL is baked in rather than read from window.location, so a
    // QR or a copied link is the public address even when the app is being
    // used from localhost or reached through some other hostname.
    __APP_URL__: JSON.stringify(pkg.appUrl),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // injectManifest rather than generateSW: the service worker carries a
      // hand-written push handler (src/sw.ts), which a generated one can't.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      manifest: {
        name: 'American High Schedule',
        short_name: 'AHS',
        description:
          "Today's bell schedule, your classes, and what's coming up at American High School.",
        theme_color: '#191c22',
        background_color: '#191c22',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
