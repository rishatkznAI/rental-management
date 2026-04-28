import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'

process.env.CSS_TRANSFORMER_WASM ||= '1'
process.env.NAPI_RS_FORCE_WASI ||= '1'

function readGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

const commitHash = process.env.VITE_GIT_COMMIT_SHA ||
  process.env.VITE_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  readGitCommit()
const buildTime = process.env.VITE_BUILD_TIME || process.env.BUILD_TIME || new Date().toISOString()

export default defineConfig({
  base: '/rental-management/',
  define: {
    __APP_COMMIT_HASH__: JSON.stringify(commitHash ? commitHash.slice(0, 12) : ''),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
  },
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
