// 物差し（measure.mjs）が、落とすべきものを落とし、正しいものを落とさないかを確かめる。
//   npm run ds:screens:selftest
// 種類ごとに、崩れた見本（bad）と正しい見本（good）を1つずつ持つ。種類を足したら、ここにも足す。
import { chromium } from '@playwright/test';
import { measureScreen } from './measure.mjs';
import { ALL } from './kinds.mjs';

const box = (css, inner) => `<div style="position:absolute;left:40px;top:40px;${css}">${inner}</div>`;

const CASES = {
  outside: {
    bad: box('width:60px;border:1px solid #888;white-space:nowrap', '<span>初期値（1024MB）</span>'),
    good: box('border:1px solid #888;white-space:nowrap', '<span>初期値（1024MB）</span>'),
  },
  cut: {
    bad: box('width:120px;overflow:hidden;white-space:nowrap', '<p>とても長い棋譜の名前がここに入ります</p>'),
    good: box('width:120px;overflow:hidden', '<p>とても長い棋譜の名前がここに入ります</p>'),
  },
  squeezed: {
    bad: box('width:44px', '<span>候補手の数</span>') + box('top:120px;width:40px', '<span>手数 <b>24</b>/112</span>'),
    good: box('', '<span>候補手の数</span>') + box('top:120px', '<span>手数 <b>24</b>/112</span>'),
  },
  noReveal: {
    bad: box('width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', '角換わり腰掛け銀同型の研究'),
    good: `<div title="角換わり腰掛け銀同型の研究" style="position:absolute;left:40px;top:40px;width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">角換わり腰掛け銀同型の研究</div>`,
  },
  overlap: {
    bad: box('white-space:nowrap', '角換わりの研究') + box('left:80px;white-space:nowrap', '矢倉の研究'),
    // 前に出た側が地を塗っていれば、後ろは隠れるだけ
    good: box('white-space:nowrap', '角換わりの研究') + box('left:80px;background:#171e20;white-space:nowrap', '矢倉の研究').replace('<div', '<div role="menu"'),
  },
  // 文字が、祖先でない塗った箱の上に乗っている（帯が評価値バーに重なる）
  'overlap（塗った箱）': {
    kind: 'overlap',
    bad: box('width:300px', '<div style="height:9px;margin-top:8px;background:#e2ddd0"></div>') + box('left:120px', '<span>検討中</span>'),
    // 同じ段に敷いた地の上に置くのはよい
    good: box('width:300px;height:40px', '<div style="height:100%;background:#273033"></div>') + box('left:120px;top:48px', '<span>検討中</span>'),
  },
  // 押して開いたメニューが、文字の端だけを覆っている
  'overlap（開いたメニュー）': {
    kind: 'overlap',
    bad: box('width:300px', '<div style="height:9px;margin-top:8px;background:#e2ddd0"></div>') + box('left:120px', '<span>検討中</span>'),
    good: box('white-space:nowrap', '<span>角換わりの研究</span>') + '<div role="menu" style="position:fixed;left:90px;top:46px;width:200px;height:120px;background:#333">メニュー</div>',
  },
  // 閉じた「詳細」の中身は、箱を持ったまま描かれない
  'overlap（閉じた詳細）': {
    kind: 'overlap',
    bad: box('', '<details open><summary>詳細</summary><p>permission_denied</p></details>') + box('top:60px', '<span>もう一度起動</span>'),
    good: box('', '<details><summary>詳細</summary><p>permission_denied</p></details>') + box('top:60px', '<span>もう一度起動</span>'),
  },
  touch: {
    bad: box('display:grid;grid-template-columns:auto auto;white-space:nowrap', '<span>33,554,432 MB</span><span>ON</span>'),
    good: box('display:grid;grid-template-columns:auto auto;column-gap:24px;white-space:nowrap', '<span>33,554,432 MB</span><span>ON</span>'),
  },
  lost: {
    bad: box('height:60px;width:160px;overflow:auto', Array.from({ length: 12 }, (_, i) => `<div class="krow${i === 9 ? ' on' : ''}" style="height:24px">${i}手目</div>`).join('')),
    good: box('height:60px;width:160px;overflow:auto', Array.from({ length: 12 }, (_, i) => `<div class="krow${i === 1 ? ' on' : ''}" style="height:24px">${i}手目</div>`).join('')),
  },
  offscreen: {
    bad: '<button style="position:absolute;left:990px;top:40px;width:80px">設定</button>',
    good: '<button style="position:absolute;left:900px;top:40px;width:80px">設定</button>',
  },
  covered: {
    bad: box('', '<button>検討を開始</button>') + '<div class="notice-layer" style="position:fixed;left:20px;top:20px;width:300px;height:120px;background:#333">知らせ</div>',
    // 押して開いたものは、覆っていてよい
    good: box('', '<button>検討を開始</button>') + '<div role="menu" style="position:fixed;left:20px;top:20px;width:300px;height:120px;background:#333">メニュー</div>',
  },
  // 浮いていない箱に隠れる文。対話の中で、縮んだ段の2行目が、次の段の見出しの下に入る
  'covered（次の段）': {
    kind: 'covered',
    bad: box('width:300px', '<div style="height:24px"><p style="line-height:20px">検討プリセット</p><p style="line-height:20px">保存時に再起動します。</p></div><div style="position:relative;height:40px;background:#1e2729">名前</div>').replace('<div', '<div role="dialog"'),
    // 同じ一覧の中で貼り付いた見出しが、送った行を隠すのはよい
    good: box('width:300px;height:80px;overflow:auto', '<div style="position:sticky;top:0;height:24px;background:#1e2729">名前</div><p style="margin-top:-14px;line-height:20px">送られた行</p><p style="height:200px">続き</p>'),
  },
  nested: {
    bad: box('padding:12px;border:1px solid #888;border-radius:6px', '<div style="padding:12px;border:1px solid #888;border-radius:6px"><div style="padding:12px;border:1px solid #888;border-radius:6px;width:120px;height:60px">値</div></div>'),
    good: box('padding:12px;border:1px solid #888;border-radius:6px', '<div style="padding:12px"><div style="padding:12px;width:120px;height:60px">値</div></div>'),
  },
  gradient: {
    bad: box('width:200px;height:80px;background:linear-gradient(#171e20,#2c3639)', ''),
    good: box('width:200px;height:80px;background:#171e20', ''),
  },
  sideBar: {
    bad: box('width:200px;height:40px;background:#273033;border-radius:8px;border-left:3px solid #b07c55', '選択中'),
    good: box('width:200px;height:40px;background:#273033', '選択中'),
  },
  contrast: {
    bad: box('color:#4a5256', '薄い文字'),
    good: box('color:#b5b9b0', '読める文字'),
  },
  tiny: {
    bad: box('font-size:10px', '小さい文字'),
    good: box('font-size:11px', '読める文字'),
  },
};

const missing = ALL.filter((kind) => !CASES[kind]);
if (missing.length > 0) {
  console.error(`見本が無い種類: ${missing.join('、')}`);
  process.exitCode = 1;
}

const page = (inner) =>
  `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0}html{background:#171e20}body{width:1000px;height:600px;overflow:hidden;color:#d8dbd3;font:13px/1.4 system-ui,sans-serif}button{font:inherit;color:inherit;background:none;border:1px solid #888}</style><body>${inner}`;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1000, height: 600 } });
let bad = 0;
for (const [name, sample] of Object.entries(CASES)) {
  const kind = sample.kind ?? name;
  await tab.setContent(page(sample.bad));
  const caught = (await tab.evaluate(measureScreen, {})).some((f) => f.kind === kind);
  await tab.setContent(page(sample.good));
  const falsely = (await tab.evaluate(measureScreen, {})).filter((f) => f.kind === kind);
  const ok = caught && falsely.length === 0;
  if (!ok) bad += 1;
  console.log(`${ok ? '✔' : '✘'} ${name}${caught ? '' : '  崩れた見本を落とせない'}${falsely.length ? `  正しい見本を落とした: ${JSON.stringify(falsely[0])}` : ''}`);
}
await browser.close();
if (bad > 0) process.exitCode = 1;
else console.log(`物差しの自己テストに合格（${Object.keys(CASES).length} 種類）`);
