import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginSass } from '@rsbuild/plugin-sass'
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss'
import { pluginVue } from '@rsbuild/plugin-vue'
import Symfony from '../assets/src/rsbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))

const publicPath = process.env.CDN_BASE ?? '/build/'

export default defineConfig({
  source: {
    entry: {
      app: resolve(__dirname, './assets/app.ts'),
      admin: resolve(__dirname, './assets/admin.ts'),
      // A style entry: a stylesheet as the entry input, so it builds to CSS with no JS attached.
      theme: resolve(__dirname, './assets/styles/theme.scss'),
    },
  },
  plugins: [
    pluginReact(),
    pluginVue(),
    pluginSass(),
    pluginTailwindcss(),
    Symfony({
        stimulus: './assets/controllers.json',
        publicPath,
        manifestKeyPrefix: 'build/',
        integrity: {
            enabled: true,
            algorithms: ['sha256', 'sha384']
        },
        copy: [
            { from: './assets/to-copy/', to: './media/' },
            { from: './assets/to-copy/', to: './tiles/', pattern: /^tile-\d+\.png$/ },
        ]
    }),
  ],
    resolve: {
      // Rsbuild, unlike Vite, doesn't dedupe React — force a single copy.
      dedupe: ['react', 'react-dom'],
      alias: {
          'leaflet/dist/leaflet.min.css': 'leaflet/dist/leaflet.css',
      }
    }
})
