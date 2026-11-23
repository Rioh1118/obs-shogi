// 案の画面（frame.html）を撮り、製品の画面と同じ物差し（screens/measure.mjs）で崩れを数える。
// 画面は `frame.html#p=<案>&screen=<画面>&state=<状態>&theme=<明るさ>` で開く。
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { measureScreen } from '../screens/measure.mjs';

async function shootOne(browser, url, j, scale, out) {
  const [width, height] = j.size.split('x').map(Number);
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    reducedMotion: 'reduce',
    locale: 'ja-JP',
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${url}#p=${j.p}&screen=${j.screen}&state=${j.state}&theme=${j.theme}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const file = `${j.p}-${j.screen}-${j.state}-${j.theme}@${j.size}.png`;
    await page.screenshot({ path: path.join(out, file), animations: 'disabled' });
    const findings = await page.evaluate(measureScreen, {});
    return { ...j, id: `${j.p}-${j.screen}-${j.state}`, file, findings, errors };
  } finally {
    await context.close().catch(() => {});
  }
}

/** 案 × 画面 × 状態 × 窓 × 明るさを全部撮る。崩れと描画の失敗を数えて返す。same は、ほかの案と同じなので撮らない画面（案 → 画面 → 同じ案） */
export async function shootFrames({ frameFile, out, cases, screens, states, skip = {}, same = {}, sizes, themes, scale = 1, jobs = 4 }) {
  mkdirSync(out, { recursive: true });
  const url = pathToFileURL(frameFile).href;
  const queue = [];
  for (const size of sizes)
    for (const p of cases)
      for (const screen of screens)
        for (const state of states) {
          if (skip[screen]?.includes(state) || same[p]?.[screen]) continue;
          for (const theme of themes) queue.push({ size, p, screen, state, theme });
        }

  const results = new Array(queue.length);
  let next = 0;

  // 長く開いていると撮影が止まることがあるので、40枚ごとにブラウザを起こし直し、失敗した1枚は2回までやり直す
  async function worker() {
    let browser = await chromium.launch();
    let used = 0;
    while (next < queue.length) {
      const at = next;
      next += 1;
      for (let attempt = 0; ; attempt += 1) {
        try {
          results[at] = await shootOne(browser, url, queue[at], scale, out);
          break;
        } catch (e) {
          await browser.close().catch(() => {});
          browser = await chromium.launch();
          used = 0;
          if (attempt >= 2) throw e;
        }
      }
      used += 1;
      if (used >= 40) {
        await browser.close();
        browser = await chromium.launch();
        used = 0;
      }
    }
    await browser.close();
  }

  await Promise.all(Array.from({ length: jobs }, worker));
  writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));

  const total = {};
  for (const r of results) {
    const c = {};
    for (const f of r.findings) {
      c[f.kind] = (c[f.kind] ?? 0) + f.count;
      total[f.kind] = (total[f.kind] ?? 0) + f.count;
    }
    if (Object.keys(c).length || r.errors.length) {
      const counts = Object.entries(c)
        .map(([k, n]) => `${k}:${n}`)
        .join(' ');
      console.log(`${r.size.padEnd(10)} ${r.id.padEnd(22)} ${r.theme.padEnd(5)} ${counts} ${r.errors.join(' | ').slice(0, 200)}`);
    }
  }
  console.log(`案 ${results.length} 枚、崩れ ${JSON.stringify(total)}`);
  return { results, total };
}
