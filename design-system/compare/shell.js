/* 見比べる台。今の画面（撮った画像）と案（動く画面）を、同じ窓の大きさで並べる。
   感想は「どこが、どう感じた」で残す。サーバ（serve.mjs）で開いていればファイルへ、そうでなければこのブラウザへ保存する。 */
(() => {
  const C = window.__COMPARE__;
  const FRAME_SRC = document.getElementById('frame-src').textContent.replaceAll('<@@/script', '</' + 'script');

  const { screens: SCREENS, states: STATES, sizes: SIZES, themes: THEMES } = C;
  const MODES = [
    ['all', '全部'],
    ['two', '2つ'],
    ['one', '1つ'],
  ];
  const VERDICTS = [
    ['pick', 'これにする'],
    ['mix', '混ぜる'],
    ['drop', '外す'],
  ];
  const KINDS = [
    ['good', '良い'],
    ['bad', '気になる'],
    ['change', '変えたい'],
  ];

  const ROUND = C.round;
  const KEY = `design-compare:${C.title}:${ROUND}`;
  const CASES = C.cases;

  const V = { ...C.start, mode: 'all', pair: ['now', C.recommend], one: C.recommend, marking: false };
  let data = load() ?? { round: ROUND, notes: [], verdicts: {}, comment: '' };
  let saveText = '';

  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const nameOf = (id) => CASES.find((c) => c.id === id)?.short ?? id;
  const labelOf = (list, id) => list.find(([k]) => k === id)?.[1] ?? id;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY));
    } catch {
      return null;
    }
  }

  const onServer = location.protocol.startsWith('http');
  let timer = 0;
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      saveText = 'このブラウザに保存しました';
    } catch {
      saveText = 'このブラウザに保存できません。「コピー」で渡してください';
    }
    if (!onServer) {
      renderSave();
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const res = await fetch('/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
        saveText = res.ok ? `保存しました（${(await res.json()).file}）` : `ファイルに保存できませんでした（${res.status}）。このブラウザには残っています`;
      } catch {
        saveText = 'ファイルに保存できませんでした。このブラウザには残っています';
      }
      renderSave();
    }, 400);
  }

  async function pull() {
    if (!onServer) return;
    try {
      const res = await fetch('/feedback');
      if (!res.ok) return;
      const saved = await res.json();
      if (saved && saved.round === ROUND && (saved.notes.length || Object.keys(saved.verdicts).length || saved.comment)) {
        data = saved;
        renderPanel();
        renderPins();
      }
    } catch {
      // サーバが無ければ、このブラウザの内容を使う
    }
  }

  // ---- 上の帯 ----

  const group = (key, label, list, disabled = () => false) =>
    `<div class="set"><span>${label}</span><div class="opts" role="group" aria-label="${label}">${list
      .map(([id, text]) => `<button type="button" data-set="${key}" data-val="${id}" aria-pressed="${V[key] === id}"${disabled(id) ? ' disabled' : ''}>${text}</button>`)
      .join('')}</div></div>`;

  function renderTop() {
    $('.top').innerHTML = `<h1>${h(C.title)}</h1>
      ${group('screen', '画面', SCREENS)}
      ${group('state', '状態', STATES, (id) => Boolean(C.skip[V.screen]?.includes(id)))}
      ${group('size', '窓', SIZES.map((s) => [s, `${s.replace('x', '×')}${C.sizeLabels[s] ? ` ${C.sizeLabels[s]}` : ''}`]))}
      ${THEMES.length > 1 ? group('theme', '明るさ', THEMES) : ''}
      ${group('mode', '並べ方', MODES)}
      <button type="button" class="mark" data-mark aria-pressed="${V.marking}">${V.marking ? '印を付けるのをやめる' : '感想の印を付ける'}</button>`;
  }

  // ---- 画面 ----

  const shownCases = () => (V.mode === 'all' ? CASES.map((c) => c.id) : V.mode === 'two' ? V.pair : [V.one]);
  const dims = () => V.size.split('x').map(Number);

  function renderCards() {
    const ids = shownCases();
    const host = $('.cards');
    host.dataset.mode = V.mode;
    const wanted = ids.map((id, i) => `${id}:${i}`).join(',');
    if (host.dataset.ids !== wanted) {
      host.dataset.ids = wanted;
      host.innerHTML = ids
        .map((id, i) => {
          const c = CASES.find((x) => x.id === id);
          const chooser =
            V.mode === 'all'
              ? `<button type="button" data-open="${id}">大きく見る</button>`
              : `<div class="opts" role="group" aria-label="見る案">${CASES.map((x) => `<button type="button" data-pick="${i}" data-val="${x.id}" aria-pressed="${x.id === id}">${h(x.tag)}</button>`).join('')}</div>`;
          return `<section class="card" data-case="${id}"><div class="cap"><b>${h(c.short)}</b>${id === C.recommend ? '<span class="rec">推奨</span>' : ''}<span class="one" title="${h(c.one)}">${h(c.one)}</span>${chooser}</div>
            <div class="view"></div><div class="facts"></div><div class="give"></div></section>`;
        })
        .join('');
    }
    for (const card of host.querySelectorAll('.card')) paint(card);
    renderPins();
  }

  function paint(card) {
    const id = card.dataset.case;
    const c = CASES.find((x) => x.id === id);
    const view = $('.view', card);
    const [w, ht] = dims();
    const scale = Math.min(1, view.clientWidth / w);
    view.style.height = `${Math.round(ht * scale)}px`;
    if (id === 'now') {
      const key = `${V.screen}/${V.state}@${V.size}`;
      const src = C.now[key];
      const missing = C.nowMissing[V.theme];
      if (missing) view.innerHTML = `<div class="miss">${h(missing)}</div><div class="pins"></div>`;
      else if (!src) view.innerHTML = '<div class="miss">この組み合わせの画像はありません</div><div class="pins"></div>';
      else view.innerHTML = `<img src="${src}" width="${w}" height="${ht}" alt="今の画面" style="transform:scale(${scale})"><div class="pins"></div>`;
    } else if (c.same?.[V.screen]) {
      view.innerHTML = `<div class="miss">この画面は「${h(nameOf(c.same[V.screen]))}」と同じです</div><div class="pins"></div>`;
    } else {
      let frame = $('iframe', view);
      if (!frame) {
        view.innerHTML = '<iframe title=""></iframe><div class="pins"></div>';
        frame = $('iframe', view);
        frame.title = c.short;
        frame.srcdoc = FRAME_SRC;
        frame.addEventListener('load', () => push(frame, id));
      }
      frame.width = w;
      frame.height = ht;
      frame.style.transform = `scale(${scale})`;
      push(frame, id);
    }
    $('.pins', view).classList.toggle('on', V.marking);
    const f = C.facts[`${id}:${V.size}`] ?? {};
    const b = id === 'now' && C.nowMissing[V.theme] ? null : C.breaks[`${c.same?.[V.screen] ?? id}:${V.screen}:${V.state}:${V.size}`];
    $('.facts', card).innerHTML = [
      f.board ? `盤の幅 <b>${f.board}px</b>（窓の面積の ${f.area}%）` : '',
      f.plies ? `一度に見える手 <b>${f.plies}</b>` : '',
      b == null ? '' : `この画面の崩れ <b>${b}</b> 件`,
    ]
      .filter(Boolean)
      .map((x) => `<span>${x}</span>`)
      .join('');
    const give = { main: c.give, engine: c.giveEngine }[V.screen];
    $('.give', card).textContent = give ? `諦めるもの: ${give}` : '';
  }

  function push(frame, id) {
    try {
      frame.contentWindow.__setProto({ p: id, screen: V.screen, state: V.state, theme: V.theme });
    } catch {
      frame.contentWindow?.postMessage({ type: 'obs-set', next: { p: id, screen: V.screen, state: V.state, theme: V.theme } }, '*');
    }
  }

  // ---- 印 ----

  const here = (n) => n.screen === V.screen && n.state === V.state && n.size === V.size && n.theme === V.theme;

  function renderPins() {
    for (const card of document.querySelectorAll('.card')) {
      const host = $('.pins', card);
      if (!host) continue;
      host.classList.toggle('on', V.marking);
      host.innerHTML = data.notes
        .map((n, i) => ({ n, i }))
        .filter(({ n }) => n.case === card.dataset.case && here(n) && n.x != null)
        .map(({ n, i }) => `<button type="button" class="pin" data-note="${i}" style="left:${n.x * 100}%;top:${n.y * 100}%" title="${h(n.where)}: ${h(n.text)}">${i + 1}</button>`)
        .join('');
    }
  }

  let asked = 0;
  function askPart(frame, x, y) {
    return new Promise((resolve) => {
      asked += 1;
      const id = asked;
      const done = (v) => {
        window.removeEventListener('message', on);
        resolve(v);
      };
      const on = (e) => {
        if (e.data?.type === 'obs-part-reply' && e.data.id === id) done(e.data);
      };
      window.addEventListener('message', on);
      frame.contentWindow.postMessage({ type: 'obs-part', id, x, y }, '*');
      setTimeout(() => done(null), 400);
    });
  }

  async function addPin(e, card) {
    const view = $('.view', card);
    const r = view.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const frame = $('iframe', view);
    let where = '';
    if (frame) {
      const [w, ht] = dims();
      const part = await askPart(frame, x * w, y * ht);
      if (part) where = [part.part, part.text && part.text !== part.part ? `「${part.text}」` : ''].filter(Boolean).join(' ');
    }
    openEdit({ case: card.dataset.case, screen: V.screen, state: V.state, size: V.size, theme: V.theme, x, y, where, text: '', kind: 'bad' }, null, e.clientX, e.clientY);
  }

  function openEdit(note, index, cx, cy) {
    $('.edit')?.remove();
    const el = document.createElement('div');
    el.className = 'edit';
    el.style.left = `${Math.min(cx + 14, innerWidth - 336)}px`;
    el.style.top = `${Math.min(cy + 8, innerHeight - 270)}px`;
    el.innerHTML = `<div class="help">${h(nameOf(note.case))} ／ ${labelOf(SCREENS, note.screen)} ／ ${labelOf(STATES, note.state)} ／ ${note.size.replace('x', '×')}</div>
      <label>どこが<input type="text" class="f-where" value="${h(note.where)}" placeholder="例: 棋譜の行"></label>
      <label>どう感じた<textarea class="f-text" rows="3" placeholder="例: 文字が詰まって読みにくい">${h(note.text)}</textarea></label>
      <div class="opts" role="group" aria-label="種類">${KINDS.map(([k, t]) => `<button type="button" data-kind="${k}" aria-pressed="${note.kind === k}">${t}</button>`).join('')}</div>
      <div class="acts"><button type="button" class="cancel">やめる</button><button type="button" class="ok">残す</button></div>`;
    document.body.append(el);
    let kind = note.kind;
    el.addEventListener('click', (ev) => {
      const k = ev.target.closest('[data-kind]');
      if (k) {
        kind = k.dataset.kind;
        for (const b of el.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b === k));
      }
      if (ev.target.closest('.cancel')) el.remove();
      if (ev.target.closest('.ok')) commit();
    });
    const commit = () => {
      const next = { ...note, where: $('.f-where', el).value.trim(), text: $('.f-text', el).value.trim(), kind, at: new Date().toISOString() };
      if (!next.text && !next.where) {
        el.remove();
        return;
      }
      if (index == null) data.notes.push(next);
      else data.notes[index] = next;
      el.remove();
      save();
      renderPanel();
      renderPins();
    };
    el.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') el.remove();
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) commit();
    });
    $('.f-text', el).focus();
  }

  // ---- 右の列 ----

  function renderSave() {
    const el = $('.save');
    if (el) el.textContent = saveText || (onServer ? '書いたものは、その場でファイルに保存します' : 'このブラウザに保存します。終わったら「コピー」で渡してください');
  }

  function renderPanel() {
    const notes = data.notes
      .map((n, i) => `<div class="note"><div class="w"><button type="button" class="go" data-jump="${i}">${i + 1}. ${h(nameOf(n.case))}</button><span>${labelOf(KINDS, n.kind)} ／ ${h(n.where)}</span><button type="button" data-del="${i}" aria-label="この感想を消す">消す</button></div><p>${h(n.text)}</p></div>`)
      .join('');
    $('.panel').innerHTML = `
      <section><h2>どれにするか</h2><div class="verd">${CASES.filter((c) => c.id !== 'now')
        .map((c) => `<span>${h(c.short)}</span><div class="opts" role="group" aria-label="${h(c.short)} の判定">${VERDICTS.map(([k, t]) => `<button type="button" data-verdict="${c.id}" data-val="${k}" aria-pressed="${data.verdicts[c.id] === k}">${t}</button>`).join('')}</div>`)
        .join('')}</div></section>
      <section><h2>混ぜ方・全体の感想</h2><textarea class="comment" rows="5" placeholder="例: メインは ${h(CASES[1].tag)}、エンジン管理は ${h(CASES.at(-1).tag)}。盤の周りはもう少し明るく">${h(data.comment)}</textarea></section>
      <section><h2>場所ごとの感想（${data.notes.length}）</h2><p class="help">「感想の印を付ける」を押してから、画面の気になる所を押します。場所の名前は自動で入り、直せます。</p><div class="notes">${notes}</div></section>
      <section class="acts"><button type="button" data-copy>コピー</button><button type="button" data-export>ファイルに書き出す</button></section>
      <p class="save"></p>
      ${C.previous.length ? `<section class="prev"><h2>前の周の感想と、直したこと</h2>${C.previous.map((r) => `<p><b>${h(r.round)}</b></p>${r.items.map((i) => `<div class="note"><div class="w">${h(i.where)}</div><p class="pre">${h(i.text)}</p><p class="pre done">${h(i.done)}</p></div>`).join('')}`).join('')}</section>` : ''}`;
    renderSave();
  }

  const asMarkdown = () =>
    [
      `# デザインの感想（${ROUND}）`,
      '',
      '## 判定',
      ...CASES.filter((c) => c.id !== 'now').map((c) => `- ${c.short}: ${labelOf(VERDICTS, data.verdicts[c.id]) ?? '（未定）'}`.replace('undefined', '（未定）')),
      '',
      '## 全体',
      data.comment || '（なし）',
      '',
      '## 場所ごと',
      ...data.notes.map((n, i) => `${i + 1}. [${nameOf(n.case)} / ${labelOf(SCREENS, n.screen)} / ${labelOf(STATES, n.state)} / ${n.size} / ${labelOf(THEMES, n.theme)}] ${labelOf(KINDS, n.kind)} — ${n.where}: ${n.text}`),
    ].join('\n');

  // ---- 操作 ----

  document.addEventListener('click', async (e) => {
    const t = e.target;
    const set = t.closest('[data-set]');
    if (set) {
      V[set.dataset.set] = set.dataset.val;
      if (C.skip[V.screen]?.includes(V.state)) V.state = STATES[0][0];
      renderTop();
      renderCards();
      return;
    }
    if (t.closest('[data-mark]')) {
      V.marking = !V.marking;
      renderTop();
      renderPins();
      return;
    }
    const open = t.closest('[data-open]');
    if (open) {
      V.mode = 'one';
      V.one = open.dataset.open;
      renderTop();
      renderCards();
      return;
    }
    const pick = t.closest('[data-pick]');
    if (pick) {
      if (V.mode === 'two') V.pair[Number(pick.dataset.pick)] = pick.dataset.val;
      else V.one = pick.dataset.val;
      renderCards();
      return;
    }
    const pin = t.closest('.pin');
    if (pin) {
      const i = Number(pin.dataset.note);
      openEdit(data.notes[i], i, e.clientX, e.clientY);
      return;
    }
    const pins = t.closest('.pins.on');
    if (pins) {
      await addPin(e, pins.closest('.card'));
      return;
    }
    const verdict = t.closest('[data-verdict]');
    if (verdict) {
      const { verdict: id, val } = verdict.dataset;
      if (data.verdicts[id] === val) delete data.verdicts[id];
      else data.verdicts[id] = val;
      save();
      renderPanel();
      return;
    }
    const del = t.closest('[data-del]');
    if (del) {
      data.notes.splice(Number(del.dataset.del), 1);
      save();
      renderPanel();
      renderPins();
      return;
    }
    const jump = t.closest('[data-jump]');
    if (jump) {
      const n = data.notes[Number(jump.dataset.jump)];
      Object.assign(V, { screen: n.screen, state: n.state, size: n.size, theme: n.theme, mode: 'one', one: n.case });
      renderTop();
      renderCards();
      return;
    }
    if (t.closest('[data-copy]')) {
      await navigator.clipboard.writeText(asMarkdown()).then(
        () => (saveText = 'コピーしました'),
        () => (saveText = 'コピーできませんでした。「ファイルに書き出す」を使ってください'),
      );
      renderSave();
      return;
    }
    if (t.closest('[data-export]')) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      a.download = `${ROUND}.json`;
      a.click();
    }
  });

  document.addEventListener('input', (e) => {
    if (!e.target.classList.contains('comment')) return;
    data.comment = e.target.value;
    save();
  });

  document.addEventListener('keydown', (e) => {
    if (/TEXTAREA|INPUT/.test(e.target.tagName)) return;
    const i = Number(e.key) - 1;
    if (i >= 0 && i < CASES.length && V.mode !== 'all') {
      if (V.mode === 'one') V.one = CASES[i].id;
      else V.pair[1] = CASES[i].id;
      renderCards();
    }
  });

  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(renderCards);
  });

  renderTop();
  renderPanel();
  renderCards();
  pull();
})();
