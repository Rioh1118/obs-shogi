# レビュー 436-error-boundary-layers ラウンド2

- 日付: 2026-09-08
- 範囲: `git diff origin/main...HEAD`（r1 の修正24件を含む）
- 走らせた reviewer: architecture / react / ui / robustness / comment / oss-hygiene
- 対象コミット: `1375bb04`
- 前ラウンド: [r1](2026-09-08-436-error-boundary-layers-r1.md)。その「次ラウンドの焦点」8点を各 reviewer へ渡した

## 所見

### [BLOCK] r2-01 falsy な値が投げられると、7枚の境界が1枚も受けずに root ごと消える

reviewer: react / robustness（両者が独立に実測）

- 場所: `src/shared/ui/AppErrorBoundary.tsx` の `State["error"]` / `getDerivedStateFromError` / `render`
- `error` を「捕まえたか」の旗に兼用している。`undefined` / `null` / `""` / `0` / `false` を投げると
  `getDerivedStateFromError` が返す `{ error: <falsy> }` を `render` の `if (error)` が通り抜け、
  **`children` をそのまま描き直す**。React は同じレンダでの2度目の例外を「境界が処理できなかった」と
  見なして外へ流すので、7枚とも同じ経路で素通りする。
- **実装側で実測（5値すべて）。** `render()` の外まで例外が抜け、`componentDidCatch` も走らないので
  `console.error` にも何も出ない。
- **この PR が消しに来た「閉じるボタンもドラッグ領域も無い白い窓」が、falsy な throw では今も残る。**
- 型が嘘を配っている点も同根: `fallback?: (error: Error, ...)` と書いてあるので、新しい fallback を
  書く人は `error.message` と書ける。`AppErrorFallbackBody` は `unknown` で受けて刈っており、
  そこだけ齟齬が無い。
- 結果: 対応済み `848fbafb` — `caught` を旗に分け、型も `unknown` に緩めた。5値とも実測で確認

### [HIGH] r2-02 モーダル層の鍵が、その層の9枚のうち2枚を見ていない。畳むと以後どのモーダルも出ない

reviewer: react / robustness / architecture（3人が独立に指摘）

- 場所: `src/pages/AppLayout.tsx`（`resetKeys={[modal]}`）、`src/pages/AppModalLayer.tsx`
- `FileConflictDialog` と `KifuReadErrorDialog` は URL の `modal` を1文字も見ず、`useFileTree()` の
  `conflict` / `kifuError` で出る。**この層でいちばん形の保証が無い2枚**が鍵の外に居る。
- 筋道: 壊れた棋譜を開く → `kifuError` が立つ → `KifuReadErrorDialog` がレンダで落ちる →
  境界が受ける → `modal` は `undefined` のままなので鍵は動かない → `clearKifuError` の呼び出し元は
  `AppModalLayer` の1箇所だけ（`rg` で確認）なので**原因を消す手段も畳まれている** →
  `再表示` も、別のモーダルを開いて鍵を動かしても、同じ行で落ち直す。
- 結果: **そのセッションでは設定も局面検索もファイル作成も二度と開かず、次の棋譜の読み込み失敗も
  同名ファイルの衝突も画面に出ない。** 失敗を見せる層が畳まれて、以後の失敗が全部沈黙する。
- 結果: 対応済み `a733aeab` — 鍵を数えるのを層の側（`useModalLayerResetKeys`）に置き、`conflict` / `kifuError` を入れた

### [HIGH] r2-03 `--floating` に高さの上限が無く、長い `detail` で上へ伸びてタイトルバーを覆う／画面外へ出る

reviewer: ui / robustness

- 場所: `src/shared/ui/AppErrorBoundary.scss` の `&--floating`
- 基底の `overflow: auto` は `height: 100%` と対で書かれている。`--floating` が `height: auto` に
  戻した時点で**このスクロールは一度も発火しない**。`max-height` も `top` も無い。
- `position: fixed` + `bottom` 起点なので、中身が伸びると**上へ**伸びる。`.app-root` は
  `overflow: hidden` で、ビューポート上端を越えたぶんはどんなスクロールでも到達できない。
  消えるのは名乗りと `detail` の冒頭 —— r1-04 で「画面に出す唯一の場所」と決めたその頭。
- 段は `$z-notification`(10000) で `$z-titlebar`(9999) より上。`Modal.scss` と
  `NotificationLayer.scss` はどちらも「帯は `decorations: false` のウィンドウを動かす唯一の手段だから
  覆わない」ために `top: $titlebar-height` を明示している。**`--floating` はその不変条件の外に出た
  最初の fixed 要素**で、幅は 60ch + padding ≒ 44rem なので 1280px 窓では帯の右半分が掴めなくなる。
- 結果: 対応済み `fd170502` — 帯を空けて `top` を置き、`max-height` を足した（r2-04 と同じ編集）

### [HIGH] r2-04 `--floating` が更新カード・通知と同じ角・同じ段に出て、更新のボタンを覆う

reviewer: ui / robustness

- 場所: `src/shared/ui/AppErrorBoundary.scss`、`src/features/updater/ui/UpdaterScreen.scss`、
  `src/shared/ui/notification/NotificationLayer.scss`、`src/index.scss` の「重なりの段」
- `--floating` は `right: $space-12; bottom: $space-12`。`.updater-overlay` は
  `bottom: 2.4rem; right: 2.4rem`（`$space-12` = 2.4rem）で**座標が完全一致**、段は fallback が上。
  面は不透明で `pointer-events` は既定。
- **r1-05 で `UpdaterScreen` を root の境界から分けた理由（修正版を受け取る導線を消さない）を、
  別の境界の fallback が物理的に塞ぐ。** `NotificationLayer.scss` は「更新カードは同じ角に立つ」を
  名指しで警告していて、そこに3人目が入った。
- 逆向きも成立: `.notice-layer` は `#modal-root`（DOM で後ろ）へ portal され同じ z-index なので、
  トーストが fallback の上に来る。
- モーダル層と更新の知らせの fallback は right / bottom / z-index が1つも違わないので、
  両方出ると後勝ちで片方に触れなくなる。
- 結果: 対応済み `fd170502` — 右下から右上へ移した。ui の「帯の直下・中央」でなく robustness の「右上」を採ったのは、中央だと本体の作業面を隠すため

### [HIGH] r2-05 `hint` を足したのに7枚中1枚にしか渡していない。既定 fallback からは渡す手段が無い

reviewer: robustness

- 場所: `src/shared/ui/AppErrorBoundary.tsx`（既定 fallback は `hint` を渡さずに `AppErrorFallbackBody` を呼ぶ）
- 筋道: `buildStreamRowsFromCursor` が投げる（`KifuStreamList` の `TODO`）→ 棋譜一覧の境界が受ける →
  利用者が見るのは「棋譜一覧を表示できませんでした。／ `plan walk overflows` ／ `再表示`」。
  **次に何をすればよいかは0行**で、`再表示` は同じカーソルなので必ず落ち直す。
- `hint` という仕組みを足しながら、案内が要る6箇所には構造的に使えない。
- 結果: 対応済み `e69489b9` — `hint` を境界の prop にして既定の fallback へ素通しし、6枚に文言を置いた。出口のボタンは #511

### [HIGH] r2-06 `resetKeys` の doc が、鍵を更新しないと起きる失敗を取り違えている

reviewer: comment（変異を当てて実測）

- 場所: `src/shared/ui/AppErrorBoundary.tsx` の `getDerivedStateFromProps` の doc
- 「落ちたまま鍵だけ2回動くと…1回目の変化で解けた後に2回目で解け直せなくなる」と書いてあるが、
  鍵を更新しない実装で実際に起きるのは**`getDerivedStateFromProps` が毎レンダ `error` を消し続け、
  境界が二度と捕まえられなくなって例外が外まで抜ける**こと。
- テストは変異を殺すが、殺している理由はコメントが書いた条件ではない。
  **この repo で4ラウンド続いた「理由と条件のずれ」と同じ型**が、いちばん読み解きにくい6行に入っている。
- 結果: 対応済み `5107ba09` — 実際に起きること（毎レンダ `error` を消し続けて例外が外へ抜ける）に書き換えた。テスト名も揃えた

### [HIGH] r2-07 「`.app-root` の外に出た fallback は `App.scss` の器を持たない」が嘘

reviewer: comment

- 場所: `src/app/App.tsx` のコメント、`src/app/RootErrorFallback.scss`
- `RootErrorFallback` は `position: fixed; inset: 0` で `.app-root` に一切依存しない。`main.tsx` で
  包んでも見た目は変わらない。**本当の理由は同じファイルの数行下にある** ——
  上げると `UpdaterScreen` の境界まで内側に入り、本体の事故で更新の導線まで畳まれる。
- r1-07 で一度直した段落に、別の嘘を入れ直したことになる。
- 結果: 対応済み `8fd3501a` — 本当の理由（`UpdaterScreen` を巻き込む）に差し替えた

### [HIGH] r2-08 ボタンの面を選んだ理由（3:1）が数値で成り立たず、直下の `--secondary` がその主張を破る

reviewer: comment / ui

- 場所: `src/shared/ui/AppErrorBoundary.scss` の `&__action` のコメントと `&--secondary`
- `#1c2325`（輝度 0.0150）に対して 3:1 を満たす枠線の輝度は 0.1475 以上（≒ `#6c6c6c`）で、
  本文 `#dcd7c9`（輝度 0.680）より**暗い**。「本文より明るくなる」は逆で、根拠が成立しない。
- `--secondary` は `$surface-raised`（`#3c4244`）で地との比 **1.56:1**。「面で境を作る」と言いながら、
  2つ目のボタンでは面が境になっていない。r1-23 で枠線をやめた判断が、後から足したボタンで崩れている。
- さらに hover の `$surface-overlay` は `color-mix(..., transparent)` = `rgba(#1c2325, 0.88)` で、
  この面（`#1c2325`）の上では**合成結果が地と完全に一致する**。
  **マウスを載せた瞬間に境が 1.00:1 になって消える。** 主ボタンとホバーの意味が逆になっている。
  コントラストの走査は `$surface-overlay` を不透明として 11.08:1 と報告するので**検査では止まらない**。
- 結果: 対応済み `ad7d5c45` — hover を面から枠へ移した。主ボタンの 3:1 の根拠も実際の数値に書き換えた

### [HIGH] r2-09 出典に定めた節が、この PR が同時に立てた穴を1つも載せていない

reviewer: oss-hygiene

- 場所: `docs/spec/screens/app-layout.md` の「失敗の見せ方」と「いま満たしていないこと」、`docs/spec/screens/boot.md`
- 節の冒頭は「どこで throw しても、ウィンドウを閉じる手段は画面に残る」と無条件で言い切り、
  「いま満たしていないこと」からは `→ #436` の行を削っただけで代わりが入っていない。
  `grep -rn "511\|512\|513\|514\|515" docs src` の結果は **0件**。
- `docs/spec/README.md` は「**無いものを『無い』と書く。** 復帰導線が無い…は仕様である」を
  `screens/` の書き方として定めている。いまの節は**在る部分だけ**を出典として持ち、
  知っていて残した穴を1つも持っていない。#513 が記述しているのは、まさにその閉じるボタンが無い窓。
- 結果: 対応済み `597fc829` — 主語を「レンダ例外なら」に限定し、「いま満たしていないこと」に #511 / #512 / #513 を足した

### [MEDIUM] r2-10 `label` が境界と fallback に別々に手書きされ、`fallback` の signature が渡さない

reviewer: react / architecture

- 場所: `src/shared/ui/AppErrorBoundary.tsx` の `fallback` の型、`src/app/App.tsx`、
  `src/app/RootErrorFallback.tsx`、`src/pages/AppLayout.tsx`
- 3つの名乗りが6箇所に手書きされている（`画面`×2 / `更新の知らせ`×2 / `モーダル`×2）。
  `画面` の2つは別ファイルで、`label` が効くのはログだけ、画面に出る文字は `RootErrorFallback` が
  独立に持つ。**`label` を必須にした目的（ログと画面の両方から受け側を名指しできる）が、
  fallback を渡した3枚では成立していない。**
- 型も弱い。名乗りは `app-layout.md` の表が定める閉じた7語の集合なのに `label: string`。
- 結果: 対応済み `52dd6611` — `fallback` の引数をオブジェクトにして `label` を渡し、名乗りの出典を境界1箇所にした

### [MEDIUM] r2-11 `floating` は境界の位置の性質なのに、`fallback` の穴を通って2箇所に散っている

reviewer: architecture

- 場所: `src/app/App.tsx`、`src/pages/AppLayout.tsx`
- 2箇所の `fallback` は「既定の本文をそのまま描いて `floating` を真にするだけ」の閉包。
  `fallback` は自らの doc で「危険な全置換の穴」だと書いている経路で、既定の本文を手で組み直している。
  既定の本文に段が増えたとき、この2箇所だけ古い形で残る。
- `AppErrorBoundary` に `floating` を持たせれば、`AppErrorFallbackBody` の外部利用者が
  `RootErrorFallback` の1つだけになる。
- 結果: 対応済み `b303ac16` — `floating` を境界の prop にした。`fallback` を渡すのは root の1箇所だけになった

### [MEDIUM] r2-12 `AppErrorFallbackBody` の `children` が、同じファイルの `AppErrorBoundary` の `children` と逆の意味

reviewer: react / comment

- 場所: `src/shared/ui/AppErrorBoundary.tsx`
- 片方は「落ちうるツリー」、もう片方は「`__actions` の中に入る `<button>`」。
  `<AppErrorFallbackBody …>{原因のツリー}</AppErrorFallbackBody>` と書いても型は通り、
  `fallback` の doc が禁じている状況（落ちた本文の中で落ちたツリーが再登場する）になる。
- `children` の暗黙の契約（`button` 1個、`--secondary` の class 前提）も名前から読めない。
- 結果: 対応済み `613b042f` — `actions` に改名した（r2-13 と同じ編集）

### [MEDIUM] r2-13 `app/` が `shared/ui` の BEM class 名を文字列で手書きしている

reviewer: ui / architecture

- 場所: `src/app/RootErrorFallback.tsx`（`className="app-error-fallback__action app-error-fallback__action--secondary"`）
- 結びつけているのが型でもモジュールでもなく文字列なので、`shared` 側が `__action` を改名・整理すると
  **このボタンは黙って素の `<button>`（UA 既定の灰色）に戻る**。落ちる場所は「最後の砦」の画面で、
  tsc も lint もテストも赤くならない。
- `--secondary` は `shared/ui` に定義があるのに利用者は `app/` の1箇所だけ、という形にもなっている。
- 結果: 対応済み `613b042f` — `AppErrorFallbackAction` を出し、class 名を `shared/ui` の中に閉じた

### [MEDIUM] r2-14 `__closeError` が絶対配置で「再表示」と「ウィンドウを閉じる」を覆いうる

reviewer: ui / robustness

- 場所: `src/app/RootErrorFallback.scss`
- 本文が `detail` と `hint` で縦に伸びると、`__actions` は容器の下端から 24〜54px、
  `__closeError` は 24〜約 88px を占め、**完全に内側に入る**。`<p>` は `pointer-events` を
  切っていないので、2つのボタンは見えないうえに押せない。
- この帯が出るのは「閉じるボタンが効かなかった」ときで、そこで唯一残る操作がその2つ。
  **失敗を知らせる箱が、失敗をやり直す手段を消す。**
- 結果: 対応済み `a3ef6eb1` — `notice` として出口の下に流れで置いた

### [MEDIUM] r2-15 作業画面の `resetKeys={[pathname]}` は、畳んでいる間に動かせる経路が1つも無い

reviewer: react

- 場所: `src/app/routing/RuntimeShell.tsx`、`src/app/routing/AppRouter.tsx`
- `panel/*` は `filetree` 1本しか無いので、シェル配下で `pathname` が動くのは初回リダイレクトだけ。
  その `<Navigate>` は畳まれる側（`AppLayout` の `Outlet`）に居る。この境界が受けると
  ヘッダもサイドバーも消えるので、**利用者が `pathname` を動かせる導線はゼロ**。
- 実際に動く URL（`?modal=` `?tesuu=` `?branch=`）は `pathname` に出ないので鍵は反応しない。
  コメントと doc だけが「復帰できる」と読める。`useLocation().key` なら遷移のたびに1回だけ変わる。
- 結果: 対応済み `b10053b6` — `location.key` にした。畳まれている間に遷移を起こす導線が無いことはコメントに書いて #511 へ

### [MEDIUM] r2-16 `label="画面"` が何も名指していない。しかも「作業画面」と並ぶ

reviewer: robustness

- 場所: `src/app/App.tsx`、`docs/spec/screens/app-layout.md` の表
- 「画面」と「作業画面」は利用者から見て同じものを指す語で、**どちらが出たのかを言葉から区別できない。**
  `label` の doc が求める「利用者が画面で指せる呼び方」を root だけが満たしていない。
- 結果: 対応済み `43f0ffec` — 「アプリ」にした

### [MEDIUM] r2-17 画面に出す `detail` が、内部の英語識別子か `[object Object]` になる

reviewer: robustness

- 場所: `src/shared/ui/AppErrorBoundary.tsx`
- レンダ経路で実際に投げられる文言は `plan walk overflows` / `resolveLine failed at te=12 forkIndex=0` /
  `useGame must be used within GameProvider` など**全て開発者向けの英語**。
  `__detail` は報告用としては正しいが、いま画面にはこれ1行しか出ていない（r2-05）ので、
  利用者が読む唯一の説明が内部語になっている。
- plain object を投げると `String({})` = `[object Object]` がそのまま出る。
- **機微な情報の漏れは見つからなかった**（レンダ経路の `throw` に絶対パスを載せているものは無く、
  `dangerouslySetInnerHTML` は0件、React が `{detail}` をエスケープする）。
- 結果: 対応済み `fda7a758` — `String()` をやめ、見出しを添えて `hint` と役割を割った

### [MEDIUM] r2-18 閉じるボタンの寸法が3通りに書かれていて、doc の「同じ形」が現物と違う

reviewer: ui

- 場所: `src/app/RootErrorFallback.scss`、`src/shared/ui/TitleBar.scss`、`src/app/RootErrorFallback.tsx` の doc
- 共有されたのは `$color-window-close` と `$titlebar-height` だけ。丸の大きさは
  `TitleBar.scss` の直値 `1.2rem` / ローカル変数 `$titlebar-button-size` / `index.$space-6` の3通り。
  `TitleBar` にある `padding: 0.14rem` が `RootErrorFallback` には無いので、12px の丸では見て分かる差になる。
- 結果: 対応済み `7b3d0648` — 丸の大きさ・padding・帯の塗りをトークンにして共有した。`scssScaleRatchet` の3つの枠が下がったので数も下げた

### [MEDIUM] r2-19 足した3トークンのうち2つは、コメントが書いた置き場の理由に当たらない

reviewer: architecture

- 場所: `src/index.scss`
- 「3色まとめて置くのは、`TitleBar` と root の fallback が同じ帯を別々に描くため」が成り立つのは
  `close` だけ。`minimize` / `maximize` は利用者が1つで、揃える相手が居ない。
- このファイルは「1利用者でもここに置く」場合に機械的な理由を残す作法を持っている
  （`$floating-note-header-height` は「ローカル変数に下ろすとラチェットの `indirect` が増える」と書いてある）。
- 結果: 対応済み `8c54325e` — 「3色は1組で意味を持つ」に書き換えた

### [MEDIUM] r2-20 「`AppModalLayer` は `createPortal` なので」が現物と違う

reviewer: comment

- 場所: `src/pages/AppLayout.tsx` のコメント、`src/shared/ui/AppErrorBoundary.scss`
- `AppModalLayer.tsx` に `createPortal` は無い。in-flow の子が0なのは、各モーダルが閉じているとき
  `return null` し、開いたときだけ `shared/ui/Modal.tsx` が portal するため。
- 守るべき条件は「`AppModalLayer` の子に、平常時 in-flow の要素を返す部品を足さない」という
  **追加時に破れる**制約なのに、それがどこにも書かれていない。
- 結果: 対応済み `b303ac16` — 「`AppModalLayer` の子は閉じている間 `null` を返し、開くと `Modal` が portal する」に直し、追加時に破れる制約も書いた

### [MEDIUM] r2-21 `App.tsx` のコメントが、`app-layout.md` が出典と宣言した表を丸ごと写している

reviewer: comment

- 場所: `src/app/App.tsx`
- 同じ PR で ADR-0004 と台帳からこの記述を剥がして「出典は app-layout.md。ここに写さない」と決めたのに、
  コード側の写しだけが残っている。しかもこの段落は r1-07 で一度腐った実績がある。
- **いまの記述は現物と一致している。** 壊れるのは次の変更のとき。
- 結果: 対応済み `8fd3501a` — 一覧を落として `app-layout.md` への参照1行にした

### [MEDIUM] r2-22 段構えの表の1行目「窓の中身の全部」が、2行目と `App.tsx` の意図に矛盾する

reviewer: oss-hygiene

- 場所: `docs/spec/screens/app-layout.md` の表
- 2つの境界は `.app-root` の**兄弟**で、root が受けても `UpdaterScreen` は描かれ続ける。
  表だけを読むと「root が受けたら更新の知らせも消える」と読め、`58f480c6` で分けた理由が
  その決定を記録する当の表で打ち消されている。**7行のうち内容が食い違うのはこの1セルだけ。**
- 結果: 対応済み `597fc829` — 「`/` と `/app` の全部（更新の知らせを除く）」にした

### [MEDIUM] r2-23 台帳の「残るか」が、`resetKeys` を入れた後は無条件では偽

reviewer: oss-hygiene

- 場所: `docs/state-transitions/failure-surfacing.md` の §0 の表と G-3 の行
- どちらも最終列が「残る」のまま。実装は鍵が変われば `error` を落とすので、
  行き先を変える／モーダルを閉じるだけで**利用者の操作なしに fallback は消える**。
- G-3 の「次の操作」欄だけ直して「残るか」欄を残したので、同じ行の中で食い違っている。
- 結果: 対応済み `fbd1b972` / `20b3cddd` — §0 の表・G-3・※ の3箇所に「鍵が動けば解ける」を書いた

### [MEDIUM] r2-24 ADR-0004 の「割り当て」表のセルを、※ を添えずに書き換えている

reviewer: oss-hygiene

- 場所: `docs/decisions/0004-notification-taxonomy.md` の G-3 のボタン欄（`再読み込み` → `再表示。戻らなければ再起動`）
- この列は実測ではなく「そうあるべき」を書く列（同じ表の F-4 に「※ 再試行の口が実装に無い」がある）。
  `再読み込み` は一度も実装されていない。
- `OPERATING-MODEL.md` が `main` 後に許すのは実測値の更新・誤記の訂正・supersede の印だけ。
  過去に同じ表を書き換えた `a435ba40` は、セルの変更と同時に「なぜ割り当てを変えたか」の ※ を足している。
- 結果: 対応済み `4458a9fd` — ボタン欄を `再読み込み` に戻し、実測との差を ※ に書いた。決定そのものは触っていない

### [MEDIUM] r2-25 ADR-0003 が、この PR で消えた直値を現在形の例として挙げたまま

reviewer: oss-hygiene

- 場所: `docs/decisions/0003-scss-scale-tokens.md`、`docs/IDEAS.md`
- 「`style={{ … }}` は44箇所あり、`AppErrorBoundary.tsx` と `KifuImportForm.tsx` は寸法を直書きしている」。
  実測では両ファイルとも一覧に出ない。総数は `origin/main` で 37、このブランチで 35。
- 同じ PR で `IDEAS.md` に同じ事実を新規に書いたので、**同じ事実が2箇所**に、片方は腐った例つきで載った。
  この PR の主題（出典を1箇所に定める）と逆を行っている。
- 結果: 対応済み `4e9e8333` — 35箇所・22ファイルに更新し、測定日とブランチを添えた

### [MEDIUM] r2-26 `IDEAS.md` の追記先が、その節の見出し・前書き・出典のどれとも合っていない

reviewer: oss-hygiene

- 場所: `docs/IDEAS.md` の「SCSS の既存の負債（`refactor/app-shell-wiring` のレビューで出たもの）」
- 足した項目は `.tsx` のインライン style の話で、出典も別のレビュー。同じファイルには
  「**SCSS の話ではない**ので上の節とは分けてある」という先例が既にある。
- 結果: 対応済み `b388037d` — 由来ごと独立した節に出した

### [MEDIUM] r2-27 出典に定めた節へ、コード側からも隣の仕様書からも辿り着けない

reviewer: oss-hygiene

- 場所: `docs/spec/screens/app-layout.md` の「対象:」行、`docs/spec/README.md`、
  `docs/spec/screens/system-dialogs.md`、`docs/spec/screens/kifu-stream.md`
- 節が出典として説明する4ファイル（`App.tsx` / `RuntimeShell.tsx` / `RootErrorFallback.tsx` /
  `AppErrorBoundary.tsx`）が**どれも「対象:」行に無い**。`UpdaterScreen` を持つ `system-dialogs.md` は
  境界に触れず、`kifu-stream.md` は3ペインで唯一リンクを持っていない（`board.md` と
  `analysis-pane.md` は受け取った）。
- **「出典を1箇所に定めた」の効き目は、そこへ辿り着ける人の数で決まる。**
- 結果: 対応済み `f1877eaa` — 「対象:」行・`docs/spec/README.md`・`kifu-stream.md`・`system-dialogs.md` の4箇所に導線を作った

### [MEDIUM] r2-28 `→ #295` は CLOSED の issue を指しており、この PR が参照を1つ増やした

reviewer: oss-hygiene

- 場所: `src/pages/AppLayout.tsx`（`7fbd5673` で追加）、`KifuStreamList.tsx`、`buildStreamRows.ts`、
  `docs/spec/screens/kifu-stream.md`（2箇所）
- `#295` は `CLOSED` / `COMPLETED`（2026-09-02）。コメントは「#277 に吸収した。本文はここに残っている」。
  GitHub 上では紫の「Closed as completed」に見えるので、読んだ人はまず「もう直っている」と読む。
  いま5箇所が同じ死に番号を指している。
- 結果: 対応済み `c0028268` — 5箇所とも `#277`（症状は `#295` の本文）へ向けた

### [MEDIUM] r2-29 消えた文言を現在形で引いているコメントが1つ残った

reviewer: oss-hygiene

- 場所: `src/features/position-navigation/ui/PositionNavigationModal.tsx`
- 「モーダルが丸ごと『表示中にエラーが発生しました』に置き換わる」。この綴りはリポジトリの
  他のどこにも無い（`1c7d896d` で `{label}を表示できませんでした。` に変えた）。
- 境界の**呼び出し側**のコメントは4箇所そろえたが、境界に落ちることを説明している**利用側**が
  取り残された。
- 結果: 対応済み `9e843035` — 文言を写すのをやめた

### [MEDIUM] r2-30 テストの語がまだ4通りある（r1-27 の統一が届いていない）

reviewer: comment

- 場所: 境界のテスト4本
- `Thrower`（`AppErrorBoundary.test.tsx`）/ `Throwing`（`shellErrorBoundary.test.tsx`）/
  `throwing`・`throwingIn`（`appLayoutPaneBoundaries.test.tsx`）/ `updaterThrowing`・`throwing`
  （`rootErrorBoundary.test.tsx`）。`throwing` は真偽値の場合とレコードの場合がある。
- `a07c85be` は「テストの語も揃えた」と記録しているが、4本並べると揃っていない。
- 結果: 対応済み `68dfbe4c` — 部品は `Throwing`、旗は `throwing`、モックを作る関数は `mockThrowing` に揃えた

### [MEDIUM] r2-31 更新の適用（`再起動して適用`）の失敗が投げっぱなしで、押しても何も起きない

reviewer: robustness

- 場所: `src/features/updater/lib/useUpdater.ts` の `restart`、`src/features/updater/ui/UpdaterScreen.tsx`
- `relaunch()` が reject すると `void` で捨てられ、unhandled rejection になる。ハンドラは
  リポジトリに1つも無い。`status` は `ready` から動かないので、何度押しても同じ。
- `useUpdater` には `phase: "error"` という出口が既にあり、`downloadAndInstall` は `catch` している。
  **この呼び出しだけ使っていない。**
- **`main` から在る欠陥**で、レンダ例外ではない（境界は関与しない）。
- 結果: **見送り** → 既存の #405 へコメント（`#issuecomment-5589319833`）。`main` から在る非同期の握り潰しで、レンダ例外ではない

## 重複・矛盾した知見

- **r2-01 と r2-10 は同じ根**（`fallback` の型と `State` が `Error` を名乗っている）。r2-01 を直すと
  `fallback` の signature を触るので、r2-10（`label` を渡す）と同じ編集になる。
- **r2-03 / r2-04 / r2-11 / r2-13 も同じ根**（`--floating` という表示の都合が `fallback` の穴を通って
  呼び出し側に散り、SCSS の段が名前を持たないまま借りられている）。
- **r2-05 / r2-12 / r2-13 も同じ根**（本文に何を並べるかの口が `children` と `fallback` に割れている）。
- **矛盾**: ui は `--floating` を「右下から外して帯の直下・中央へ」、robustness は「右上へ」と言う。
  どちらも「通知と更新カードの角を避ける」が根拠で、**位置は判断が要る**。
- architecture は「r1 の『器と見た目を割るのは今回やらない』はいまも妥当」と明言し、
  r2 の集中が薄まったこと（31件中11件 → この表で `AppErrorBoundary` の API に当たるのは4件）を数えている。

## 見ていない範囲

- **実プロセスでの重なりを誰も見ていない。** `--floating` と更新カード・通知の重なり、
  `data-tauri-drag-region` が実際に効くか、`getCurrentWindow().close()` が実際に閉じるかは
  すべて宣言と DOM 順からの静的な判断。
- `FileConflictDialog` / `KifuReadErrorDialog` の内部でどの行が実際に throw しうるかは特定していない。
- `src-tauri/` は差分に含まれないため未読。
- スクリーンショット（`docs/images/`）は突き合わせていない。
- 棋譜一覧の境界は7枚のうち唯一どのテストにも通っていない。

## lint / hook で強制できるもの

- **`getDerivedStateFromError(error: Error` の綴り**（r2-01）。ソース走査で落とせる。
  型を `unknown` に緩めれば `error.message` を書いた瞬間に tsc が止める。
- **`label` の union 化と、`app-layout.md` の表の「名乗り」列との一致**（r2-10）。
  `docsIdentifiers.test.ts` と同じ形。いま表と実装を繋ぐものは何も無い。
- **`shared/` の BEM class 名を `shared/` の外の `.tsx` が文字列で書いていないこと**（r2-13）。
  同型が3件ある（`RootErrorFallback.tsx` と `appLayoutPaneBoundaries.test.tsx` の2箇所）。
- **`position: fixed` で `bottom` だけを持ち `max-height` も `top` も無い宣言**（r2-03）。
  `modalOverlayTitlebar.test.ts` は `.modal__*` しか見ないので、そこに穴が開いた。
  `scssFiles(SRC)` 全体を歩き、`z-index >= $z-titlebar` の fixed 要素に上端を止める宣言を要求する。
- **同じ `right`/`bottom` の組を持つ fixed セレクタの重複**（r2-04）。いま2件が完全一致。
- **`$z-notification` を借りている箇所が `index.scss` の「全体の並び」に列挙されていないこと**（r2-04）。
- **`docs/` と `src/` の `#N` が閉じた issue を指していないか**（r2-28）。ネットワークが要るので CI 側。
- **doc / コメントが `「…。」` で引用した画面の文言が、ソースに実在するか**（r2-29）。
  `docsIdentifiers.ts` は下線つき識別子しか見ないので、鉤括弧の中は完全に素通し。
- **`() => void someAsync()` の形**（r2-31）。`asyncResultUse.test.ts` と同じ走査。
- **`AppErrorBoundary` に `resetKeys` を渡さない呼び出し**（r2-02 の裏）。必須にして
  要らない箇所は `resetKeys={[]}` と明示させれば「鍵が無い」を型で落とせる。

## 修正計画（r2 → r3）

### 束（同じ根から出ている所見）

- **契約の束**: r2-01 → r2-10 → r2-11 → r2-12 → r2-13 → r2-05
  （`fallback` が「全置換の穴」1つしか無いので、`floating` も `label` も `hint` も
  呼び出し側が手で組み直すしかない。境界の prop に上げると、後ろ4件の指摘箇所が消える）
- **鍵の束**: r2-02, r2-15（どちらも「鍵がその境界の入力を覆っていない」）
- **右下の角の束**: r2-03 → r2-04（位置を決めれば高さの上限も同じ編集で入る）
- **面の束**: r2-08 → r2-19 の一部（ボタンの面と hover）
- **出典の束**: r2-09 → r2-22, r2-23, r2-24, r2-25, r2-26, r2-27

### 対象そのものを疑ったか

**31件のうち `fallback` prop の設計に由来するものが6件**（r2-01 r2-05 r2-10 r2-11 r2-12 r2-13）。
r1 では11件が `AppErrorBoundary` 全体に集まっていたので、集中は薄まりつつ**1つの prop に寄った**。

architecture が「r1 の『器と見た目を割るのは今回やらない』はいまも妥当」と数えて明言している。
**落とす案を1行**: `fallback` の全置換をやめ、境界が `floating` / `hint` / `label` を持ち、
`fallback` は「枠を自前で持つ必要がある root だけ」の口にする。これは分解ではなく穴を塞ぐ方向で、
順2〜6 が実質それに当たる。器と見た目のファイル分割は**今回もやらない**。

**所見が減らないラウンドが3回続いたら**（次が3回目）、そのときに分割を計画へ載せる。

### このラウンドで直すもの

| 順  | 所見          | なぜこの順か                                                                              | この直し方で壊しうるもの                                                                                                                                              |
| --- | ------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | r2-01         | BLOCK。この PR の前提を壊している                                                         | `State` の形を変えるので `getDerivedStateFromProps` の解除も直す必要がある。`fallback` を `unknown` に緩めると、既存の呼び出しが `error.message` を書いていれば落ちる |
| 2   | r2-11         | 束の先頭。`floating` を境界へ上げると `fallback` の利用者が1つに減り、順3〜5 が小さくなる | `AppErrorFallbackBody` の外部利用者が減るので、named export の必要性が薄れる（消さない。root がまだ使う）                                                             |
| 3   | r2-10         | 順2 で `fallback` が1箇所になってから signature を触る                                    | `fallback` の引数が増えるので root の呼び出しが変わる。**ログと画面の名乗りが揃うかをテストで固定しないと、また割れる**                                               |
| 4   | r2-12 + r2-13 | 順3 の続き。`children` → `actions` と、class を渡すのをやめるのは同じ編集                 | `--secondary` の利用者が `shared/ui` の中に移るので、SCSS の到達性が変わる                                                                                            |
| 5   | r2-05         | 契約が固まってから案内を書く                                                              | `hint` を6枚に足すと文言が増える。**`.workspace__dock` の狭い枠で溢れる**ので順6 の `overflow` と一緒に見る                                                           |
| 6   | r2-03 + r2-04 | 表示の不変条件。**位置は判断が要る**（下記）                                              | 位置を右上へ動かすと、`.app-content` の中身（ヘッダの右側のアイコン）に重なる。`max-height` を足すと基底の `overflow: auto` が初めて発火する                          |
| 7   | r2-08 + r2-19 | 面の束。順4 で `--secondary` が shared に閉じてから                                       | `$surface-raised` の語義（「いま触れない」）を借りるのをやめると、`contrastRatchet` の測れた対が動く                                                                  |
| 8   | r2-14         | 順5 で本文が縦に伸びるので、その前に重なりを解く                                          | `__closeError` を in-flow にすると本文の縦位置が動く。**動くこと自体が「状態が変わった」の手掛かり**になるので、これは意図した変化                                    |
| 9   | r2-17         | 順5 の `hint` と役割を割る                                                                | `[object Object]` を出さない刈り方にすると、plain object を投げたときに `detail` が空になる（`hint` が唯一の説明になる）                                              |
| 10  | r2-02         | 鍵の束。門番の向き                                                                        | `AppLayout` が `useFileTree()` を読むか、境界を `AppModalLayer` の中へ移すか。**後者は境界の位置が変わるので `appLayoutPaneBoundaries.test.tsx` が見る構造が変わる**  |
| 11  | r2-15         | 同上                                                                                      | `location.key` は遷移のたびに変わる。**同じ URL への `replace` でも変わる**ので、落ち続けるものを描き直す回数が増える                                                 |
| 12  | r2-16         | 名乗り。順3 で1箇所になってから                                                           | 文言が変わるので `rootErrorBoundary.test.tsx` と `app-layout.md` の表を同時に直す                                                                                     |
| 13  | r2-18         | 無し                                                                                      | `TitleBar.scss` の直値と `$titlebar-button-size` を畳むので、`modalOverlayTitlebar.test.ts` が見る値に触れないことを確認する                                          |
| 14  | r2-06         | ここから下はコメント。**現物が固まってから**                                              | 無し                                                                                                                                                                  |
| 15  | r2-07         | 無し                                                                                      | 無し                                                                                                                                                                  |
| 16  | r2-20         | 無し                                                                                      | 無し                                                                                                                                                                  |
| 17  | r2-21         | 無し                                                                                      | コード側から一覧を落とすので、**doc へ辿る導線（順22）が入るまで情報が減る**。同じラウンドで両方入れる                                                                |
| 18  | r2-29         | 無し                                                                                      | 無し                                                                                                                                                                  |
| 19  | r2-30         | 無し                                                                                      | 無し                                                                                                                                                                  |
| 20  | r2-09         | 出典の束の先頭                                                                            | 「いま満たしていないこと」に3行増える。**#511〜#515 を閉じるときにここも消す**必要がある                                                                              |
| 21  | r2-22 + r2-23 | 順20 の続き                                                                               | 無し                                                                                                                                                                  |
| 22  | r2-27         | 順17 が落とした導線をここで作る                                                           | 「対象:」行に4ファイル増えるので、`docsSourcePaths` の走査に載る                                                                                                      |
| 23  | r2-24 + r2-25 | ADR は append-only。実測値の更新だけに留める                                              | ADR-0003 の数（35）は**次に `style={{}}` を1つ足した瞬間に腐る**。数と一緒に測った日とブランチを添える                                                                |
| 24  | r2-26         | 無し                                                                                      | 無し                                                                                                                                                                  |
| 25  | r2-28         | 5箇所を同時に直す（1箇所だけ直すとどちらが正か分からなくなる）                            | `#277` は epic なので、症状の本文へ辿るには `#295` の番号も要る。**両方書く**                                                                                         |

### 直さないもの

| 所見  | 行き先                     | 理由                                                                                                   |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| r2-31 | **既存の #405 へコメント** | `main` から在る非同期の握り潰しで、レンダ例外ではない。#405「失敗を握り潰す TS の経路が4つ」がその台帳 |

### 判断が要る点（この計画で決めたこと）

**`--floating` の位置**（r2-03 / r2-04 で ui と robustness の案が割れた）。

- ui: 右下から外して帯の直下・中央
- robustness: 右上（`top: $titlebar-height + $space-6`）

**右上を採る。** 理由は3つ。(a) 右下は通知・更新カード・トーストの3者が既に取り合っていて、
`NotificationLayer.scss` がそれを名指しで警告している。(b) 帯の直下に `top` を置けば、
`Modal.scss` / `NotificationLayer.scss` と同じ不変条件（帯を覆わない）に自分も載る。
(c) 中央は本体の作業面を隠す。**`max-height` は位置と同じ編集で入れる。**

### 次ラウンドの焦点

1. **falsy な throw が7枚とも受け止められるか。** `undefined` / `null` / `""` / `0` / `false` の5値。
   `getDerivedStateFromProps` の解除経路も含めて
2. **`fallback` の穴が root の1箇所だけになったか。** `floating` / `hint` / `label` を境界へ上げた結果、
   呼び出し側で既定の本文を組み直している箇所が残っていないか
3. **`hint` を6枚に足したことで、狭い枠（`.workspace__dock`）で溢れていないか。**
   順6 の `max-height` と `overflow: auto` が効く範囲
4. **`--floating` を右上へ動かしたことで、ヘッダの右側（本アイコン・歯車）に重なっていないか**
5. **モーダル層の鍵を直したことで、`AppLayout` が `AppModalLayer` の入力を数え直す形になっていないか**
   （入力が増えるたびに黙って穴が開く形を作っていないか）
6. **`location.key` にしたことで、落ち続けるものを描き直し続けていないか**
7. **`app-layout.md` の表7行と実装7箇所の1対1**が、順2〜4 の編集の後も保たれているか
8. **ADR-0003 に書いた実測値（35）が、このブランチの最終状態と合っているか**

### 検証の見積り

25件 × TS のみの `verify`（実測 40〜60 秒）で 20〜30 分。`src-tauri/` は1行も触らない。
次ラウンドへ送ったものは無い。
