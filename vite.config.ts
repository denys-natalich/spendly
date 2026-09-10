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
        name: 'Spendly — Expense Tracker',
        short_name: 'Spendly',
        description: 'Multi-currency expense tracking with live EUR/USD/UAH rates.',
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
        // Supabase and FX APIs must always hit the network first — cached data
        // is only a fallback for offline reads.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/bank\.gov\.ua\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fx-rates',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
}))
