// 撮る場面の一覧。1件が「画面 × 状態」で、窓の大きさは呼び手が掛ける。
//   fixture  fixtures.mjs の見本データの名前
//   url      最初に開く場所
//   steps    開いた後にする操作
import { FIXTURES, ROOT } from './fixtures.mjs';

const APP = '/app/panel/filetree';
const modal = (name, params = {}) => `${APP}?${new URLSearchParams({ modal: name, ...params })}`;

const settle = (page, ms = 350) => page.waitForTimeout(ms);

/** 押す。別の層（通知など）に覆われていて押せないときは、要素へ直に送る。覆われていることは measure が数える */
async function press(page, locator) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  try {
    await el.click({ timeout: 1500 });
  } catch {
    await el.dispatchEvent('click');
  }
}

/** ツリーの行を名前で押す */
async function clickNode(page, name) {
  await press(page, page.locator('.node-box').filter({ hasText: name }).first());
}

/** 棋譜を開く。フォルダの中なら順に開く */
async function openKifu(page, names) {
  for (const name of names) {
    await clickNode(page, name);
    await page.waitForTimeout(120);
  }
  await page.waitForSelector('.kifu__list', { timeout: 5000 }).catch(() => {});
  await settle(page, 250);
}

const MAIN_KIFU = ['角換わり.kif'];
const LONG_KIFU = ['第12回全国アマチュア将棋選手権大会 決勝トーナメント準決勝 角換わり腰掛け銀同型.kif'];

/** n 手目まで進める */
async function goTo(page, n) {
  const row = page.locator(`#kifu-row-${n}, [id$="-${n}"].kifu-row`).first();
  if (await row.count()) {
    await row.scrollIntoViewIfNeeded();
    // 行の余りには分岐とコメントのボタンがある
    await row.locator('.kifu-row__move').click();
  } else {
    for (let i = 0; i < n; i += 1) await page.locator('[title^="次の手"]').click();
  }
  await settle(page, 250);
}

async function startAnalysis(page) {
  await press(page, '[title="検討を開始"]');
  await settle(page, 900);
}

const open = (names, ply) => async (page) => {
  await openKifu(page, names);
  if (ply) await goTo(page, ply);
};

const then =
  (...fns) =>
  async (page) => {
    for (const fn of fns) await fn(page);
  };

export const SCENARIOS = [
  // 起動
  { id: 'boot-loading', screen: '起動', state: '待ち', fixture: 'booting', url: '/' },
  { id: 'boot-folder', screen: '最初のフォルダ選択', state: '通常', fixture: 'noRoot', url: '/' },
  { id: 'boot-error', screen: '起動', state: '失敗', fixture: 'configBroken', url: '/' },

  // 棋譜を開く前
  { id: 'welcome', screen: 'ようこそ', state: '通常', fixture: 'normal', url: APP },
  { id: 'welcome-empty', screen: 'ようこそ', state: '空', fixture: 'empty', url: APP },
  { id: 'tree-error', screen: 'ファイルツリー', state: '失敗', fixture: 'treeBroken', url: APP },

  // メイン画面
  { id: 'main-idle', screen: 'メイン', state: '通常', fixture: 'normal', url: APP, steps: open(MAIN_KIFU, 24) },
  {
    id: 'main-analyzing',
    screen: 'メイン',
    state: '検討中',
    fixture: 'normal',
    url: APP,
    steps: then(open(MAIN_KIFU, 24), startAnalysis),
  },
  { id: 'main-start', screen: 'メイン', state: '開始局面', fixture: 'warned', url: APP, steps: open(MAIN_KIFU) },
  { id: 'main-late', screen: 'メイン', state: '終盤（検討中）', fixture: 'normal', url: APP, steps: then(open(MAIN_KIFU, 80), startAnalysis) },
  { id: 'main-hands', screen: 'メイン', state: '持ち駒が多い', fixture: 'hands', url: APP, steps: then(open(['持ち駒が多い局面.kif'], 5), startAnalysis) },
  { id: 'main-long', screen: 'メイン', state: '長い文字', fixture: 'long', url: APP, steps: then(open(LONG_KIFU, 24), startAnalysis) },
  { id: 'main-error', screen: 'メイン', state: '失敗', fixture: 'error', url: APP, steps: open(MAIN_KIFU, 24) },
  { id: 'main-empty', screen: 'メイン', state: '候補手なし', fixture: 'empty', url: APP },
  { id: 'main-rows', screen: 'メイン', state: '行と評価値バー', fixture: 'rows', url: APP, steps: then(open(MAIN_KIFU, 24), startAnalysis) },
  {
    id: 'main-sidebar-closed',
    screen: 'メイン',
    state: 'サイドバーを閉じる',
    fixture: 'normal',
    url: APP,
    steps: then(open(MAIN_KIFU, 24), async (page) => {
      await page.locator('[title="サイドバーを閉じる"]').click();
      await settle(page);
    }),
  },
  {
    id: 'main-gote',
    screen: 'メイン',
    state: '後手視点',
    fixture: 'normal',
    url: APP,
    steps: then(open(MAIN_KIFU, 62), async (page) => {
      await page.locator('[title="後手視点にする"]').click();
      await settle(page);
    }),
  },
  {
    id: 'kifu-fork',
    screen: '棋譜',
    state: '分岐メニュー',
    fixture: 'normal',
    url: APP,
    steps: then(open(MAIN_KIFU, 25), async (page) => {
      await page.locator('[title="分岐を選択"]').first().click();
      await settle(page);
    }),
  },
  {
    id: 'kifu-comment',
    screen: '棋譜',
    state: 'コメント',
    fixture: 'normal',
    url: APP,
    steps: then(open(MAIN_KIFU, 24), async (page) => {
      await page.locator('.kifu-row--active [title="コメントを開く"]').first().click();
      await settle(page, 600);
    }),
  },
  {
    id: 'engine-detail',
    screen: '検討',
    state: '起動失敗の詳細',
    fixture: 'error',
    url: APP,
    steps: then(open(MAIN_KIFU, 24), async (page) => {
      const b = page.locator('.analysis-controls__status-text--button').first();
      if (await b.count()) await b.click();
      await settle(page);
    }),
  },
  {
    id: 'mate-result',
    screen: '検討',
    state: '詰み探索の結果',
    fixture: 'normal',
    url: APP,
    steps: then(open(MAIN_KIFU, 106), async (page) => {
      await page.locator('[title="詰み探索"]').click();
      await settle(page, 900);
    }),
  },
  {
    id: 'book-empty',
    screen: '定跡',
    state: '空',
    fixture: 'bookTab',
    url: APP,
    steps: open(MAIN_KIFU),
  },
  {
    id: 'book-rows',
    screen: '定跡',
    state: '通常',
    fixture: 'bookTab',
    url: APP,
    steps: then(open(MAIN_KIFU), async (page) => {
      await page.locator('.book-empty__item').first().click();
      await settle(page, 600);
    }),
  },
  { id: 'tree-menu', screen: 'ファイルツリー', state: 'メニュー', fixture: 'normal', url: APP, steps: async (page) => {
      await page.locator('.node-box').filter({ hasText: '角換わり.kif' }).first().click({ button: 'right' });
      await settle(page);
    } },
  { id: 'kifu-read-error', screen: '棋譜の読み込み失敗', state: '失敗', fixture: 'kifuBroken', url: APP, steps: async (page) => {
      await clickNode(page, '角換わり.kif');
      await settle(page, 500);
    } },

  // 設定
  { id: 'settings-workspace', screen: '設定 › ワークスペース', state: '通常', fixture: 'normal', url: modal('settings', { tab: 'workspace' }) },
  { id: 'settings-workspace-long', screen: '設定 › ワークスペース', state: '長い文字', fixture: 'long', url: modal('settings', { tab: 'workspace' }) },
  { id: 'settings-workspace-error', screen: '設定 › ワークスペース', state: '失敗', fixture: 'error', url: modal('settings', { tab: 'workspace' }) },
  { id: 'settings-ai', screen: '設定 › AI ライブラリ', state: '通常', fixture: 'normal', url: modal('settings', { tab: 'aiLibrary' }) },
  { id: 'settings-ai-empty', screen: '設定 › AI ライブラリ', state: '空', fixture: 'empty', url: modal('settings', { tab: 'aiLibrary' }) },
  { id: 'settings-ai-error', screen: '設定 › AI ライブラリ', state: '失敗', fixture: 'error', url: modal('settings', { tab: 'aiLibrary' }) },
  { id: 'settings-engine', screen: '設定 › エンジン管理', state: '通常', fixture: 'normal', url: modal('settings', { tab: 'engine' }) },
  { id: 'settings-engine-long', screen: '設定 › エンジン管理', state: '長い文字', fixture: 'long', url: modal('settings', { tab: 'engine' }) },
  { id: 'settings-engine-many', screen: '設定 › エンジン管理', state: 'プリセットが多い', fixture: 'many', url: modal('settings', { tab: 'engine' }) },
  { id: 'settings-engine-empty', screen: '設定 › エンジン管理', state: '空', fixture: 'empty', url: modal('settings', { tab: 'engine' }) },
  { id: 'settings-engine-error', screen: '設定 › エンジン管理', state: '失敗', fixture: 'error', url: modal('settings', { tab: 'engine' }) },
  { id: 'settings-display', screen: '設定 › 表示', state: '通常', fixture: 'normal', url: modal('settings', { tab: 'display' }) },
  {
    id: 'preset-dialog',
    screen: 'プリセット編集',
    state: '通常',
    fixture: 'normal',
    url: modal('settings', { tab: 'engine' }),
    steps: async (page) => {
      await page.locator('[aria-label="編集"]').first().click();
      await settle(page, 700);
    },
  },
  {
    id: 'preset-dialog-long',
    screen: 'プリセット編集',
    state: '長い文字',
    fixture: 'long',
    url: modal('settings', { tab: 'engine' }),
    steps: async (page) => {
      await page.locator('[aria-label="編集"]').first().click();
      await settle(page, 700);
    },
  },
  {
    id: 'preset-dialog-error',
    screen: 'プリセット編集',
    state: '失敗',
    fixture: 'error',
    url: modal('settings', { tab: 'engine' }),
    steps: async (page) => {
      const b = page.locator('[aria-label="編集"]').first();
      if (await b.isEnabled()) await b.click();
      await settle(page, 700);
    },
  },

  // モーダル
  { id: 'navigation', screen: '局面ナビゲーション', state: '通常', fixture: 'normal', url: APP, steps: then(open(MAIN_KIFU, 24), async (page) => {
      await page.locator('[title="局面ナビゲーション"]').click();
      await settle(page, 700);
    }) },
  { id: 'position-search', screen: '局面検索', state: '通常', fixture: 'normal', url: APP, steps: then(open(MAIN_KIFU, 24), async (page) => {
      await press(page, '[title="局面検索"]');
      await settle(page, 900);
    }) },
  { id: 'position-search-long', screen: '局面検索', state: '長い文字', fixture: 'long', url: APP, steps: then(open(LONG_KIFU, 24), async (page) => {
      await press(page, '[title="局面検索"]');
      await settle(page, 900);
    }) },
  { id: 'position-search-error', screen: '局面検索', state: '失敗', fixture: 'error', url: APP, steps: then(open(MAIN_KIFU, 24), async (page) => {
      await press(page, '[title="局面検索"]');
      await settle(page, 900);
    }) },
  { id: 'study-positions', screen: '課題局面', state: '通常', fixture: 'normal', url: modal('study-positions') },
  { id: 'study-positions-long', screen: '課題局面', state: '長い文字', fixture: 'long', url: modal('study-positions') },
  { id: 'study-positions-empty', screen: '課題局面', state: '空', fixture: 'empty', url: modal('study-positions') },
  { id: 'study-save', screen: '局面を保存', state: '通常', fixture: 'normal', url: APP, steps: then(open(MAIN_KIFU, 30), async (page) => {
      await page.locator('[title="局面を保存"]').click();
      await settle(page, 700);
    }) },
  { id: 'create-file', screen: '棋譜を作成', state: '盤で組む', fixture: 'normal', url: modal('create-file', { tab: 'create', dir: ROOT }) },
  { id: 'import-file', screen: '棋譜を作成', state: '貼り付け', fixture: 'normal', url: modal('create-file', { tab: 'import', dir: ROOT }) },
  { id: 'updater', screen: '更新のカード', state: '通常', fixture: 'update', url: APP, steps: open(MAIN_KIFU) },
];

export { FIXTURES };
