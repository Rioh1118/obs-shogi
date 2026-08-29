# レビュー file-tree-error ラウンド3

- 日付: 2026-08-30
- 範囲: issue #169（`fix/169-file-tree-error`、`main...HEAD` の106ファイル）
- 走らせた reviewer: architecture / react / ui / robustness / rust / comment / oss-hygiene
- 対象: `main...HEAD`（短ハッシュは rebase で消えるので範囲で書く）

**所見 55件を統合して 41件**（BLOCK 4 / HIGH 16 / MEDIUM 21）。

ラウンド2 は34件だった。**増えている。** ラウンド2 の対応で触った面が広く、
かつ差分の外まで見た reviewer が複数いたため。

**うち5件はラウンド2 の対応が作った退行**（B-1 / H-4 / H-5 / H-11 / H-13）。
**3件はラウンド2 の対応が不十分**（H-6 / H-7 / H-8）。
**1件はラウンド2 で書いた反論が誤り**（H-9）。

---

## BLOCK

### B-1 モーダルが2枚重なると、フォーカスの閉じ込めどうしが奪い合ってアプリが固まる

- reviewer: react / robustness（**独立に再現まで確認**）
- 場所: `src/shared/ui/Modal.tsx` の `onFocusOut` / `pullBack`
- 根拠: 閉じ込めは「カードの外にフォーカスが出たら中へ戻す」だけで、**外にもう1枚モーダルがある場合を見ていない**。
  A の中にフォーカスがある状態で B が mount → B が `pullBack` → A の `focusout` → A が奪い返す →
  B の `focusout` → … `focus()` は同期でイベントを撒くので**マイクロタスクキューが空にならない**。
  2枚重ねただけで `focus` が200回を超えて呼ばれ続けることを react 側が実測（robustness も30回で打ち切りを確認）。
- なぜ問題か: **ラウンド2 H-7 の対応が作った退行。** しかも踏む経路は特殊ではない。
  「ファイルを作成 → 既にある名前で作成 → `already_exists` → `FileConflictDialog` が上に mount」は
  **このダイアログが存在する理由そのもの**。設定 → プリセット編集、棋譜が開けない状態でのファイル操作も同じ。
  `Modal.test.tsx` の4件は全部1枚しか mount していないので1件も踏んでいない。
- 直し方: モジュールスコープに開いているカードのスタックを持ち、`onFocusOut` / `onKeyDown` は
  **自分が最上位のときだけ**働く。Escape の順序（H-1）も同じ装置で直る。

### B-2 `mv.rs` の4コマンドだけ `validate_under_root` を通らず、root 外のディレクトリを改名・移動できる

- reviewer: rust / architecture（独立に指摘）
- 場所: `src-tauri/src/file_system/mv.rs` の `rename_kifu_file` / `mv_kifu_file` / `rename_directory` / `mv_directory`
- 根拠: `use` に `validate_under_root` が無く、4関数とも `AppHandle` すら受け取っていない。
  `operations.rs` は7箇所、`kifu.rs` は1箇所で通している。**書き込み系で通していないのはこの4つだけ。**
  ディレクトリ側には `is_kifu_file` のような絞りも無い。
- なぜ問題か: `invoke("mv_directory", { dirPath: "/Users/x/Documents", destParentDir: "/tmp" })` が通る。
  `root_dir` を設定してあっても効かない。CSP は `script-src 'self' 'unsafe-inline'` なので
  webview 側に注入が成れば `invoke` はそのまま呼べる。
- **`main` にもある既存の穴。** ただしこのブランチは4関数の全行を書き直しており、
  `validate_basename` の戻り値を使う形へ4箇所とも触っている。
- 直し方: 4関数を `<R: Runtime>(app: AppHandle<R>, ...)` にして、`src` と `dest` の**両方**に通す。

### B-3 セッショントークン入りの `sdb.html` がリポジトリ直下にあり、`.gitignore` に無い

- reviewer: oss-hygiene
- 場所: `sdb.html`（未追跡・未 ignore）、`.gitignore`
- 根拠: `data-phx-session`（Phoenix LiveView の署名付きセッション）と `csrf-token` を含む。
  `git check-ignore -v sdb.html` は一致なし。
- なぜ問題か: 「コミットしない」という禁止が**ローカルのハンドオフメモにしか無い**。
  `git add -A` を1回打った時点で MIT の公開リポジトリにトークンが入る。
  このブランチは1所見1コミットで `git add` を何十回も回している最中で、事故確率が高い状態が続いている。
- 直し方: `.gitignore` に1行足し、作業ツリーからも消す。

### B-4 `InlineNameEditor.commit` のコメントが、4行下の自分のコードを否定している

- reviewer: comment
- 場所: `src/widgets/file-tree/ui/InlineNameEditor.tsx` の `commit`
- 根拠: 「ここでは `onCancel` は呼ばない」の4行下で `onCancel()` を呼んでいる。
  しかもコメントは `cancelRef.current = false;` の真上にあるのに、`cancelRef` の話を一言もしていない。
- なぜ問題か: 読み手はコメントがどの行に掛かるか決められず、
  「実装が間違っている」のか「コメントが古い」のかを判断できない。
  この関数はラウンド2 で `setError` を足して意味が変わっており、そのときに更新していない。
- 直し方: 2つに分ける。`cancelRef` の行と `onCancel()` の分岐に、それぞれの理由を置く。

---

## HIGH

### H-1 モーダルが重なると Escape が上ではなく下を閉じる

- reviewer: react / robustness（独立に指摘、実測）
- 場所: `src/shared/ui/Modal.tsx`、`src/entities/file-tree/model/reducer.ts` の `case "error"`
- 根拠: 各 `Modal` が `document` のキャプチャ段に `keydown` を登録する。
  同一ノードの同一段は**登録順**なので、先に mount した下が先に `preventDefault` + `onClose` を実行し、
  上は `defaultPrevented` で降りる。実測 `{ 下: 1, 上: 0 }`。
- なぜ問題か: 設定 → プリセット編集 → 打ち替え → Escape で**設定ごと閉じ、打ち替えた内容が失われる**。
  作成フォーム → 衝突ダイアログ → Escape で背後のフォームだけが消える。
  `reducer.ts` のコメントは**この挙動を既に知っていて**、`case "error"` の中だけで回避している。
  共通部品側の欠陥を state 側で1組だけ埋めているので、他の重なりには効いていない。
- 直し方: B-1 と同じスタックで、Escape も最上位の1枚だけが処理する。

### H-2 名前の失敗の表示が行の上に貼り付き、閉じられず、下の行を押せなくする

- reviewer: ui
- 場所: `src/widgets/file-tree/ui/InlineNameEditor.scss` の `__error`、同 `.tsx` の `onBlur`
- 根拠: 3つが重なる。
  1. 不透明な面 + `z-index: 1` で行の上に描かれ、下の行の `onClick` に届かない。
     サイドバーは 260px 固定、`NodeBox` の `paddingLeft` は `2 + level * 1.3` rem。
     level 3 で使える幅は約179px、level 8 で約104px。「名前に使えない文字が含まれています」は
     約187px なので **2〜3行に折り返し、下の1〜3行を丸ごと覆う**
  2. 外をクリック → `onBlur` → 同じ `draft` で再送信 → また失敗 → **同じ箱が戻る**
  3. Escape は `<input>` の `onKeyDown` にしか無いので、blur 後は効かない
- なぜ問題か: **ラウンド2 H-5 の対応が作った退行。** 無効な名前を打って外をクリックすると、
  閉じる手段の無い失敗表示がツリーに貼り付き、その下の行が押せなくなる。
  しかも `reducer.ts` のコメントは**この loop を、編集行を畳む理由として書いている**。
  畳まない経路を新設したのに、その経路に loop への対処が無い。
  `InlineNameEditor.test.tsx` の4件は Enter しか叩いておらず blur を1度も踏んでいない。
- 直し方: 箱に `pointer-events: none`。`commit` を「前回失敗した `draft` と同じなら送り直さない」に。
  Escape を `.inline-name-editor` の `onKeyDown` へ上げる。テストに blur の経路を1本足す。

### H-3 コントラスト検査が到達できるのは対の13%で、しかも「測れた件数」がラチェットされていない

- reviewer: ui
- 場所: `src/__tests__/contrast.ts`、`src/__tests__/contrastRatchet.test.ts`
- 根拠（実測）:

| 指標                                   | 実測         |
| -------------------------------------- | ------------ |
| `src/**/*.scss` の `color:` 宣言       | 378          |
| 検査が比を出せた対                     | **49**       |
| 測れた対が0件の `.scss`                | **85 / 100** |
| このブランチが触った `.scss` のうち0件 | **10 / 16**  |

落ちる原因は4つ。(1) 最上位で `background` を宣言しないと以後ずっと `surface` が `null`、
(2) BEM の `&__x` を DOM の入れ子として扱うので `--warning` の面が `__lead` へ伝わらない、
(3) `opacity` を見ていない、(4) グラデーションと `currentColor` は `null` で黙って落ちる。

- なぜ問題か: **`Button.scss` の面を `rgba(..., 0.99)` に変えるだけで、H-2/H-3 で測った対が
  検査から静かに消える**（測れた対 4 → 3、両方のテストは緑）。
  ラウンド2 の書き戻しは「測れる対はこのラウンドから全部見る」と書いたが、
  見ているのは13%で、その13%も維持されない。**2ラウンド続いた穴を止める装置として、この形では効かない。**
- 直し方: `BASELINE` と対で**測れた対の件数（カバレッジ）を固定**し、減ったら落とす。
  `scanContrast` に「載る面」を渡す入口を作る。解けなかった値は `unresolved` として数える。

### H-4 読み直しの失敗が、直前の操作の失敗として二重に出る

- reviewer: robustness
- 場所: `src/entities/file-tree/model/provider.tsx` の `loadFileTree` と、
  `createNewFile` / `importKifuFile` / `createNewDirectory` / `renameNode` の末尾
- 根拠: `loadFileTree` は3経路のどれも通らず `dispatch({type:"error"})` を直接出す。
  操作側は `const reload = await loadFileTree(); if (!reload.success) return reload;` と、
  **読み直しの失敗を自分の失敗として返す**。
- なぜ問題か: 作成は成功しているのに、`FileTree` のモーダルと `FileCreateForm` の `FsErrorView` に
  **同時に2つ**出る。しかも文言は嘘で、ファイルは作られている。利用者はもう一度押し、
  `already_exists` → 衝突ダイアログ → 別名 → **同じ棋譜が2本**になる。
  `deferFailure` はまさに「同じ失敗が2箇所に別の文言で出る」のを避けるために置かれたのに、
  `loadFileTree` はその判断を通らない。
- 直し方: 変更そのものの成否と、そのあとの整合（読み直し）の成否を分ける。
  操作は変更が成功したら `Ok` を返し、読み直しの失敗は `loadFileTree` が積む `state.error` に任せる。

### H-5 衝突を別名で解決しても、発端のモーダルが残り、成功が誰にも伝わらない

- reviewer: robustness
- 場所: `src/entities/file-tree/model/provider.tsx` の `resolveConflictByRename`、3つのフォーム
- 根拠: 解決すると `conflict_closed` は出るが、**発端のモーダルには何も伝わらない**。
  フォームが `toggleModal()` するのは自分の `createNewFile` が成功したときだけ。
- なぜ問題か: 「新規作成 → `a` → 既にある → 衝突ダイアログ → `b.kif` に直して確定」で
  `b.kif` は**作られる**が、下から出てくるのは**入力が `a` のままの作成フォーム**で、
  成功も失敗も何も出ていない。作られたことに気づけず、もう一度押すと
  **同じ棋譜の2本目**ができる。インポートは棋譜本文ごと2本目になる。
  `createFileForms.test.tsx` の「フォーム側では出さない」は、残った後どうなるかを見ていない。
- 直し方: 解決の成否を発端の側へ返す。`conflict_closed` に `resolvedPath` を持たせるか、
  `resolveConflictByRename` の成功時に発端のモーダルも閉じる。

### H-6 `KifuImportForm` だけ処理中の状態が無く、二度押しで「成功したのに名前が重複」が出る

- reviewer: react / robustness（独立に指摘）
- 場所: `src/features/create-file/ui/KifuImportForm.tsx`
- 根拠: `handleSubmit` に `isLoading` 相当が無く、送信ボタンの `disabled` は入力内容だけで決まる。
  `importKifuFile` はパース + 書き込み + **ツリー全体の再取得**を通る。
- なぜ問題か: **ラウンド2 M-11 の対応が不十分。** 押しても画面が1px も変わらないので
  もう一度押す → 1回目は成功、2回目は `already_exists` → 衝突ダイアログ。
  「押しても何も起きなかったのに、なぜか同名が既にあると言われる」という読み解けない画面になる。
  しかも B-1 のハングもここから踏む。
- 直し方: `Button` の `isLoading` を使う。フォームごと差し替えない（H-13 も参照）。

### H-7 `AiLibraryTab` の `eval` / `book` 作成失敗を誰も読んでいない

- reviewer: robustness
- 場所: `src/features/settings/ui/tabs/AiLibraryTab.tsx` の `onCreateAiFolder`
- 根拠: `await createDir(profilePath, "eval")` と `"book"` の戻り値を見ていない。
  `createDir` は `AsyncResult` を返すので**投げない**。
- なぜ問題か: **ラウンド2 M-6 の対応が3行のうち1行目にしか当たっていない。**
  失敗しても `scanNow` へ進み、画面に出るのは「eval が未検出です」という警告だけ。
  利用者は「置いていないだけ」と読むが、実際には**フォルダ自体が無い**。
- 直し方: 3つとも同じ形にする。この tab の失敗表示も `FsError` のまま持って `FsErrorView` に渡す。

### H-8 「逃げ道は段で出し分ける」という捨てた規則が、状態遷移表と ADR-0005 に残っている

- reviewer: oss-hygiene / architecture（独立に指摘）
- 場所: `docs/state-transitions/file-tree.md` の ※1、`docs/decisions/0005-one-button-one-dialog.md` の決定5
- 根拠: 実装の規則は「逃げ道は**ツリーが無いときだけ**、段に関わらず出す」。
  文書は「段が `warning` なら読み直し、`danger` なら別の操作」。**2方向とも食い違う。**
- なぜ問題か: **ラウンド2 H-1 の修正がこの段ゲートを外したもので、その理由は
  `FileTreeErrorNotice` のコメントに書いてある。** 同じラウンドで書き直した ※1 と、
  同じラウンドで数字を直した ADR-0005 の両方に古い規則が残った。
  ラウンド2 H-11 が指摘した「注が実装と正反対」がこの1文で再発している。
- 直し方: ※1 を「読み直しは段が決める / 逃げ道はツリーの有無が決める」の2軸に。ADR-0005 も揃える。

### H-9 ラウンド2 H-10 の反論が誤り。WIP=1 はこの PR で実際に消えている

- reviewer: oss-hygiene
- 場所: `.claude/reviews/2026-08-29-file-tree-error-r2.md` の「反論」、
  `docs/OPERATING-MODEL.md`、`docs/decisions/0001-branch-and-pr-policy.md`、`.claude/skills/weekly-review/SKILL.md`
- 根拠: このブランチの `090127b`（`chore: 実装の進め方から確認の手数と着手数の縛りを外す`）が
  `CLAUDE.md` と `implement/SKILL.md` の両方から
  「着手中の issue は**常に1件**」を削っている。
  反論の根拠にした `git log -S "WIP" -- CLAUDE.md` が空だったのは、
  **その文言に `WIP` という語が無く、検索語が当たらなかっただけ**。
- なぜ問題か: いま `OPERATING-MODEL.md` と ADR-0001 は「常に1件」と命じ、
  `weekly-review/SKILL.md` は「2件以上なら WIP 違反として指摘する」と実装している一方、
  エージェントが読む `CLAUDE.md` と `implement` には無い。
  **次に `/weekly-review` を回すと、この PR が意図的に外した縛りで違反を指摘される。**
  さらに ADR-0001 の決定を新 ADR 無しに運用文書側で撤回した形になり、append-only の規約に反する。
- 直し方: ADR-0006 を1本書いて ADR-0001 の該当決定を supersede し、`LOG.md` に1行足し、
  残る3箇所を落とす。**縛りを外すかどうかは既に `090127b` で決まっている**ので、
  ここでやるのはその決定を規約どおりの形にすること。

### H-10 `failure-surfacing.md` §0「出口は5つだけ」が #169 の前のまま

- reviewer: oss-hygiene
- 場所: `docs/state-transitions/failure-surfacing.md` §0
- 根拠: 冒頭は「台帳。古いままなら嘘をつく」と宣言しているのに、その直下の §0 だけが棚卸し時点のまま。
  `FileTree` の `Modal` + `FileTreeErrorNotice`、3フォームの `FsErrorView`、
  `InlineNameEditor` の入力欄直下、の3種類が抜けている。「各機能ごとに手書き」も偽。
- なぜ問題か: **ラウンド2 H-12 の対応が不十分。** §2 を読むと出口があり、§0 を読むと無い。
  同じファイル内の矛盾という、H-12 が直したはずの形がそのまま §0 に残っている。
- 直し方: §0 の表に3行足し、数を数え直す。

### H-11 状態遷移表 ※2 の「経路は3つ」が網羅でなく、**削除の失敗**がどこにも書かれていない

- reviewer: oss-hygiene / architecture（独立に指摘）
- 場所: `docs/state-transitions/file-tree.md` の ※2、`src/entities/file-tree/model/provider.tsx` の `deleteNode`
- 根拠: 表の列には **E6 削除**があり、`(S2, E9)` のセルがこの注を指す。
  ところが `deleteNode` は3経路のどれも通らず `pushError` を直呼びする。
  `resolveConflictByRename` の `pushError` 2箇所、`loadFileTree` の直 dispatch も同じ。
- なぜ問題か: **ラウンド2 H-11 の対応が作った退行。** 「3つある」という断定を新しく書いたが、
  実際は5経路ある。読者が「削除に失敗したらどうなるか」を辿ると答えが無い。
- 直し方: 表に `pushError` 直呼びと `loadFileTree` の行を足すか、削除も `handleFailure` に寄せる。

### H-12 `node.id` は取得のたびに作り直される UUID なのに、選択と rename の同一性がそれで決まっている

- reviewer: react
- 場所: `src-tauri/src/file_system/tree.rs`（`generate_id()`）、
  `FileNode.tsx` / `DirectoryNode.tsx` / `RootNode.tsx`、`provider.tsx` の `startInlineRename`
- 根拠: `loadFileTree` はファイル操作のたびに走り、そのたびに全ノードの `id` が変わる。
  `isSelected` も `renamingNodeId` もその `id` で比べている。
- なぜ問題か: ファイルを選んだあとに別の作成・削除をすると、**選択行の強調だけが消える**
  （内部の `selectedNode` は残るので「選択が外れて見えるのに選択されている」）。
  編集行が出ている間にツリーが読み直されると、**入力欄が黙って消える**（打った文字列ごと）。
  **これはこの変更が無くそうとしている症状そのもの。**
  さらに `key` の空間が割れている（`RootNode` は `child.path`、`TreeNode` は `child.id`）ので、
  深さ2以降が再取得のたびに remount される。
- **`main` にもある既存の欠陥。** ただし症状が #169 の主題と同じ。
- 直し方: 同一性を `path` に一本化する。

### H-13 処理中にフォーム全体を `Spinner` に差し替えるので、入力欄が消える

- reviewer: react
- 場所: `src/features/create-file/ui/FileCreateForm.tsx`、`SfenKifuCreateModal.tsx`
- 根拠: `if (isLoading) return <Spinner />;`
- なぜ問題か: `Button` に `isLoading` があるのに、この2つは**押した瞬間に入力欄もボタンも見出しも消す**。
  この変更が掲げる「入力欄が消える を無くす」と逆向きで、`ConfirmDialog` /
  `FileTreeErrorNotice` が `isLoading` に寄せたのと3つ目の表現になっている。
  加えてフォーカスを持っていた入力欄が DOM から取り除かれるが、`Modal` の閉じ込めは
  `focusout` しか見ていないので**要素の削除では戻す経路が無い**。
- 直し方: 送信ボタンを `isLoading` にしてフォームは出したままにする。
  `Spinner` は「まだ何も無い」ときの表示に限る。

### H-14 `build_file_tree_recursive` に循環と深さの止めが無く、symlink ループでプロセスごと落ちる

- reviewer: rust
- 場所: `src-tauri/src/file_system/tree.rs`
- 根拠: `Path::is_dir()` も `fs::metadata()` も symlink を辿る。`visited` も深さの上限も無い。
- なぜ問題か: `root_dir` の中に自分を指す symlink が1つあると無限に降り、
  行き着くのは**スタックオーバーフロー（SIGSEGV/abort）**。panic ではないのでフロントには何も届かず、
  ウィンドウごと消える。`get_file_tree` は起動時に必ず走るので**起動するたびに落ち、GUI からは復旧できない**。
  クラウド同期フォルダを symlink で繋ぐのは珍しい構成ではない。
- **`main` にもある既存の欠陥。**
- 直し方: 深さの上限を渡し、`fs::symlink_metadata` でディレクトリの symlink は辿らず葉として扱う。

### H-15 大文字小文字だけを変えるリネームが `already_exists` で必ず失敗する（APFS で実測）

- reviewer: rust
- 場所: `src-tauri/src/file_system/utils.rs` の `ensure_not_exists`、`mv.rs` の4箇所
- 根拠: APFS で `abc.kif` だけがある状態で `Abc.kif` の `exists()` が真になることを実測。
  `ensure_not_exists` は dest が src と同じ実体かを見ていない。
- なぜ問題か: **改名しようとしている当のファイル自身が衝突相手として報告される。**
  「同じ名前のものが既にあります」が出て `FileConflictDialog` が別名を要求するが、
  大文字小文字の違いだけでは永久に通らない。macOS が第一の対象環境なので常時当たる。
- **`main` にもある既存の欠陥。**
- 直し方: rename / mv では dest が src と同じ実体なら衝突として扱わない（`dev()` + `ino()` で比較）。

### H-16 いま走っている保存の経路が `FsError` の外にあり、生の OS 英文が画面に出る

- reviewer: rust
- 場所: `src-tauri/src/kifu.rs` の `write_kifu_to_file`、`operations.rs` の `save_kifu_file`
- 根拠: `write_kifu_to_file` は `error: Option<String>` を返し、`io::Error` を `to_string()` で載せる。
  受け側は `describeFsError` も `fsErrorTier` も通らない。
  一方、このブランチが `atomic_write` / `validate_under_root` / `validate_basename` を通す形に整えた
  `save_kifu_file` は、**`src/` に呼び出し元が1件も無い**。
- なぜ問題か: 開いている棋譜を読み取り専用にして一手指すと
  `"Permission denied (os error 13)"` がそのまま画面に出る。
  `permission_denied` という code も「権限がありません」という文も既にあるのに、この経路だけ通らない。
  **整えた方は誰も通らず、通っている方は整っていない。**
  この変更の目的が、一番回数の多い書き込み経路に届いていない。
- 直し方: `write_kifu_to_file` の戻りを `Result<_, FsError>` にする。`save_kifu_file` は残すか消すかを決める。

---

## MEDIUM（21件・要点のみ）

| #    | 内容                                                                                                                                                                                                                                                                                          | reviewer                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| M-1  | 変更の経緯（`fix/169`／`#169 の差分の外`／`#9e7757 は割っていた`／`3.52:1 まで落ちていた`）が5箇所のコメントに残る                                                                                                                                                                            | comment                        |
| M-2  | 同じ「フォームが持つ失敗」に `error` / `saveError` / `submitError` の3つの名前                                                                                                                                                                                                                | comment                        |
| M-3  | `handleFailure` / `deferFailure` / `deferNameFailure` は名前に「誰が描くか」の軸が無く、コメント無しに選べない                                                                                                                                                                                | comment                        |
| M-4  | `onCommit` の TSDoc が書いた契約を4つの呼び出し元がどれも守らず、二重表示を防いでいるのは reducer だけ                                                                                                                                                                                        | comment / architecture         |
| M-5  | `validateBasename` を通しているのは5つの入力欄のうち `RootNode` の1つだけ。TSDoc は全体方針として書いている                                                                                                                                                                                   | comment / architecture / react |
| M-6  | `provider.tsx` に解決済みレビュー番号 `// 6:` が残る                                                                                                                                                                                                                                          | comment                        |
| M-7  | `Button` の TSDoc が対話の面の決定を ADR-0004 に帰している（実際は ADR-0005）                                                                                                                                                                                                                 | comment                        |
| M-8  | `Modal` の `size="full"` / `padding="sm"`、`Form` の `theme="light"` が呼び出し元ゼロ（M-1 の再発）                                                                                                                                                                                           | comment / ui                   |
| M-9  | `SfenKifuCreateModal` のガードのコメントが別の条件式（`dirOptions.length === 0`）の説明になっている                                                                                                                                                                                           | comment                        |
| M-10 | `getConflictCopy` / `getConflictKind` の `default` が網羅性検査を殺し、同じフォルダの他2本と扱いが割れる                                                                                                                                                                                      | architecture                   |
| M-11 | `resolveConflictByRename` の `pushError` が、直前に `conflict_closed` を出したかで届いたり消えたりする                                                                                                                                                                                        | architecture                   |
| M-12 | barrel が公開境界として働いているのは28スライス中8。barrel を足すと検査が落ちる向きに働く                                                                                                                                                                                                     | architecture                   |
| M-13 | パスの手書きヘルパが4層に4本。`shared/lib/path.ts` の `norm` は `/g` が無く Windows パスで壊れる                                                                                                                                                                                              | architecture                   |
| M-14 | `CreateFileModal` だけ `Modal` の padding と `Form` の padding が二重で、タブと入力欄が30px ずれる（M-12 の再発）                                                                                                                                                                             | ui                             |
| M-15 | `TagsInput` の `__help span` が 4.45:1。`add-btn` は `opacity` のせいで実測 4.41:1（検査は 4.79 と報告）                                                                                                                                                                                      | ui                             |
| M-16 | `CreateFileModal` のタブは面 1.37:1・枠 1.47:1 で、コメントの「面と枠の両方で示す」が成立していない                                                                                                                                                                                           | ui                             |
| M-17 | `$color-danger-text` を足した同じコミットで `sp-save__error` に生の `#e57373` が残る（M-15 の対応が半分）                                                                                                                                                                                     | ui                             |
| M-18 | 失敗の面の `color-mix` 式が2ファイルに逐語で重複。`InlineNameEditor` 側は輪郭が 1.11:1 で見えない                                                                                                                                                                                             | ui                             |
| M-19 | `$shadow-control` を足した同じコミットで `TagsInput` が同じ役割の影を直値で書いている（M-13 の再発）                                                                                                                                                                                          | ui                             |
| M-20 | ツリーの全行が1つの Context を読むので、行を1つ選ぶだけで全行が再レンダ（仮想化も無い）                                                                                                                                                                                                       | react                          |
| M-21 | Rust 側: `serde_emits_snake_case_variant_names` の `all` が手書き / `validate_basename` の doc が末尾 `.` を根拠にするが落としていない / `delete_directory(root)` が通る / `validate_under_root` が存在検査より後ろ / `atomic_write` の tmp 名が決め打ち / 同期コマンドがメインスレッドを塞ぐ | rust                           |

そのほか文書側: `failure-surfacing.md` §1 の実測値が古い（9箇所 → 7箇所）／§4 の抽出条件と中身が合わず F-6 と F-8 が落ちている／
§3 が指す ADR-0004 の F-3 は1段しか無く実装（2段）と合わない／`review-round` の「件数は `CLAUDE.md`」が同じ PR の
`CLAUDE.md`（「件数を書かない」）と食い違う／`review-fix` が今も短ハッシュを求める／
Rust の `#[test]` が0個という記述が `OPEN-QUESTIONS.md` と `OPERATING-MODEL.md` に残る／
append-only の境界（いつから書き換え不可か）が書かれていない／#184 / #201 / #202 がコードから参照されていない／
状態遷移表 S3 / S5 の「実行できる」がモーダルの全面 overlay と矛盾し、`(S4, E9)` が空欄のまま。

---

## 重複・矛盾した所見

- **B-1 と H-1 は同じ装置で直る。** react と robustness が独立に同じ原因を挙げた
- **B-2 は rust が BLOCK、architecture が HIGH。** 深刻度は rust を採る（root 外のディレクトリを移動できる）
- **M-5 は3人が独立に挙げた**（comment / architecture / react）。ただし直し方が割れている:
  「5箇所とも通す」（architecture, react）と「1箇所に絞った理由を書く」（comment）。
  **判断が要る** — ルートだけ特別扱いする理由（`setRootDir` でツリーを組み直さずに `app-config` へ書く）は
  実在するので、後者にも根拠がある
- **M-8 と ui の `Form` の `light` 削除提案は同じもの。** ただし `Modal` の `--light` は
  `PositionNavigationModal` が使っているので落とせない（#183）

## 見ていない範囲

- **実機での確認は誰もしていない。** B-1 のハングは happy-dom 上での再現、
  H-1 の順序は実測、その他は読みと計算
- コントラストは SCSS の合成順からの手計算。`backdrop-filter` と `background-blend-mode` は入れていない
- `src-tauri/src/engine/` `src-tauri/src/search/` の並行性・プロセス管理（rust reviewer の依頼範囲外）
- `features/settings` の12ファイルの中身（`Button` / `Modal` の呼び出し行のみ）
- `docs/state-transitions/` のうち差分に含まれない4本の本文
- `npm run verify` は architecture と oss-hygiene が走らせた（緑）。`verify:rust` は誰も走らせていない

## lint / hook で強制できるもの

**複数の reviewer が独立に挙げたもの**:

- **`AsyncResult` を返す関数の戻り値を捨てている呼び出しの検出。** H-7 が落ちる。
  **ラウンド2 でも同じ提案が挙がっており、入れなかった結果このラウンドで所見が1件出ている**
- **コメント中の禁止語の検出**（`今回|〜だった|レビュー|ラウンド|PR #\d|#\d+ で対応|この差分|fix/\d+`）。**M-1 の5箇所が全部落ちる**
- **`src-tauri/src/file_system/` の `#[command]` が `validate_under_root` を呼んでいるかの検査。** B-2 が落ちる
- **union のリテラル値のうち呼び出し元が0の値を落とす検査。** M-8 が落ちる（**ラウンド2 M-1 の3回目の再発**）
- **`Modal` を2枚重ねるテストを必須にする。** B-1 と H-1 が1つで落ちる
- **コントラストの「測れた対」のカバレッジをラチェットする。** H-3 が落ちる
- **`await` を含むハンドラで実行中を表す state / ref を読まない箇所の検出。** H-6 と `InlineNameEditor` の二重コミットが落ちる
- **`node.id` を比較・`key` に使うことの禁止（`file-tree` 限定）。** H-12 が落ちる
- **`.gitignore` に無い未追跡ファイルのうち `data-phx-session` / `csrf-token` を含むものを止める hook。** B-3 が落ちる

**機械では防げないもの**: H-5（成功をどこへ伝えるか）、H-4（変更の成否と整合の成否の切り分け）、
M-5（手前の検証を置くか）、H-9（縛りを外すかどうかは既に決まっているが、どう記録するか）。

---

## 次ラウンドの対象

**BLOCK 4件と HIGH 16件のうち、#169 の範囲にあるものを全部直す。** 順序:

1. **B-3** — `.gitignore`。事故が起きる前に
2. **B-1 / H-1** — `Modal` のスタック。**私が作った退行**で、確実に踏む経路がある
3. **B-4 / H-2** — `InlineNameEditor`。**私が作った退行**
4. **B-2** — `mv.rs` の `validate_under_root`。既存だが4関数とも書き直している
5. **H-4 / H-5 / H-6 / H-7 / H-13** — 失敗と処理中の見せ方
6. **H-3** — コントラスト検査のカバレッジ
7. **H-8 / H-9 / H-10 / H-11** — 文書の整合。ADR-0006 を含む
8. MEDIUM のうち #169 の範囲にあるもの

**issue に送る**（#169 の範囲外の既存の欠陥）:
H-12（`node.id`）/ H-14（symlink ループ）/ H-15（APFS の大文字小文字）/ H-16（保存経路が `FsError` の外）/
M-13（パスヘルパ）/ M-20（Context と仮想化）/ M-21 の Rust 各件。
