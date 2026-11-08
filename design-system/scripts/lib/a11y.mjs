// axe-core（WCAG 2.0/2.1/2.2 の A と AA）で HTML を検査する。
// axe はフォーカス表示のコントラスト（2.4.11 / 2.4.13）を検査しない。それはコントラストのペア検査で担保する。
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { pathToFileURL } from 'node:url';

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export async function axeFiles(files) {
  const results = [];
  if (!files.length) return results;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    for (const file of files) {
      for (const scheme of ['light', 'dark']) {
        const page = await context.newPage();
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(pathToFileURL(file).href);
        const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        results.push({ file, scheme, violations: r.violations });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}
