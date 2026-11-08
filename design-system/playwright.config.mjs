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
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.001, threshold: 0.02 }, // threshold は1画素の色の差の許容。既定の 0.2 だと #2c3639 → #1b2325 の背景の変更を見逃す
  },
});
