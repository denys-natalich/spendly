import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/spendly/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Moneta — Money Management',
        short_name: 'Moneta',
        description: 'Money management — expenses, trips and debts, with live EUR/USD/UAH rates.',
        theme_color: '#1a1a19',
        background_color: '#121211',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/spendly/',
        scope: '/spendly/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The shell is precached in full, so the app starts with no network at
        // all; the data it shows comes from IndexedDB, not from a cached
        // response. Supabase is never cached — a stale reply would be read as
        // the truth and overwrite what the device knows.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/bank\.gov\.ua\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fx-rates',
              // A rate is worth waiting a few seconds for, not a minute: past
              // that the cached copy is a better answer than a spinner.
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
}))
