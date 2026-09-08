# レビュー 436-error-boundary-layers ラウンド1

- 日付: 2026-09-08
- 範囲: `git diff origin/main...HEAD`（10ファイル / +417 -33）
  - `src/app/App.tsx` `src/app/RootErrorFallback.tsx` `src/app/routing/RuntimeShell.tsx` `src/pages/AppLayout.tsx`
  - テスト3本（`src/app/__tests__/rootErrorBoundary.test.tsx` / `src/app/routing/__tests__/shellErrorBoundary.test.tsx` / `src/pages/__tests__/appLayoutPaneBoundaries.test.tsx`）
  - docs 3本（`docs/spec/screens/app-layout.md` `docs/spec/screens/board.md` `docs/state-transitions/failure-surfacing.md`）
- 走らせた reviewer: architecture / react / ui / robustness / comment / oss-hygiene
- 対象コミット: `e883b0f1`

## 所見

### [BLOCK] r1-01 `RuntimeShell` の境界が出す画面は、白地に白文字で何も読めない

reviewer: ui

- 場所: `src/app/routing/RuntimeShell.tsx:18`、`src/shared/ui/AppErrorBoundary.tsx:47`、`src/app/App.scss:9`
- 面を塗っているのは `.app-layout`（`AppLayout.scss:19` の `background-color: index.$color-primary-light`）で、
  それは境界の**内側**に居る。`.app-root` / `.app-content` / `body` / `html` / `tauri.conf.json` の
  どこにも背景が無い（`grep "^body\|^html\|#root"` の結果は `global.scss:14,18` のみで、どちらも背景を持たない）。
- 境界が受けた瞬間に `.app-layout` ごと消えるので、既定 fallback の `rgba(255,255,255,0.7)` が
  canvas の既定色（白）の上に出る。比 **1.05:1**。「表示中にエラーが発生しました。」も「再表示」も
  画面に無いのと同じになる。**この PR が足した境界が、この PR の目的（復帰導線を残す）を潰している。**
- 同じ落とし穴は `src/pages/AppLoading.tsx:22` に既に記録がある（「器も自分で持つ。外に置くと面も文字色も継げず」）。
- 結果: 対応済み `60bcd702` — 既定 fallback を SCSS へ寄せ、不透明な面（`$color-primary-black`）を持たせた

### [HIGH] r1-02 `AppModalLayer` の fallback が `.app-layout` の grid 行を食い、作業面が押し出される

reviewer: ui

- 場所: `src/pages/AppLayout.tsx:42`、`src/pages/AppLayout.scss:16`、`src/shared/ui/Modal.tsx:164`
- `.app-layout` は `display: grid; grid-template-rows: var(--header-h) 1fr;`。平常時 `AppModalLayer` は
  `createPortal` なので in-flow の子を1つも作らず、header が行1・`__body` が行2に載る。
- モーダルが throw すると境界が in-flow の `<div>` を返し、auto-placement で fallback が行1、
  header が行2（`1fr`）、`__body` が暗黙の行3へずれる。`overflow: hidden` に切られて
  **盤・棋譜・解析が全部消える。** この境界のコメント（「本体まで unmount させない」）が
  防ごうとしていることそのものが起きる。
- **`main` から在る境界だが、この PR が「段構えの一部」として doc に位置づけたので、同じ PR で直す。**
- 結果: 対応済み `2d30bf02` — モーダル層の fallback を `--floating`（`position: fixed`）で出し、grid の行を食わないようにした

### [HIGH] r1-03 「再表示」が決定的な例外では画面を1ドットも変えない。原因が消えても fallback は解けない

reviewer: react / robustness

- 場所: `src/shared/ui/AppErrorBoundary.tsx:18,27-35`、`src/pages/AppLayout.tsx:66`
- `reset` は `error` を `null` にするだけ。落ちる原因は境界の**外**（`RuntimeProviders` の context）に
  残るので、同じ state で再マウントして同じ行で throw する。react-reviewer が実測（`再表示` を押して
  子の render 回数 3→5、画面は fallback のまま）。実例は既にコード上にある
  —— `src/widgets/kifu-stream/ui/KifuStreamList.tsx:119-121` の `TODO(#295)`。
- 逆向きも成立する。`getDerivedStateFromProps` 相当が無いので、**原因が消えた後も fallback のまま**。
  robustness-reviewer が実測（境界の内側で `/boom` → `/safe` へ遷移しても `fallbackStill: true`）。
  `AppModalLayer` の境界は一度捕まえると URL の `modal` が消えても復帰せず、以後どのモーダルも出ない。
- 盤ペインの境界は `GameControls`（最初に戻る／前後）を**同じ境界の中に入れた**ので、
  盤が落ちると局面を動かす手段も同時に消える。
- 結果: **一部** 対応済み `697f8091` — `resetKeys` を足し、作業画面に `pathname`、モーダル層にモーダルの種類を渡した。盤・棋譜一覧・解析の鍵と、繰り返しの提示・解析の停止導線は #511 へ

### [HIGH] r1-04 落ちた例外の中身がどこにも残らない

reviewer: robustness / react

- 場所: `src/app/App.tsx:24`（`_error` を捨てている）、`src/shared/ui/AppErrorBoundary.tsx:22-25`、
  `src-tauri/Cargo.toml:14`、`src-tauri/src/lib.rs:50-58`
- `componentDidCatch` の doc は「落ちた原因はここでしか見られない」と書くが、その1箇所が
  **配布版では見られない**。`tauri` の feature に `devtools` は無く（自動で入るのは debug のみ）、
  `@tauri-apps/plugin-log` も入っていないのでフロントの `console` はログファイルにも流れない。
- 結果、root まで上がった例外は**画面にも出ず、ログにも残らず、devtools も開けない**。
  利用者が報告できるのは「表示中にエラーが発生しました。」の一文だけ。
- 沈黙する失敗が、まさに失敗を見せる画面で起きている。
- 結果: **一部** 対応済み `0dac13ad` — `error.message`（`Error` でなければ `String()`）を画面に出す。ログへ流す側は既存の #448 が持っている

### [HIGH] r1-05 `UpdaterScreen` を root 境界の内側に入れたので、直前のコメントの主張が成り立たなくなった

reviewer: architecture / react

- 場所: `src/app/App.tsx:24-39`
- 同じ境界が `BootstrapProviders` + ルータ と `UpdaterScreen` を1枚で受ける。コメントは
  「その状態を直す版が、その状態のせいで届かない」を避けるために `UpdaterScreen` をルータの外へ
  出しているのに、境界では巻き込む位置へ移した。**修正版を受け取る唯一の導線が、いちばん必要な場面で消える。**
- 逆向きも成立: `UpdaterScreen`（`createPortal` + lucide）の render 例外1つで、動いているアプリ全体が
  `RootErrorFallback` に差し替わる。今回ペイン境界を足して防いだ失敗の型そのもの。
- 結果: 対応済み `58f480c6` — `UpdaterScreen` を root の境界の外へ出し、自前の境界（`--floating`）で包んだ

### [HIGH] r1-06 「root まで上がるのは provider・guard・ルータ自身が落ちたときだけ」が事実でない

reviewer: comment / oss-hygiene / robustness

- 場所: `src/app/App.tsx:20-22`、`docs/spec/screens/app-layout.md:122`、`docs/state-transitions/failure-surfacing.md:72`
- 境界の**外**に居るのは provider・guard・ルータだけではない。`RuntimeShell.tsx:11` の `TitleBar`、
  `AppRouter.tsx:11` の `AppLoading`（`/` の起動画面一式）、`App.tsx:38` の `UpdaterScreen`、
  `BootstrapProviders` の `NotificationLayer` も同じ。
- 特に `TitleBar` は `RootErrorFallback.tsx:11-14` の doc が「枠そのものが落ちて root まで来た場合」として
  明示的に前提にしている経路で、**2つのコメントが互いに矛盾している。**
- 派生: `/` の起動画面には `TitleBar` が無いので、**正常時は閉じるボタンが無く、落ちたときだけ出る**
  という逆転がある（別 issue 候補）。
- 結果: 対応済み `faf2b759`（コード側）/ `8122701a`（doc 側）— `TitleBar`・起動画面・`UpdaterScreen` を列挙。派生（起動画面に枠が無い）は #515 へ

### [HIGH] r1-07 `App.tsx` の「盤・解析ペインは `RuntimeShell` の境界が受け」が現物と違う

reviewer: comment

- 場所: `src/app/App.tsx:20-21`
- 後続コミット `a0d14dcf` が盤ペイン／解析ペインに境界を入れたので、いちばん内側で受けるのはそちら。
  `RuntimeShell` の境界が実際に受けるのはヘッダ・サイドバー・`AppLayout` 自身。
- 同じ行の「ここより上に境界は置けない（`createRoot` の直下）」も違う。`main.tsx` で `<App />` を
  包む境界は置ける。置かない理由は「そこでは枠を描けない」であって「置けない」ではない。
- 結果: 対応済み `faf2b759` — 「いちばん内側が受ける」に直し、「境界は置けない」も「そこでは枠を描けない」に直した

### [HIGH] r1-08 ADR-0004 の ※ が「2箇所」「いまも root ごと unmount する」と現在形で嘘

reviewer: oss-hygiene / comment

- 場所: `docs/decisions/0004-notification-taxonomy.md:220-222`
- `failure-surfacing.md:67` のほぼ同文はこの PR で更新したが、ADR 側だけ取り残された。
  `board.md:89` `analysis-pane.md:92` から参照される現役の文書で、**#436 で塞いだ当の状態を現在形で述べている。**
- `docs/OPERATING-MODEL.md:53-58` は main 後の ADR 書き換えを3つに限っているが、これは1（実測値の更新）に当たる。
  **決定そのものは触らない。**
- 結果: 対応済み `2927082b` — ADR-0004 の ※ から実測を落とし、出典を `app-layout.md` へ委譲。決定そのものは触っていない

### [HIGH] r1-09 `failure-surfacing.md` が自分のファイルの中で境界の数を矛盾させている

reviewer: oss-hygiene

- 場所: `docs/state-transitions/failure-surfacing.md:166`（G-3 の行）
- `| G-3 | React が落ちた | **囲った範囲だけ差し替わる**（2箇所） | リロード | 残る |` が古いまま。
  §0 の ※ を直したのに §2 を直していない。この台帳は「直したのに行が古いままなら台帳として嘘をつく」を
  自分の存在理由にしている。
- 「（2箇所）」はこの文書が繰り返し禁じている「数を書く」の実例で、今回まさに腐った。
  復帰列の「リロード」も現物と違う（「再表示」ボタンがある）。
- 結果: 対応済み `2927082b` — G-3 の「（2箇所）」を落とし、復帰を「再表示。戻らなければ再起動」に直した

### [HIGH] r1-10 `startupErrorRoute.test.tsx` の doc「境界が無いので真っ白」が嘘になった

reviewer: comment

- 場所: `src/app/routing/__tests__/startupErrorRoute.test.tsx:14-16`
- このテストが守る `/` ⇄ `/app` の往復は `RequireRootDir` で起き、そこは `RuntimeShell` の境界より**上**。
  root 境界が受けるので、出るのは真っ白な窓ではなく `RootErrorFallback`。
- 「選び直す手段も消える」の部分は今も真で、そこがこのテストの本当の価値になっている。
- 結果: 対応済み `0c004afc` — 「真っ白になる」を「root の境界が受ける。ただし選び直す導線は消える」に直した

### [HIGH] r1-11 最後の砦の「閉じる手段」が 12px の無地の赤丸1つで、文言にも案内が無い

reviewer: robustness / ui

- 場所: `src/app/RootErrorFallback.tsx:61-75,89`
- `html { font-size: 62.5% }` なので `1.2rem` = 12px。アイコンも `title` も文字も無い丸1つ。
  `TitleBar` は同じ赤丸に `<X size={12}/>` を常時載せているので、見た目の手掛かりが一致しない。
- 中央の文言は「表示中にエラーが発生しました。」だけで、**何が起きたか・次に何をすればよいか・
  未保存の変更がどうなるか**のどれも書いていない。この画面が出る理由は「閉じられない」を直すことなのに、
  閉じる導線がいちばん見つけにくい形で置かれている。
- 結果: 対応済み `1bb0e50f` — 帯の丸に `X` を載せ（`b6516e38`）、本文に文字ボタンと「次に何をすればよいか／保存していない入力がどうなるか」を置いた

### [MEDIUM] r1-12 境界が6枚になったのに、どれが受けたかを画面も検査も名指しできない

reviewer: architecture / robustness

- 場所: `src/pages/AppLayout.tsx:42,66,78,86`、`src/app/routing/RuntimeShell.tsx:18`、`src/shared/ui/AppErrorBoundary.tsx:51`
- 5枚が引数なしの `<AppErrorBoundary>` で、出力は全て同一の「表示中にエラーが発生しました。」。
  盤ペインの境界を誤って外しても上の境界が**同じ文言**で受けるので、利用者にも開発者にも退行が見えない。
  テストは `.workspace` の有無という間接的な指標で代用している。
- `.workspace__dock` に出た場合は上端寄せ、`.workspace__boardPane` では中央（r1-19）なので、
  位置からも「どの部品の代わりか」が読み取れない。
- 直し方案: `AppErrorBoundary` に `label` を持たせ、「盤を表示できませんでした」と名乗らせる。
  `componentDidCatch` のログにも載せる。
- 結果: 対応済み `1c7d896d` — `label` を必須にして「盤を表示できませんでした。」と名乗らせ、ログにも載せた。ペインのテストは文言で受け側を名指しする

### [MEDIUM] r1-13 既定 fallback の本文が `RootErrorFallback` に1文字違わず写されている

reviewer: architecture / react / comment

- 場所: `src/shared/ui/AppErrorBoundary.tsx:38-67`、`src/app/RootErrorFallback.tsx:78-105`
- 文言・`gap`・`padding`・ボタンの `padding` / `borderRadius` / `border` / `background` / `color` /
  `fontSize` / `cursor` が両方に同一の形である。`fallback` の契約が**全置換しか許さない**ため。
- 文言「表示中にエラーが発生しました。」は3つのテストが突き合わせに使っているので、
  既定側を直すと片方のテストだけ赤くなり、`RootErrorFallback` は古い文言のまま緑で残る。
- `AppErrorBoundary.tsx:37` の「ここだけ直値で書く」も同時に嘘になった。
- 結果: 対応済み `7ad0bbd6` — `AppErrorFallbackBody` として1箇所に出した

### [MEDIUM] r1-14 サイドバー（`Outlet`）とヘッダだけ境界が無い

reviewer: robustness

- 場所: `src/pages/AppLayout.tsx:46,49-54`
- `Outlet` に入るのは `FileTree`で、ディスクから読んだ木とファイル名という**いちばん形の保証が無いもの**を描く。
  ここで throw すると `RuntimeShell` の境界が受け、盤も棋譜も解析も全部消える。
  盤・解析・棋譜には1枚ずつ置いたのに、いちばん落ちそうな面だけ素通し。
- 結果: **見送り** → #512。段構えは「ヘッダとサイドバーは作業画面の境界が受ける」と決めてある。粒度を変えるのは別の判断

### [MEDIUM] r1-15 解析ペインが落ちると、走っているエンジンを止める手段が消える

reviewer: robustness

- 場所: `src/pages/AppLayout.tsx:86-88`、`src/widgets/analysis-pane/ui/AnalysisPaneHeader.tsx:77-87`
- 解析の state は `useAnalysis`（境界の外）、停止ボタンは `AnalysisPaneHeader`（境界の内）。
  無限解析中にペインが落ちると、**エンジンは走ったまま `isAnalyzing` は true のまま停止ボタンだけが消える**。
  「再表示」を押すと同じ応答でまた落ちる。
- 結果: **見送り** → #511（r1-03 の残りと同じ issue）。解析専用の fallback から `stopAnalysis()` を呼ぶのは境界の形そのものの設計

### [MEDIUM] r1-16 `RootErrorFallback` の閉じるボタンの失敗が沈黙する

reviewer: robustness

- 場所: `src/app/RootErrorFallback.tsx:28-34`
- `catch` して `console.error` だけ。上（r1-04）のとおり配布版では誰にも届かない。
  この画面の存在理由は「他に手段が無いときの最後の1つ」なので、そこが黙って失敗すると
  利用者に残るのは**押しても何も起きないボタン**になる。
- 結果: 対応済み `06e745bb` — 閉じられなかったら OS の終了操作を案内する

### [MEDIUM] r1-17 `createRoot` の外は依然として白い窓

reviewer: robustness

- 場所: `src/main.tsx:8`、`index.html:28`
- モジュール評価中の throw、チャンクの読み込み失敗、`#root` が無い場合の `!` の落下は、
  `App` が1度も描かれないまま終わる。結果は今回直したかったものそのもの。
  `window.onerror` / `unhandledrejection` のハンドラはリポジトリに1つも無い。
- 結果: **見送り** → #513。`index.html` と `main.tsx` はこの PR が触っていない層

### [MEDIUM] r1-18 `TitleBar` の3つの promise が投げっぱなし。`app-layout.md:104` の言い切りと噛み合わない

reviewer: robustness

- 場所: `src/shared/ui/TitleBar.tsx:9-11`、`docs/spec/screens/app-layout.md:104`
- `minimize` / `toggleMaximize` / `close` が reject しても catch も `unhandledrejection` も無い。
- 今回の変更は「レンダ例外なら閉じる手段が残る」までを保証したが、**閉じる操作自体の失敗経路は
  元のままの沈黙**で、doc の「どこで throw しても、ウィンドウを閉じる手段は画面に残る」という
  無条件の言い切りと噛み合っていない。
- 結果: **見送り** → #514（r1-24 と同じ issue）。`app-layout.md:104` の言い切りは `8122701a` で「レンダ例外は」に限定した

### [MEDIUM] r1-19 既定 fallback が高さを持たず、出る場所ごとに縦位置が変わる

reviewer: ui

- 場所: `src/shared/ui/AppErrorBoundary.tsx:39-49`
- `justify-content: center` が効くのは親が高さを与える `.workspace__boardPane` だけ。
  `.workspace__dock` と `.app-content` では高さが auto になり上寄せで出る。
  盤と解析が同時に落ちると、同一の文言が片方は中央・片方は上端に出る。
- 結果: 対応済み `60bcd702` — `height: 100%` と `justify-content: safe center` で、どの親でも縦位置が決まる

### [MEDIUM] r1-20 `2.6rem` が `$titlebar-height` の写しになり、検査が届かない

reviewer: ui / comment / architecture

- 場所: `src/app/RootErrorFallback.tsx:53`、`src/index.scss:141-145`
- `index.scss:141-142` の注記は「`.titlebar` の高さであり、`decorations: false` のウィンドウを動かす
  **唯一の**ドラッグ領域の高さでもある」。ドラッグ領域は2つになったので、この「唯一」が嘘になった。
  `modalOverlayTitlebar.test.ts` の前提も同じ言い方で、SCSS しか見ないので新しい帯を一切見ない。
- `RootErrorFallback` 側の doc は「合わせる必要は無い」という否定形だけを書き、
  **実際に選ばれた `2.6rem` がトークンと同値である理由を1つも書いていない。** 偶然か意図かが読めない。
  先例（`index.scss:146-147` の `$floating-note-header-height`）は「揃うのは意匠で、従属ではない」と両方書いている。
- 結果: 対応済み `b6516e38` — 帯の高さを `index.$titlebar-height` から取り、直値を消した。`index.scss` の「唯一のドラッグ領域」と `modalOverlayTitlebar.test.ts` の doc も直した

### [MEDIUM] r1-21 インライン直値の2ファイルは、どのラチェットにも走査されない位置にある

reviewer: ui

- 場所: `src/app/RootErrorFallback.tsx:38-101`、`src/shared/ui/AppErrorBoundary.tsx:39-63`、`src/__tests__/walk.ts`
- `scssScaleRatchet` も `contrastRatchet` も `scssFiles(SRC)` で回り、`.scss` しか拾わない。
- 「最後の砦なので依存を増やさない」は `RootErrorFallback` には成り立つが、
  `AppErrorBoundary` の既定 fallback は `.app-layout` の内側にしか出ない（＝SCSS が効くことが確定した文脈）ので
  `AppErrorBoundary.tsx:37` の理由は成り立たない。
- 反論の余地: この所見は r1-01 / r1-13 と同じ根から出ている。既定 fallback に面を持たせれば
  「面と文字が同じ宣言の対になる」ので、構造として r1-01 が起きなくなる。
- 結果: 対応済み `60bcd702` / `b6516e38`（直値そのものを消した）。走査を足す案は `docs/IDEAS.md` へ

### [MEDIUM] r1-22 閉じるボタンが `TitleBar` の同じボタンと違う規則で書かれている

reviewer: ui

- 場所: `src/app/RootErrorFallback.tsx:61-75`、`src/shared/ui/TitleBar.scss:42,52`
- `#ff5f57` が2箇所に直値。片方を変えても追随しない。
- `TitleBar` は `:hover { filter: brightness(1.2) }` を持つが、インラインでは擬似クラスが書けないので
  `RootErrorFallback` の丸は**押せるかどうかを動きから確かめられない**。
- 丸の色自体のコントラストは帯に対して 5.92:1 で非文字の 3:1 は満たす。
- 結果: 対応済み `b6516e38` — `$color-window-close/minimize/maximize` をトークンにして `TitleBar` と共有。`X` の記号と `:hover` も揃えた

### [MEDIUM] r1-23 「再表示」ボタンの輪郭が 3:1 を割る

reviewer: ui

- 場所: `src/app/RootErrorFallback.tsx:96`、`src/shared/ui/AppErrorBoundary.tsx:58`
- 本文は基準を満たす（`#1c2325` の上の `rgba(255,255,255,0.7)` は **8.26:1**、
  面の上のボタン文字は **8.68:1**）。割っているのは輪郭で、枠と面が **1.91:1**、枠と地が **2.33:1**。
  WCAG 1.4.11 の 3:1 に届かない。面と地も 1.22:1 しかない。
- 結果: 対応済み `60bcd702` — 枠線をやめ、面（`$color-secondary-solid` に白文字 4.79:1）で境を作る

### [MEDIUM] r1-24 ウィンドウ操作の Tauri 呼び出しが UI 層に2つ目を作った

reviewer: architecture

- 場所: `src/app/RootErrorFallback.tsx:1,30`、`src/shared/ui/TitleBar.tsx:1,11`
- `rg '@tauri-apps/api' src` の13箇所のうち11は `entities/*/api/*` と `shared/api/{clipboard,picker,shell}`。
  UI から直に叩いているのは `TitleBar` だけだったのが2つになった。失敗の握り方も2箇所で別々
  （`TitleBar` は握らず、`RootErrorFallback` は try/catch）。#176（閉じる前の確認）を入れるときに片方だけ通る経路ができる。
- **`RootErrorFallback` を `src/app/` に置いたこと自体は妥当**（`TitleBar` が `RuntimeShell` の中に居るという
  app 層の構造を前提にしているので、`shared/ui/` へ下ろすと shared が上の層の配置を知ることになる）。
- 結果: **見送り** → #514。既存コードのリファクタで、「ついでの改名」を混ぜない

### [MEDIUM] r1-25 `RootErrorFallback` の doc が、コンポーネントではなく `type Props` に付いている

reviewer: comment

- 場所: `src/app/RootErrorFallback.tsx:3-27`
- TS が doc を結び付ける先は直後の宣言、つまり非公開の `Props`。`App.tsx:24` で
  `RootErrorFallback` にホバーしても何も出ず、20行の「なぜ」は誰も見ない `Props` に付く。
- 結果: 対応済み `81178533` — doc を関数の直上へ移した

### [MEDIUM] r1-26 `AppErrorBoundary` の `fallback` prop に契約の doc が無い

reviewer: comment

- 場所: `src/shared/ui/AppErrorBoundary.tsx:5`
- **fallback は境界の内側でレンダされるので、fallback 自身が投げると同じ境界では捕まらず外へ抜ける。**
  この契約は今 `RootErrorFallback.tsx:11-14` にだけ書かれているが、fallback を書く人全員に効く規則で、
  置き場所は prop 側。内部実装に厚く、公開面が裸になっている。
- 結果: 対応済み `1174a670` — `fallback` prop に「境界の内側で描かれる」「落ちたツリーの部品を再利用しない」を書いた

### [MEDIUM] r1-27 同じ概念に名前が2つ・3つある

reviewer: comment

- 場所: `src/app/RootErrorFallback.tsx:23-27`、`src/app/App.tsx:24`；テスト3本
- 境界側は `reset` で統一されているのに利用者だけ `retry` に改名し、その改名を打ち消すためだけに
  doc の1行目（「境界の `reset`。」）が要っている。名前で表せるものをコメントで補っている。
- テスト3本が「レンダ中に throw する差し替え」に `throwing` / `Exploding` / `explode` と3つの語を当てている。
- 結果: 対応済み `a07c85be` — `retry` → `reset`、テストの語も `throwing` / `Throwing` に揃えた

### [MEDIUM] r1-28 4つの境界のうち棋譜ペインだけコメントが無く、粒度も揃っていない

reviewer: comment

- 場所: `src/pages/AppLayout.tsx:41,65,78,85`
- `41`・`65`・`85` にはコメントがあり `78` だけ無い。`85` だけが**なぜ落ちうるか**を書き、
  `65` は畳む範囲の説明にとどまる。棋譜ペインには落ちる理由が分かっている（`KifuStreamList.tsx:119-121` の
  `TODO(#295)`）のに、境界側にその参照が無い。
- 結果: 対応済み `7fbd5673` — 4箇所とも「何が落ちうるか」＋「畳む範囲」の形にし、棋譜一覧に #295 を添えた

### [MEDIUM] r1-29 段構えの説明が app-layout.md と failure-surfacing.md に二重に置かれている

reviewer: oss-hygiene / architecture

- 場所: `docs/spec/screens/app-layout.md:109-123`、`docs/state-transitions/failure-surfacing.md:67-75`
- 「枠は自前」「`TitleBar` は `RuntimeShell` の中」「root で受けたときだけ `RootErrorFallback`」が
  両方にほぼ逐語で入っている。`failure-surfacing.md:176-178` 自身が「ここで二重に持たない
  （2箇所に置くと、片方だけ直る）」と書いている。
- r1-06 は**いま既に2ファイル同時に直さないと片方が嘘になる**状態の実例。
- 結果: 対応済み `8122701a` — 出典を `app-layout.md` の「失敗の見せ方」に定め、台帳はそこを指すだけにした

### [MEDIUM] r1-30 `analysis-pane.md` に境界が付いたことが書かれていない

reviewer: oss-hygiene

- 場所: `docs/spec/screens/analysis-pane.md:82`
- `**このペインには失敗を出す場所が1つも無い。**` と断言しているが、境界が付いたので
  レンダ例外は出る場所ができた。`board.md` に足したのと同じ情報が、`AppLayout.tsx:85` のコメントが
  「エンジンの応答は形が保証されていない」と名指ししたいちばん要る面に無い。
- 結果: 対応済み `883ca81b` — 断言を「レンダ例外を除き」に緩め、`board.md` と同じ形で1段落足した

### [MEDIUM] r1-31 テストが `console.error` を潰すだけで、唯一の観測点を突き合わせていない

reviewer: react

- 場所: 新規テスト3本の `beforeEach`
- `componentDidCatch` の `console.error` は唯一の記録先（r1-04）なのに、その行を消しても
  どのテストも落ちない（変異が生き残る）。
- `beforeEach` なので throw しないテストでも潰れており、`act` 警告・`key` 重複警告も全部見えない。
- 結果: 対応済み `48e1fa3b` — 名乗り付きで `console.error` に出ることを1本で固定。`componentDidCatch` を消す変異で落ちることを確認した

## 重複・矛盾した所見

- **r1-01 / r1-13 / r1-19 / r1-21 / r1-23 は同じ根**——「既定 fallback が面を持たず、
  スタイルがインライン直値で、それが2箇所に複製されている」。1つの修正（既定 fallback に不透明な面を持たせ、
  本文を1箇所に寄せる）で全部が解ける。ui-reviewer は `contrastRatchet` の `UNMEASURED_COUNT`（401、
  下げる方だけ）に触れないよう、面は**不透明トークン**（`$surface-raised`）にすべきと具体に指摘している。
- **r1-06 / r1-07 / r1-08 / r1-09 / r1-10 / r1-29 / r1-30 も同じ根**——「境界の被覆と個数を、
  コードのコメントと4つの doc が別々に持っている」。出典を1箇所に定めれば以後腐らない。
- **矛盾**: architecture は `RootErrorFallback` の `src/app/` 配置を「妥当」と言い、
  同時に「ウィンドウ操作は `shared/api/window` へ寄せよ」と言う（r1-24）。これは両立する
  ——コンポーネントは app、Tauri 呼び出しは shared/api。
- **判断が要る**: r1-03 の直し方が2案に割れている。react は `resetKeys` を足す案、
  robustness は「同じ例外が繰り返している」を出して別の出口を前に出す案。
  ui は r1-20 で「直値を残して検査を足す」案と「トークンへ寄せる」案の両論を残している。

## 見ていない範囲

- **実プロセスでの挙動を1つも見ていない。** `data-tauri-drag-region` が実際に効くか、
  `getCurrentWindow().close()` が実際にウィンドウを閉じるかは、tauri 2.11.1 の
  `src/window/scripts/drag.js:51-70` を読んだ静的な判断のみ。
- Rust 側（`src-tauri/`）はこの差分に含まれないため未読。
- `RuntimeProviders` の中身（どの provider がレンダ中に throw しうるか）は未確認。
- `AnalysisPane` / `GameBoard` の内部が実際にどこで throw するか。
- 新規テストへ変異を当てて落ちることは reviewer は確認していない（実装側が確認済み: 5ケースとも落ちる）。
- スクリーンショット（`docs/images/`）が古くなったかは未確認（通常時の描画は変えていない）。

## lint / hook で強制できるもの

- **`.tsx` のインライン `style={{}}` に現れる寸法・色リテラル**。`scssScaleRatchet` / `contrastRatchet` は
  `scssFiles(SRC)` しか歩かないので、いま完全に素通し。`tsFiles` を歩いて数え、
  許可リストに `RootErrorFallback.tsx` を明示する形にすれば「最後の砦だから直値」という例外が
  **意図した1ファイルだけ**に留まっていることを機械で保てる。いまは例外が無言で増やせる。
- **fallback の文言リテラルの重複**。「表示中にエラーが発生しました。」が2箇所に手書きされていることは、
  既存のソース走査ラチェットと同じ形で「この綴りは1箇所だけ」を固定できる。
- **`RootErrorFallback` の帯の高さと `$titlebar-height` の一致**。`modalOverlayTitlebar.test.ts` と
  同じ形で書ける（`.tsx` を文字列として読むだけ）。
- **doc に書かれた「N箇所」**。`AppErrorBoundary` を含む行に `N箇所` の綴りが出たら落とす走査。
  今回腐った `ADR-0004:221` と `failure-surfacing.md:166` はどちらもこの形。
- **`vi.mock` の2階層以上の相対パス**。`shellErrorBoundary.test.tsx:25` の `vi.mock("../../providers/...")` は
  `DEEP_RELATIVE_IMPORT` が禁じる形だが `no-restricted-imports` は静的 import しか見ない。
  `testsLayerBoundary.test.ts` の走査に1本足せば止まる（同型が既存に5件ある）。
- **浮いた promise**（`TitleBar` の3つ）。typed lint か、既存の `asyncResultUse.test.ts` と同じ走査。

## 修正計画（r1 → r2）

### 束（同じ根から出ている所見）

- **見た目の束**: r1-01 → r1-19, r1-23, r1-21, r1-20, r1-22（既定 fallback が面も高さも持たず、
  寸法と色がインライン直値で、それが2ファイルに複製されている）。SCSS へ寄せて面を持たせると
  5件の指摘箇所が消える。
- **本文の束**: r1-13 → r1-11 の一部（本文が2箇所にあるので、案内を厚くしても片方だけになる）。
- **境界の契約の束**: r1-12 → r1-28（境界が名乗れば、コメントで補っていたものが型に載る）。
- **出典の束**: r1-29 → r1-06, r1-07, r1-08, r1-09, r1-10, r1-30
  （段構えの説明が5箇所に散っている。出典を1つに定めてから残りをリンクに落とす）。

### このラウンドで直すもの

| 順  | 所見                          | なぜこの順か                                                                                     | この直し方で壊しうるもの                                                                                                                                                                                                                                     |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | r1-01 + r1-19 + r1-23 + r1-21 | 束の先頭。SCSS へ寄せると寸法・色・輪郭・高さの4件が同時に消え、以後の commit が触る面が確定する | `contrastRatchet` の `MEASURED_COUNT`（84）が増える。**不透明トークンにしないと `UNMEASURED_COUNT`（401、下げる方だけ）が増えて落ちる。** `height: 100%` が `.workspace__boardPane`（grid / stretch）で伸びる                                                |
| 2   | r1-20 + r1-22                 | 1 の続き。SCSS になった時点で `2.6rem` と `#ff5f57` の写しをトークンへ寄せられる                 | `index.scss` にトークンを1つ足すので `scssScaleRatchet` の `indirect` に載らないか要確認。`modalOverlayTitlebar.test.ts` は `$titlebar-height` の実効値を見るので変えない                                                                                    |
| 3   | r1-13                         | 本文が1箇所になってから案内を厚くする（順を逆にすると片方だけ厚くなる）                          | 「表示中にエラーが発生しました。」を見ている3テストが、全部同じ実体を見るようになる。**どれか1つが偽陽性で緑になっていた場合、それが見えなくなる**                                                                                                           |
| 4   | r1-05                         | 失敗経路の門番の向きを変える。修正が積み上がる前に入れる                                         | root の境界が2枚になる。`UpdaterScreen` 側の境界が `null` を返すと**更新の失敗が完全に沈黙する**ので、既定 fallback を使う                                                                                                                                   |
| 5   | r1-02                         | 同上。`main` から在る欠陥だが、この PR が doc で段構えの一部として位置づけた                     | 境界を grid の子から外すと `AppModalLayer` の位置が変わる。`AppModalLayer.test.tsx` と `appLayoutKifuSwitch.test.tsx` が `.app-layout` の子構造を見ていないか要確認                                                                                          |
| 6   | r1-12                         | 機械で強制できる側。境界が名乗れば、以後のテストが「どの境界が受けたか」を直接見られる           | `label` を**必須**にすると既存4箇所の呼び出しが全部変わる。文言が変わるので既存3テストの `getByText` が落ちる                                                                                                                                                |
| 7   | r1-03（一部）                 | 門番の向き。`resetKeys` は機械側なので、案内（順11）より先に入れる                               | `getDerivedStateFromProps` を足すと、**`reset` を押した直後の再レンダでキーが同じでも `error` が復活しない**ことを確かめる必要がある。シェルに `pathname` を渡すと `/app/panel/A → B` の遷移で fallback が解ける（意図どおり）が、**遷移のたびに比較が走る** |
| 8   | r1-04（一部）                 | 案内の材料。順11 の文言はここで出す `error.message` を前提にする                                 | `throw` される値は `Error` とは限らない。刈らないと `undefined` が画面に出る                                                                                                                                                                                 |
| 9   | r1-16                         | 同上                                                                                             | `RootErrorFallback` が state を持つ。**fallback 自身が落ちると同じ境界では捕まらない**ので、state の更新経路を最小にする                                                                                                                                     |
| 10  | r1-11                         | 面・本文・材料が揃ってから案内を書く                                                             | 文言が長くなるので、`.workspace__dock` の狭い枠で溢れる。順1 の `overflow` の扱いを確認する                                                                                                                                                                  |
| 11  | r1-07 + r1-06（コード側）     | ここから下はコメントと doc。**現物が固まってから書く**                                           | 無し（コメントのみ）。ただし r1-06 は doc 側（順15）と**同じ文**なので、片方だけ直すと再び食い違う                                                                                                                                                           |
| 12  | r1-26                         | 公開面の契約                                                                                     | 無し                                                                                                                                                                                                                                                         |
| 13  | r1-27                         | 名前を揃える。順12 の doc が確定してから                                                         | `retry` → `reset` で `App.tsx` の受け渡しが変わる。テストの語も揃える                                                                                                                                                                                        |
| 14  | r1-25                         | 無し                                                                                             | 無し                                                                                                                                                                                                                                                         |
| 15  | r1-28                         | 無し                                                                                             | 無し                                                                                                                                                                                                                                                         |
| 16  | r1-29 + r1-06（doc 側）       | 出典の束の先頭。ここを決めてから残りの doc をリンクに落とす                                      | `app-layout.md` を正にすると、`failure-surfacing.md` は「台帳」を名乗りながら境界だけ外部を指す形になる。**台帳の他の行と作法が割れる**                                                                                                                      |
| 17  | r1-08 + r1-09                 | 順16 の出典が決まってから                                                                        | ADR-0004 は append-only。**決定そのものは触らない**（実測値の更新だけ。`OPERATING-MODEL.md:53-58` の1に当たる）                                                                                                                                              |
| 18  | r1-30                         | 同上                                                                                             | 無し                                                                                                                                                                                                                                                         |
| 19  | r1-10                         | 同上                                                                                             | 無し                                                                                                                                                                                                                                                         |
| 20  | r1-31                         | 最後。上の修正で観測点（`label` 付きのログ）が変わるので、変わってから固定する                   | `console.error` を素通しにすると `act` 警告で出力が荒れる。**潰すのをやめるのではなく、突き合わせを1つ足す**                                                                                                                                                 |

### 直さないもの

| 所見                        | 行き先                               | 理由                                                                                                                        |
| --------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| r1-14                       | **issue #512**                       | 選んだ設計（段構え）は「ヘッダとサイドバーは shell の境界が受ける」と決めてある。粒度を変えるのは別の判断。指摘自体は正しい |
| r1-15                       | **issue #511**（r1-03 の残りと同じ） | 解析専用の fallback から `stopAnalysis()` を呼ぶのは、境界の形そのものの設計。この PR の範囲を超える                        |
| r1-17                       | **issue #513**                       | `index.html` と `main.tsx` はこの PR が触っていない層。塞ぐ価値は高いが独立している                                         |
| r1-18                       | **issue #514**（r1-24 と同じ）       | `TitleBar` の既存の沈黙。`shared/api/window` への集約と一体で直すべき                                                       |
| r1-24                       | **issue #514**（r1-18 と同じ）       | 既存コードのリファクタ。「ついでの改名」を混ぜない                                                                          |
| r1-04（ログへ流す部分）     | **既存の #448**                      | `@tauri-apps/plugin-log` の導入は依存の追加を伴う。画面に出す部分だけこの PR で直す                                         |
| r1-03（繰り返し検出）       | **issue #511**（r1-15 と同じ）       | `resetKeys` までをこの PR で入れ、「同じ例外が繰り返している」の提示は別途                                                  |
| r1-21（ラチェット化）       | **`docs/IDEAS.md`**                  | `.tsx` のインライン直値を数える走査は 6週間以内に着手しない。この PR では直値そのものを消す                                 |
| r1-06（起動画面に枠が無い） | **issue #515**                       | 正常時は閉じるボタンが無く、落ちたときだけ出るという逆転。独立した不具合                                                    |

### 対象そのものを疑ったか

**31件のうち11件が `AppErrorBoundary` 1つに集まっている**（r1-01 r1-03 r1-04 r1-12 r1-13 r1-19
r1-21 r1-23 r1-26 r1-31 と r1-02 の一部）。集まっているのは、この部品が
**「境界」と「落ちたときの見た目」と「復帰の導線」の3つを1つの class に畳んでいる**ため。

落とす案を1行: **`AppErrorBoundary` を「捕まえる器」だけにし、見た目と導線を別のコンポーネントへ出す。**
今回の修正（順1〜3, 6, 7）は実質その方向で、`fallback` の既定を共有部品に、`label` と `resetKeys` を
器の側に置く。**器と見た目を完全に割るところまではやらない** —— この issue が要求しているのは
被覆であって分解ではなく、4箇所の呼び出しを持つ部品を同じ PR で割ると差分が読めなくなる。

所見が減らないラウンドが3回続いたら、そのときに分解を計画に載せる。

### 次ラウンドの焦点

次の `/review-round` は次を reviewer へ渡す。

1. **`contrastRatchet` / `scssScaleRatchet` の数**を、面を SCSS へ寄せたことで正しく動かせているか。
   `UNMEASURED_COUNT` を上げていないか（上げてよいのは「測れなかった段が対象に入る」場合だけ）
2. **`height: 100%` を足した fallback が、4つの親（`.workspace__boardPane` = grid/stretch、
   `.workspace__kifuPane` = flex、`.workspace__dock` = block、`.app-content` = block）で溢れないか**
3. **root の境界が2枚になったこと**で、`UpdaterScreen` の失敗が沈黙していないか
4. **`AppModalLayer` の境界を grid の子から外したこと**で、モーダルの重なりと `.app-layout` の
   行割りが変わっていないか
5. **`resetKeys` を足したこと**で、`reset` を押した直後にキーが同じでも `error` が復活しないか。
   `/app/panel/*` の遷移でサイドバーの開閉（`isSidebarOpen`）が既定に戻っていないか
6. **`label` を必須にしたこと**で、4箇所の文言と3本のテストが揃っているか
7. **同じ文が2箇所に残っていないか**（順16〜19 で出典を1つに寄せたはずのもの）
8. **`error.message` を画面に出したこと**で、`Error` でない値が投げられたときに `undefined` が出ないか

### 検証の見積り

20件 × TS のみの `verify`（`tsc -b` + `lint` + `vitest` + `test:hooks`）。
このブランチは `src-tauri/` を1行も触らないので `verify:rust` は走らない。
**実測で `verify` は 40〜60 秒**（このブランチで3回計測）なので、20件で 20〜30 分。
次ラウンドへ送ったものは無い（送ったのは「直さないもの」の表の行き先へ）。
