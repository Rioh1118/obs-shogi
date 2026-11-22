// 見比べる1枚（compare.html）を組む。案を撮って崩れを数え、今の画面の画像と一緒に全部埋め込む。
//   node compare/build.mjs <探索のフォルダ> --work <作業フォルダの絶対パス> --now --url <開発サーバ>   最初の1回
//   node compare/build.mjs <探索のフォルダ> --work <作業フォルダの絶対パス>                            2回目から
// 案に崩れか固定値の違反が1件でもあれば、1枚を作ったうえで失敗で終わる。
//
// 探索のフォルダの cases.mjs が出すもの（例: explorations/2026-11-22-rework/cases.mjs）
//   buildFrame()          案の画面を1ファイルの HTML で返す。次の2つを守る
//                         - window.__setProto({ p, screen, state, theme }) で、案・画面・状態・明るさを描き替える
//                           （最初の値は URL の #p=…&screen=…&state=…&theme=… から読む）
//                         - { type: 'obs-part', id, x, y } の message に { type: 'obs-part-reply', id, part, text } を返す
//                           （感想の印を付けた所の名前。data-part を読む）
//   TITLE, ROUND          1枚の題、周の名前（英数字とハイフン。感想のファイル名になる）
//   CASES, RECOMMEND      案の id・名前・説明・諦めるもの、推奨する案の id。id が now のものは今の画面。
//                         same（画面 → 案の id）を書いた画面は、その案と同じとして撮らない
//   SCREENS, STATES, SKIP 画面と状態の id と名前、画面ごとに無い状態
//   SIZES, THEMES, START  窓の大きさ、明るさ（1つなら切り替えを出さない）、最初に見せる組
//   SIZE_LABELS           窓の大きさに添える語（省ける）
//   NOW, NOW_MISSING      今の画面を撮る場面（画面 → 状態 → 場面の id）、今の製品に無い明るさの断り
//   FACTS                 盤の大きさと一度に見える手を測る所（省ける）
//
// 作業フォルダ: 作ったものを全部ここに置く。git には入れない
//   frame.html / proto/ … 案の画面と、撮った画像・崩れの数
//   now/ … 今の画面（--now を付けたときに撮り直す。盤の大きさは --url の開発サーバから測る）
//   feedback/<周>.json … 見る人の感想
//   feedback/previous.json … 前の周までの感想と、1件ごとに「直したこと」（done）。感想から作り、done が空なら止まる
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { BREAKS, LOCKED } from '../screens/kinds.mjs';
import { SCENARIOS, FIXTURES } from '../screens/scenarios.mjs';
import { installTauriMock } from '../screens/mock-tauri.mjs';
import { shootFrames } from './shoot.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ds = path.resolve(here, '..');
const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

if (!args[0] || args[0].startsWith('--') || !opt('work')) {
  console.error('使い方: node compare/build.mjs <探索のフォルダ> --work <作業フォルダ> [--now --url <開発サーバ>] [--skip-shoot]');
  process.exit(1);
}
const exploration = path.resolve(args[0]);
const work = path.resolve(opt('work'));
const X = await import(pathToFileURL(path.join(exploration, 'cases.mjs')).href);
mkdirSync(work, { recursive: true });

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const NEEDED = ['buildFrame', 'TITLE', 'ROUND', 'CASES', 'RECOMMEND', 'SCREENS', 'STATES', 'SKIP', 'SIZES', 'THEMES', 'START', 'NOW', 'NOW_MISSING'];
const lacking = NEEDED.filter((name) => X[name] === undefined);
if (lacking.length > 0) fail(`cases.mjs に ${lacking.join('、')} が無い（書き方は compare/build.mjs の冒頭）`);
if (!/^[\w-]+$/.test(X.ROUND)) fail(`周の名前は英数字とハイフンで書く: ${X.ROUND}`);

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

// 0. 前の周の感想。1件ずつ、どう直したか（従わなかったなら理由）を書いてから次の1枚を作る
const feedbackDir = path.join(work, 'feedback');
const previousFile = path.join(feedbackDir, 'previous.json');
const nameIn = (list, id) => list.find(([k]) => k === id)?.[1] ?? id;
function collectPrevious() {
  if (!existsSync(feedbackDir)) return [];
  const written = existsSync(previousFile) ? read(previousFile) : [];
  const doneOf = (round, key) => written.find((r) => r.round === round)?.items.find((i) => i.key === key)?.done ?? '';
  const past = readdirSync(feedbackDir)
    .filter((f) => f.endsWith('.json') && f !== 'previous.json' && f !== `${X.ROUND}.json`)
    .sort()
    .map((f) => read(path.join(feedbackDir, f)))
    .filter((r) => r.round && Array.isArray(r.notes));
  return past.map((r) => {
    const items = r.notes.map((n) => {
      const at = [X.CASES.find((c) => c.id === n.case)?.short ?? n.case, nameIn(X.SCREENS, n.screen), nameIn(X.STATES, n.state)];
      return { key: [n.case, n.screen, n.state, n.at].join(':'), where: `${at.join(' ')}: ${n.where}`, text: n.text };
    });
    if (r.comment) items.unshift({ key: 'all', where: '全体', text: r.comment });
    return { round: r.round, items: items.map((i) => ({ ...i, done: doneOf(r.round, i.key) })) };
  });
}
const previous = collectPrevious();
if (previous.length > 0) {
  writeFileSync(previousFile, `${JSON.stringify(previous, null, 1)}\n`);
  const open = previous.flatMap((r) => r.items.filter((i) => !i.done).map((i) => `  ${r.round} ${i.where}: ${i.text}`));
  if (open.length > 0) {
    console.error(`前の周の感想に、直したこと（従わなかったなら理由）が書かれていない: ${open.length} 件\n${open.join('\n')}\n${previousFile} の done に書いてから作り直す`);
    process.exit(1);
  }
}

// 1. 案の画面
const frame = await X.buildFrame();
for (const word of ['__setProto', 'obs-part-reply'])
  if (!frame.includes(word)) fail(`案の画面に ${word} が無い。これが無いと、見比べる1枚の切り替えと印が効かない（compare/build.mjs の冒頭）`);
const frameFile = path.join(work, 'frame.html');
writeFileSync(frameFile, frame);

// 2. 今の画面
const nowDir = path.join(work, 'now');
const nowScenes = Object.entries(X.NOW).flatMap(([screen, states]) =>
  Object.entries(states).map(([state, scenario]) => ({ screen, state, scenario })),
);
if (!has('now') && !existsSync(path.join(nowDir, 'results.json')))
  fail(`今の画面を撮った記録が無い（${nowDir}）。最初の1回は --now --url <開発サーバ> を付ける`);
if (has('skip-shoot') && !existsSync(path.join(work, 'proto', 'results.json'))) fail('案を撮った記録が無い。--skip-shoot を外す');
if (has('now')) {
  const only = [...new Set(nowScenes.map((n) => n.scenario))].join(',');
  const common = ['scripts/screens.mjs', '--sizes', X.SIZES.join(','), '--only', only];
  const url = opt('url') ? ['--url', opt('url')] : [];
  const run = spawnSync('node', [...common, '--scale', '2', '--out', nowDir, ...url], { cwd: ds, stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

// 3. 案を撮って、崩れを数える
const protoDir = path.join(work, 'proto');
if (!has('skip-shoot')) {
  // 前の周に撮った画像が混ざらないように、出し直す
  rmSync(protoDir, { recursive: true, force: true });
  await shootFrames({
    frameFile,
    out: protoDir,
    cases: X.CASES.map((c) => c.id).filter((id) => id !== 'now'),
    screens: X.SCREENS.map(([id]) => id),
    states: X.STATES.map(([id]) => id),
    skip: X.SKIP,
    same: Object.fromEntries(X.CASES.filter((c) => c.same).map((c) => [c.id, c.same])),
    sizes: X.SIZES,
    themes: X.THEMES.map(([id]) => id),
  });
}

// 4. 崩れの数
const breaks = {};
const sum = (r) => r.findings.filter((f) => BREAKS.includes(f.kind)).reduce((n, f) => n + f.count, 0);
for (const r of read(path.join(nowDir, 'results.json')))
  for (const { screen, state, scenario } of nowScenes)
    if (r.id === scenario) breaks[`now:${screen}:${state}:${r.size}`] = sum(r);
const protoResults = read(path.join(protoDir, 'results.json'));
for (const r of protoResults)
  if (r.theme === X.THEMES[0][0]) breaks[`${r.p}:${r.screen}:${r.state}:${r.size}`] = sum(r);
// 案の崩れと、固定値の違反。1件でもあれば、1枚を作ったうえで失敗で終わる
const broken = protoResults
  .map((r) => ({ r, n: r.findings.filter((f) => [...BREAKS, ...LOCKED].includes(f.kind)).reduce((m, f) => m + f.count, 0) }))
  .filter(({ r, n }) => n > 0 || r.errors.length > 0);

// 5. 盤の大きさと、一度に見える手
const facts = {};
const measureFacts = ([w, h, q]) => {
  const b = document.querySelector(q.board)?.getBoundingClientRect();
  const host = document.querySelector(q.list)?.getBoundingClientRect();
  if (!b || !host) return null;
  const plies = [...document.querySelectorAll(q.row)].filter((r) => {
    const box = r.getBoundingClientRect();
    return box.top >= host.top - 1 && box.bottom <= host.bottom + 1;
  }).length;
  return { board: Math.round(b.width), area: ((100 * b.width * b.height) / (w * h)).toFixed(0), plies };
};
const nowFacts = path.join(nowDir, 'facts.json');
const browser = await chromium.launch();
if (X.FACTS && has('now') && opt('url')) {
  const scenario = SCENARIOS.find((s) => s.id === X.FACTS.now.scenario);
  const out = {};
  for (const size of X.SIZES) {
    const [width, height] = size.split('x').map(Number);
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript(installTauriMock, FIXTURES[scenario.fixture]);
    await page.goto(opt('url') + scenario.url);
    await page.waitForTimeout(1200);
    await scenario.steps?.(page);
    out[size] = await page.evaluate(measureFacts, [width, height, X.FACTS.now]);
    await page.close();
  }
  writeFileSync(nowFacts, JSON.stringify(out, null, 1));
}
if (existsSync(nowFacts)) for (const [size, f] of Object.entries(read(nowFacts))) facts[`now:${size}`] = f;
for (const size of X.FACTS ? X.SIZES : []) {
  const [width, height] = size.split('x').map(Number);
  for (const c of X.CASES.filter((x) => x.id !== 'now')) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${pathToFileURL(frameFile).href}#p=${c.id}&${X.FACTS.proto.query}`);
    await page.waitForTimeout(150);
    facts[`${c.id}:${size}`] = await page.evaluate(measureFacts, [width, height, X.FACTS.proto]);
    await page.close();
  }
}

// 6. 今の画面の画像。ブラウザに WebP へ直させる（PNG のままだと1枚が 60MB になる）
const now = {};
const encoder = await browser.newPage();
await encoder.goto('about:blank');
for (const { screen, state, scenario } of nowScenes)
  for (const size of X.SIZES) {
    const file = path.join(nowDir, `${scenario}@${size}.png`);
    if (!existsSync(file)) continue;
    const png = `data:image/png;base64,${readFileSync(file).toString('base64')}`;
    now[`${screen}/${state}@${size}`] = await encoder.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/webp', 0.82);
    }, png);
  }
await browser.close();

// 7. 1枚にする
const compare = {
  title: X.TITLE,
  round: X.ROUND,
  recommend: X.RECOMMEND,
  start: X.START,
  screens: X.SCREENS,
  states: X.STATES,
  skip: X.SKIP,
  sizes: X.SIZES,
  sizeLabels: X.SIZE_LABELS ?? {},
  themes: X.THEMES,
  cases: X.CASES,
  nowMissing: X.NOW_MISSING,
  now,
  facts,
  breaks,
  previous,
};
// 埋め込む案の画面にも </script> がある。読む側（shell.js）で戻す
const ESC = '<@@/script';
const escapeScript = (s) => s.replaceAll('</script', '<\\/script');
const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${X.TITLE}</title>
<style>${readFileSync(path.join(here, 'shell.css'), 'utf8')}</style></head>
<body><header class="top"></header><main class="stage"><div class="cards"></div></main><aside class="panel" aria-label="感想"></aside>
<script type="text/plain" id="frame-src">${frame.replaceAll('</script', ESC)}</script>
<script>window.__COMPARE__=${escapeScript(JSON.stringify(compare))}</script>
<script>${escapeScript(readFileSync(path.join(here, 'shell.js'), 'utf8'))}</script>
</body></html>`;
const file = path.join(work, 'compare.html');
writeFileSync(file, html);
console.log(`${file}  ${(html.length / 1e6).toFixed(1)} MB、今の画面 ${Object.keys(now).length} 枚、案 ${protoResults.length} 枚`);
if (broken.length > 0) {
  console.error(`案に崩れか固定値の違反がある: ${broken.length} 枚\n${broken.slice(0, 20).map(({ r, n }) => `  ${r.id} ${r.theme}@${r.size}: ${n} 件 ${r.errors[0] ?? ''}`).join('\n')}`);
  process.exitCode = 1;
}
