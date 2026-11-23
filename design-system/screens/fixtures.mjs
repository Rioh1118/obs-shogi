// 製品の画面を撮るときの見本データ。
// 値は Tauri のコマンドが返す形（src/entities/*/api）に合わせる。棋譜と候補手は手元のエンジンの自己対局から作った。
// 人名・フォルダ名は実在しないもの。公開リポジトリに置くので、利用者の環境の名前を写さない。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

const { sfens, candidates } = JSON.parse(read('positions.json'));
const KIF = { main: read('main.kif'), plain: read('plain.kif'), long: read('long.kif'), hands: read('hands.kif') };

export const ROOT = '/Users/me/Documents/KIFU_ROOT';
const AI = '/Users/me/ShogiAI';

const LONG_JA = '第12回全国アマチュア将棋選手権大会 決勝トーナメント準決勝 角換わり腰掛け銀同型';
const LONG_PATH = 'YaneuraOu_SFNN_halfka2_1024_7_64_k3k3-V990DEV_APPLEM1';

// ---- ファイルツリー ----

const file = (dir, name) => ({
  id: `${dir}/${name}`,
  name,
  path: `${dir}/${name}`,
  isDir: false,
  size: 4096,
  lastModified: 1790000000,
  extension: name.split('.').pop(),
});

const dir = (parent, name, children = []) => {
  const p = `${parent}/${name}`;
  return { id: p, name, path: p, isDir: true, children: children.map((c) => c(p)) };
};
const D = (name, ...children) => (parent) => dir(parent, name, children);
const F = (name) => (parent) => file(parent, name);

const root = (...children) => ({
  id: ROOT,
  name: 'KIFU_ROOT',
  path: ROOT,
  isDir: true,
  children: children.map((c) => c(ROOT)),
});

const treeNormal = root(
  D(
    '実戦',
    D('2026-09', F('2026-09-12 相掛かり.kif'), F('2026-09-27 矢倉.kif')),
    D('2026-10', F('2026-10-03 角換わり.kif'), F('2026-10-18 雁木.kif')),
  ),
  D('将棋ウォーズ', F('wars_0412.kif'), F('wars_0413.kif'), F('wars_0414.kif')),
  D(
    '戦法研究',
    D('振り飛車', F('四間飛車 美濃.kif')),
    D('横歩取り', F('横歩取り 青野流.kif')),
    D('相掛かり', F('相掛かり 腰掛け銀.kif')),
    D('角換わり', D('腰掛け銀', F('角換わり基本形.kif'), F('4五桂急戦.kif')), F('早繰り銀.kif')),
  ),
  D('雁木', F('雁木 右四間.kif')),
  F('角換わり.kif'),
);

const treeLong = root(
  D(
    '全国アマチュア将棋選手権大会 東日本ブロック 予選リーグ 対局記録',
    D('2026年度 第12回 春季大会 一次予選から決勝トーナメントまで', F(`${LONG_JA}.kif`)),
    F(`${LONG_JA} 変化と自戦記つき 再検討版.kif`),
  ),
  D('a-very-long-folder-name-without-any-spaces-that-never-wraps-by-itself'),
  F(`${LONG_JA}.kif`),
);

const HANDS = '持ち駒が多い局面';
const treeHands = root(
  D('実戦', F('2026-10-03 角換わり.kif')),
  D('戦法研究', F('角換わり基本形.kif')),
  F('角換わり.kif'),
  F(`${HANDS}.kif`),
);

const treeEmpty = { ...root(), children: [] };

// ---- プリセット ----

// 名前は option_labels.rs の辞書から
const DEFS = [
  { name: 'Threads', label: 'スレッド数', type: 'spin', default: 4, min: 1, max: 1024 },
  { name: 'NumaPolicy', label: 'NUMA の割り当て', type: 'string', default: 'auto' },
  { name: 'USI_Ponder', label: '先読み', type: 'check', default: false },
  { name: 'DepthLimit', label: '深さの上限', type: 'spin', default: 0, min: 0, max: 2147483647 },
  { name: 'NodesLimit', label: 'ノード数の上限', type: 'spin', default: 0, min: 0, max: null },
  { name: 'USI_Hash', label: 'ハッシュ（MB）', type: 'spin', default: 1024, min: 1, max: 33554432 },
  { name: 'MultiPV', label: '候補手の数', type: 'spin', default: 1, min: 1, max: 600 },
  { name: 'DrawValueBlack', label: '引き分けの評価値（先手）', type: 'spin', default: -2, min: -30000, max: 30000 },
  { name: 'DrawValueWhite', label: '引き分けの評価値（後手）', type: 'spin', default: -2, min: -30000, max: 30000 },
  { name: 'ResignValue', label: '投了する評価値', type: 'spin', default: 99999, min: 0, max: 99999 },
  { name: 'PvInterval', label: '読み筋を出す間隔（ms）', type: 'spin', default: 300, min: 0, max: 100000000 },
  { name: 'ConsiderationMode', label: '検討モード', type: 'check', default: false },
  { name: 'OutputFailLHPV', label: 'fail low/high の読み筋も出す', type: 'check', default: true },
  { name: 'GenerateAllLegalMoves', label: 'すべての合法手を生成する', type: 'check', default: false },
  {
    name: 'EnteringKingRule',
    label: '入玉ルール',
    type: 'combo',
    default: 'CSARule27',
    vars: ['NoEnteringKing', 'CSARule24', 'CSARule24H', 'CSARule27', 'CSARule27H', 'TryRule'],
  },
  { name: 'NetworkDelay', label: '通信の遅延（ms）', type: 'spin', default: 120, min: 0, max: 10000 },
  { name: 'SlowMover', label: '序盤重視率（%）', type: 'spin', default: 100, min: 1, max: 1000 },
  { name: 'USI_OwnBook', label: '定跡を使う', group: 'book', type: 'check', default: true },
  { name: 'BookMoves', label: '定跡を使う手数', group: 'book', type: 'spin', default: 16, min: 0, max: 10000 },
  {
    name: 'BookFile',
    label: '定跡ファイル',
    group: 'book',
    type: 'combo',
    default: 'standard_book.db',
    vars: ['no_book', 'standard_book.db', 'user_book1.db'],
  },
  { name: 'BookDir', label: '定跡のフォルダ', group: 'book', type: 'string', default: 'book' },
  { name: 'EvalDir', label: '評価関数のフォルダ', type: 'string', default: 'eval' },
  { name: 'FV_SCALE', label: '評価値のスケール（NNUE）', type: 'spin', default: 16, min: 1, max: 128 },
];
const RESERVED = ['USI_Ponder', 'ConsiderationMode', 'USI_OwnBook', 'BookFile', 'BookDir', 'EvalDir'];

const preset = (over) => ({
  id: over.id,
  label: '',
  aiName: '',
  enginePath: '',
  evalFilePath: '',
  bookEnabled: false,
  bookFilePath: null,
  options: { MultiPV: '5' },
  analysis: null,
  definitions: null,
  reservedNames: null,
  definitionsFor: null,
  probedAt: null,
  engineName: null,
  engineAuthor: null,
  ...over,
});

const withEngine = (entry, engineName) => {
  const enginePath = `${AI}/engines/${entry}`;
  return {
    enginePath,
    definitions: DEFS,
    reservedNames: RESERVED,
    definitionsFor: enginePath,
    probedAt: '2026-11-22T06:21:30.242Z',
    engineName,
    engineAuthor: 'yaneurao',
  };
};

const PRESETS_NORMAL = [
  preset({
    id: 'p-main',
    label: '研究用 5本',
    aiName: 'AobaNNUE',
    ...withEngine(
      LONG_PATH,
      'YaneuraOu(tournament128-cl4) NNUE V9.90DEV 64APPLEM1 TOURNAMENT',
    ),
    evalFilePath: `${AI}/AobaNNUE/eval/nn.bin`,
    bookEnabled: true,
    bookFilePath: `${AI}/AobaNNUE/book/user_book1.ybb`,
    options: { MultiPV: '5' },
  }),
  preset({
    id: 'p-fast',
    label: '速い検討',
    aiName: 'AobaNNUE',
    ...withEngine('YaneuraOu_NNUE-V900Git_APPLEM1', 'YaneuraOu NNUE V9.00Git 64APPLEM1 TOURNAMENT'),
    evalFilePath: `${AI}/AobaNNUE/eval/nn.bin`,
    options: { MultiPV: '1', Threads: '8', USI_Hash: '4096' },
  }),
  preset({
    id: 'p-mate',
    label: '詰将棋',
    ...withEngine('YaneuraOu_MATE-V900Git_APPLEM1', 'YaneuraOu MATE V9.00Git 64APPLEM1'),
    options: {},
  }),
  preset({ id: 'p-new', label: '新規プリセット', options: { MultiPV: '5' } }),
];

const PRESETS_LONG = [
  preset({
    ...PRESETS_NORMAL[0],
    id: 'p-main',
    label: '角換わり腰掛け銀の研究用（候補手5本・定跡あり・ハッシュ32GB・長考）',
    aiName: 'AobaNNUE-halfka2-1024-progress-20261031-experimental',
    evalFilePath: `${AI}/AobaNNUE-halfka2-1024-progress-20261031-experimental/eval/nn-finetuned-20261031.bin`,
    bookFilePath: `${AI}/AobaNNUE-halfka2-1024-progress-20261031-experimental/book/user_book1_merged_20261031.ybb`,
    options: { MultiPV: '20', Threads: '1024', USI_Hash: '33554432' },
  }),
  preset({
    ...PRESETS_NORMAL[1],
    id: 'p-fast',
    label: 'a-preset-name-without-any-spaces-that-never-wraps-by-itself',
  }),
  preset({ ...PRESETS_NORMAL[2], id: 'p-mate' }),
  preset({ ...PRESETS_NORMAL[0], id: 'p-5', label: '振り飛車の研究' }),
  preset({ ...PRESETS_NORMAL[1], id: 'p-6', label: '対抗形（早指し）' }),
  preset({ ...PRESETS_NORMAL[0], id: 'p-7', label: '終盤の検討' }),
  preset({ id: 'p-new', label: '' }),
];

// プリセットは増えていく。一覧が1画面に収まらない数
const PRESETS_MANY = [
  ...PRESETS_NORMAL,
  ...[
    ['角換わり 10本', 0, { MultiPV: '10', Threads: '16', USI_Hash: '8192' }],
    ['相掛かりの序盤', 0, { MultiPV: '5', Threads: '12' }],
    ['矢倉', 1, { MultiPV: '3', Threads: '8', USI_Hash: '4096' }],
    ['雁木', 1, { MultiPV: '3', Threads: '8', USI_Hash: '4096' }],
    ['振り飛車の研究', 0, { MultiPV: '8' }],
    ['対抗形（早指し）', 1, { MultiPV: '1', Threads: '4' }],
    ['終盤の検討', 0, { MultiPV: '5', USI_Hash: '16384' }],
    ['入玉と宣言', 1, { MultiPV: '2' }],
    ['対局の振り返り', 1, { MultiPV: '1', Threads: '8', USI_Hash: '2048' }],
    ['実験用の評価関数', 0, { MultiPV: '5', Threads: '16', USI_Hash: '32768' }],
  ].map(([label, from, options], i) =>
    preset({ ...PRESETS_NORMAL[from], id: `p-many-${i}`, label, bookEnabled: from === 0 && i % 3 === 0, options }),
  ),
];

// ---- AI ライブラリ ----

const engine = (entry, launchability = 'ready') => ({
  entry,
  path: `${AI}/engines/${entry}`,
  kind: 'file',
  launchability,
});
const asset = (folder, kind, entry, extra = {}) => ({
  entry,
  path: `${AI}/${folder}/${kind}/${entry}`,
  kind: 'file',
  ...extra,
});

const AI_INDEX = {
  ai_root: AI,
  engines_dir: { path: `${AI}/engines`, exists: true, kind: 'dir' },
  engines: [
    engine(LONG_PATH),
    engine('YaneuraOu_NNUE-V900Git_APPLEM1'),
    engine('YaneuraOu_MATE-V900Git_APPLEM1'),
    engine('Apery_rust_v2.1.0', 'notExecutable'),
    engine('YaneuraOu_AVX2.exe', 'wrongPlatform'),
  ],
  profiles: [
    {
      name: 'AobaNNUE',
      path: `${AI}/AobaNNUE`,
      has_eval_dir: true,
      has_book_dir: true,
      eval_files: [asset('AobaNNUE', 'eval', 'nn.bin', { eval_type: 'HalfKA2 1024x2' })],
      eval_options: [{ name: 'FV_SCALE', value: '24' }],
      eval_options_outside_eval: false,
      book_files: [
        asset('AobaNNUE', 'book', 'user_book1.db'),
        asset('AobaNNUE', 'book', 'user_book1.ybb'),
      ],
    },
    {
      name: 'Hao',
      path: `${AI}/Hao`,
      has_eval_dir: true,
      has_book_dir: true,
      eval_files: [asset('Hao', 'eval', 'nn.bin', { eval_type: 'HalfKP 768x2-16-64' })],
      eval_options: [],
      eval_options_outside_eval: false,
      book_files: [],
    },
  ],
};

const AI_INDEX_EMPTY = {
  ai_root: AI,
  engines_dir: { path: `${AI}/engines`, exists: false, kind: 'unknown' },
  engines: [],
  profiles: [],
};

// ---- 課題局面 ----

const at = (ply) => sfens[String(ply)];
const study = (id, ply, label, state, tags, description, updatedAt) => ({
  id,
  sfen: at(ply),
  label,
  description,
  state,
  tags,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt,
});

const STUDY_NORMAL = [
  study('s1', 24, '▲３六歩か▲５六銀か', 'active', ['角換わり', '腰掛け銀'], '評価値の差は小さい。定跡の手数と、後手の右桂の跳ね方で比べる。', '2026-11-21T10:12:00.000Z'),
  study('s2', 37, '△６三銀に▲４五歩の仕掛け', 'active', ['角換わり', '仕掛け'], '', '2026-11-20T21:40:00.000Z'),
  study('s3', 45, '▲２二歩の叩きを入れる', 'inbox', ['角換わり'], '', '2026-11-18T08:03:00.000Z'),
  study('s4', 62, '終盤の入り口', 'reference', ['終盤', '寄せ'], '', '2026-11-02T13:00:00.000Z'),
  study('s5', 80, '', 'done', [], '', '2026-10-11T13:00:00.000Z'),
];

const STUDY_LONG = [
  study('s1', 24, `${LONG_JA} から派生する後手右桂急戦の分岐点`, 'active', ['角換わり腰掛け銀の後手右桂急戦', '第12回全国アマチュア将棋選手権大会', '要再検討', '長い札4', '長い札5'], '長いメモ。'.repeat(120), '2026-11-21T10:12:00.000Z'),
  study('s2', 37, 'a-label-without-any-spaces-that-never-wraps-by-itself-in-the-list', 'inbox', ['tag-without-any-spaces-that-never-wraps-by-itself'], '', '2026-11-20T21:40:00.000Z'),
  ...STUDY_NORMAL.slice(2),
];

// ---- 局面検索 ----

const SEARCH_FILES = [
  [`${ROOT}/角換わり.kif`, 24],
  [`${ROOT}/戦法研究/角換わり/腰掛け銀/角換わり基本形.kif`, 24],
  [`${ROOT}/実戦/2026-10/2026-10-03 角換わり.kif`, 26],
  [`${ROOT}/将棋ウォーズ/wars_0412.kif`, 30],
  [`${ROOT}/将棋ウォーズ/wars_0414.kif`, 22],
  [`${ROOT}/戦法研究/角換わり/早繰り銀.kif`, 24],
];
const SEARCH_FILES_LONG = [
  [`${ROOT}/全国アマチュア将棋選手権大会 東日本ブロック 予選リーグ 対局記録/2026年度 第12回 春季大会 一次予選から決勝トーナメントまで/${LONG_JA}.kif`, 24],
  ...SEARCH_FILES,
];
const hits = (files) => ({
  files: files.map(([absPath], i) => ({ fileId: i + 1, absPath })),
  hits: files.map(([, tesuu], i) => ({
    occ: { fileId: i + 1, gen: 1, nodeId: tesuu },
    cursor: { tesuu, forkPointers: i === 1 ? [{ te: 25, forkIndex: 0 }].filter(() => tesuu > 25) : [] },
  })),
});

// ---- 定跡 ----

const BOOK_INFO = {
  handle: 1,
  path: `${AI}/AobaNNUE/book/user_book1.ybb`,
  format: 'yaneuraouYbb',
  positionCount: 17000703,
  droppedFields: 0,
};
const BOOK_MOVES = [
  { usiMove: '2g2f', ponder: '8c8d', value: 62, depth: 40, count: 18230 },
  { usiMove: '7g7f', ponder: '8c8d', value: 58, depth: 40, count: 16110 },
  { usiMove: '6i7h', ponder: '8c8d', value: 31, depth: 27, count: 2210 },
  { usiMove: '9g9f', ponder: '3c3d', value: 12, depth: 23, count: 310 },
  { usiMove: '1g1f', ponder: null, value: -4, depth: 21, count: null },
];

// ---- 起動の警告・失敗 ----

const START_WARNINGS = [{ kind: 'bookLoadUnconfirmed', file: 'user_book1.ybb' }];
const START_WARNINGS_LONG = [
  { kind: 'bookLoadUnconfirmed', file: 'user_book1_merged_20261031_experimental.ybb' },
  { kind: 'clamped', name: 'USI_Hash', value: '33554432' },
  { kind: 'notInVars', name: 'EnteringKingRule', value: 'CSARule27HWithAVeryLongSuffix' },
  { kind: 'evalNotChosen', name: 'EvalFile' },
];
const START_FAILURE = {
  kind: 'exitedEarly',
  lastOutput:
    'info string Error! : failed to read eval file : eval/nn.bin\ninfo string current directory = /Users/me/ShogiAI/engines',
  message: 'the engine exited before readyok',
  evalType: null,
};

// ---- 設定 ----

const config = (over = {}) => ({
  root_dir: ROOT,
  ai_root: AI,
  last_preset_id: 'p-main',
  dock_tabs: null,
  dock_tabs_known: null,
  dock_startup_tab: null,
  dock_last_tab: 'analysis',
  show_evaluation_bar: null,
  analysis_display_mode: null,
  mate_preset_id: 'p-mate',
  mate_search_limit: null,
  book_recent_paths: [`${AI}/AobaNNUE/book/user_book1.ybb`, `${AI}/AobaNNUE/book/user_book1.db`],
  ...over,
});

const INDEX_READY = {
  state: 'Ready',
  dirtyCount: 0,
  indexedFiles: 612,
  totalFiles: 612,
  scanFailed: false,
  partiallyUnreadable: false,
};
const WARN = (i) => ({
  kind: i % 2 ? 'file' : 'place',
  path: `${ROOT}/全国アマチュア将棋選手権大会/${LONG_JA}-${i}.kif`,
  message: '棋譜として読み取れませんでした',
});

const base = {
  root: ROOT,
  config: config(),
  version: '0.1.0',
  tree: treeNormal,
  kifu: {
    [`${ROOT}/角換わり.kif`]: KIF.main,
    [`${ROOT}/戦法研究/角換わり/腰掛け銀/角換わり基本形.kif`]: KIF.main,
  },
  kifuDefault: KIF.plain,
  presets: { presets: PRESETS_NORMAL, revision: 'r1', writable: true, unreadableCount: 0, loadNotice: null },
  aiIndex: AI_INDEX,
  study: { positions: STUDY_NORMAL },
  search: { ...hits(SEARCH_FILES), error: null },
  book: { info: BOOK_INFO, moves: BOOK_MOVES, error: null },
  candidates,
  startWarnings: [],
  startFailure: null,
  index: INDEX_READY,
  indexWarns: [],
  updater: { skippedVersion: null, lastCheckedMs: 1795000000000 },
  update: null,
  fail: {},
  hang: [],
};

/** 状態ごとの見本データ。値は JSON にできるものだけ（ページへ渡すため） */
export const FIXTURES = {
  normal: base,

  long: {
    ...base,
    tree: treeLong,
    kifu: { [`${ROOT}/${LONG_JA}.kif`]: KIF.long },
    kifuDefault: KIF.long,
    presets: { ...base.presets, presets: PRESETS_LONG },
    study: { positions: STUDY_LONG },
    search: { ...hits(SEARCH_FILES_LONG), error: null },
    book: {
      ...base.book,
      info: { ...BOOK_INFO, path: `${AI}/AobaNNUE-halfka2-1024/book/user_book1_merged_20261031_experimental.ybb` },
    },
    startWarnings: START_WARNINGS_LONG,
    indexWarns: [0, 1, 2, 3, 4, 5, 6].map(WARN),
    index: { ...INDEX_READY, indexedFiles: 598, partiallyUnreadable: true },
    config: config({
      book_recent_paths: [
        `${AI}/AobaNNUE-halfka2-1024-progress-20261031-experimental/book/user_book1_merged_20261031.ybb`,
      ],
    }),
  },

  // プリセットが14件
  many: { ...base, presets: { ...base.presets, presets: PRESETS_MANY } },

  // 持ち駒が7種あり、指し手の表記が長い（「５三銀左不成」）
  hands: {
    ...base,
    tree: treeHands,
    kifu: { ...base.kifu, [`${ROOT}/${HANDS}.kif`]: KIF.hands },
  },

  empty: {
    ...base,
    tree: treeEmpty,
    presets: { ...base.presets, presets: [] },
    aiIndex: AI_INDEX_EMPTY,
    study: { positions: [] },
    search: { files: [], hits: [], error: null },
    book: { info: null, moves: [], error: null },
    candidates: {},
    index: { ...INDEX_READY, state: 'Empty', indexedFiles: 0, totalFiles: 0 },
    config: config({ last_preset_id: null, mate_preset_id: null, book_recent_paths: [], ai_root: null }),
    updater: { skippedVersion: null, lastCheckedMs: null },
  },

  error: {
    ...base,
    startFailure: START_FAILURE,
    presets: {
      ...base.presets,
      writable: false,
      unreadableCount: 1,
      loadNotice: { kind: 'unreadable', reason: 'permission denied' },
    },
    search: { files: [], hits: [], error: '索引を読めませんでした（権限がありません）' },
    book: { ...base.book, error: { code: 'invalid_content', message: '定跡として読めない行があります', path: BOOK_INFO.path } },
    index: { ...INDEX_READY, indexedFiles: 598, scanFailed: true },
    indexWarns: [0, 1, 2].map(WARN),
    fail: {
      scan_ai_root: `ai_root does not exist: ${AI}`,
    },
  },

  // 起動の警告が出る（利用者の 2026-11-22 の写真と同じ状態）
  warned: { ...base, startWarnings: START_WARNINGS },

  noRoot: { ...base, config: config({ root_dir: null }) },
  configBroken: { ...base, fail: { load_config: 'expected value at line 1 column 1' } },
  booting: { ...base, hang: ['load_config'] },
  treeBroken: {
    ...base,
    fail: { get_file_tree: { code: 'permission_denied', message: '権限がありません', path: ROOT } },
  },
  kifuBroken: {
    ...base,
    fail: {
      read_file: {
        code: 'permission_denied',
        message: 'failed to read file: Permission denied (os error 13)',
        path: `${ROOT}/角換わり.kif`,
      },
    },
  },
  update: { ...base, update: { version: '0.2.0' } },
  // 取得が落ちる。理由は plugin が返した綴りのまま出る
  updateBroken: {
    ...base,
    update: { version: '0.2.0' },
    fail: { 'plugin:updater|download_and_install': 'error sending request for url (https://example.com/obs-shogi/latest.json)' },
  },
  // 同じ名前の棋譜がもう在る
  conflict: {
    ...base,
    fail: {
      create_kifu_file: {
        code: 'already_exists',
        message: '同じ名前のものがあります',
        path: `${ROOT}/角換わり.kif`,
        existingPath: `${ROOT}/角換わり.kif`,
      },
    },
  },
  rows: { ...base, config: config({ analysis_display_mode: 'rows', show_evaluation_bar: true }) },
  bookTab: { ...base, config: config({ dock_last_tab: 'book' }) },
};
