import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const nodeBin = JSON.stringify(process.env.PLAYWRIGHT_NODE_PATH || process.execPath);
const viteBin = JSON.stringify(path.join(projectRoot, 'node_modules', '.bin', 'vite'));

const frontendCommand = `${nodeBin} ${viteBin} --host 127.0.0.1 --port 5173`;
const backendCommand = `${nodeBin} server.js`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173/rental-management/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: frontendCommand,
      url: 'http://127.0.0.1:5173/rental-management/',
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        CSS_TRANSFORMER_WASM: '1',
        NAPI_RS_FORCE_WASI: '1',
      },
    },
    {
      command: backendCommand,
      cwd: './server',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
