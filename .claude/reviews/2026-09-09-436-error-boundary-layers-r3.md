# レビュー 436-error-boundary-layers ラウンド3

- 日付: 2026-09-09
- 範囲: `git diff origin/main...HEAD`（r1 24件 + r2 30件の修正を含む）
- 走らせた reviewer: architecture / react / ui / robustness / comment / oss-hygiene
- 対象コミット: レビュー時 `1375bb04` 系列（**その後 `origin/main` へ rebase 済み**。r3-08 参照）
- 前ラウンド: [r1](2026-09-08-436-error-boundary-layers-r1.md) / [r2](2026-09-08-436-error-boundary-layers-r2.md)

## 所見

### [BLOCK] r3-01 `resetKeys` のテストで、失敗を説明したコメントが「その失敗が起きない行」に付いている

reviewer: comment（変異を当てて実測）

- 場所: `src/shared/ui/__tests__/AppErrorBoundary.test.tsx` の「落ちている間に鍵が動いても、境界は捕まえ続ける」
- コメントが付いた `rerender` の子は `boom={false}` なので、**実装によらず1回も throw しない**。
  「このレンダで throw が飛び出す」は偽。
- 変異（`getDerivedStateFromProps` から `keys` を落とす）で実際に落ちるのは**1つ前の rerender**
  （`resetKeys={["b"]}` / `boom` が真のまま）。
- r2-06 で `getDerivedStateFromProps` の doc の同じ取り違えを直したのに、**テスト側のコメントだけが
  古い理解のまま残った。** コメントを信じた次の読み手は、変異が死ぬ行を「関係ない」と読んで消す。

### [HIGH] r3-02 右上へ移した `--floating` が、ヘッダ右の「課題局面」「設定」を覆う。しかもその2つが鍵を動かす唯一の導線

reviewer: ui / robustness（2人が独立に算術で確認）

- 場所: `src/shared/ui/AppErrorBoundary.scss` の `&--floating`、`src/widgets/app-layout-header/ui/AppLayoutHeader.scss`
- 箱は viewport の `top: 2.6 + 1.2 = 3.8rem`（38px）、右端から 24px に立つ。`.app-layout` の1段目は
  `--header-h: 5.6rem` で **y=26〜82px**、`&__icon-btn` は 36px 角。1280px 窓で
  **「課題局面」は上端2pxを残して全部、「設定」は右12pxの帯を残して覆われる。**
  面は不透明、段は `$z-notification`(10000) でヘッダ（段なし）より上。
- **その2つのアイコンが `params.modal` を動かす導線**（`AppLayoutHeader`）。モーダル層の `hint`
  「別の操作からやり直してください」と解析の `hint`「設定からエンジンを選び直す」が名指しするのも同じボタン。
  **箱が、その箱を消す鍵を動かす導線の上に載る。**
- 更新の知らせの境界も同じ座標なので、両方畳まれると後勝ちで片方に触れなくなる（r2-04 が
  位置を動かしただけで解けていない）。

### [HIGH] r3-03 右上は通知の帯（banner）と同じ場所・同じ段。通知が後から描かれるので名乗りが隠れる

reviewer: ui

- 場所: `src/shared/ui/AppErrorBoundary.scss`、`src/shared/ui/notification/NotificationLayer.scss`
- 帯は `top: $titlebar-height` から幅いっぱいで下へ積む。`--floating` の上端は 38px、段はどちらも
  `$z-notification` で同値、`.notice-layer` は `#modal-root`（DOM で後ろ）へ portal されるので
  **通知が必ず上に描かれる。**
- 隠れるのは「◯◯を表示できませんでした。」の1行 —— **`label` を必須にした目的そのもの。**

### [HIGH] r3-04 鍵を持たない3枚の `hint` が、その操作だけで直るかのように読める

reviewer: robustness

- 場所: `src/pages/AppLayout.tsx` の盤 / 棋譜一覧 / 解析
- この3枚には `resetKeys` が無いので、案内どおり別の棋譜を開いても**境界は前のエラー画面のまま残る**。
  盤は別の境界なので新しい棋譜を描き直し、**「盤は新しい棋譜、一覧は『この棋譜は途中から一覧を組めません』」**
  という食い違いになる。実際は隣の `再表示` を押せば直るのに、`hint` はそれを一言も書いていない。
- `docs/spec/screens/app-layout.md` は「鍵を渡している境界以外は畳んだままになる」と正しく書いているので、
  **doc と画面の案内が正面から食い違っている。**

### [HIGH] r3-05 `fallback` を渡すと `hint` と `floating` が黙って捨てられる

reviewer: react / comment / architecture（3人）

- 場所: `src/shared/ui/AppErrorBoundary.tsx` の `render`
- `Props` は `fallback` と `hint` / `floating` を同時に渡せるが、`fallback` の枝は両方を読まずに捨てる。
  `hint` の doc は「置く側が決める」、`floating` の doc は「境界の位置の性質なので境界が持つ」と
  drift しない根拠として書いてあるのに、**実装は「既定の本文を使ったときだけ効く」に留まっている。**
- r2-11 が `floating` について塞いだ穴が、`hint` でそのまま残っている。
  `--floating` が要る境界に独自 `fallback` を足した瞬間、r1-02 で直した段割りの症状にテスト無しで戻れる。

### [HIGH] r3-06 `useModalLayerResetKeys` の doc が、このブランチで直した過去のバグを過去形で説明している

reviewer: comment

- 場所: `src/pages/AppModalLayer.tsx`
- 「`modal` だけを見ていた**間は**…鍵の外に**居た**」は `a733aeab` 以前の状態の説明で、現物のどの行にも
  対応しない。`CONTRIBUTING.md` の「『元は〜だった』も書きません。消したコードの説明は履歴の仕事です」に当たる。
- 読み手は「いまも2枚が鍵の外に居る」と読み違えうる。`commentHistory` の `HISTORY_WORDS` には
  この言い回しが無いので機械では止まらない。

### [HIGH] r3-07 `$surface-titlebar` の「なぜ」が、重なりの向きも背後の色も現物と逆

reviewer: comment / ui

- 場所: `src/index.scss`
- 3つとも成り立たない。(1) **論理が逆** —— 「下に何が居るかで見え方が割れる」のは半透明の性質で、
  不透明にすれば下が何であれ同じ色になる。半透明を選んだ理由として自分の主張を打ち消している。
  (2) 平常時の `.titlebar` は「作業面の上」に居ない（`.app-root` は flex column で `.app-content` は
  帯の**下**に並ぶ。`Modal.scss` と `NotificationLayer.scss` は `top: $titlebar-height` で帯を避けている）。
  (3) 落ちたときの `__chrome` も「`$color-primary-black` の上」ではない（`$color-primary-black` を塗る
  `.app-error-fallback` は `__body` の中＝帯の下）。
- 実際にはどちらの帯も同じ背後（canvas）を持つ。**いま同じ色に見えているのは、書いてある理由ではない。**

### [HIGH] r3-08 このブランチが `origin/main` の2コミット後ろに居て、docs 3ファイルが同じ節でぶつかる

reviewer: oss-hygiene

- merge-base `b216df34` に対し `origin/main` は `febcee04`。`failure-surfacing.md`（§0 の表に
  main が「通知」の行を足し「9つ」に更新）/ `system-dialogs.md`（main が「ここに数を書かない」を追加）/
  `IDEAS.md`（main が5節追加、`entities/search` の実測を更新）が衝突する。
- そのまま「自分の側を採る」で畳むと、**main の実測と規約が PR のマージで消える。**
- ADR-0003 に書いた実測（35箇所 / 22ファイル）も、rebase 後に取り直す必要がある。
- **結果: rebase 済み**（下記）。

### [MEDIUM] r3-09 鍵を数えるために、作業面ぜんぶを描く `AppLayout` が FileTreeContext を購読し始めた

reviewer: react / architecture

- 場所: `src/pages/AppLayout.tsx`、`src/entities/file-tree/model/provider.tsx`
- `origin/main` の `AppLayout` は `useGame()` しか読んでいなかった。いま `useModalLayerResetKeys()` 経由で
  `useFileTree()` の消費者になったので、provider の `value`（**毎レンダ新しいオブジェクト**。
  同ファイルの `TODO(#216)` がそう書いている）が変わるたびに再レンダする。
- 変わるのはツリーの行を1つ選ぶ・右クリック・フォルダの開閉 —— **どれも盤とも解析とも関係が無い操作。**
  `AppLayout` の子は1つも memo されていないので、再レンダは盤・駒台・棋譜一覧・解析・サイドバー・
  ヘッダに全部降りる。以前はツリーの行で止まっていた経路が作業面ぜんぶまで通る。

### [MEDIUM] r3-10 `useModalLayerResetKeys` の「この層が読む入力を全部並べる」が現物と違う。URL の4つが鍵の外に居る

reviewer: react / robustness / architecture

- 場所: `src/pages/AppModalLayer.tsx`
- 層の子が読む URL の入力は `modal` だけではない —— `params.tab`（`CreateFileModal` / `SettingsPanel`）/
  `params.dir`（`CreateFileModal`）/ `params.sfen`（`SfenKifuCreateModal` / `PositionSearchModal` /
  `StudyPositionSaveModal`）/ `params.returnTo`（`StudyPositionsManagerModal`）。**9枚のうち5枚。**
- **規則を厳密に満たしても畳みは解けない。** 層が畳まれている間、URL を動かせるのは層の外だけで、
  `AnalysisPaneHeader` の `openModal("position-search")` は `updateParams` が渡された鍵しか触らないので
  **`sfen` も `modal` も変わらない**。落ちた直後にいちばん自然な操作（もう一度「局面検索」を押す）が完全な無反応になる。
- 「読む入力を全部」は**足し忘れる形の規則**。`location.key` / `location.search` に寄せると、
  失敗の形そのものが消える。

### [MEDIUM] r3-11 `useModalLayerResetKeys` を実物で叩くテストが1本も無く、r2-02 の修正は変異を当てても落ちない

reviewer: react / architecture

- 場所: `src/pages/__tests__/` の3本（いずれも `vi.mock` で `useModalLayerResetKeys: () => []`）
- **鍵から `conflict` / `kifuError` を落としても `npm run verify` は緑のまま通る。**
  r2-02 は「そのセッションではどのモーダルも二度と出ない」という重さだった。
  `CLAUDE.md` が要求する「変異を当てて落ちることを確かめる」を満たしていない。

### [MEDIUM] r3-12 `AppErrorFallbackAction` の `onClick: () => void` が async を黙って飲み込む

reviewer: react

- 場所: `src/shared/ui/AppErrorBoundary.tsx`、`src/app/RootErrorFallback.tsx`
- `() => Promise<void>` は `() => void` に代入できる。いまの `close` は自分で try/catch しているので
  実害は無い —— **だからこそ、その try/catch を外しても型でも lint でもテストでも赤くならない。**
- ここは「押しても何も起きないボタン」を消すために `closeFailed` の state をわざわざ足した画面。

### [MEDIUM] r3-13 `RuntimeShell` のコメントで `key` が2つの意味を持ち、根拠が見ていない側の話になっている

reviewer: react / comment

- 場所: `src/app/routing/RuntimeShell.tsx`
- 1段目「`location.key` を**見る**」／最終段「`key` を**使わない**」で、同じ綴りが `useLocation().key` と
  React の `key` prop を指している。前後8行で正反対の動詞が付く。
- 「`panel/*` は `filetree` の1本だけ」も `pathname` の話で、`location.key` を選んだ以上**根拠にならない**
  （`?modal=` / `?tesuu=` でも動くと1段目が書いている）。実際に復帰できない理由は
  「畳んでいる間は遷移を起こす導線が画面に残らない」の方だけ。

### [MEDIUM] r3-14 境界の枚数「7枚」を、`App.tsx` が「ここに写さない」と決めた直後に `shared/ui` の2箇所へ写している

reviewer: comment

- 場所: `src/shared/ui/AppErrorBoundary.tsx`、`src/shared/ui/__tests__/AppErrorBoundary.test.tsx`
- `App.tsx` と `failure-surfacing.md` はどちらも「どこに何枚あるかは `app-layout.md` が持つ。
  ここに写さない —— 2箇所に置くと片方だけ直る」と明文で決めている。その決定の対象が2つ残っている。
- #512（ヘッダとサイドバー）を入れれば枚数は9になり、そのとき赤くなるテストは無い。
- **`shared/ui` の汎用部品が「アプリ側にいま何枚置かれているか」を知っていること自体がレイヤ的に逆向き。**

### [MEDIUM] r3-15 `--secondary` の枠の比が実測と合わず、隣接色を片側しか見ていない

reviewer: comment

- 場所: `src/shared/ui/AppErrorBoundary.scss`
- `$color-secondary-dark`（`#a27b5c`）と地（`#1c2325`）の比は実測 **4.19:1** で、書いてある 4.30:1 ではない。
  `$surface-raised` 側も 1.56:1（書いてあるのは 1.57）。結論は変わらないが、次に色を触る人は
  この数字を基準線として引き算する。
- 枠のもう一方の隣接色は自分の面 `$surface-raised` で、そこに対しては **2.69:1** しかない。
  1.4.11 を根拠に挙げながら隣接色を片側しか評価していない。
- 同じファイルの `__action` 側（3.33:1 / 3.02:1）は実測と一致しているので、ずれているのはこの1行だけ。

### [MEDIUM] r3-16 r2-20 で直した `createPortal` の誤りが、同じ所見に挙がっていた SCSS 側に残っている

reviewer: comment

- 場所: `src/shared/ui/AppErrorBoundary.scss` の `--floating`
- r2-20 は `AppLayout.tsx` と**このファイルの両方**を場所に挙げていたが、修正は `AppLayout.tsx` にしか入っていない。
  同じ事実について正しい説明と誤った説明が同居している。
- `--floating` を新しい場所に付けたい人が読むのはたいてい SCSS 側なので、
  「portal している部品なら安全」と読んで in-flow の箱を返す部品に付けうる。

### [MEDIUM] r3-17 `notice` / `actions` が `shared/ui/notification` の既存の語と衝突し、土台を通さない理由が無い

reviewer: comment

- 場所: `src/shared/ui/AppErrorBoundary.tsx`、`src/app/RootErrorFallback.scss`、`src/shared/ui/notification/Notice.tsx`
- 同じ `shared/ui` の中で `Notice` は「失敗を伝える箱」、`actions` はその箱に並ぶ `NotifyAction[]`（**データ**）の
  名前として既に使われている。`AppErrorFallbackBody` はどちらの綴りも借りて、
  `notice` に**箱ではなく任意の `ReactNode`**、`actions` に**データではなく描画済みの `ReactNode`** を入れている。
- `__closeError` は `$surface-fatal` + `$color-fatal-text` で `InlineNotice` と同じ役割の箱を手で組み直したものだが、
  **なぜ土台を通さないのかがどこにも書かれていない。** `CONTRIBUTING.md` は
  「失敗を利用者に出すときは、まず通知の土台を通してください」「箱を自分で作ると、手書きの出口が1つ増えます」と
  明文で求めている。

### [MEDIUM] r3-18 出典に定めた節が書く「どの鍵を渡しているか」が、r2 の修正後の現物と違う

reviewer: robustness / oss-hygiene

- 場所: `docs/spec/screens/app-layout.md`
- 「（作業画面は行き先、モーダル層は**モーダルの種類**）」は `8122701a` で書かれ、`a733aeab`（鍵に2枚を追加）と
  `b10053b6`（`pathname` → `location.key`）の後も更新されていない。
- この節は「段構えの出典」を名乗り、`App.tsx` と台帳が「ここに写さない」と言って指している唯一の場所。
  次に鍵を整理する人は `conflict` / `kifuError` を**余計な依存**と読んで落とせる（落としても何も赤くならない）。

### [MEDIUM] r3-19 `actions` / `notice` は境界から届かない。#511 が必ず `fallback` の穴を開け直す

reviewer: architecture

- 場所: `src/shared/ui/AppErrorBoundary.tsx`
- 本文が受け取れる7つのうち、境界が渡すのは5つ。`actions` / `notice` は `fallback` 経由でしか埋まらない。
- `app-layout.md` が残した穴「`再表示` は原因が境界の外にあると効かない → #511」の直し方は、
  各境界に本物の出口を並べること。その瞬間、6枚は `fallback` を渡して既定の本文を組み直すしかない
  —— **r2-11 が塞いだ穴を #511 が必ず開け直す。**

### [MEDIUM] r3-20 `--header-h` が2ファイルに別々の直値で置かれている

reviewer: ui

- 場所: `src/pages/AppLayout.scss`、`src/widgets/app-layout-header/ui/AppLayoutHeader.scss`
- `.app-header` は自分の上に同名のカスタムプロパティを**再宣言して継承を潰している**ので、2つの `5.6rem` は独立。
  片方だけ動かすと隙間が空くか `overflow: hidden` に切られる。どちらも検査を素通りする。
- r3-02 の直しでこの高さを第三者（`--floating`）が参照するので、出典が2つあるままだと3つ目がどちらを写すか決まらない。

### [MEDIUM] r3-21 2つの帯の閉じるボタンの横位置が、直値とトークンの2箇所で別々に決まっている

reviewer: ui

- 場所: `src/shared/ui/TitleBar.scss`（`padding: 0 1.2rem`）、`src/app/RootErrorFallback.scss`（`0 index.$space-6`）
- ボタンが画面のどこに立つかを決めているのは帯の左 padding で、そこだけが共有から漏れている（いまは偶然同値）。
  `7b3d0648` は大きさ・padding・塗りを寄せたが、この1つは直値のまま残った。
- `RootErrorFallback` の doc が「同じ窓の同じボタンだと分からなくなる」と名指しで防ごうとした症状そのもの。

### [MEDIUM] r3-22 この PR が立てた穴のうち #514 / #515 と「更新の適用の沈黙」が docs のどこからも辿れない

reviewer: oss-hygiene

- `grep -rn "#51[0-9]" docs src` は #511 / #512 / #513 だけ。#514 / #515 は docs にも src にも0件。
- `docs/spec/README.md` は「**無いものを「無い」と書く。**」「いま満たしていないこと — issue 番号つき」を
  `screens/` の書き方として定めている。#514 / #515 を閉じた人は消すべき doc の行を持たない。

### [MEDIUM] r3-23 issue #514 の本文が、この PR が書き換えた一文を「引用」しており、その文はもう存在しない

reviewer: oss-hygiene

- #514 は「`app-layout.md` は『どこで throw しても、ウィンドウを閉じる手段は画面に残る』と書いているが」と引用するが、
  現物は `8122701a`（と `597fc829`）で「レンダ例外なら」に限定済み。
- 拾う人は引用された文を grep して見つけられず、「doc を直せば済む話か、コードの話か」が読み手ごとに割れる。

### [MEDIUM] r3-24 報告書2本だけが `## 重複・矛盾した知見` を使い、規約と他140本の見出しから外れている

reviewer: oss-hygiene

- 規約（`review-round` の雛形）は `## 重複・矛盾した所見`。`.claude/reviews/` の他140本はそちら。
- `/review-plan` 手順1 がこの節を名指しで読むよう指示しているので、見出しがずれると横断 grep から落ちる。

### [MEDIUM] r3-25 リポジトリ入口の宿題4件（**#436 の範囲外**）

reviewer: oss-hygiene

- **CONTRIBUTING のブランチ名規約が実践と一致しない。** 規約は `issue-<番号>/<説明>`、
  マージ済み25本に `issue-` で始まるものは0本（このブランチも `fix/436-...`）
- **README / CONTRIBUTING の「前提」が Rust / Node / npm の3行だけ。** CI が Linux で入れている
  `libwebkit2gtk-4.1-dev` ほかの apt パッケージも、`rust-toolchain.toml` の `1.98.0` 固定も書かれていない
- **`AGENTS.md` が `vp install` / `vp check` / `vp test` を検証手順として提示している。**
  実際は `npm run verify` / `verify:rust` で、`vp test` は `test:hooks` も `cargo` も走らせない
- **`src-tauri/Cargo.toml` が雛形のまま**（`description = "A Tauri App"` / `authors = ["you"]` /
  `license = ""` / `repository = ""`）。Linux は `.deb` / AppImage を作るのでパッケージ metadata に載る。
  第三者クレートの帰属表示（`THIRD-PARTY` 相当）も0件

## 重複・矛盾した所見

- **`fallback` の穴の束**: r3-05（`hint` / `floating` が落ちる）と r3-19（`actions` / `notice` が届かない）は
  同じ根。境界と本文で「描けるもの」が食い違っている。
- **モーダル層の鍵の束**: r3-09（購読が上がった）/ r3-10（URL の4つが漏れ）/ r3-11（テストが無い）/
  r3-18（doc が古い）。react と architecture が独立に**同じ直し方**（境界を `AppModalLayer` の中へ入れ、
  鍵は `location` 由来の1つに寄せる）を提案しており、4件が1つの編集で消える。
- **`--floating` の位置の束**: r3-02 / r3-03 / r3-20。位置を決めるにはヘッダの高さをトークンにする必要がある。
- **矛盾**: r2 で ui は「帯の直下・中央」、robustness は「右上」を提案し、計画は右上を採った。
  **その右上が今回2人から否定された**（ヘッダのアイコンと通知の帯）。位置の判断は3回目。
- architecture は焦点4（prop が6つに増えたこと）に対し「**割っても数が減らない**ので今回も割らない。
  ただし r1 / r2 と根拠が違う」と判定し、減らす方向は r3-19（本文の口を1つに揃える）だと述べている。

## 見ていない範囲

- **実プロセスでの重なりを誰も見ていない。** r3-02 / r3-03 の座標はすべて SCSS の宣言と DOM の入れ子からの算術。
- `FileConflictDialog` / `KifuReadErrorDialog` の内部でどの行が throw しうるかは未特定。
- r3-10 で挙げた4つの param について、いま実際にレンダで throw する行は特定できていない。
- 棋譜一覧の境界は7枚のうち唯一どのテストにも通っていない（r2 から変わらず）。
- `src-tauri/` は差分に含まれないため未読。スクリーンショットは突き合わせていない。
- `npm run verify` はどの reviewer も走らせていない。

## lint / hook で強制できるもの

- **`floating` / `hint` が `fallback` を渡した境界で無視されること**（r3-05）は**型で止まる**。
  `fallback` の引数に足すか、`Props` を discriminated union にする。
- **`app-layout.md` の境界表の行数と `src/` の `<AppErrorBoundary` の出現数の一致**（r3-14 / r3-18）。
  `docsIdentifiers.ts` と同型。`label` を union にすれば名乗りの綴りも tsc が止める。
- **`position: fixed` かつ `z-index >= $z-titlebar` の箱が、ヘッダの段と重なる `top` を持たないこと**（r3-02）。
  `modalOverlayTitlebar.test.ts` が帯について同型の検査を持っている。**トークン化（r3-20）が前提。**
- **同名のカスタムプロパティが複数の SCSS で別々に宣言されていないこと**（r3-20）。
- **`vi.mock` が named export を定数関数で潰していること**（r3-11）。件数をラチェットにできる。
- **`docs` と `src` の `#N` が閉じた issue を指していないか**（CI 側。r2 から継続）。
- **`.claude/reviews/*.md` の必須見出し4本**（r3-24）。`test:hooks` に足せる。
- **`src-tauri/Cargo.toml` の `authors` に `"you"` が無いこと**（r3-25）。Rust の `#[test]` 1本で足りる。
- r3-01 / r3-06 / r3-07 / r3-13 / r3-15 / r3-16 / r3-17（コメントと実装のずれ）は機械では止まらない。

## 修正計画（r3 → r4）

### 束

- **`fallback` の穴**: r3-05 → r3-19（`fallback` の引数に view 系を全部渡すと両方消える）
- **モーダル層の鍵**: r3-09 / r3-10 / r3-11 / r3-18（境界を層の中へ入れ、鍵を `location.key` に寄せる1編集）
- **`--floating` の位置**: r3-20 → r3-02 → r3-03（トークン化してから位置と段を決める）
- **コメント**: r3-01 / r3-06 / r3-07 / r3-13 / r3-14 / r3-15 / r3-16

### 対象そのものを疑ったか

**所見が減っていない**（r1 31 / r2 31 / r3 25）。`/review-plan` 手順4 は「3回続いたら直し方ではなく
対象を疑う」と言う。**数えた結果**: r3 の25件のうち `AppErrorBoundary` の API に当たるのは
r3-05 / r3-12 / r3-14 / r3-17 / r3-19 の**5件**、位置と寸法の SCSS が r3-02 / r3-03 / r3-20 / r3-21 の**4件**、
モーダル層の鍵が**4件**、残りはコメントと doc。**1つの機構への集中はさらに薄まっている**
（r1 は11/31 が `AppErrorBoundary`、r3 は 5/25）。

architecture は「器と見た目をファイルで割っても、4つの prop の素通しは1つも減らない」と数えている。
**分割は今回もやらない。** 減らす方向は r3-19（境界に置ける表現と本文が持つ表現を一致させる）で、
それは順1で入る。

**減っていないのは、直すたびに前の修正が次の所見を作っているため**（r2-04 で位置を動かしたら
r3-02 / r3-03 が出た、r2-02 で鍵を直したら r3-09 / r3-10 が出た）。これは
`/review-plan` が「4ラウンド全てで前ラウンドの修正が新しい欠陥を出した」と記録している形そのもの。
**次ラウンドの焦点を「今回の修正が何を壊しうるか」に全振りする。**

### このラウンドで直すもの

| 順  | 所見                          | なぜこの順か                                              | この直し方で壊しうるもの                                                                                                                                                                     |
| --- | ----------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | r3-05 + r3-19                 | 束の先頭。`fallback` の引数を揃えると2件が同時に消える    | `fallback` の引数が増えるので root の呼び出しが変わる。**`actions` / `notice` は fallback 側の state に依存するので境界には上げられない** —— その線引きを doc に書かないと次に同じ所見が出る |
| 2   | r3-20                         | 位置を決める前にヘッダの高さを1つにする                   | `.app-header` の再宣言を落とすと継承に頼る。`.app-header` が `.app-layout` の外で使われていないことを確認する                                                                                |
| 3   | r3-02 + r3-03                 | 位置の判断3回目。**ヘッダも通知も避ける場所と段を決める** | 段を `$z-notification` より上にすると、通知の帯を覆う。帯は幅いっぱい、箱は右の一部なので許容する判断を doc に残す                                                                           |
| 4   | r3-09 + r3-10 + r3-11 + r3-18 | 鍵の束。門番の向き                                        | 境界を `AppModalLayer` の中へ入れると、`AppModalLayer` をモックしている**3本のテストから境界が消える**。段割りを見るテストは実物を描く形へ移す必要がある                                     |
| 5   | r3-04                         | 文言。鍵の形が決まってから                                | `再表示` の綴りを `hint` に埋めるので、ボタンの文言を変えたときに2箇所になる                                                                                                                 |
| 6   | r3-12                         | 型                                                        | `() => void \| Promise<void>` に広げると、拒否を握る責任が部品側に移る                                                                                                                       |
| 7   | r3-21                         | 無し                                                      | `scssScaleRatchet` の `spacing` が1減る                                                                                                                                                      |
| 8   | r3-17                         | 名前。順1 で口が確定してから                              | `notice` → `afterAction` に改名。`InlineNotice` を通さない理由を書く（通すかどうかは別の判断で、ここでは書くだけ）                                                                           |
| 9   | r3-01                         | ここから下はコメント                                      | 無し                                                                                                                                                                                         |
| 10  | r3-06                         | 無し                                                      | 無し                                                                                                                                                                                         |
| 11  | r3-07                         | 無し                                                      | 無し                                                                                                                                                                                         |
| 12  | r3-13                         | 無し                                                      | 無し                                                                                                                                                                                         |
| 13  | r3-14                         | 無し                                                      | 無し                                                                                                                                                                                         |
| 14  | r3-15                         | 数値。**測ってから書く**                                  | 無し                                                                                                                                                                                         |
| 15  | r3-16                         | 無し                                                      | 無し                                                                                                                                                                                         |
| 16  | r3-22 + r3-23                 | doc と issue の整合                                       | 無し                                                                                                                                                                                         |
| 17  | r3-24                         | 無し                                                      | 無し                                                                                                                                                                                         |

### 直さないもの

| 所見  | 行き先                 | 理由                                                                                                                                                                       |
| ----- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r3-08 | **対応済み（rebase）** | `git rebase origin/main` を通し、`failure-surfacing.md` の衝突は main の「通知」の行を残して解決した。ADR-0003 の実測（35 / 22）は rebase 後の木で取り直して一致を確認済み |
| r3-25 | **issue**              | リポジトリ入口の4件。#436 の範囲（境界を置く）の外で、どれも `main` から在る                                                                                               |

### 次ラウンドの焦点

**このラウンドは「前の修正が次の所見を作る」を3回続けている。** 次の reviewer には
**今回の修正そのものが何を壊したか**を優先して見てもらう。

1. **`--floating` の位置と段（3回目）。** ヘッダの下・通知より上に置いた結果、
   新しく覆うものが無いか。`/`（ヘッダの無い画面）で位置が破綻していないか
2. **境界を `AppModalLayer` の中へ入れたこと。** `.app-layout` の段割りが保たれているか、
   `AppLayout` から file-tree の購読が消えたか、テストが実物の鍵を見ているか
3. **`fallback` の引数に view 系を渡したこと。** `actions` / `notice` だけが本文側に残る線引きが
   doc とコードで一致しているか
4. **`hint` に `再表示` の綴りを埋めたこと。** ボタンの文言との2箇所化
5. **ヘッダの高さをトークンにしたこと。** `.app-header` の再宣言を落として継承に頼る形の破れ
6. **今回もコメントの所見が7件出た。** 書き直したコメント1つずつについて、
   条件がコードのどの行かを指せるか

### 検証の見積り

17件 × TS のみの `verify`（実測 40〜60 秒）で 15〜25 分。`src-tauri/` は1行も触らない。
