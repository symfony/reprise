import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, version as viteVersion } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import Inspect from 'vite-plugin-inspect'
import Unplugin from '../assets/src/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

const publicPath = process.env.CDN_BASE ?? '/build/'

const input = {
  app: resolve(__dirname, './assets/app.ts'),
  admin: resolve(__dirname, './assets/admin.ts'),
}

// The top-level `input` option landed in Vite 8.2; the E2E matrix still runs Vite 7.
const [viteMajor, viteMinor] = viteVersion.split('.').map(Number)
const entry = viteMajor > 8 || (viteMajor === 8 && viteMinor >= 2)
  ? { input }
  : { build: { rollupOptions: { input } } }

export default defineConfig({
  ...entry,
  plugins: [
    tailwindcss(),
    Inspect(),
    react(),
    vue(),
    Unplugin({
        stimulus: './assets/controllers.json',
        publicPath,
        manifestKeyPrefix: 'build/',
        integrity: {
            enabled: true,
        },
        copy: [
            { from: './assets/to-copy/', to: './media/' },
            { from: './assets/to-copy/', to: './tiles/', pattern: /^tile-\d+\.png$/ },
        ]
    }),
  ],
    resolve: {
      alias: {
          'leaflet/dist/leaflet.min.css': 'leaflet/dist/leaflet.css',
      }
    }
})
