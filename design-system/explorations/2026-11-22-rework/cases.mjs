// 見比べる1枚（compare/）に渡す、この探索の中身。案の名前と説明、並べる画面と状態、今の画面の撮り方の対応。
// 1周目は A〜D（proto/cases.css）、2周目は D を土台にした D2・D3（proto/round2.css）
import { buildFrame } from './build.mjs';

export { buildFrame };

export const TITLE = '見た目を見比べる（2周目）';
export const ROUND = 'round-2';
export const RECOMMEND = 'e';
export const START = { screen: 'main', state: 'analyzing', size: '1464x917', theme: 'dark' };

// 起動時の窓は、作業領域に収まる大きさ（幅 1600・高さ 1000 まで）。14インチの MacBook Pro では 1464x917
export const SIZES = ['1600x1000', '1464x917', '1280x720', '1024x640'];
export const SIZE_LABELS = { '1600x1000': '大きい画面の起動時', '1464x917': '14インチの起動時', '1280x720': '小さめ', '1024x640': '最小' };
export const THEMES = [['dark', '暗い']];
export const SCREENS = [
  ['main', 'メイン'],
  ['engine', '設定 › エンジン管理'],
  ['workspace', '› ワークスペース'],
  ['ai', '› AI ライブラリ'],
  ['display', '› 表示'],
];
export const STATES = [
  ['idle', '通常'],
  ['analyzing', '検討中'],
  ['start', '開始局面と知らせ'],
  ['mate', '詰み探索の結果'],
  ['book', '定跡'],
  ['rows', '行と評価値バー'],
  ['many', 'プリセットが多い'],
  ['long', '長い文字'],
  ['hands', '持ち駒が多い'],
  ['empty', '空'],
  ['error', '失敗'],
];
const MAIN_ONLY = ['analyzing', 'start', 'hands', 'mate', 'book', 'rows'];
/** 画面ごとに、無い状態 */
export const SKIP = {
  main: ['many'],
  engine: MAIN_ONLY,
  workspace: [...MAIN_ONLY, 'many', 'empty'],
  ai: [...MAIN_ONLY, 'many', 'long'],
  display: [...MAIN_ONLY, 'many', 'long', 'empty', 'error'],
};

/** 今の画面を撮る場面。画面 → 状態 → screens/scenarios.mjs の id */
export const NOW = {
  main: {
    idle: 'main-idle',
    analyzing: 'main-analyzing',
    start: 'main-start',
    mate: 'mate-result',
    book: 'book-rows',
    rows: 'main-rows',
    long: 'main-long',
    hands: 'main-hands',
    empty: 'welcome-empty',
    error: 'main-error',
  },
  engine: {
    idle: 'settings-engine',
    many: 'settings-engine-many',
    long: 'settings-engine-long',
    empty: 'settings-engine-empty',
    error: 'settings-engine-error',
  },
  workspace: {
    idle: 'settings-workspace',
    long: 'settings-workspace-long',
    error: 'settings-workspace-error',
  },
  ai: {
    idle: 'settings-ai',
    empty: 'settings-ai-empty',
    error: 'settings-ai-error',
  },
  display: {
    idle: 'settings-display',
  },
};
export const NOW_MISSING = {};

/** 盤の大きさと、一度に見える手。ページの中で走る */
export const FACTS = {
  now: { scenario: 'main-idle', board: '.board-container', list: '.kifu__list', row: '.kifu-row' },
  proto: { query: 'screen=main&state=idle&theme=dark', board: '.board', list: '.klist, .flow', row: '.krow:not(.start), .fcell' },
};

export const CASES = [
  {
    id: 'now',
    tag: '今',
    short: '今の画面',
    one: 'main（5d5cdf0c）の画面を、見本データで撮ったもの',
  },
  {
    id: 'e',
    tag: 'D2',
    short: 'D2 今のドックを1段に',
    one: 'D の骨格に、今のドックの見た目（銅の下線、温かい塗りの最善手、等幅の数字、記号だけの道具、下の帯）。タブ・状態・道具を1段にまとめ、読みの量は下の帯へ。プリセットは1行1件',
    give: '状態と道具が、タブと同じ段に入る。窓が低いときは、読みの量もその段に上がる',
    giveEngine: '長いエンジン名と評価関数は2行に折れ、適用中のほかは3行目から先を省く',
  },
  {
    id: 'f',
    tag: 'D3',
    short: 'D3 今のドックのまま',
    one: 'D の骨格に、今のドックをそのまま置く（枠つきの箱、タブの段と、状態・道具の段、脚注）。プリセットは1件を2段で、全部の欄を見せる',
    give: 'ドックが 35px 高く、盤の幅が7%小さい（1464×917）',
    giveEngine: '14件のうち、一度に見えるのは7件（D2 は11件）',
    same: { workspace: 'e', ai: 'e', display: 'e' },
  },
];
