import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env' });

const baseURL = process.env.WP_BASE_URL || 'https://mastercard-saucal.sa.ngrok.io';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { open: 'never' }],
  ],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
