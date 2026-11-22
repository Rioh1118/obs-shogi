// 描かれた画面から、崩れを数える。ページの中で走る（`page.evaluate`）。
// **この関数は文字列にしてページへ渡るので、外の変数を見ない。**
//
// 見るもの（kind）:
//   outside   文字が、線か色で描かれた箱の外へ出ている
//   cut       文字が切れていて、省略記号も出ない
//   squeezed  値・札・ボタンの短い文字が、幅が足りずに折り返している
//   noReveal  省略されているのに、全文を読む手段（title）が無い
//   overlap   別々の文字どうしか、文字と隣の塗った箱が重なっている
//   touch     別々の欄の文字が、間を空けずに接している（「33,554,432 MB」と「ON」）
//   lost      選ばれている手の行が、一覧の見える範囲に無い
//   offscreen 押せるものが画面の外にある（スクロールでも届かない）
//   covered   押せるものか文字が、浮いた箱（通知など。押して開いたものは除く）か、隣の塗った箱に覆われている
//   nested    枠のある角丸の箱が3重以上に入れ子になっている
//   gradient  背景にグラデーションが敷かれている（盤と駒の画像は除く）
//   sideBar   角丸の箱の片側にだけ棒が立っている（枠・影・擬似要素）
//   contrast  文字と地の明るさの差が足りない（4.5:1、大きい文字は 3:1）。押せない状態の文字と、画像の上の文字は除く
//   tiny      文字が下限（11px）より小さい

export function measureScreen(opts = {}) {
  const TOL = 1.5;
  const SHORT = opts.shortText ?? 18;
  const findings = [];

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const style = (el) => window.getComputedStyle(el);

  const alpha = (color) => {
    if (!color || color === 'transparent') return 0;
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(/[,/]\s*|\s+/).filter(Boolean);
      return parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;
    }
    const s = color.match(/\/\s*([\d.]+)\s*\)/);
    return s ? Number.parseFloat(s[1]) : 1;
  };

  const pathOf = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 4) {
      const cls = typeof cur.className === 'string' ? cur.className.trim().split(/\s+/)[0] : '';
      parts.unshift(cls ? `.${cls}` : cur.tagName.toLowerCase());
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };

  const isVisible = (el) => {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const s = style(cur);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
      cur = cur.parentElement;
    }
    return true;
  };

  // 描かれている角丸か枠の箱か（線か色を持つ）
  const paintsBox = (el) => {
    const s = style(el);
    const bordered = ['Top', 'Right', 'Bottom', 'Left'].filter(
      (side) =>
        Number.parseFloat(s[`border${side}Width`]) > 0 &&
        s[`border${side}Style`] !== 'none' &&
        alpha(s[`border${side}Color`]) > 0.03,
    );
    const filled = alpha(s.backgroundColor) > 0.03 || s.backgroundImage !== 'none';
    return { bordered: bordered.length, filled };
  };

  const isClipped = (s) => /(hidden|clip|auto|scroll)/.test(`${s.overflowX}`);
  const scrollsY = (s) => /(auto|scroll)/.test(s.overflowY);
  const scrollsX = (s) => /(auto|scroll)/.test(s.overflowX);

  // 開いているモーダルの下は測らない（同じ崩れを2度数えないため）。知らせはモーダルより上に出るので測る
  const FLOATING = '.notice-layer, .updater-overlay, .toasts';
  const scope = [...document.querySelectorAll('[aria-modal="true"]')].at(-1) ?? null;
  const inScope = (el) => !scope || scope.contains(el) || !!el.closest(FLOATING);

  const boardArea = (el) =>
    !!el.closest('.board-container, .hand-container, .board-preview__container, .editor-board, canvas');

  // 文字のある要素を集める
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.nodeValue.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue;
    if (!inScope(el) || !isVisible(el) || boardArea(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    if (rects.length === 0) continue;
    const box = {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
    texts.push({ node, el, text, rects, box });
  }

  const push = (kind, el, text, extra = {}) =>
    findings.push({ kind, path: pathOf(el), text: text.slice(0, 60), ...extra });

  // 見える範囲。切り取る祖先と窓の内側だけに縮める
  const clipRect = (el, rect) => {
    const r = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    let cur = el;
    while (cur && cur !== document.body) {
      const s = style(cur);
      if (isClipped(s) || /(hidden|clip|auto|scroll)/.test(s.overflowY)) {
        const b = cur.getBoundingClientRect();
        r.left = Math.max(r.left, b.left);
        r.top = Math.max(r.top, b.top);
        r.right = Math.min(r.right, b.right);
        r.bottom = Math.min(r.bottom, b.bottom);
      }
      cur = cur.parentElement;
    }
    r.left = Math.max(r.left, 0);
    r.top = Math.max(r.top, 0);
    r.right = Math.min(r.right, vw);
    r.bottom = Math.min(r.bottom, vh);
    return r;
  };
  const visibleRect = (t) => clipRect(t.el, t.box);
  for (const t of texts) t.visible = visibleRect(t);
  const shown = texts.filter(
    (t) => t.visible.right - t.visible.left > 2 && t.visible.bottom - t.visible.top > 2,
  );

  for (const t of shown) {
    const { el, text, box, rects } = t;

    // 省略（ellipsis）の有無と、切り取り
    let cur = el;
    let handled = false;
    let reachableX = false;
    let reachableY = false;
    while (cur && cur !== document.body && !handled) {
      const s = style(cur);
      const clipX = isClipped(s);
      if (scrollsX(s) && cur.scrollWidth > cur.clientWidth + 1) reachableX = true;
      if (scrollsY(s)) reachableY = true;
      if (clipX && !scrollsX(s) && !reachableX) {
        const overX = cur.scrollWidth - cur.clientWidth;
        const b = cur.getBoundingClientRect();
        const cutX = box.right - b.right > TOL || b.left - box.left > TOL;
        if (overX > TOL && cutX) {
          const ellipsis = s.textOverflow === 'ellipsis';
          const clamped = s.webkitLineClamp && s.webkitLineClamp !== 'none';
          if (ellipsis || clamped) {
            const reveal = cur.closest('[title]')?.getAttribute('title') || el.closest('[title]')?.getAttribute('title');
            // 読み筋は、全文へ届く手段を持たないと決めている（製品の docs/decisions/0010 の決定2）
            const isReadingLine = !!cur.closest('.candidate-table__pv, .move-sequence__pv');
            const hasReveal = !!reveal || isReadingLine || !!cur.closest('[data-reveal]');
            if (!hasReveal) push('noReveal', cur, text, { over: Math.round(overX) });
          } else {
            push('cut', cur, text, { over: Math.round(box.right - b.right) });
          }
          handled = true;
        }
      }
      if (/(hidden|clip)/.test(s.overflowY) && !scrollsY(s) && !reachableY) {
        const b = cur.getBoundingClientRect();
        const cutY = box.bottom - b.bottom > 3 || b.top - box.top > 3;
        const clamped = s.webkitLineClamp && s.webkitLineClamp !== 'none';
        if (cutY && !clamped && box.bottom - box.top < 60) {
          push('cut', cur, text, { overY: Math.round(Math.max(box.bottom - b.bottom, b.top - box.top)) });
          handled = true;
        }
      }
      cur = cur.parentElement;
    }

    // いちばん近い描かれた箱から出ているか
    let host = el;
    while (host && host !== document.body) {
      const p = paintsBox(host);
      const s = style(host);
      const inline = s.display === 'inline';
      if (!inline && (p.bordered >= 2 || (p.filled && Number.parseFloat(s.borderTopLeftRadius) > 0))) break;
      if (scrollsX(s) || scrollsY(s)) {
        host = null;
        break;
      }
      host = host.parentElement;
    }
    if (host && host !== document.body && !handled) {
      const b = host.getBoundingClientRect();
      const s = style(host);
      const clippedHere = isClipped(s) || /(hidden|clip)/.test(s.overflowY);
      const dx = Math.max(t.visible.right - b.right, b.left - t.visible.left);
      const dy = Math.max(t.visible.bottom - b.bottom, b.top - t.visible.top);
      if (!clippedHere && (dx > TOL || dy > TOL)) {
        push('outside', host, text, { dx: Math.round(dx), dy: Math.round(dy) });
      }
    }

    // 短い文字の折り返し
    const lines = [];
    for (const r of rects) {
      if (!lines.some((y) => Math.abs(y - r.top) < 3)) lines.push(r.top);
    }
    // 折ってよいと印（wbr、data-wrap）の付いた綴りは除く
    if (lines.length >= 2 && text.length <= SHORT && !/[。、]/.test(text) && !el.querySelector('wbr') && !el.closest('[data-wrap]')) {
      const s = style(el);
      const prose = ['P', 'LI', 'DD', 'PRE'].includes(el.tagName) && text.length > 12;
      if (!prose && s.whiteSpace !== 'pre' && s.whiteSpace !== 'pre-wrap') {
        push('squeezed', el, text, { lines: lines.length, width: Math.round(el.getBoundingClientRect().width) });
      }
    }
  }

  // 文字がいくつかの要素に分かれた短い語（「手数 24/112」）の折り返し。まとまりの箱ごとに数える
  const blockOf = (el) => {
    let cur = el;
    while (cur.parentElement && style(cur).display === 'inline') cur = cur.parentElement;
    return cur;
  };
  const blocks = new Map();
  for (const t of shown) {
    const b = blockOf(t.el);
    if (!blocks.has(b)) blocks.set(b, []);
    blocks.get(b).push(t);
  }
  for (const [block, list] of blocks) {
    if (list.length < 2 || block.querySelector('br, wbr') || block.closest('[data-wrap]')) continue;
    const text = list.map((t) => t.text).join(' ');
    if (text.length > SHORT || /[。、]/.test(text) || /^pre/.test(style(block).whiteSpace)) continue;
    const tops = [];
    for (const r of list.flatMap((t) => t.rects)) if (!tops.some((y) => Math.abs(y - r.bottom) < 5)) tops.push(r.bottom);
    if (tops.length >= 2) push('squeezed', block, text, { lines: tops.length, width: Math.round(block.getBoundingClientRect().width) });
  }

  // 重なって当然の層（モーダル、メニュー、通知）。層が違うものどうしは比べない
  const LAYERS =
    '[role="dialog"], [role="menu"], [role="tooltip"], .modal, .notice-layer, .updater-overlay, .floating-note, .toasts, .ovl';
  const layerOf = (el) => el.closest(LAYERS);

  /** el から、other と共通の祖先の手前までに、地を塗る箱があるか */
  const paintsUpTo = (el, other) => {
    for (let cur = el; cur && !cur.contains(other); cur = cur.parentElement) {
      const s = style(cur);
      if (alpha(s.backgroundColor) > 0.5 || s.backgroundImage !== 'none') return true;
    }
    return false;
  };

  // 文字どうしの重なり
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) {
      const a = shown[i];
      const b = shown[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (layerOf(a.el) !== layerOf(b.el)) continue;
      const w = Math.min(a.visible.right, b.visible.right) - Math.max(a.visible.left, b.visible.left);
      const h = Math.min(a.visible.bottom, b.visible.bottom) - Math.max(a.visible.top, b.visible.top);
      if (w <= 3 || h <= 4) continue;
      // 前に出ている側が地を塗っていれば、後ろの文字は隠れるだけで重ならない（固定の見出しの下を流れる行など）
      const mx = Math.max(a.visible.left, b.visible.left) + w / 2;
      const my = Math.max(a.visible.top, b.visible.top) + h / 2;
      const top = document.elementFromPoint(mx, my);
      if (!top) continue;
      const aOnTop = a.el === top || a.el.contains(top) || top.contains(a.el);
      const bOnTop = b.el === top || b.el.contains(top) || top.contains(b.el);
      if (!aOnTop && !bOnTop) continue;
      if (!(aOnTop && bOnTop) && paintsUpTo(aOnTop ? a.el : b.el, aOnTop ? b.el : a.el)) continue;
      push('overlap', a.el, `${a.text.slice(0, 20)} × ${b.text.slice(0, 20)}`, { w: Math.round(w), h: Math.round(h) });
    }
  }

  // 文字と、別の部品の記号の重なり
  const marks = [...document.querySelectorAll('svg')]
    .filter((g) => isVisible(g) && !boardArea(g))
    .map((g) => ({ g, r: clipRect(g.parentElement, g.getBoundingClientRect()) }))
    .filter(({ r }) => r.right - r.left > 4 && r.bottom - r.top > 4);
  for (const t of shown) {
    for (const { g, r } of marks) {
      const host = g.closest('button, a, [role="button"]') ?? g.parentElement;
      if (host.contains(t.el) || t.el.contains(g)) continue;
      if (layerOf(host) !== layerOf(t.el)) continue;
      const w = Math.min(t.visible.right, r.right) - Math.max(t.visible.left, r.left);
      const hgt = Math.min(t.visible.bottom, r.bottom) - Math.max(t.visible.top, r.top);
      if (w <= 3 || hgt <= 4) continue;
      const top = document.elementFromPoint(Math.max(t.visible.left, r.left) + w / 2, Math.max(t.visible.top, r.top) + hgt / 2);
      if (!top) continue;
      const related = top === g || g.contains(top) || host === top || host.contains(top) || t.el === top || t.el.contains(top);
      if (!related) continue;
      push('overlap', t.el, `${t.text.slice(0, 20)} × 記号（${host.getAttribute('aria-label') || host.title || pathOf(host)}）`, { w: Math.round(w), h: Math.round(hgt) });
    }
  }

  // 別々の欄（表のセル、格子の欄、ボタン）の文字が接している
  const cellOf = (el) => {
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.tagName === 'BUTTON' || style(cur).display === 'table-cell') return cur;
      if (cur.parentElement && /grid/.test(style(cur.parentElement).display)) return cur;
      cur = cur.parentElement;
    }
    return null;
  };
  const cells = shown.map((t) => cellOf(t.el));
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) {
      const [ca, cb] = [cells[i], cells[j]];
      if (!ca || !cb || ca === cb || ca.contains(cb) || cb.contains(ca)) continue;
      const first = shown[i].visible.left <= shown[j].visible.left ? 0 : 1;
      const [a, b] = first === 0 ? [shown[i], shown[j]] : [shown[j], shown[i]];
      const [left, right] = first === 0 ? [ca, cb] : [cb, ca];
      const gap = b.visible.left - a.visible.right;
      const h = Math.min(a.visible.bottom, b.visible.bottom) - Math.max(a.visible.top, b.visible.top);
      const short = Math.min(a.visible.bottom - a.visible.top, b.visible.bottom - b.visible.top);
      if (gap < -4 || gap >= 4 || h < short * 0.6) continue;
      const ruled = Number.parseFloat(style(left).borderRightWidth) > 0 || Number.parseFloat(style(right).borderLeftWidth) > 0;
      if (ruled || layerOf(a.el) !== layerOf(b.el)) continue;
      push('touch', a.el, `${a.text.slice(0, 20)} | ${b.text.slice(0, 20)}`, { gap: Math.round(gap) });
    }
  }

  // 選ばれている手の行が見えない
  for (const row of document.querySelectorAll('.kifu-row--active, .krow.on, .fcell.on')) {
    if (!inScope(row) || !isVisible(row)) continue;
    const r = row.getBoundingClientRect();
    const v = clipRect(row.parentElement, r);
    if (v.bottom - v.top < r.height * 0.8) push('lost', row, row.textContent.trim().slice(0, 20));
  }

  // 届かない押せるもの
  const focusables = document.querySelectorAll(
    'button, a[href], input, select, textarea, [role="button"], [tabindex="0"], .node-box, .kifu-row, .krow',
  );
  /** その点で el を覆っている、浮いた箱。押して開いたもの（メニュー、対話、吹き出し）は数えない */
  const coverOf = (el, x, y) => {
    const top = document.elementFromPoint(x, y);
    if (!top || top === el || el.contains(top) || top.contains(el)) return null;
    let box = top;
    while (box && box !== document.body && !/fixed|absolute/.test(style(box).position)) box = box.parentElement;
    if (!box || box === document.body || box.contains(el)) return null;
    const invited = box.closest('[role="menu"], [role="dialog"], [role="tooltip"], [class*="pop"], [class*="menu"], [class*="note"]:not([class*="notice"])');
    // 同じ対話の中で覆っているなら、押して開いたものではない
    return invited && !invited.contains(el) ? null : box;
  };
  /** その点で el の下にある、祖先でない塗られた箱。文字が別の箱の上に乗っている（帯が評価値バーに重なる） */
  const paintedUnder = (el, x, y) => {
    const stack = document.elementsFromPoint(x, y);
    const own = stack.findIndex((hit) => hit === el || el.contains(hit));
    // 上に載っている箱は数えない。その点の文字は覆われている（`coverOf` と `hiddenBy` が見る）
    if (own === -1) return null;
    for (const under of stack.slice(own)) {
      if (under === el || under.contains(el) || el.contains(under)) {
        // 自分か祖先が塗っていれば、そこから下は見えない
        if (alpha(style(under).backgroundColor) > 0.5 || style(under).backgroundImage !== 'none') return null;
        continue;
      }
      if (boardArea(under) || under.closest('.board, .hand, .strip')) return null;
      const s = style(under);
      if (alpha(s.backgroundColor) > 0.5) {
        // 貼り付いた見出しの帯のように、文字の列と同じ段に敷いた地は数えない
        const b = under.getBoundingClientRect();
        const t = el.getBoundingClientRect();
        if (b.top <= t.top + 1 && b.bottom >= t.bottom - 1) return null;
        return under;
      }
    }
    return null;
  };
  /**
   * その点で el を隠している、塗られた箱。浮いていなくても数える（縮んだ段の文が、次の段の見出しの下に隠れる）。
   * 同じ一覧の中で貼り付いた見出しが、送った行を隠すのは数えない
   */
  const hiddenBy = (el, x, y) => {
    const top = document.elementFromPoint(x, y);
    if (!top || top === el || el.contains(top) || top.contains(el)) return null;
    let painted = null;
    let stuck = null;
    for (let cur = top; cur && cur !== document.body && !cur.contains(el); cur = cur.parentElement) {
      const s = style(cur);
      if (!painted && (alpha(s.backgroundColor) > 0.5 || s.backgroundImage !== 'none')) painted = cur;
      if (s.position === 'sticky') stuck = cur;
    }
    if (!painted) return null;
    const invited = painted.closest('[role="menu"], [role="dialog"], [role="tooltip"]');
    if (invited && !invited.contains(el)) return null;
    if (stuck) {
      let host = stuck.parentElement;
      while (host && host !== document.body && !scrollsY(style(host)) && !scrollsX(style(host))) host = host.parentElement;
      if (host && host.contains(el)) return null;
    }
    return painted;
  };
  for (const t of shown) {
    const v = t.visible;
    const x = (v.left + v.right) / 2;
    const at = (f) => v.top + (v.bottom - v.top) * f;
    const over = coverOf(t.el, x, at(0.5)) ?? [0.2, 0.5, 0.8].map((f) => hiddenBy(t.el, x, at(f))).find(Boolean);
    if (over) push('covered', t.el, `${t.text.slice(0, 20)} ← ${pathOf(over)}`);
    const under = [0.1, 0.5, 0.9].map((f) => paintedUnder(t.el, v.left + (v.right - v.left) * f, at(0.5))).find(Boolean);
    if (under) push('overlap', t.el, `${t.text.slice(0, 20)} × ${pathOf(under)}`);
  }
  for (const el of focusables) {
    if (!inScope(el) || !isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx > 0 && cy > 0 && cx < vw && cy < vh) {
      const over = coverOf(el, cx, cy);
      if (over) {
        // 切り取られて見えていないだけの行は数えない
        let clippedAway = false;
        let cur = el.parentElement;
        while (cur && cur !== document.body) {
          const cs = style(cur);
          if (/(hidden|clip|auto|scroll)/.test(cs.overflowY)) {
            const b = cur.getBoundingClientRect();
            if (cy < b.top || cy > b.bottom) clippedAway = true;
          }
          cur = cur.parentElement;
        }
        if (!clippedAway) push('covered', el, `${el.getAttribute('aria-label') || el.title || el.textContent.trim().slice(0, 20)} ← ${pathOf(over)}`);
      }
    }
    const out = r.right > vw + TOL || r.bottom > vh + TOL || r.left < -TOL || r.top < -TOL;
    if (!out) continue;
    let reachable = false;
    let cur = el.parentElement;
    while (cur && cur !== document.body) {
      const s = style(cur);
      if (scrollsY(s) || scrollsX(s)) {
        reachable = true;
        break;
      }
      cur = cur.parentElement;
    }
    if (!reachable) push('offscreen', el, el.getAttribute('aria-label') || el.title || el.textContent.trim() || el.tagName);
  }

  // 入れ子の箱・グラデーション・片側の棒
  const seenNested = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!inScope(el) || el.closest('svg') || boardArea(el) || !isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16) continue;
    const s = style(el);

    if (/gradient\(/.test(s.backgroundImage) && r.width * r.height > 900) {
      push('gradient', el, (el.textContent || '').trim().slice(0, 24), { w: Math.round(r.width), h: Math.round(r.height) });
    }

    const radius = Number.parseFloat(s.borderTopLeftRadius) || 0;
    const p = paintsBox(el);

    if (radius >= 3) {
      const sides = ['Left', 'Right', 'Top', 'Bottom'].map((side) => Number.parseFloat(s[`border${side}Width`]) || 0);
      const oneSide = sides[0] >= 2 && sides[0] > sides[1] + 1 && (p.filled || p.bordered > 1);
      const insetBar = /inset\s+-?[2-9]px 0px 0px/.test(s.boxShadow) || /rgb[^)]*\)\s+-?[2-9]px 0px 0px 0px inset/.test(s.boxShadow);
      const before = window.getComputedStyle(el, '::before');
      const after = window.getComputedStyle(el, '::after');
      const bar = [before, after].some(
        (b) =>
          b.content !== 'none' &&
          b.position === 'absolute' &&
          Number.parseFloat(b.width) >= 1 &&
          Number.parseFloat(b.width) <= 5 &&
          Number.parseFloat(b.height) > r.height * 0.3 &&
          alpha(b.backgroundColor) > 0.2,
      );
      if ((oneSide || insetBar || bar) && (p.filled || p.bordered > 0)) {
        push('sideBar', el, (el.textContent || '').trim().slice(0, 24));
      }
    }

    const isCard = radius >= 3 && p.bordered >= 3 && r.width > 60 && r.height > 40;
    if (isCard) {
      let depth = 1;
      let cur = el.parentElement;
      while (cur && cur !== document.body) {
        const cs = style(cur);
        const cr = cur.getBoundingClientRect();
        if ((Number.parseFloat(cs.borderTopLeftRadius) || 0) >= 3 && paintsBox(cur).bordered >= 3 && cr.width > 60) depth += 1;
        cur = cur.parentElement;
      }
      if (depth >= 3) {
        const key = pathOf(el);
        if (!seenNested.has(key)) {
          seenNested.add(key);
          push('nested', el, (el.textContent || '').trim().slice(0, 24), { depth });
        }
      }
    }
  }

  // 固定値: 文字と地のコントラスト、文字の大きさ
  const parseColor = (color) => {
    const m = color.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [r, g, b, a];
    }
    const c = color.match(/^color\(srgb ([^)]+)\)$/);
    if (c) {
      const [r, g, b, a = 1] = c[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return [r * 255, g * 255, b * 255, a];
    }
    return null;
  };
  const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3]));
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // 地の色。画像かグラデーションの上なら測らない（null）
  const groundOf = (el) => {
    const layers = [];
    let cur = el;
    while (cur) {
      const s = style(cur);
      if (s.backgroundImage !== 'none') return null;
      const c = parseColor(s.backgroundColor);
      if (!c) return null;
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
      cur = cur.parentElement;
    }
    let rgb = [18, 20, 22];
    for (const layer of layers.reverse()) rgb = over(layer, rgb);
    return rgb;
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let cur = el; cur; cur = cur.parentElement) o *= Number(style(cur).opacity);
    return o;
  };
  for (const t of shown) {
    const { el, text } = t;
    const s = style(el);
    const size = Number.parseFloat(s.fontSize);
    if (size < 11 - 0.05) push('tiny', el, text, { size });
    if (el.closest(':disabled, [aria-disabled="true"]')) continue;
    const fg = parseColor(s.color);
    const ground = groundOf(el);
    if (!fg || !ground) continue;
    const shownColor = over([...fg.slice(0, 3), fg[3] * opacityOf(el)], ground);
    const [hi, lo] = [luminance(shownColor), luminance(ground)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5) - 0.02) push('contrast', el, text, { ratio: Number(ratio.toFixed(2)) });
  }

  // 同じ場所の同じ指摘は1つにし、何か所あったかを添える
  const merged = new Map();
  for (const f of findings) {
    const key = `${f.kind}|${f.path}|${f.kind === 'nested' || f.kind === 'gradient' || f.kind === 'sideBar' ? '' : f.text}`;
    const prev = merged.get(key);
    if (prev) prev.count += 1;
    else merged.set(key, { ...f, count: 1 });
  }
  return [...merged.values()];
}
