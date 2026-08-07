import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';
import { siteUrl, siteUrls } from './helpers/site';

// Resolve .env next to this config rather than relative to the working
// directory: VS Code runs from the repo root, a terminal run usually from
// tests/Playwright, and a CWD-relative path silently loads nothing in one of
// them — leaving WP_BASE_URL unset and baseURL on a dead default.
const HERE = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(HERE, '.env') });

// Each worker owns one install, chosen by its TEST_PARALLEL_INDEX. This module
// is loaded per worker process, after Playwright sets that variable, so the
// worker gets its own baseURL. `helpers/site.ts` resolves the API base the same
// way, keeping page navigation and REST calls on the same site.
const baseURL = siteUrl();

// Never exceed the number of installs: two workers on one site would fight over
// gateway settings, since configureGateway() rewrites them globally.
const workers = Math.max(1, siteUrls().length);

export default defineConfig({
  testDir: './tests',
  // Signs in to every configured install up front and saves one session file per
  // site, so no suite pays for a login on its first admin screen.
  globalSetup: path.join(HERE, 'global-setup.ts'),
  timeout: 240000,
  // `fullyParallel: false` keeps every test of a spec file on one worker, so a
  // whole suite runs against a single site. Playwright then hands each free
  // worker the next file — the work queue this needs, with no orchestrator.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers,
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { open: 'never', outputFolder: 'reports' }],
  ],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
    launchOptions: { slowMo: 250 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
