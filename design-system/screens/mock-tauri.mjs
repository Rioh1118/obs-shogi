// ブラウザの中で Tauri の代わりに答える関数。ページの読み込みより前に流し込む（`page.addInitScript`）。
// **この関数は文字列にしてページへ渡るので、外の変数を見ない。** 受け取るのは JSON にできる見本データだけ。

export function installTauriMock(fx) {
  const callbacks = new Map();
  const listeners = new Map();
  let nextId = 1;
  let position = null;
  let session = 0;
  let searchId = 0;

  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

  const emit = (event, payload) => {
    for (const id of listeners.get(event) ?? []) {
      callbacks.get(id)?.({ event, id, payload: clone(payload) });
    }
  };
  // 画面の外（撮影する側）から通知を流すための口
  window.__obsEmit = emit;

  const later = (ms, fn) => window.setTimeout(fn, ms);

  const sfenKey = (sfen) => (sfen ?? '').replace(/^sfen\s+/, '').split(/\s+/).slice(0, 3).join(' ');

  const candidatesAt = (sfen) => fx.candidates[sfenKey(sfen)] ?? [];

  const emitIndex = () => {
    emit('position-index-state', fx.index);
    for (const w of fx.indexWarns) emit('position-index-warn', w);
  };

  const commands = {
    load_config: () => fx.config,
    save_config: ({ config }) => {
      fx.config = config;
      return null;
    },
    backup_broken_config: () => null,

    get_file_tree: () => fx.tree,
    read_file: ({ filePath }) => fx.kifu[filePath] ?? fx.kifuDefault,
    write_kifu_to_file: ({ request }) => ({ success: true, file_path: request.file_path }),

    load_presets: () => fx.presets,
    save_presets: () => 'r2',
    scan_ai_root: () => fx.aiIndex,
    probe_engine: ({ enginePath, token }) => {
      const p = fx.presets.presets.find((x) => x.enginePath === enginePath);
      return {
        token,
        enginePath,
        name: p?.engineName ?? 'YaneuraOu NNUE V9.00Git 64APPLEM1 TOURNAMENT',
        author: 'yaneurao',
        definitions: p?.definitions ?? [],
        reserved: p?.reservedNames ?? [],
      };
    },
    start_analysis_engine: () => {
      if (fx.startFailure) throw fx.startFailure;
      return {
        info: { name: 'YaneuraOu NNUE', author: 'yaneurao', options: [] },
        warnings: fx.startWarnings,
      };
    },
    shutdown_engine: () => null,
    set_position: ({ position: next }) => {
      position = next;
      return null;
    },
    start_infinite_analysis: () => {
      session += 1;
      const id = `session-${session}`;
      const found = candidatesAt(position);
      later(120, () =>
        emit('analysis-update', {
          sessionId: id,
          result: { candidates: found, mate_sequence: null },
        }),
      );
      return id;
    },
    stop_analysis: () => 'stopped',
    start_mate_search: () => {
      later(200, () =>
        emit('mate-search-finished', {
          sessionId: 'mate-1',
          result: { candidates: candidatesAt(position), mate_sequence: null },
          conclusion: { kind: 'noMate' },
        }),
      );
      return 'mate-1';
    },
    stop_mate_search: () => null,

    open_project: () => {
      later(60, emitIndex);
      return { totalFiles: fx.index.totalFiles };
    },
    search_position: () => {
      searchId += 1;
      const requestId = searchId;
      later(30, () => emit('position-search-begin', { requestId, stale: false }));
      later(60, () => {
        if (fx.search.error) {
          emit('position-search-error', { requestId, message: fx.search.error });
          return;
        }
        emit('position-search-chunk', {
          requestId,
          chunk: fx.search.hits,
          files: fx.search.files,
        });
        emit('position-search-end', { requestId });
      });
      return { requestId };
    },
    cancel_search: () => null,

    load_study_positions: () => fx.study,
    save_study_positions: () => null,

    list_books: () => [],
    open_book: () => {
      if (fx.book.error) throw fx.book.error;
      return fx.book.info;
    },
    lookup_book_moves: () => fx.book.moves,
    walk_book_lines: ({ input }) =>
      input.moves.map((usiMove, i) => ({
        usiMove,
        plies: [22, 18, 9, 4, 1][i % 5],
        stopped: 'outOfBook',
      })),
    close_book: () => null,

    list_games: () => [],

    load_updater_state: () => fx.updater,
    save_updater_state: () => null,

    'plugin:app|version': () => fx.version,
    'plugin:updater|check': () =>
      fx.update
        ? {
            rid: 1,
            available: true,
            currentVersion: fx.version,
            version: fx.update.version,
            date: null,
            body: null,
            rawJson: {},
          }
        : null,
    'plugin:resources|close': () => null,
    'plugin:dialog|open': () => null,
    'plugin:opener|reveal_item_in_dir': () => null,
    'plugin:event|listen': ({ event, handler }) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
      // 索引の状態は Rust が自分から流す。購読が後になっても届くように、繋がった時点でも流す
      if (event === 'position-index-state') later(80, emitIndex);
      return handler;
    },
    'plugin:event|unlisten': ({ event, eventId }) => {
      listeners.set(event, (listeners.get(event) ?? []).filter((id) => id !== eventId));
      return null;
    },
  };

  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
    transformCallback(callback, once = false) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, (payload) => {
        if (once) callbacks.delete(id);
        callback?.(payload);
      });
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    convertFileSrc: (p) => p,
    async invoke(cmd, args = {}) {
      if (fx.hang.includes(cmd)) return new Promise(() => {});
      if (Object.prototype.hasOwnProperty.call(fx.fail, cmd)) throw clone(fx.fail[cmd]);
      const run = commands[cmd];
      if (!run) {
        console.debug(`[mock] 答えを持たないコマンド: ${cmd}`);
        return null;
      }
      try {
        return clone(run(args));
      } catch (e) {
        throw clone(e);
      }
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event, eventId) {
      listeners.set(event, (listeners.get(event) ?? []).filter((id) => id !== eventId));
    },
  };
}
