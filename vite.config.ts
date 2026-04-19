import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pages from '@hono/vite-cloudflare-pages'

export default defineConfig(({ mode }) => {
  if (mode === 'client') {
    return {
      plugins: [react()],
      build: {
        emptyOutDir: false,   // don't wipe dist/ — _worker.js lives there too
        rollupOptions: {
          input: './src/client/index.tsx',
          output: {
            entryFileNames: 'static/client.js',
            chunkFileNames: 'static/[name]-[hash].js',
            assetFileNames: 'static/[name]-[hash][extname]',
          },
        },
      },
    }
  }
  return {
    plugins: [pages()],
    build: {
      outDir: 'dist',
    },
  }
})
