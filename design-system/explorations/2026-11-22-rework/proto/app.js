/* 案の画面を組む。案（p）・画面（screen）・状態（state）・明るさ（theme）・手数（ply）から DOM を作る。
   文言とデータは製品と同じもの（build-data.mjs）。操作は、手の移動・ツリーの開閉・知らせの詳細・プリセットの選択だけ動く。 */
(() => {
  const { DATA, ICONS, ASSETS } = window.__PROTO__;

  const S = {
    p: 'd',
    screen: 'main',
    state: 'idle',
    theme: 'dark',
    ply: 24,
    sidebar: true,
    more: -1,
    open: new Set(),
    applied: 0,
    ...readHash(),
  };

  function readHash() {
    const q = new URLSearchParams(location.hash.replace(/^#/, ''));
    const out = {};
    for (const k of ['p', 'screen', 'state', 'theme']) if (q.get(k)) out[k] = q.get(k);
    if (q.get('ply')) out.ply = Number(q.get('ply'));
    return out;
  }

  const h = (s) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const icon = (name, size = 16, sw = 1.6) =>
    `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${(sw * 24) / size / 1.5}" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${ICONS[name]}</svg>`;

  const btn = (name, title, { cls = '', size = 16, disabled = false, pressed = null, attrs = '' } = {}) =>
    `<button type="button" class="ib ${cls}" title="${h(title)}" aria-label="${h(title)}"${disabled ? ' disabled' : ''}${
      pressed === null ? '' : ` aria-pressed="${pressed}"`
    } ${attrs}>${icon(name, size)}</button>`;

  /** いまの手の印。盤の最終手のマスと、棋譜のいまの行だけに付ける（案A では左の棒） */
  const now = '<i class="now" aria-hidden="true"></i>';

  /** 長い綴りを、区切りの後ろで折れるようにする */
  const soft = (text) => h(text).replace(/([_/-])/g, '$1<wbr>');

  // ---- データの取り出し ----

  /** 2周目の案。骨格は D、ドックは今の見た目 */
  const isV2 = () => S.p === 'e' || S.p === 'f';

  const START_PLY = { start: 0, hands: 5, mate: 106, book: 0 };
  const kifu = () => DATA.kifu[S.state] ?? DATA.kifu.normal;
  const isRunning = () => ['analyzing', 'long', 'hands', 'rows'].includes(S.state);
  const candidates = () => {
    if (S.state === 'mate') return DATA.candidates.normal[START_PLY.mate];
    if (!isRunning()) return [];
    const all = S.state === 'hands' ? DATA.candidates.hands : DATA.candidates.normal;
    return all[S.ply] ?? all[START_PLY[S.state] ?? 24] ?? [];
  };
  const turnOf = () => (kifu().sfens[S.ply].split(' ')[1] === 'b' ? 's' : 'g');
  const tree = () => DATA.tree[S.state] ?? DATA.tree.normal;
  const empty = () => S.state === 'empty';
  /** エンジンが使えない間は候補手が出ないので、検討の段を見出しだけに縮めて盤へ回す */
  const dockMin = () => S.state === 'error';

  const BLANK_PRESET = {
    id: 'x',
    label: '（無名プリセット）',
    configured: false,
    engine: '',
    enginePath: '',
    engineName: '',
    evalFile: '',
    book: '',
    multiPv: { value: '5', isDefault: false },
    threads: { value: '初期値', isDefault: true, known: false },
    hash: { value: '初期値', isDefault: true, known: false },
  };
  const presets = () => (empty() ? [BLANK_PRESET] : (DATA.presets[S.state] ?? DATA.presets.normal));
  // 製品と同じ並び: 適用中が先頭、残りは名前順
  const sortedPresets = () => {
    const [first, ...rest] = presets();
    return [first, ...rest.sort((a, b) => a.label.localeCompare(b.label))];
  };

  const notices = () => {
    if (S.state === 'start') return [DATA.notices.warned];
    if (S.state === 'long') return [DATA.notices.long];
    if (S.state === 'error') return DATA.notices.error;
    if (empty())
      return [
        {
          kind: 'banner',
          tier: 'warning',
          title: 'エンジンを起動できませんでした',
          body: ['選んでいるプリセットのエンジンが設定されていません。設定の「エンジン管理」で確認してください。'],
          actions: ['設定を開く'],
        },
      ];
    return [];
  };

  // ---- 盤 ----

  const PIECE = { P: 'pawn', L: 'lance', N: 'knight', S: 'silver', G: 'gold', B: 'bishop', R: 'rook', K: 'king' };
  const PROM = { P: 'prom_pawn', L: 'prom_lance', N: 'prom_knight', S: 'prom_silver', B: 'horse', R: 'dragon' };
  const ALT = { P: '歩', L: '香', N: '桂', S: '銀', G: '金', B: '角', R: '飛', K: '玉' };

  const pieceImg = (ch, promoted) => {
    const up = ch.toUpperCase();
    const side = ch === up ? 'black' : 'white';
    const name = promoted ? PROM[up] : PIECE[up];
    return `<img class="pc pc-${name}" src="${ASSETS.pieces[`${side}_${name}`]}" alt="${ALT[up]}" draggable="false">`;
  };

  const square = (file, rank, inner, last) => {
    const isLast = last && last[0] === file && last[1] === rank;
    return `<div class="sq${isLast ? ' last' : ''}">${isLast ? now : ''}${inner}</div>`;
  };

  function boardHtml() {
    const [board] = kifu().sfens[S.ply].split(' ');
    const last = kifu().last[S.ply];
    let html = '';
    board.split('/').forEach((row, r) => {
      let file = 9;
      for (let i = 0; i < row.length; i += 1) {
        let ch = row[i];
        if (/\d/.test(ch)) {
          for (let n = 0; n < Number(ch); n += 1) {
            html += square(file, r + 1, '', last);
            file -= 1;
          }
          continue;
        }
        let promoted = false;
        if (ch === '+') {
          promoted = true;
          i += 1;
          ch = row[i];
        }
        html += square(file, r + 1, pieceImg(ch, promoted), last);
        file -= 1;
      }
    });
    return `<div class="board" data-part="盤"><div class="grid">${html}</div></div>`;
  }

  const HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

  function handOf(side) {
    const raw = kifu().sfens[S.ply].split(' ')[2];
    const out = new Map();
    if (raw === '-') return out;
    for (const m of raw.matchAll(/(\d*)([a-zA-Z])/g)) {
      const mine = side === 's' ? m[2] === m[2].toUpperCase() : m[2] === m[2].toLowerCase();
      if (mine) out.set(m[2].toUpperCase(), Number(m[1] || 1));
    }
    return out;
  }

  const chOf = (side, k) => (side === 's' ? k : k.toLowerCase());

  /**
   * 横に置く駒台。12枚までは、強い駒から1枚ずつ4段に並べる（実物の駒台と同じ）。
   * それより多いときは、種類ごとに1枚と枚数にする。どちらも盤の駒と同じ大きさ
   */
  function handBox(side) {
    const hand = handOf(side);
    const kinds = HAND_ORDER.filter((k) => hand.get(k));
    const all = kinds.flatMap((k) => Array.from({ length: hand.get(k) }, () => ({ k, n: 1 })));
    const grouped = all.length > 12;
    const list = grouped ? kinds.map((k) => ({ k, n: hand.get(k) })) : all;
    const rows = [[], [], [], []];
    if (!grouped && list.length <= 3) {
      const at = kinds.some((k) => 'RB'.includes(k)) ? 0 : kinds.some((k) => 'GS'.includes(k)) ? 1 : kinds.some((k) => 'NL'.includes(k)) ? 2 : 3;
      rows[at] = list;
    } else {
      const per = grouped ? 2 : Math.max(2, Math.ceil(list.length / 4));
      list.forEach((item, i) => rows[Math.floor(i / per)].push(item));
    }
    const order = side === 's' ? rows : [...rows].reverse();
    return `<div class="hand hand-${side}${grouped ? ' grouped' : ''}" data-part="駒台">${order
      .map((r) => `<div class="hrow">${r.map(({ k, n }) => `<span class="stack"><span class="hp">${pieceImg(chOf(side, k), false)}</span>${grouped ? `<b>${n > 1 ? n : ''}</b>` : ''}</span>`).join('')}</div>`)
      .join('')}</div>`;
  }

  /** 盤の上下に置く帯の駒台。種類ごとに1枚と枚数 */
  function handStrip(side) {
    const hand = handOf(side);
    const kinds = HAND_ORDER.filter((k) => hand.get(k));
    const list = side === 's' ? kinds : [...kinds].reverse();
    return `<div class="strip strip-${side}" data-part="駒台">${list
      .map((k) => `<span class="stack"><span class="hp">${pieceImg(chOf(side, k), false)}</span>${hand.get(k) > 1 ? `<b>${hand.get(k)}</b>` : ''}</span>`)
      .join('')}</div>`;
  }

  const chunks = (text) => text.split(/\s+/).filter(Boolean).map((c) => `<span class="ck">${h(c)}</span>`).join(' ');
  const nameTag = (side, { turned = false, oneLine = false } = {}) => {
    const raw = side === 's' ? kifu().sente : kifu().gote;
    const glyph = side === 's' ? '☗' : turned ? '⛉' : '☖';
    const on = turnOf() === side;
    return `<div class="name name-${side}${on ? ' on' : ''}" data-part="対局者名" data-wrap title="${h(raw)}"><span class="who"><span class="koma">${glyph}</span><span class="nm">${oneLine ? `<bdi>${h(raw || '—')}</bdi>` : chunks(raw || '—')}</span></span>${
      on ? `<span class="turn">${side === 's' ? '先手番' : '後手番'}</span>` : ''
    }</div>`;
  };

  const clusterSide = () => `<div class="cluster" data-part="盤と駒台">
      <div class="cl cl-g">${handBox('g')}${nameTag('g', { turned: true })}</div>
      ${boardHtml()}
      <div class="cl cl-s">${nameTag('s')}${handBox('s')}</div>
    </div>`;

  const clusterPortrait = () => `<div class="cluster portrait" data-part="盤と駒台">
      <div class="pr pr-g">${nameTag('g', { turned: true, oneLine: true })}${handStrip('g')}</div>
      ${boardHtml()}
      <div class="pr pr-s">${handStrip('s')}${nameTag('s', { oneLine: true })}</div>
    </div>`;

  const controls = (size = 20) => {
    const at0 = S.ply === 0;
    const atEnd = S.ply >= kifu().rows.length - 1;
    return `<div class="ctl" data-part="手の移動">
      ${btn('first', isV2() ? '最初に戻る（Home）' : '最初に戻る', { disabled: at0, size, attrs: 'data-go="first"' })}
      ${btn('prev', isV2() ? '前の手（←）' : '前の手', { disabled: at0, size, attrs: 'data-go="prev"' })}
      ${btn('next', isV2() ? '次の手（→）' : '次の手', { disabled: atEnd, size, attrs: 'data-go="next"' })}
      ${btn('last', isV2() ? '最後に進む（End）' : '最後に進む', { disabled: atEnd, size, attrs: 'data-go="last"' })}
    </div>`;
  };

  // ---- ツリー ----

  function treeHtml() {
    const active = empty() ? null : kifu().path;
    const rows = [];
    const walk = (node, level) => {
      const isOpen = level === 0 || S.open.has(node.path);
      rows.push({ node, level, isOpen });
      if (node.dir && isOpen) for (const c of node.children) walk(c, level + 1);
    };
    walk(tree(), 0);
    const ext = (n) => n.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
    return `<nav class="tree" data-part="ファイルツリー" aria-label="棋譜"><div class="tree-in">${rows
      .map(({ node, level, isOpen }) => {
        const on = node.path === active;
        const e = node.dir ? '' : ext(node);
        const stem = e ? node.name.slice(0, -e.length) : node.name;
        return `<div class="node${node.dir ? ' dir' : ''}${on ? ' on' : ''}" style="--lv:${level}" data-dir="${node.dir ? h(node.path) : ''}" title="${h(node.name)}" tabindex="0">
          ${on && S.p === 'a' ? now : ''}<span class="chev">${node.dir ? icon(isOpen ? 'down' : 'right', 14) : ''}</span>${
            node.dir ? `<span class="ficon">${icon(isOpen ? 'folderOpen' : 'folder', 14)}</span>` : '<span class="ficon koma">☗</span>'
          }<span class="nname"><span class="stem">${h(stem)}</span><span class="ext">${h(e)}</span></span></div>`;
      })
      .join('')}</div></nav>`;
  }

  // ---- 棋譜 ----

  const firstLine = (c) => c.split('\n').find((l) => l.trim()) ?? '';

  const tesuu = () => `<span class="tesuu" data-part="手数">手数 <b>${S.ply}</b>/${kifu().rows.length - 1}</span>`;

  const rowActions = (r) => {
    const hasComment = Boolean(r.comment);
    return `<span class="acts">${
      r.forks.length
        ? `<button type="button" class="mini fork" title="分岐を選択" aria-label="分岐を選択">${icon('branch', 13)}<span>${r.forks.length}</span></button>`
        : ''
    }<button type="button" class="mini cmt${hasComment ? ' has' : ''}" title="${hasComment ? 'コメントを開く' : 'コメントを追加'}" aria-label="${hasComment ? 'コメントを開く' : 'コメントを追加'}">${icon('comment', 13)}${hasComment ? '<span>1</span>' : ''}</button></span>`;
  };

  /** 1行1手。extra が true なら、行の余りに変化の手とコメントの1行目を出し、いまの行はコメントを3行まで広げる */
  function kifuList({ extra = false } = {}) {
    return `<div class="klist" data-part="棋譜の一覧" role="grid" aria-label="棋譜" tabindex="0" aria-activedescendant="k${S.ply}">${kifu()
      .rows.map((r) => {
        const on = r.ply === S.ply;
        const open = extra && on && Boolean(r.comment);
        const note = extra
          ? `<span class="xtra">${
              r.forks.length
                ? `<button type="button" class="xf" title="分岐を選択: ${h(r.forks.join(' '))}">${icon('branch', 12)}${r.forks.map((f) => `<span class="xt">${h(f)}</span>`).join('')}</button>`
                : ''
            }${r.comment && !open ? `<button type="button" class="xc" title="${h(r.comment.trim())}">${h(firstLine(r.comment))}</button>` : ''}</span>`
          : '';
        const memo = open ? `<p class="memo" title="${h(r.comment.trim())}">${h(r.comment.trim().replace(/\s+/g, ' '))}</p>` : '';
        return `<div class="krow${on ? ' on' : ''}${open ? ' open' : ''}${r.ply === 0 ? ' start' : ''}" data-ply="${r.ply}" id="k${r.ply}" title="${r.ply === 0 ? '開始局面へ' : `${r.ply}手目へ`}">${on ? now : ''}<span class="kn">${r.ply || ''}</span><span class="km">${h(r.text)}</span>${note}${rowActions(r)}${memo}</div>`;
      })
      .join('')}</div>`;
  }

  /** 棋譜を1行に決まった手数で流す。手数は列の幅から決め、行の頭に何手目かを出す（layoutFlow） */
  function kifuFlow() {
    const rows = kifu().rows;
    const cells = rows.slice(1).map((r) => {
      const on = r.ply === S.ply;
      return `<button type="button" class="fcell${on ? ' on' : ''}" data-ply="${r.ply}" id="k${r.ply}" title="${r.ply}手目へ">${on ? now : ''}<span class="fm">${h(r.text)}</span>${
        r.forks.length ? `<i class="fi" title="分岐 ${r.forks.length}">${icon('branch', 11)}</i>` : ''
      }${r.comment ? `<i class="fi" title="コメントあり">${icon('comment', 11)}</i>` : ''}</button>`;
    });
    const cur = rows[S.ply];
    const memo = `<div class="fmemo" data-part="いまの手の覚え書き"><span class="kn">${S.ply || ''}</span><span class="km">${h(cur.text)}</span>${
      cur.forks.length ? `<span class="xf">${icon('branch', 12)}${cur.forks.map((f) => `<span>${h(f)}</span>`).join('')}</span>` : ''
    }<span class="xc" title="${h(cur.comment.trim())}">${cur.comment ? h(firstLine(cur.comment)) : ''}</span>${rowActions(cur)}</div>`;
    return `<div class="flow" data-part="棋譜の一覧"><div class="fgrid">${cells.join('')}</div></div>${memo}`;
  }

  // ---- 検討 ----

  const STATUS = () => {
    if (S.state === 'error') return { word: '起動失敗', mark: 'danger', link: true };
    if (empty()) return { word: 'エンジンなし', mark: 'idle' };
    if (S.state === 'mate') return { word: '詰み探索完了', mark: 'idle', timer: '7s' };
    if (isRunning()) return { word: '検討中', mark: 'run', timer: '13s' };
    return { word: '待機中', mark: 'idle' };
  };

  const statusHtml = () => {
    const s = STATUS();
    return `<span class="status ${s.mark}" data-part="エンジンの状態"><i class="dot ${s.mark}"></i>${
      s.link ? `<button type="button" class="slink">${s.word}</button>` : `<span>${s.word}</span>`
    }${s.timer ? `<span class="timer">${s.timer}</span>` : ''}</span>`;
  };

  const tabs = () =>
    `<div class="tabs" role="tablist" data-part="ドックのタブ"><button type="button" role="tab" class="tab on" aria-selected="true">検討</button><button type="button" role="tab" class="tab" aria-selected="false">定跡</button></div>`;

  /** 操作の並び。label が true なら、検討の開始だけ語を添える */
  function actions({ label = false, size = 16 } = {}) {
    const run = isRunning() ? ['stop', '検討を中断'] : ['play', '検討を開始'];
    const main =
      S.state === 'error'
        ? `<button type="button" class="bt sm">もう一度起動</button>`
        : label
          ? `<button type="button" class="bt sm run ${run[0]}" title="${run[1]}">${icon(run[0], 13)}<span>${run[1]}</span></button>`
          : btn(run[0], run[1], { size, cls: `${run[0]}${isRunning() ? ' on' : ''}` });
    return `<div class="acts2" data-part="検討の操作">
      ${label || S.state === 'error' ? main : ''}
      <div class="g">${btn('rotate', '後手視点にする', { size })}${label || S.state === 'error' ? '' : main}${btn('crown', '詰み探索', { size })}</div>
      <div class="g">${btn('nav', '局面ナビゲーション', { size })}${btn('search', '局面検索', { size })}${btn('bookmark', S.ply === 24 ? '課題局面を編集' : '局面を保存', { size, cls: S.ply === 24 ? 'filled' : '' })}</div>
      ${btn('settings', '設定', { size })}
    </div>`;
  }

  const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

  function stats() {
    const top = candidates()[0];
    const items = [
      ['深さ', top ? top.depth : '—'],
      ['ノード数', top ? fmt(top.nodes) : '—'],
      ['NPS', top ? fmt(Math.round((top.nodes / top.time) * 1000)) : '—'],
      ['時間', top ? `${(top.time / 1000).toFixed(1)}s` : '—'],
    ];
    return `<div class="stats" data-part="読みの量">${items.map(([l, v]) => `<span class="st"><span class="sl">${l}</span><span class="sv">${v}</span></span>`).join('')}</div>`;
  }

  const pvHtml = (pv) => pv.map((m) => `<span class="mv ${m[0] === '☗' ? 'ps' : 'pg'}">${h(m)}</span>`).join('');

  /** 候補手の表。withStats が true なら、読みの量を見出しの行の右に置く */
  function pvTable({ withStats = false } = {}) {
    const list = candidates();
    const head = withStats ? `<span class="thx"><span>読み筋</span>${stats()}</span>` : '読み筋';
    return `<div class="pvt" data-part="候補手の表"><table><thead><tr><th class="c1">指し手</th><th class="c2">評価値</th><th>${head}</th></tr></thead><tbody>${
      list.length === 0
        ? `<tr class="none"><td colspan="3">候補手なし</td></tr>`
        : list
            .map(
              (c, i) =>
                `<tr class="${i === 0 ? 'best' : ''}"><td class="c1">${h(c.move)}</td><td class="c2">${h(c.eval)}</td><td class="c3" title="${h(c.pv.join(' '))}"><div class="pv">${pvHtml(c.pv)}</div></td></tr>`,
            )
            .join('')
    }</tbody></table></div>`;
  }

  /** 縦の列の検討（案B）。指し手と評価値を表で並べ、読み筋は下に1本ずつ折り返す */
  function pvColumn() {
    const list = candidates();
    const head = `<div class="pvh"><div class="pvt" data-part="候補手の表"><table><thead><tr><th class="c1">指し手</th><th class="c2">評価値</th></tr></thead><tbody>${
      list.length === 0
        ? `<tr class="none"><td colspan="2">候補手なし</td></tr>`
        : list.map((c, i) => `<tr class="${i === 0 ? 'best' : ''}"><td class="c1">${h(c.move)}</td><td class="c2">${h(c.eval)}</td></tr>`).join('')
    }</tbody></table></div>${stats()}</div>`;
    if (list.length === 0) return head;
    return `${head}<ol class="pvs" data-part="読み筋">${list
      .map((c, i) => `<li class="${i === 0 ? 'best' : ''}" title="${h(c.pv.join(' '))}"><div class="pv">${pvHtml(c.pv)}</div></li>`)
      .join('')}</ol>`;
  }

  // ---- 2周目のドック。見た目は今のもの（src/widgets/dock、analysis-pane、book-view）----

  const isBook = () => S.state === 'book';

  const tabsV2 = () =>
    `<div class="tabs" role="tablist" data-part="ドックのタブ">${['検討', '定跡']
      .map((t, i) => `<button type="button" role="tab" class="tab${(i === 1) === isBook() ? ' on' : ''}" aria-selected="${(i === 1) === isBook()}">${t}</button>`)
      .join('')}</div>`;

  const bookTools = () =>
    `<div class="acts2" data-part="定跡の操作"><div class="g">${btn('folderOpen', '定跡を開く', { size: 18 })}${btn('close', '定跡を閉じる', { size: 18 })}</div></div>`;

  const bookStatus = () =>
    `<span class="status book" data-part="開いている定跡"><span class="bk" title="${h(DATA.book.path)}">${h(DATA.book.file)}</span><span class="timer">${DATA.book.count}</span></span>`;

  function bookTable() {
    return `<div class="pvt bkt" data-part="定跡の表"><table><thead><tr><th class="c1">指し手</th><th class="b2">評価</th><th class="b2">深さ</th><th class="b3">出現回数</th><th class="b4">応手</th><th>この先</th></tr></thead><tbody>${DATA.book.rows
      .map(
        (r) =>
          `<tr><td class="c1">${h(r.move)}</td><td class="b2">${h(r.value)}</td><td class="b2 dim">${r.depth}</td><td class="b3"><span class="bq">${r.count}</span><i class="bb"><i style="width:${(r.ratio * 100).toFixed(1)}%"></i></i></td><td class="b4 dim">${h(r.ponder)}</td><td class="${r.ahead.startsWith('→') ? '' : 'dim'}">${h(r.ahead)}</td></tr>`,
      )
      .join('')}</tbody></table></div>`;
  }

  /** 候補手の見せ方「行」 */
  const pvRows = () =>
    `<ol class="pvr" data-part="候補手の行">${candidates()
      .map((c, i) => `<li class="${i === 0 ? 'best' : ''}" title="${h(c.pv.join(' '))}"><span class="ev">${h(c.eval)}</span><div class="pv">${pvHtml(c.pv)}</div></li>`)
      .join('')}</ol>`;

  const evalBar = () => {
    const at = Number(candidates()[0]?.eval ?? 0);
    const left = 50 + (50 * Math.max(-3000, Math.min(3000, at))) / 3000;
    return `<div class="gauge" data-part="評価値バー" role="img" aria-label="評価値バー"><i style="width:${left.toFixed(1)}%"></i></div>`;
  };

  function dockV2() {
    const body = isBook() ? bookTable() : S.state === 'rows' ? evalBar() + pvRows() : pvTable();
    const said = S.state === 'mate' ? '<p class="said" data-part="詰み探索の結論">詰みはありません。</p>' : '';
    return `<section class="dock" data-part="ドック">${tabsV2()}${isBook() ? bookTools() : actions({ size: 18 })}<div class="dbody">${said}${body}</div><div class="dmeta">${
      isBook() ? bookStatus() : statusHtml() + stats()
    }</div></section>`;
  }

  // ---- 知らせ ----

  const TIER_ICON = { info: 'info', warning: 'warn', danger: 'danger' };
  const bodyHtml = (n) => n.body.map((b) => `<p>${h(b)}</p>`).join('');
  const moreBtn = (i, text) => `<button type="button" class="bt xs more" data-more="${i}" aria-expanded="${S.more === i}">${text}${icon('down', 12)}</button>`;

  /** 知らせの帯。1件1行。詳細は押したときだけ、その場に開く。2件を超えたぶんは数で出す */
  function bandsHtml(list) {
    if (list.length === 0) return '';
    const shown = list.slice(0, 2);
    const rest = list.length - shown.length;
    return `<div class="bands" data-part="知らせの帯">${shown
      .map((n, i) => {
        const last = i === shown.length - 1 && rest > 0;
        return `<div class="band ${n.tier}" role="status"><span class="nic">${icon(TIER_ICON[n.tier], 16)}</span><span class="ntt" title="${h(n.title)}">${h(n.title)}</span><span class="nb1" title="${h(n.body.join(' '))}">${h(n.body[0])}</span><span class="nac">${n.actions.map((a, k) => `<button type="button" class="bt xs${k === 0 && n.tier === 'danger' && i === 0 ? ' pri' : ''}">${h(a)}</button>`).join('')}${moreBtn(i, '詳細')}${
          last ? `<button type="button" class="bt xs">ほか ${rest} 件</button>` : ''
        }</span>${btn('close', '閉じる', { cls: 'ncl', size: 14 })}${S.more === i ? `<div class="nfull">${bodyHtml(n)}</div>` : ''}</div>`;
      })
      .join('')}</div>`;
  }

  /**
   * 自分で消えない知らせは、失敗も警告も帯に出す（2件まで、残りは数）。設定を開いている間は「設定を開く」を出さない。
   * 6秒で消える知らせは、盤を動かさないように上の帯の空きに出す（この見本の状態には無い）
   */
  const bandList = () =>
    S.screen !== 'main' ? notices().map((n) => ({ ...n, actions: n.actions.filter((a) => a !== '設定を開く') })) : notices();

  // ---- 枠 ----

  const lights = `<div class="lights" data-part="窓の操作"><i class="lc"></i><i class="lm"></i><i class="lz"></i></div>`;
  const mark = (w) => `<img class="mark" src="${ASSETS.icon}" width="${w}" height="${Math.round((w * 691) / 594)}" alt="アプリのアイコン">`;
  const wordmark = () => `<div class="wm" data-part="文字ロゴ"><span class="wm1">obs</span><span class="wm2">shogi</span></div>`;

  const toggle = () => btn(S.sidebar ? 'panelClose' : 'panelOpen', S.sidebar ? 'サイドバーを閉じる' : 'サイドバーを開く', { cls: 'tgl', size: 17, attrs: 'data-toggle' });

  const docTitle = () =>
    empty()
      ? `<span class="fname none">ファイル未選択</span>`
      : `<span class="fname" title="${h(kifu().path)}">${h(kifu().file)}</span>`;

  const topRight = (withLabel) =>
    withLabel
      ? `<div class="tr"><button type="button" class="tb" title="課題局面">${icon('library', 15)}<span>課題局面</span></button><button type="button" class="tb" title="設定">${icon('settings', 15)}<span>設定</span></button></div>`
      : `<div class="tr">${btn('library', '課題局面', { size: 18 })}${btn('settings', '設定', { size: 18 })}</div>`;

  const bar = () =>
    `<header class="bar" data-part="上の帯">${lights}${toggle()}<div class="brand">${mark(16)}${wordmark()}</div><div class="doc">${docTitle()}</div>${topRight(true)}</header>${bandsHtml(bandList())}`;

  const side = () => `<aside class="side">${treeHtml()}</aside>`;

  const FORMATS = ['.kif', '.ki2', '.csa', '.jkf'];
  const welcome = () => `<div class="wel" data-part="棋譜を開く前"><div class="wel-in">${mark(72)}<h2>棋譜を選択するか、作成してください</h2><p>左のファイルツリーから棋譜を選択すると、<br>こちらに盤が出ます</p><button type="button" class="bt pri">棋譜を作成</button><div class="fmts">${FORMATS.map((f) => `<span>${f}</span>`).join('')}</div></div></div>`;

  // ---- 案ごとのメイン画面 ----

  const dockCls = () => (dockMin() ? ' min' : '');
  const cols = (inner) => `<div class="cols${S.sidebar ? '' : ' closed'}">${side()}${empty() ? welcome() : inner}</div>`;

  const MAIN = {
    // 案A: C4 を当て切る。構成は今のまま
    a: () => ({
      head: `<div class="titlebar">${lights}</div>
      <header class="hd" data-part="上の帯">
        ${toggle()}${wordmark()}
        <div class="doc">${docTitle()}${
          empty() ? '' : `<span class="bdg">${turnOf() === 's' ? '☗ 先手番' : '☖ 後手番'}</span><span class="bdg">${S.ply}手目</span>`
        }</div>${topRight(false)}
      </header>${bandsHtml(bandList())}`,
      body: cols(`<main class="work${dockCls()}">
          <section class="stage" data-part="盤の周り">${clusterSide()}${controls()}</section>
          <aside class="kifu" data-part="棋譜"><div class="khd">${tesuu()}</div>${kifuList()}</aside>
          <section class="dock" data-part="ドック"><div class="dh">${tabs()}${stats()}${statusHtml()}${actions()}</div>${pvTable()}</section>
        </main>`),
    }),

    // 案B: 柱。縦の4列。盤は縦いっぱい、駒台は盤の上下、棋譜と検討は盤の右に続けて置く
    b: () => ({
      head: bar(),
      body: cols(`<section class="stage" data-part="盤の周り">${clusterPortrait()}${controls()}</section>
        <aside class="kifu" data-part="棋譜"><div class="khd">${tesuu()}</div>${kifuList()}</aside>
        <section class="ana" data-part="検討の列"><div class="dh">${tabs()}${statusHtml()}</div><div class="ds">${actions({ label: true })}</div>${pvColumn()}</section>`),
    }),

    // 案C: 机。上は盤と駒台だけ、下に棋譜の流しと検討の表
    c: () => ({
      head: bar(),
      body: cols(`<main class="work${dockCls()}">
          <section class="stage" data-part="盤の周り">${clusterSide()}</section>
          <section class="bench">
            <div class="kifu" data-part="棋譜"><div class="khd">${controls(18)}${tesuu()}</div>${kifuFlow()}</div>
            <div class="dock" data-part="検討"><div class="dh">${tabs()}${statusHtml()}${actions()}</div>${pvTable({ withStats: true })}</div>
          </section>
        </main>`),
    }),

    // 案D: 記録。構成は今に近く、中央は盤と駒台だけ。手の移動は棋譜の見出しに置き、棋譜の行に覚え書きを出す
    d: () => ({
      head: bar(),
      body: cols(`<main class="work${dockCls()}">
          <section class="stage" data-part="盤の周り">${clusterSide()}</section>
          <aside class="kifu" data-part="棋譜"><div class="khd">${controls(18)}${tesuu()}</div>${kifuList({ extra: true })}</aside>
          <section class="dock" data-part="ドック"><div class="dh">${tabs()}${statusHtml()}${actions({ label: true })}</div>${pvTable({ withStats: true })}</section>
        </main>`),
    }),
  };

  // 2周目。骨格は D のまま、ドックだけ今の見た目にする
  const mainV2 = () => ({
    head: bar(),
    body: cols(`<main class="work"${dockMin() ? ` style="--bands:${34 * Math.min(2, bandList().length)}px"` : ''}>
          <section class="stage" data-part="盤の周り">${clusterSide()}</section>
          <aside class="kifu" data-part="棋譜"><div class="khd">${tesuu()}</div>${kifuList({ extra: true })}${controls(20)}</aside>
          ${dockV2()}
        </main>`),
  });
  MAIN.e = mainV2;
  MAIN.f = mainV2;

  // ---- 設定 › エンジン管理 ----

  const readOnly = () => S.state === 'error';
  const TABS = ['ワークスペース', 'AI ライブラリ', 'エンジン管理', '表示'];
  const TAB_OF = { workspace: 'ワークスペース', ai: 'AI ライブラリ', engine: 'エンジン管理', display: '表示' };
  const SECTION_DESC = 'エンジンの起動設定・検討の基本設定をプリセットとして管理します。保存時に必要なら自動でエンジンが再起動されます。';
  const NOTE = '候補手の数を増やすと 1手あたりの読みが浅くなります（研究向けの “幅 vs 深さ” トレードオフ）。';

  /** そのままではエンジンが動かない問題があるか。無くても動くもの（定跡）では出さない */
  const needsCare = (tab) => {
    if (tab === 'AI ライブラリ') return (DATA.ai[S.state] ?? DATA.ai.idle).scan !== 'ready';
    if (tab === 'エンジン管理') return readOnly() || !sortedPresets()[applied()].configured;
    return false;
  };

  const settingsNav = () =>
    `<nav class="snav" data-part="設定のタブ">${TABS.map((t) => {
      const on = t === TAB_OF[S.screen];
      const trouble = isV2() && needsCare(t) ? `<i class="trb" title="設定が要ります">${icon('warn', 13)}</i>` : '';
      return `<button type="button" class="stab${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''}>${on && S.p === 'a' ? now : ''}${t}${trouble}</button>`;
    }).join('')}</nav>`;

  const secActions = () => `<div class="sacts"><button type="button" class="bt sm">${icon('refresh', 13)}もう一度読み込む</button><button type="button" class="bt sm go"${readOnly() ? ' disabled' : ''}>${icon('plus', 13)}追加</button></div>`;

  const rowBtns = (n) => `<span class="rb">${btn('pencil', '編集', { size: 15, disabled: readOnly() })}${btn('copy', '複製', { size: 15, disabled: readOnly() })}${btn('trash', '削除', { size: 15, cls: 'del', disabled: readOnly() || n <= 1 })}</span>`;

  const applied = () => Math.min(S.applied, sortedPresets().length - 1);
  const stateTag = (p, i) => (i === applied() ? '<span class="tag now-tag">適用中</span>' : '') + (p.configured ? '' : `<span class="tag warn">${icon('warn', 12)}要設定</span>`);

  /** 値。エンジンの初期値のままなら、数の下に「初期値」と書く */
  const numCell = (v) => `<span class="num${v.isDefault ? ' def' : ''}">${h(v.value)}${v.isDefault && v.known ? '<small>初期値</small>' : ''}</span>`;
  const longOr = (text, full, none) => (text ? `<span class="long" title="${h(full ?? text)}">${soft(text)}</span>` : `<span class="off">${none}</span>`);

  const mateSection = () => `<section class="sec mate" data-part="詰み探索"><div class="sech"><h3>詰み探索</h3><p>検討ペインの「詰み探索」で使うエンジンと時間です。</p></div>
    <div class="frow"><div class="fl"><label>詰み探索に使う</label><p>詰将棋エンジンのプリセットを選択してください。</p></div><div class="fc"><div class="sel"><span>${empty() ? '指定しない' : '詰将棋'}</span>${icon('down', 14)}</div></div></div>
    <div class="frow"><div class="fl"><label>上限時間</label></div><div class="fc"><div class="seg" role="radiogroup">${['10秒', '30秒', '60秒', '無制限'].map((t) => `<button type="button" role="radio" aria-checked="${t === '30秒'}" class="${t === '30秒' ? 'on' : ''}">${t}</button>`).join('')}</div></div></div></section>`;

  const hasMany = () => sortedPresets().some((p) => Number(p.multiPv.raw ?? p.multiPv.value) >= 2);
  const note = () => (hasMany() ? `<p class="note">${NOTE}</p>` : '');

  const PRESETS = {
    // A: 1行1プリセットの表
    a: () => {
      const list = sortedPresets();
      return `<div class="ptbl" data-part="プリセットの表"><table><thead><tr><th class="w-name">名前</th><th class="w-eng">エンジン</th><th class="w-ev">評価関数</th><th class="w-n r">候補手の数</th><th class="w-n r">Threads</th><th class="w-h r">Hash</th><th class="w-b">定跡</th><th class="w-o"></th></tr></thead><tbody>${list
        .map(
          (p, i) =>
            `<tr class="${i === applied() ? 'on' : ''}" tabindex="0" data-apply="${i}"><td class="w-name"><span class="pn" title="${h(p.label)}">${h(p.label)}</span>${stateTag(p, i)}</td><td>${longOr(p.engine, p.enginePath, '未設定')}<span class="ev2">${longOr(p.evalFile, p.evalPath, '評価関数を指定しない')}</span></td><td class="w-ev">${longOr(p.evalFile, p.evalPath, '指定しない')}</td><td class="r">${numCell(p.multiPv)}</td><td class="r">${numCell(p.threads)}</td><td class="r">${numCell(p.hash)}</td><td class="w-b">${p.book ? '<span>ON</span>' : '<span class="off">OFF</span>'}</td><td class="ra">${rowBtns(list.length)}</td></tr>`,
        )
        .join('')}</tbody></table></div>${note()}`;
    },

    // B: 一覧と中身。一覧にも数を出して、開かずに比べられるようにする
    b: () => {
      const list = sortedPresets();
      const at = applied();
      const p = list[at];
      const item = (k, v) => `<div class="dl"><dt>${k}</dt><dd>${v}</dd></div>`;
      const brief = (x) =>
        x.configured
          ? [['候補手', x.multiPv.value], ['Threads', x.threads.value], ['Hash', x.hash.value]].map(([k, v]) => `<i><em>${k}</em> ${h(v)}</i>`).join('')
          : '';
      return `<div class="md"><div class="mlist" data-part="プリセットの一覧">${list
        .map(
          (x, i) =>
            `<button type="button" class="mi${i === at ? ' on' : ''}" data-apply="${i}"><span class="mt"><span class="pn" title="${h(x.label)}">${h(x.label)}</span>${stateTag(x, i)}</span><span class="ms">${brief(x)}</span></button>`,
        )
        .join('')}</div>
        <div class="mdet" data-part="プリセットの中身"><div class="mh"><h4>${h(p.label)}</h4>${stateTag(p, at)}<span class="sp"></span>${rowBtns(list.length)}</div>
        <dl>${item('エンジン', p.engine ? `${longOr(p.engine, p.enginePath)}<small>${h(p.engineName)}</small>` : '<span class="off">未設定</span>')}
        ${item('評価関数', longOr(p.evalFile, p.evalPath, '指定しない'))}
        ${item('定跡', p.book ? `<span>ON</span><small>${soft(p.book)}</small>` : '<span class="off">OFF</span>')}</dl>
        <dl class="nums">${item('候補手の数', numCell(p.multiPv))}${item('Threads', numCell(p.threads))}${item('Hash', numCell(p.hash))}</dl>
        ${Number(p.multiPv.raw ?? p.multiPv.value) >= 2 ? `<p class="note">${NOTE}</p>` : ''}</div></div>`;
    },

    // C: プリセットを列、項目を行にして比べる
    c: () => {
      const list = sortedPresets();
      const line = (k, f, cls = '') => `<tr class="${cls}"><th scope="row">${k}</th>${list.map((p, i) => `<td class="${i === applied() ? 'on' : ''}" data-apply="${i}">${f(p, i)}</td>`).join('')}</tr>`;
      return `<div class="cmp" data-part="プリセットの比較表"><table style="--cols:${list.length}"><thead><tr><td></td>${list
        .map(
          (p, i) =>
            `<th class="${i === applied() ? 'on' : ''}" scope="col" tabindex="0" data-apply="${i}"><span class="pn" title="${h(p.label)}">${h(p.label)}</span><span class="tags">${stateTag(p, i)}</span></th>`,
        )
        .join('')}</tr></thead><tbody>
        ${line('', () => rowBtns(list.length), 'ops')}
        ${line('エンジン', (p) => longOr(p.engine, p.enginePath, '未設定'))}
        ${line('評価関数', (p) => longOr(p.evalFile, p.evalPath, '指定しない'))}
        ${line('定跡', (p) => (p.book ? 'ON' : '<span class="off">OFF</span>'))}
        ${line('候補手の数', (p) => numCell(p.multiPv), 'n')}
        ${line('Threads', (p) => numCell(p.threads), 'n')}
        ${line('Hash', (p) => numCell(p.hash), 'n')}
        </tbody></table></div><p class="cmpmore" data-count="${list.length}"></p>${note()}`;
    },

    // D: 名前と数を1段目に、綴りを下に。欄の左端を全部の行でそろえる
    d: () => {
      const list = sortedPresets();
      const kv = (k, v, cls = '') => `<span class="k">${k}</span><span class="v ${cls}">${v}</span>`;
      return `<div class="rows" data-part="プリセットの一覧"><div class="rh"><span>名前</span><span class="r">候補手の数</span><span class="r">Threads</span><span class="r">Hash</span><span></span></div>${list
        .map(
          (p, i) =>
            `<div class="pr1${i === applied() ? ' on' : ''}" tabindex="0" role="button" data-apply="${i}"><div class="p1"><span class="pn" title="${h(p.label)}">${h(p.label)}</span>${stateTag(p, i)}</div><span class="r">${numCell(p.multiPv)}</span><span class="r">${numCell(p.threads)}</span><span class="r">${numCell(p.hash)}</span>${rowBtns(list.length)}<div class="p2">${kv('エンジン', longOr(p.engine, p.enginePath, '未設定'), 'wide')}${kv('評価関数', longOr(p.evalFile, p.evalPath, '指定しない'))}${kv('定跡', longOr(p.book, p.bookPath, 'OFF'))}</div></div>`,
        )
        .join('')}</div>${note()}`;
    },
  };

  // ---- 設定（2周目）。箱を重ねず、見出し・行・線だけで組む ----

  const radioSeg = (list, on) =>
    `<div class="seg" role="radiogroup">${list.map((t) => `<button type="button" role="radio" aria-checked="${t === on}" class="${t === on ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const pairs = (list) => `<dl class="pairs">${list.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  const sec = (title, desc, body, { acts = '', mark: badge = '', cls = '' } = {}) =>
    `<section class="sec ${cls}" data-part="${h(title)}"><div class="sech"><h3>${h(title)}${badge}</h3>${acts ? `<div class="sacts">${acts}</div>` : ''}${desc ? `<p>${h(desc)}</p>` : ''}</div>${body}</section>`;
  const sbtn = (text, { cls = '', disabled = false, ic = '' } = {}) =>
    `<button type="button" class="bt sm ${cls}"${disabled ? ' disabled' : ''}>${ic ? icon(ic, 13) : ''}${h(text)}</button>`;
  const pathText = (p) => `<span class="long" title="${h(p)}">${soft(p)}</span>`;

  /** 詰み探索は数が増えないので上に置く。検討プリセットは増えるので下に置き、一覧だけを送る */
  const mateV2 = () =>
    sec(
      '詰み探索',
      '検討ペインの「詰み探索」で使うエンジンと時間です。',
      `<div class="mrow"><div class="mf"><label>詰み探索に使う</label><div class="sel"><span>${empty() ? '指定しない' : '詰将棋'}</span>${icon('down', 14)}</div></div><div class="mf"><label>上限時間</label>${radioSeg(['10秒', '30秒', '60秒', '無制限'], '30秒')}</div></div>${empty() ? '<p class="note">詰将棋エンジンのプリセットを選択してください。</p>' : ''}`,
      { cls: 'mate2' },
    );

  const nameLine = (p, i) => `<div class="l1"><span class="pn" title="${h(p.label)}">${h(p.label)}</span>${stateTag(p, i)}</div>`;

  const PRESET_LIST = {
    // D3: 1件を2段で。全部の欄を見せる
    f: (list) => `<div class="ph"><span>名前とエンジン</span><span class="h2">評価関数と定跡</span><span class="r">候補手の数</span><span class="r">Threads</span><span class="r">Hash</span><span></span></div>${list
      .map(
        (p, i) =>
          `<div class="prw${i === applied() ? ' on' : ''}" tabindex="0" role="button" data-apply="${i}"><div class="q1">${nameLine(p, i)}<div class="l2">${longOr(p.engine, p.enginePath, '未設定')}</div></div><div class="q2"><div class="l2 first">${longOr(p.evalFile, p.evalPath, '評価関数を指定しない')}</div><div class="l2">${p.book ? `<em>定跡</em> ${longOr(p.book, p.bookPath, '')}` : '<span class="off">定跡 OFF</span>'}</div></div><span class="r">${numCell(p.multiPv)}</span><span class="r">${numCell(p.threads)}</span><span class="r">${numCell(p.hash)}</span>${rowBtns(list.length)}</div>`,
      )
      .join('')}`,
    // D2: 1件を1行で。長い名前は2行まで折り、適用中の行は省かずに出す
    e: (list) => `<div class="ph"><span>名前</span><span>エンジン</span><span class="h2">評価関数</span><span>定跡</span><span class="r">候補手の数</span><span class="r">Threads</span><span class="r">Hash</span><span></span></div>${list
      .map(
        (p, i) =>
          `<div class="prw${i === applied() ? ' on' : ''}" tabindex="0" role="button" data-apply="${i}" title="${h([p.engine || '未設定', p.evalFile, p.book].filter(Boolean).join(' ／ '))}">${nameLine(p, i)}<span class="en">${longOr(p.engine, p.enginePath, '未設定')}</span><span class="en h2">${longOr(p.evalFile, p.evalPath, '指定しない')}</span><span class="bk2" title="${h(p.book || 'OFF')}">${p.book ? 'ON' : '<span class="off">OFF</span>'}</span><span class="r">${numCell(p.multiPv)}</span><span class="r">${numCell(p.threads)}</span><span class="r">${numCell(p.hash)}</span>${rowBtns(list.length)}</div>`,
      )
      .join('')}`,
  };

  const presetsV2 = () => {
    const list = sortedPresets();
    return `<section class="sec presets" data-part="検討プリセット"><div class="sech"><h3>検討プリセット<span class="cnt">${list.length}</span></h3>${secActions()}<p>${SECTION_DESC}</p></div><div class="plist" data-part="プリセットの一覧" tabindex="-1">${PRESET_LIST[S.p](list)}${note()}</div></section>`;
  };

  const workspacePane = () => {
    const ix = DATA.index[S.state] ?? DATA.index.idle;
    const shown = [...ix.warns].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'place' ? -1 : 1)).slice(0, 5);
    const rest = ix.warns.length - shown.length;
    const state = `<p class="word ${ix.ok || ix.idle ? '' : 'bad'}">${ix.ok || ix.idle ? '' : icon('warn', 14)}${h(ix.word)}</p>${pairs(ix.items.map(([k, v]) => [k, h(v)]))}${
      shown.length
        ? `<div class="wl"><h4>読み取り警告</h4>${rest > 0 ? `<p>ほか ${rest} 件（読めなかった場所を先に、${shown.length} 件だけ表示しています）</p>` : ''}<ul>${shown
            .map((w) => `<li><span>${h(w.message)}</span><span class="wp" title="${h(w.path)}">${soft(w.path)}</span></li>`)
            .join('')}</ul></div>`
        : ''
    }`;
    return (
      sec('状態', '局面検索インデックスの準備状況を表示します。', state, { acts: shown.length ? sbtn('警告をクリア') : '' }) +
      sec(
        '保存場所',
        '棋譜・ノート・タグなどのデータを保存する“Vault”です。通常は変更しません。',
        `<div class="folder"><div class="fl"><label>root_dir</label></div><div class="fp">${pathText(DATA.root)}</div><div class="fb">${sbtn('コピー', { ic: 'copy' })}</div></div><div class="risk"><p>変更すると参照先が切り替わるため、変更後はアプリを再読み込みします。</p>${sbtn('ワークスペースを変更…', { cls: 'dng' })}</div>`,
      ) +
      sec(
        '更新',
        'アプリ本体の更新を確認します。起動のたびに一度だけ自動で確認します。',
        pairs([
          ['現在のバージョン', h(DATA.version)],
          ['最後に確認できた', empty() ? DATA.checked.empty : DATA.checked.normal],
        ]),
        { acts: sbtn('更新を確認') },
      )
    );
  };

  const AI_NEXT = {
    ready: ['セットアップの土台は完成しています', 'エンジンと評価関数が見つかっています。プリセット作成に進めます。', [['もう一度読み込む', '']]],
    idle: ['AI ライブラリのフォルダを選択してください', 'エンジン・評価関数・定跡をまとめる専用フォルダを1つ選択するところから始まります。', [['フォルダを選択…', 'pri']]],
    error: ['フォルダを確認できませんでした', '', [['もう一度読み込む', 'pri'], ['選択…', '']]],
  };

  /** 置き方の説明。済んでいる間は閉じておく */
  const GUIDE = [
    ['engines/', 'エンジン実行ファイル', 'YaneuraOu-xxx', ''],
    ['＜AI 名＞/eval/', '評価関数', 'nn.bin', ''],
    ['＜AI 名＞/book/', '定跡ファイル', 'standard.db', '任意'],
  ];
  const STEPS = [
    ['AI ライブラリを選択', 'エンジン・評価関数・定跡をすべてまとめる専用フォルダを1つ選択します。既存フォルダでも新規フォルダでも構いません。'],
    ['engines/ フォルダを作成', 'エンジン実行ファイルをまとめる engines/ フォルダをボタンひとつで作成します。'],
    ['エンジン実行ファイルを配置', 'YaneuraOu などのエンジン実行ファイルを engines/ に配置してください。配置後にもう一度読み込みます。'],
    ['評価関数・定跡を配置', 'AI 名のフォルダを作成し、その中に eval/ と book/ を置きます。'],
  ];

  const aiPane = () => {
    const a = DATA.ai[S.state] ?? DATA.ai.idle;
    const done = a.scan === 'ready';
    const badge = a.scan === 'error' ? ['エラー', 'bad'] : !a.root ? ['未設定', 'warn'] : a.warnings.length ? ['注意あり', 'warn'] : null;
    const [title, desc, buttons] = AI_NEXT[a.scan];
    const open = !done;
    const fold = (name, text, body) =>
      `<section class="sec fold${open ? ' open' : ''}" data-part="${name}"><button type="button" class="fh" aria-expanded="${open}">${icon(open ? 'down' : 'right', 14)}<h3>${name}</h3><p>${text}</p></button>${open ? body : ''}</section>`;
    return (
      sec(
        'AI ライブラリ',
        'エンジン本体・評価関数・定跡DBをまとめて管理する場所です（推奨：専用フォルダを1つ作成して固定）。',
        `<div class="folder"><div class="fl"><label>フォルダ</label><p>決めたルールのフォルダ構成でファイルを置くと自動検出します。</p></div><div class="fp${a.root ? '' : ' none'}">${a.root ? pathText(a.root) : '未設定（選択… からフォルダを選択してください）'}</div><div class="fb">${sbtn('選択…', { ic: 'folderOpen' })}${sbtn('開く', { disabled: !a.root })}${sbtn('engines/ を開く', { disabled: !done })}${btn('copy', 'パスをコピー', { size: 15, disabled: !a.root })}</div></div>`,
        { mark: badge ? `<span class="tag ${badge[1]}">${icon('warn', 12)}${badge[0]}</span>` : '' },
      ) +
      (a.warnings.length ? sec('検出された問題', '', `<ul class="wl2">${a.warnings.map((w) => `<li>${icon('warn', 13)}<span>${h(w)}</span></li>`).join('')}</ul>`) : '') +
      sec(
        '次にやること',
        '',
        `<div class="nx"><div><b>${title}</b><p>${h(a.error || desc)}</p></div><div class="sacts">${buttons.map(([t, c]) => sbtn(t, { cls: c })).join('')}</div></div>`,
      ) +
      sec(
        '現在の状態',
        '読み込んだ結果をリアルタイムで反映しています。',
        `${pairs([
          ['AI ライブラリ', a.root ? '設定済み' : '未設定'],
          ['engines フォルダ', done ? 'あり' : '—'],
          ['エンジン', done ? `${a.engines.length} 件` : '—'],
          ['AI フォルダ', done ? `${a.profiles.length} 件` : '—'],
        ])}${
          done
            ? `<table class="found" data-part="検出されたもの"><tbody>${a.engines
                .map((e, i) => `<tr><th scope="row">${i === 0 ? 'エンジン' : ''}</th><td colspan="2">${soft(e)}</td></tr>`)
                .join('')}${a.profiles
                .map((p, i) => `<tr><th scope="row">${i === 0 ? '検出されたAI' : ''}</th><td title="${h(p.path)}">${h(p.name)}</td><td class="has"><span>評価関数 ${p.hasEval ? 'あり' : '不足'}</span><span class="${p.hasBook ? '' : 'off'}">定跡 ${p.hasBook ? 'あり' : '未設定'}</span></td></tr>`)
                .join('')}</tbody></table>`
            : ''
        }`,
      ) +
      (done
        ? sec(
            'AI フォルダを追加',
            'AI 名を入力すると eval/ と book/ をまとめて作成します。',
            `<div class="add"><label>AI 名</label><div class="inp">AI 名を入力</div>${sbtn('作成', { disabled: true })}<p>例: Suisho / 研究用A</p></div>`,
          )
        : '') +
      fold(
        'フォルダ構成',
        'この構造でファイルを置くと自動検出されます。',
        `<table class="found guide"><tbody>${GUIDE.map(([p, r, e, o]) => `<tr><th scope="row">${h(p)}</th><td>${r}${o ? `<span class="tag">${o}</span>` : ''}</td><td class="off">${e}</td></tr>`).join('')}</tbody></table>`,
      ) +
      fold('セットアップ手順', '手順ごとに操作できます。', `<ol class="steps">${STEPS.map(([t, d], i) => `<li class="${i === 0 ? 'on' : ''}"><b>${t}</b><p>${d}</p>${i === 0 ? sbtn('フォルダを選択…', { ic: 'folderOpen' }) : ''}</li>`).join('')}</ol>`)
    );
  };

  const check = (on, text, { note: extra = '', disabled = false } = {}) =>
    `<label class="ckb${on ? ' on' : ''}${disabled ? ' dis' : ''}"><i>${on ? icon('check', 12) : ''}</i><span>${text}</span>${extra ? `<small>${extra}</small>` : ''}</label>`;
  const radio = (on, text, extra) => `<label class="rdb${on ? ' on' : ''}"><i></i><span>${text}</span><small>${extra}</small></label>`;
  const skeleton = (kind) =>
    kind === 'table'
      ? `<span class="sk t" aria-hidden="true">${[0, 1, 2, 3].map((r) => `<span class="${r === 1 ? 'b' : r === 0 ? 'h' : ''}"><i></i><i></i><i></i></span>`).join('')}</span>`
      : `<span class="sk r" aria-hidden="true">${[0, 1, 2, 3].map((r) => `<span class="${r === 0 ? 'b' : ''}"><i></i></span>`).join('')}</span>`;

  const displayPane = () =>
    sec(
      'ドックのタブ',
      '盤の下のドックに出す面と、その並び順',
      `<ul class="order">${['検討', '定跡']
        .map((t, i) => `<li>${check(true, t, i === 0 ? { note: '外せません', disabled: true } : {})}<span class="mvs">${btn('up', `${t}を上へ`, { size: 15, disabled: i === 0 })}${btn('down', `${t}を下へ`, { size: 15, disabled: i === 1 })}</span></li>`)
        .join('')}</ul>`,
    ) +
    sec('起動時に開くタブ', '', `<div class="rds">${radio(true, '前回のもの', '最後に見ていたタブを開く')}${radio(false, '決めておく', 'いつも同じタブを開く')}</div>`) +
    sec(
      '検討ビュー',
      'ドックの検討タブに出るもの',
      `<h4>候補手の見せ方</h4><div class="rds two">${radio(true, '表', `${skeleton('table')}評価値と読み筋が列で揃う`)}${radio(false, '行', `${skeleton('rows')}1手1行で詰める`)}</div><p class="note">どちらの見せ方でも最善手は1行目に出ます。</p><div class="gap">${check(false, '評価値バーを出す')}<p class="note in">目盛が ±3000 の線形で勝率と対応しないため、初期値では出しません。</p></div>`,
    );

  const PANES = {
    workspace: () => `<div class="mmain">${workspacePane()}</div>`,
    ai: () => `<div class="mmain">${aiPane()}</div>`,
    engine: () => `<div class="mmain fix">${mateV2()}${presetsV2()}</div>`,
    display: () => `<div class="mmain">${displayPane()}</div>`,
  };

  const settings = () => `<div class="ovl"><div class="modal" role="dialog" aria-modal="true" aria-label="設定" data-part="設定のモーダル">
    <header class="mhd"><h2>設定</h2>${btn('close', '閉じる', { size: 16 })}</header>
    <div class="mbody">${settingsNav()}${isV2() ? PANES[S.screen]() : `<div class="mmain"><section class="sec" data-part="検討プリセット"><div class="sech"><h3>検討プリセット</h3>${secActions()}<p>${SECTION_DESC}</p></div>${PRESETS[S.p]()}</section>${mateSection()}</div>`}</div>
  </div></div>`;

  // ---- 描いた後の仕上げ ----

  /** 縦の列の読み筋（案B）。5本が全部見えるように、1本あたりの行数を列の高さから決める */
  function fitStack() {
    const list = root.querySelector('ol.pvs');
    if (!list) return;
    const lines = Math.floor((list.clientHeight / list.children.length - 15) / 20);
    list.style.setProperty('--lines', Math.max(1, lines));
  }

  /** 変化の手を、手の途中で切らずに入る分だけ出す。入らない分は数にする */
  function fitForks() {
    for (const el of root.querySelectorAll('.xf')) {
      const kids = [...el.querySelectorAll('.xt')];
      const right = el.parentElement.getBoundingClientRect().right;
      const fits = (k, spare) => k.getBoundingClientRect().right <= right - spare;
      if (el.offsetParent === null || kids.every((k) => fits(k, 0))) continue;
      const over = kids.filter((k) => !fits(k, 24));
      for (const k of over) k.remove();
      const rest = document.createElement('span');
      rest.textContent = over.length === kids.length ? String(over.length) : `+${over.length}`;
      el.append(rest);
    }
  }

  /** プリセットの比較（案C）。列が途中で切れない幅にそろえ、見えていない列を数で知らせる */
  function fitCompare() {
    const box = root.querySelector('.cmp');
    if (!box) return;
    const total = Number(root.querySelector('.cmpmore').dataset.count);
    const seen = Math.min(total, Math.floor((box.clientWidth - 96) / 176));
    const width = Math.floor((box.clientWidth - 96) / seen);
    box.querySelector('table').style.width = `${96 + width * total}px`;
    root.querySelector('.cmpmore').textContent = total > seen ? `ほか ${total - seen} 件は、横に続きます。` : '';
  }

  /** 続きがある一覧の下端を薄くして、途中で切れていることを知らせる */
  function markMore() {
    for (const el of root.querySelectorAll('.mmain:not(.fix), .plist')) {
      const update = () => el.classList.toggle('more', el.scrollHeight - el.scrollTop - el.clientHeight > 8);
      el.addEventListener('scroll', update, { passive: true });
      update();
    }
  }

  /** 読み筋を、手の途中で切らずに行数へ収める。続きがあれば … を付ける */
  function fitPv() {
    for (const el of root.querySelectorAll('.pv')) {
      const lines = Number(getComputedStyle(el).getPropertyValue('--lines')) || 0;
      if (lines === 0 || el.children.length === 0) continue;
      const lh = el.children[0].offsetHeight;
      // 行数が減ると箱が縦の中央へ寄り直すので、先頭との差で数える
      const rowOf = (k) => Math.round((k.offsetTop - el.children[0].offsetTop) / lh);
      const cut = [...el.children].findIndex((k) => rowOf(k) >= lines);
      if (cut < 0) continue;
      for (const k of [...el.children].slice(cut)) k.remove();
      const dots = document.createElement('span');
      dots.className = 'mv dots';
      dots.textContent = '…';
      el.append(dots);
      while (rowOf(dots) >= lines && el.children.length > 2) el.children[el.children.length - 2].remove();
    }
  }

  /** 棋譜の流し。列の幅から1行の手数（偶数）を決め、行の頭に手数を出す */
  function layoutFlow() {
    const grid = root.querySelector('.fgrid');
    if (!grid) return;
    const per = Math.max(2, 2 * Math.floor((grid.clientWidth + 0.5) / (2 * 92)));
    grid.style.gridTemplateColumns = `repeat(${per}, minmax(0, 1fr))`;
    let col = 0;
    for (const cell of grid.children) {
      const wide = cell.querySelector('.fm').scrollWidth + 10 * cell.querySelectorAll('.fi').length > grid.clientWidth / per - 8;
      const span = wide ? 2 : 1;
      if (col + span > per) col = 0;
      cell.style.gridColumn = `${col + 1} / span ${span}`;
      if (col === 0) cell.dataset.head = cell.dataset.ply;
      col = (col + span) % per;
    }
  }

  /** いまの手の行を真ん中に。行の途中で切れないように、行の高さの倍数でそろえる */
  function centerRow() {
    const row = root.querySelector(`#k${S.ply}`);
    const list = row?.closest('.klist, .flow');
    if (!row || !list) return;
    const rh = Number.parseFloat(getComputedStyle(row).getPropertyValue('--rh')) || row.offsetHeight;
    const target = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
    list.scrollTop = Math.max(0, Math.round(target / rh) * rh);
  }

  // ---- 描く ----

  const root = document.getElementById('proto');

  function render() {
    document.documentElement.dataset.theme = S.theme;
    document.documentElement.dataset.p = S.p;
    const withSettings = S.screen !== 'main';
    if (S.plyTouched !== true) S.ply = START_PLY[S.state] ?? 24;
    S.ply = Math.min(S.ply, kifu().rows.length - 1);
    root.className = `app ${isV2() ? 'd v2 ' : ''}${S.p} t-${S.p === 'a' ? 'c4' : 'ink'}${withSettings ? ' has-modal' : ''}`;
    const { head, body } = MAIN[S.p]();
    const onList = Boolean(document.activeElement?.closest('.klist'));
    root.innerHTML = `${head}<div class="body">${body}${withSettings ? settings() : ''}</div>`;
    if (onList) focusList();
    fitStack();
    fitPv();
    fitForks();
    fitCompare();
    markMore();
    layoutFlow();
    centerRow();
  }

  function focusList() {
    root.querySelector('.klist')?.focus({ preventScroll: true });
  }

  function setPly(n) {
    S.ply = Math.max(0, Math.min(n, kifu().rows.length - 1));
    S.plyTouched = true;
    root.removeAttribute('data-pointing');
    render();
  }

  // 止まったポインタの下の行は、ホバーにしない。座標が変わったら動いたと見なす
  let pointerAt = '';
  root.setAttribute('data-pointing', '');
  root.addEventListener('pointermove', (e) => {
    const at = `${e.clientX},${e.clientY}`;
    if (at === pointerAt) return;
    pointerAt = at;
    root.setAttribute('data-pointing', '');
  });

  root.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      const last = kifu().rows.length - 1;
      setPly({ first: 0, prev: S.ply - 1, next: S.ply + 1, last }[go.dataset.go]);
      return;
    }
    if (e.target.closest('[data-toggle]')) {
      S.sidebar = !S.sidebar;
      render();
      return;
    }
    const more = e.target.closest('[data-more]');
    if (more) {
      const i = Number(more.dataset.more);
      S.more = S.more === i ? -1 : i;
      render();
      return;
    }
    const preset = e.target.closest('[data-apply]');
    if (preset && !e.target.closest('.rb')) {
      S.applied = Number(preset.dataset.apply);
      render();
      return;
    }
    const dirEl = e.target.closest('[data-dir]');
    if (dirEl && dirEl.dataset.dir) {
      const key = dirEl.dataset.dir;
      if (S.open.has(key)) S.open.delete(key);
      else S.open.add(key);
      render();
      return;
    }
    const row = e.target.closest('[data-ply]');
    if (row && !e.target.closest('.mini, .xf, .xc')) setPly(Number(row.dataset.ply));
  });

  // 製品のキー操作（docs/spec/screens/app-layout.md の「キー操作」）と同じ割り当て
  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || S.screen !== 'main' || empty()) return;
    const onList = document.activeElement?.closest('.klist');
    const to = { ArrowLeft: S.ply - 1, ArrowRight: S.ply + 1, Home: 0, End: kifu().rows.length - 1, ...(onList ? { ArrowUp: S.ply - 1, ArrowDown: S.ply + 1 } : {}) }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    focusList();
    setPly(to);
  });

  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  });

  const change = (next) => {
    if (next.state && next.state !== S.state) {
      S.plyTouched = false;
      S.more = -1;
      S.applied = 0;
    }
    Object.assign(S, next);
    render();
  };
  window.addEventListener('hashchange', () => change(readHash()));

  // 見比べる側から、指した所が何かを聞く
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'obs-part') return;
    const el = document.elementFromPoint(m.x, m.y);
    const part = el?.closest('[data-part]')?.dataset.part ?? '';
    const own = el?.closest('button, td, th, .krow, .node, .pr1, .fcell, .name, p, h2, h3');
    const text = (own?.getAttribute('aria-label') || own?.title || own?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    e.source.postMessage({ type: 'obs-part-reply', id: m.id, part, text }, '*');
  });

  window.__setProto = change;
  render();
  document.fonts?.ready.then(render);
})();
