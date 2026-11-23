// 製品の画面を、見本データで動かして撮り、崩れを数える。
//   npm run ds:screens -- --out <dir>                 全場面を撮って数える
//   npm run ds:screens -- --only settings-engine      場面を絞る（前方一致、カンマ区切り）
//   npm run ds:screens -- --sizes 1464x917,1024x640   窓の大きさ（省くと、14インチの起動時と、窓の下限）
//   npm run ds:screens -- --jobs 4                    同時に開くページの数
//   npm run ds:screens -- --engine webkit             WebKit で描く（macOS の製品はこれ。省くと chromium）
//   npm run ds:screens -- --url http://localhost:5199 動いているサーバを使う
//   npm run ds:screens -- --strict                    崩れ・形の癖・固定値の違反が1件でもあれば失敗する（製品の verify:screens）
//
// 製品の部品は src/ のものをそのまま描く。Tauri の呼び出しだけを screens/mock-tauri.mjs が答える。
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { SCENARIOS, FIXTURES } from '../screens/scenarios.mjs';
import { installTauriMock } from '../screens/mock-tauri.mjs';
import { measureScreen } from '../screens/measure.mjs';
import { ALL, BREAKS, LOCKED, SHAPES, countOf } from '../screens/kinds.mjs';

const ds = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(ds, '..');

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const only = opt('only')?.split(',') ?? null;
const sizes = (opt('sizes') ?? '1464x917,1024x640').split(',').map((s) => {
  const [width, height] = s.split('x').map(Number);
  return { name: s, width, height };
});
const out = path.resolve(opt('out') ?? path.join(ds, 'test-results', 'screens'));
const scale = Number(opt('scale') ?? 1);
const port = Number(opt('port') ?? 5199);
const jobs = Number(opt('jobs') ?? 4);
const engine = opt('engine') === 'webkit' ? webkit : chromium;

// 実アプリの窓の地の色。半透明の帯（タイトルバー）がこの上に載る
const windowBackground = JSON.parse(
  readFileSync(path.join(repo, 'src-tauri', 'tauri.conf.json'), 'utf8'),
).app.windows[0].backgroundColor;

async function startServer() {
  const url = opt('url');
  if (url) return { url, stop: () => {} };
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // npx の下の vite ごと止めるために、プロセスの組を分ける
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite が起動しなかった')), 60000);
    child.stdout.on('data', (d) => {
      if (!/Local:|ready in/.test(String(d))) return;
      clearTimeout(timer);
      resolve();
    });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => reject(new Error(`vite が終了した: ${code}`)));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => process.kill(-child.pid, 'SIGTERM'),
  };
}

function pickScenarios() {
  if (!only) return SCENARIOS;
  const picked = SCENARIOS.filter((s) => only.some((o) => s.id === o || s.id.startsWith(`${o}-`)));
  if (picked.length === 0) {
    console.error(`--only ${only.join(',')} に当たる場面が無い（screens/scenarios.mjs の id を書く）`);
    process.exit(1);
  }
  return picked;
}

async function capture(browser, baseUrl, scenario, size) {
  const { steps, ...meta } = scenario;
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: scale,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(installTauriMock, FIXTURES[scenario.fixture]);
  await page.addInitScript((color) => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.backgroundColor = color;
    });
  }, windowBackground);

  try {
    await page.goto(baseUrl + scenario.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(scenario.fixture === 'booting' ? 600 : 900);
    await page.evaluate(() => document.fonts.ready);
    if (steps) await steps(page);
    await page.waitForTimeout(200);

    const file = `${scenario.id}@${size.name}.png`;
    await page.screenshot({ path: path.join(out, file), animations: 'disabled', caret: 'hide' });
    const findings = await page.evaluate(measureScreen, {});
    return { ...meta, size: size.name, file, findings, errors };
  } catch (e) {
    const file = `${scenario.id}@${size.name}.failed.png`;
    await page.screenshot({ path: path.join(out, file) }).catch(() => {});
    return { ...meta, size: size.name, file: null, findings: [], errors: [...errors, String(e)] };
  } finally {
    await context.close();
  }
}

function summarize(results) {
  const totalOf = (kind) => results.reduce((n, r) => n + countOf(r, kind), 0);
  const line = (label, kinds) => {
    const each = kinds.map((k) => [k, totalOf(k)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    console.log(`${label} ${each.reduce((n, [, c]) => n + c, 0)} 件${each.length ? `（${each.map(([k, n]) => `${k} ${n}`).join('、')}）` : ''}`);
  };
  const broken = results.filter((r) => BREAKS.some((k) => countOf(r, k) > 0)).length;
  console.log(`\n${results.length} 場面のうち、崩れのある場面 ${broken}`);
  line('崩れ', BREAKS);
  line('形の癖', SHAPES);
  line('固定値の違反', LOCKED);
}

const picked = pickScenarios();
const server = await startServer();
mkdirSync(out, { recursive: true });
const queue = sizes.flatMap((size) => picked.map((scenario) => ({ size, scenario })));
const results = new Array(queue.length);
let next = 0;

// 長く開いていると撮影が止まることがあるので、20枚ごとにブラウザを起こし直し、描けなかった1枚は2回までやり直す
async function worker() {
  let browser = await engine.launch();
  let used = 0;
  while (next < queue.length) {
    const at = next;
    next += 1;
    const { size, scenario } = queue[at];
    let r = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      r = await capture(browser, server.url, scenario, size);
      if (r.file) break;
      await browser.close().catch(() => {});
      browser = await engine.launch();
      used = 0;
    }
    results[at] = r;
    const counts = ALL
      .map((kind) => [kind, countOf(r, kind)])
      .filter(([, n]) => n > 0)
      .map(([kind, n]) => `${kind}:${n}`)
      .join(' ');
    const failed = r.errors.length ? `  ERR ${r.errors[0].replace(/\s+/g, ' ').slice(0, 140)}` : '';
    console.log(`${r.size.padEnd(10)} ${r.id.padEnd(26)} ${counts || 'ok'}${failed}`);
    used += 1;
    if (used >= 20) {
      await browser.close().catch(() => {});
      browser = await engine.launch();
      used = 0;
    }
  }
  await browser.close().catch(() => {});
}

try {
  // 1枚目は vite が部品を変換する間に当たるので、先に1つだけ開いて温める
  const warm = await engine.launch();
  await capture(warm, server.url, SCENARIOS.find((s) => s.id === 'welcome'), sizes[0]);
  await warm.close();
  await Promise.all(Array.from({ length: jobs }, worker));
} finally {
  server.stop();
}

writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
summarize(results);

// 描けなかった場面を「崩れ 0 件」と読ませない
const undrawn = results.filter((r) => !r.file);
if (undrawn.length > 0) {
  console.error(`\n描けなかった場面が ${undrawn.length} あります:\n${undrawn.map((r) => `  ${r.id}@${r.size} ${r.errors.at(-1)?.replace(/\s+/g, ' ').slice(0, 140)}`).join('\n')}`);
  process.exitCode = 1;
}

if (has('strict')) {
  const bad = results
    .map((r) => ({ key: `${r.id}@${r.size}`, n: ALL.reduce((m, k) => m + countOf(r, k), 0), errors: r.errors }))
    .filter((r) => r.n > 0 || r.errors.length > 0);
  for (const r of bad) console.error(`  ${r.key}: ${r.n} 件${r.errors.length ? `（${r.errors[0].slice(0, 120)}）` : ''}`);
  if (bad.length > 0) process.exitCode = 1;
  console.log(bad.length > 0 ? `直す場面 ${bad.length} / ${results.length}` : `直す場面は無い（${results.length} 場面）`);
}
