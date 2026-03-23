// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/TracceGPX3.0/', // base per GitHub Pages
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['tracks_pwa.db', 'sql-wasm.wasm'], // Assets da cacheare
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,db,png,svg}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // Aumenta a 10MB per il DB
      },
      manifest: {
        name: 'Grosseto GPX Tracker',
        short_name: 'GPXTrack',
        theme_color: '#ffffff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
})