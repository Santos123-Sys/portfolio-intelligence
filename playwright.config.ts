import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3100', browserName: 'chromium' },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      SESSION_SECRET: 'browser-test-only-session-secret-at-least-32-characters',
      DATABASE_URL: 'postgresql://browser:browser@127.0.0.1:5432/browser',
      MARKET_DATA_PROVIDER: 'stub',
      WEB_SEARCH_PROVIDER: 'none',
    },
  },
});
