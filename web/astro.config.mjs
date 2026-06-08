import { defineConfig } from 'astro/config';
import { visualizer } from 'rollup-plugin-visualizer';
import tailwindcss from '@tailwindcss/vite';

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: 'static',
  site: 'https://chat.emolike.net',

  build: {
    assets: 'assets',
  },

  vite: {
    build: {
      target: 'es2022',
    },
    plugins: [
      tailwindcss(),
      visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true }),
    ],
  },

  adapter: cloudflare()
});