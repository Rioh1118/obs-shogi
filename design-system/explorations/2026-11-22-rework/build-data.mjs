// 案の画面に流す実データを作る。撮影用の見本データ（screens/fixtures.mjs）と同じ棋譜・候補手・プリセットを使い、
// 文字列は製品と同じ形（tsshogi の displayText）にする。
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FIXTURES, ROOT } from '../../screens/fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const require = createRequire(path.join(repo, 'package.json'));
const { importKIF, Record, RecordMetadataKey, Color } = require('tsshogi');

const isMove = (node) => node.move && typeof node.move === 'object' && 'to' in node.move;

/** 棋譜を、製品の棋譜ストリームと同じ行（本譜）にする */
function readKifu(kif) {
  const record = importKIF(kif);
  if (record instanceof Error) throw record;
  record.resetAllBranchSelection();
  const rows = [];
  const sfens = [];
  const last = [];
  record.goto(0);
  for (;;) {
    const node = record.current;
    const forks = [];
    if (node.ply > 0) {
      let b = node.prev?.next;
      while (b) {
        if (b !== node) forks.push(b.displayText);
        b = b.branch;
      }
    }
    rows.push({
      ply: node.ply,
      text: node.ply === 0 ? '開始局面' : node.displayText,
      side: node.ply === 0 ? null : node.prev.nextColor === Color.BLACK ? 's' : 'g',
      comment: node.comment || '',
      forks,
    });
    sfens.push(record.position.sfen);
    last.push(isMove(node) ? [node.move.to.file, node.move.to.rank] : null);
    if (!record.goForward()) break;
    if (!isMove(record.current)) break;
  }
  const m = record.metadata;
  return {
    sente: m.getStandardMetadata(RecordMetadataKey.BLACK_NAME) ?? '',
    gote: m.getStandardMetadata(RecordMetadataKey.WHITE_NAME) ?? '',
    rows,
    sfens,
    last,
  };
}

function pvTexts(sfen, usiMoves) {
  const record = Record.newByUSI(`position sfen ${sfen} moves ${usiMoves.join(' ')}`);
  if (record instanceof Error) return [];
  return record.moves.slice(1).map((m) => m.displayText);
}

const evalText = (e, turn) => {
  if (!e) return '';
  const sign = turn === 'w' ? -1 : 1;
  if (e.kind === 'Centipawn') {
    const v = e.value * sign;
    return v > 0 ? `+${v}` : `${v}`;
  }
  const mate = (e.kind?.MateInMoves ?? 0) * sign;
  return mate > 0 ? `Mate+${mate}` : `Mate${mate}`;
};

/** 局面ごとの候補手（先手から見た評価値） */
function candidatesFor(sfens, list) {
  const out = {};
  sfens.forEach((sfen, ply) => {
    const key = sfen.split(/\s+/).slice(0, 3).join(' ');
    const turn = sfen.split(/\s+/)[1];
    const found = list[key];
    if (!found) return;
    out[ply] = found.map((c) => {
      const pv = pvTexts(sfen, c.pv_line);
      return {
        move: pv[0] ?? '—',
        eval: evalText(c.evaluation, turn),
        pv,
        depth: c.depth,
        nodes: c.nodes,
        time: c.time_ms,
      };
    });
  });
  return out;
}

const base = (p) => p.split('/').pop();
const fileLabel = (p) => {
  const parts = p.split('/');
  const name = parts.pop();
  parts.pop();
  return `${parts.pop()} / ${name}`;
};

function presetRows(presets) {
  return presets.map((p) => {
    const def = (name) => p.definitions?.find((d) => d.name === name)?.default ?? null;
    const num = (name, unit = '') => {
      const saved = p.options[name];
      const d = def(name);
      return saved != null
        ? { value: `${Number(saved).toLocaleString('en-US')}${unit}`, raw: saved, isDefault: false }
        : { value: d != null ? `${Number(d).toLocaleString('en-US')}${unit}` : '初期値', raw: d, isDefault: true, known: d != null };
    };
    return {
      id: p.id,
      label: p.label.trim() || '（無名プリセット）',
      configured: Boolean(p.enginePath),
      engine: p.enginePath ? base(p.enginePath) : '',
      enginePath: p.enginePath,
      engineName: p.engineName ?? '',
      evalFile: p.evalFilePath ? fileLabel(p.evalFilePath) : '',
      evalPath: p.evalFilePath,
      book: p.bookEnabled && p.bookFilePath ? fileLabel(p.bookFilePath) : '',
      bookPath: p.bookFilePath,
      multiPv: num('MultiPV'),
      threads: num('Threads'),
      hash: num('USI_Hash', ' MB'),
    };
  });
}

/** 定跡の表（src/widgets/book-view）。評価は手番側から見た値 */
const bookRows = (sfen, moves, plies) =>
  moves.map((m, i) => {
    const texts = pvTexts(sfen, m.ponder ? [m.usiMove, m.ponder] : [m.usiMove]);
    const most = Math.max(...moves.map((x) => x.count ?? 0));
    return {
      move: texts[0] ?? '—',
      ponder: texts[1] ?? '—',
      value: m.value > 0 ? `+${m.value}` : String(m.value),
      depth: m.depth ?? '—',
      count: m.count == null ? '—' : m.count.toLocaleString('en-US'),
      ratio: m.count == null ? 0 : m.count / most,
      ahead: plies[i] > 1 ? `→ ${plies[i]}手目` : '行き止まり',
    };
  });

const bookOf = (fx, sfen) => ({
  file: base(fx.book.info.path),
  path: fx.book.info.path,
  count: `${fx.book.info.positionCount.toLocaleString('en-US')} 局面`,
  rows: bookRows(sfen, fx.book.moves, [22, 18, 9, 4, 1]),
});

/** 局面検索の索引の状態（src/features/settings/ui/workspace-tab/IndexStatusSection.tsx の語） */
const INDEX_WORD = {
  ok: '準備完了',
  notStarted: '未作成',
  partiallyUnreadableAndIndexed: '読めない場所と、入れられなかった棋譜があります',
  notRefreshedAndPartiallyIndexed: '更新できず、入れられなかった棋譜もあります',
};
const indexOf = (fx, health) => ({
  word: INDEX_WORD[health],
  ok: health === 'ok',
  idle: health === 'notStarted',
  items: [
    ['対象ファイル', fx.index.totalFiles.toLocaleString('en-US')],
    ['未同期', fx.index.scanFailed ? '確認できていません' : fx.index.dirtyCount.toLocaleString('en-US')],
    ['索引済み', `${fx.index.indexedFiles.toLocaleString('en-US')} / ${fx.index.totalFiles.toLocaleString('en-US')}`],
    ['警告', fx.indexWarns.length.toLocaleString('en-US')],
  ],
  warns: fx.indexWarns,
});

/** AI ライブラリの中身（src/features/settings/lib/aiLibraryContents.ts の読み方） */
const aiOf = (fx, scan) => {
  const idx = scan === 'ready' ? fx.aiIndex : null;
  const engines = idx ? idx.engines.filter((e) => e.launchability !== 'wrongPlatform').map((e) => e.entry) : [];
  const profiles = idx
    ? idx.profiles.map((p) => ({
        name: p.name,
        path: p.path,
        hasEval: p.has_eval_dir && p.eval_files.length > 0,
        hasBook: p.has_book_dir && p.book_files.length > 0,
      }))
    : [];
  return {
    root: fx.config.ai_root ?? '',
    scan,
    engines,
    profiles,
    enginesDir: idx?.engines_dir.path ?? '',
    error:
      scan === 'error'
        ? `AI ライブラリを読めませんでした。フォルダがあるか（外付けなら繋がっているか）を確認して「もう一度読み込む」を押してください（${fx.fail.scan_ai_root}）`
        : '',
    warnings: profiles.flatMap((p) => [
      ...(p.hasEval ? [] : [`「${p.name}」: 評価関数が未検出です（<AI 名>/eval に nn.bin 等）。`]),
      ...(p.hasBook ? [] : [`「${p.name}」: 定跡が未検出です（<AI 名>/book に .db か .ybb）。`]),
    ]),
  };
};

const tree = (node) => ({
  name: node.name,
  path: node.path,
  dir: node.isDir,
  children: (node.children ?? []).map(tree),
});

const main = readKifu(FIXTURES.normal.kifu[`${ROOT}/角換わり.kif`]);
const longKifu = readKifu(FIXTURES.long.kifuDefault);
const HANDS_PATH = `${ROOT}/持ち駒が多い局面.kif`;
const handsKifu = readKifu(FIXTURES.hands.kifu[HANDS_PATH]);

export const DATA = {
  kifu: {
    normal: { file: '角換わり', path: `${ROOT}/角換わり.kif`, ...main },
    long: {
      file: base(Object.keys(FIXTURES.long.kifu)[0]).replace(/\.kif$/, ''),
      path: Object.keys(FIXTURES.long.kifu)[0],
      ...longKifu,
    },
    hands: { file: '持ち駒が多い局面', path: HANDS_PATH, ...handsKifu },
  },
  candidates: {
    normal: candidatesFor(main.sfens, FIXTURES.normal.candidates),
    hands: candidatesFor(handsKifu.sfens, FIXTURES.normal.candidates),
  },
  tree: {
    normal: tree(FIXTURES.normal.tree),
    long: tree(FIXTURES.long.tree),
    hands: tree(FIXTURES.hands.tree),
    empty: tree(FIXTURES.empty.tree),
  },
  presets: {
    normal: presetRows(FIXTURES.normal.presets.presets),
    long: presetRows(FIXTURES.long.presets.presets),
    many: presetRows(FIXTURES.many.presets.presets),
    empty: [],
  },
  book: bookOf(FIXTURES.normal, main.sfens[0]),
  root: ROOT,
  version: FIXTURES.normal.version,
  checked: { normal: '2026/11/19 12:26', empty: 'まだ確認できていません' },
  index: {
    idle: indexOf(FIXTURES.normal, 'ok'),
    long: indexOf(FIXTURES.long, 'partiallyUnreadableAndIndexed'),
    empty: indexOf(FIXTURES.empty, 'notStarted'),
    error: indexOf(FIXTURES.error, 'notRefreshedAndPartiallyIndexed'),
  },
  ai: {
    idle: aiOf(FIXTURES.normal, 'ready'),
    empty: aiOf(FIXTURES.empty, 'idle'),
    error: aiOf(FIXTURES.error, 'error'),
  },
  notices: {
    warned: {
      kind: 'toast',
      tier: 'info',
      title: '保存した設定の一部を、そのままでは送っていません',
      body: ['定跡 user_book1.ybb を読んだことをエンジンが知らせてこなかったので、使われていないかもしれません。同じ名前の .db が book フォルダにあると、エンジンはそちらを読みます。'],
      actions: ['設定を開く'],
    },
    long: {
      kind: 'toast',
      tier: 'info',
      title: '保存した設定の一部を、そのままでは送っていません',
      body: [
        '定跡 user_book1_merged_20261031_experimental.ybb を読んだことをエンジンが知らせてこなかったので、使われていないかもしれません。同じ名前の .db が book フォルダにあると、エンジンはそちらを読みます。',
        'USI_Hash はエンジンの範囲に収まらないので 33554432 で送りました。プリセットの値を範囲に収めてください。',
        'EnteringKingRule の「CSARule27HWithAVeryLongSuffix」はエンジンの選択肢に無いので送っていません。プリセットの値を直してください。',
        'ほか 1 件。',
      ],
      actions: ['設定を開く'],
    },
    error: [
      {
        kind: 'banner',
        tier: 'danger',
        title: 'エンジンを起動できませんでした',
        body: ['エンジンが準備の途中で終了しました。設定の「エンジン管理」で、エンジンと評価関数の場所と、エンジンに必要なファイルが揃っているかを確認してください。設定を直したときは自動で、ファイルや権限・ドライブを直したときは「もう一度起動」で再起動します。'],
        actions: ['もう一度起動', '設定を開く'],
      },
      {
        kind: 'banner',
        tier: 'danger',
        title: 'プリセットのファイルを読めませんでした',
        body: ['ファイルを開けなかったため、変更できない状態で開いています。ファイルの権限を確認して、「もう一度読み込む」を押してください。'],
        actions: ['もう一度読み込む'],
      },
      {
        kind: 'toast',
        tier: 'warning',
        title: '読めなかったプリセットが 1 件あります',
        body: ['ファイルには残してあります。'],
        actions: [],
      },
    ],
  },
};

// 製品の lucide-react から、案で使う記号の線だけを取る
const ICON_NAMES = {
  panelClose: 'panel-left-close',
  panelOpen: 'panel-left-open',
  settings: 'settings',
  library: 'library',
  rotate: 'rotate-cw',
  play: 'play',
  stop: 'square',
  crown: 'crown',
  nav: 'navigation',
  search: 'search',
  bookmark: 'bookmark',
  first: 'chevron-first',
  prev: 'chevron-left',
  next: 'chevron-right',
  last: 'chevron-last',
  down: 'chevron-down',
  right: 'chevron-right',
  comment: 'message-square',
  branch: 'git-branch',
  close: 'x',
  minus: 'minus',
  max: 'maximize-2',
  pencil: 'pencil',
  copy: 'copy',
  trash: 'trash-2',
  plus: 'plus',
  refresh: 'refresh-ccw',
  up: 'chevron-up',
  check: 'check',
  warn: 'triangle-alert',
  danger: 'circle-alert',
  info: 'info',
  folder: 'folder',
  folderOpen: 'folder-open',
  more: 'ellipsis',
};

/** 別名のファイル（`export { default } from './…'`）は、指す先まで辿る */
async function iconNode(dir, file) {
  const full = path.join(dir, `${file}.mjs`);
  const mod = await import(full);
  const node = mod.__iconNode ?? mod.__iconData?.node;
  if (node) return node;
  const alias = readFileSync(full, 'utf8').match(/from '\.\/([^']+)\.mjs'/)?.[1];
  if (!alias) throw new Error(`icon ${file} の線が取れない`);
  return iconNode(dir, alias);
}

export async function loadIcons() {
  const dir = path.join(repo, 'node_modules/lucide-react/dist/esm/icons');
  const out = {};
  for (const [key, file] of Object.entries(ICON_NAMES)) {
    const node = await iconNode(dir, file);
    out[key] = node
      .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
      .join('');
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(DATA, null, 1).slice(0, 3000));
  console.log(DATA.kifu.normal.rows.filter((r) => r.forks.length || r.comment));
  console.log(DATA.kifu.hands.rows.map((r) => r.text).join(' '), Object.keys(DATA.candidates.hands));
  console.log(Object.keys(await loadIcons()).length, 'icons');
}
