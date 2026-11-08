import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  snapshotPathTemplate: 'tests/__screenshots__/{arg}-{platform}{ext}',
  reporter: 'list',
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  },
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.001 },
  },
});
