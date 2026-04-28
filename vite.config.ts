import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'

process.env.CSS_TRANSFORMER_WASM ||= '1'
process.env.NAPI_RS_FORCE_WASI ||= '1'

export default defineConfig({
  base: '/rental-management/',
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  server: {
    proxy: {
      // In dev mode, proxy /api and /bot requests to the local Express server
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/bot': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React core
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // UI components (Radix + shadcn)
          'vendor-ui': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-slot',
            'class-variance-authority',
            'clsx',
            'tailwind-merge',
          ],
          // Icons
          'vendor-icons': ['lucide-react'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
})
