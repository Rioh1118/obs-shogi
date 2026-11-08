// npm run ds:shot — preview/ の見本画面の画像差分。
// 基準画像の更新（npm run ds:shot:update）はユーザーの承認後だけ。
// 基準画像は {platform} ごと（macOS と Linux で書体の描画が違う）。
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const pages = ['index', 'button', 'examples'];

for (const name of pages) {
  test(`preview/${name}.html`, async ({ page }) => {
    await page.goto(pathToFileURL(path.resolve('preview', `${name}.html`)).href);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
}

test('Button のフォーカス表示（固定の二重リング）', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve('preview', 'button.html')).href);
  await page.keyboard.press('Tab'); // ナビゲーションのリンク
  await page.locator('[data-theme="dark"] .lm-button--primary').first().focus();
  await expect(page.locator('.pv-themes')).toHaveScreenshot('button-focus-dark.png');
});
