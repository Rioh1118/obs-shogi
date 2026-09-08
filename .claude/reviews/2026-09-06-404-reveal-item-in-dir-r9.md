# レビュー 404-reveal-item-in-dir ラウンド9

- 日付: 2026-09-07
- 範囲: `fix/404-reveal-item-in-dir`（r8 の修正まで）
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 前ラウンド: `2026-09-06-404-reveal-item-in-dir-r8.md`

所見は **9件**（18 → 21 → 24 → 20 → 13 → 14 → 6 → 11 → 9）。
r8 の修正（分類の一本化・選択後のスキャンの持ち主）が作った所見が3件（R9-02 / R9-03 / R9-07）。

**このラウンドの途中で `origin/main` が2回進んだ**（#438 まで → #429 / #385 を含む列 → #446）。
rebase を通してから修正した。main 側で `verify-gate.sh` が `gate_kinds_for_path` に
作り直され、`docs/state-transitions/failure-surfacing.md` に F-32 の行が入っている。
どちらも競合したので、main の姿を採ったうえでこの枝の変更を載せ直した。

## 所見

### R9-01 [MEDIUM] capability を触ったコミットで Rust 側の検査が走らない（oss-hygiene）

`tauri_build::build()` は capability を読み、知らない許可の識別子で落ちる。
TS 側（`openerCapability`）が見るのは `opener:` の綴りだけなので、`core:` や `fs:` の
打ち間違いはどちらの検証にも掛からず、次に `.rs` を触った人が身に覚えのない赤を踏む。

- 結果: 対応済み。ただし**この枝のコミットは残っていない** —— rebase 先の main が
  `src-tauri/capabilities/*.json` を `rust` へ割る形をすでに持っていた。
  この枝からは `ts` 側（`openerCapability` を走らせる）の割り当てだけを残し、
  `verify-gate.test.sh` の期待を `ts rust` にした。`bash .claude/hooks/verify-gate.test.sh` は
  203 本の assertion で通っている

### R9-02 [MEDIUM] `onPick` の「同じルートを選び直した」経路にテストが1本も無い（react）

r8 で `if (sameRoot) await scanNow(...)` を入れたが、当たっているテストは
「別のルートを選んだ」だけだった。条件を反転しても落ちるテストが無い。
同じルートを選び直す回（効かなくなった外付けを繋ぎ直した等）は `aiRoot` が変わらないので
effect が走らず、**押しても何も起きないボタン**になる。

- 結果: 対応済み。同じルート／別のルートの両側を固定した（別のルートは「1回だけ走る」で見る）

### R9-03 [MEDIUM] 取り消しと選択の失敗にテストが無い（robustness）

`chooseAiRoot` の差し替えが成功しか表せない型だったので、残り2つの経路をテストから作れない。
取り消しを失敗として扱うと、何もしていないのに「フォルダを確認できませんでした」が出る。
選択の失敗で `last` を捨てると、選べなかっただけで開く口まで閉じる。

- 結果: 対応済み。差し替えを本番と同じ形（`AsyncResult<string | null, string>`）にして、
  2経路とも固定した

### R9-04 [MEDIUM] `currentRootRef` をレンダで更新しても全部緑（react、変異で確認）

関門を触るテストは間に `waitFor` を挟むのでレンダが1回走る。
ref の更新をレンダへ動かしても14本すべてが通った。**選び直した直後に返る継続は
再レンダより先に走る**ので、そこが本来の窓。

- 結果: 対応済み。選択の解決と作成の解決を同じ `act` の中で続けて起こすテストを足した。
  変異を当てると**このテストだけ**が落ちる（他の19本は通ったまま）

### R9-05 [MEDIUM] 世代の関門は成功側しか固定されていない（react）

追い越された要求は落ちて返ることもある（切り替える前のルートが消えていた回）。
`catch` の関門を外すと、その失敗が新しいルートの画面に「フォルダを確認できませんでした」を
書き、`last` まで捨てて開く口を閉じる。

- 結果: 対応済み。変異を当てて落ちることを確かめた

### R9-06 [MEDIUM] プリセット編集ダイアログの `other` に復帰の口が無い（robustness）

r8 で「作成」を出さないようにしたのは正しい（押しても英文の失敗に突き当たるだけ）。
ただし代わりに置くべき口が無く、残るのは「再スキャン」だけ。
外しに行くにはダイアログを閉じて設定タブまで戻るしかない。

- 結果: **見送り、issue へ（#485）**。この画面に `revealInFileManager` と通知を配線するのは
  もう1画面ぶんの変更で、#404 の範囲の外。本文が絶対パスを名乗っているので場所は分かる。
  「この画面には開く口が無い」ことを仕様（`docs/spec/screens/engine-preset-dialog.md`）に書いた

### R9-07 [MEDIUM] `ScanState` の doc が、いま起きないことを書いている（comment）

「作成ボタンが現れ」と書いてあるが、分類を4つに割ってからは索引が無い回は
`missing` ではなく `unknown` に来るので作成ボタンは出ない。鏡写しのテストの doc も同じ。

- 結果: 対応済み。**出ないことのほうが問題**（開くことも作ることもできない画面が、
  押した本人の操作で現れる）という形に書き直した

### R9-08 [LOW] プリセット編集ダイアログの仕様に engines の帯が1行も無い（oss-hygiene）

「操作と結果」の表に「engines/ を作成」はあるが、**どういうときに出るか**が無い。
r8 で `missing` のときだけに変えたので、現物と仕様の距離が開いた。

- 結果: 対応済み。分類ごとの帯と押せる口を表にした

### R9-09 [LOW] `readdirSync` の例外の一覧が古い（oss-hygiene）

`CONTRIBUTING.md` が例外として名指ししているのはディレクトリ名を数える3本だけ。
`src-tauri/tests/` を歩く `ratchetIndex` と `src-tauri/capabilities/` を歩く
`openerCapability` が載っていない。載せないと、規約に反した検査が2本ある形になる。

- 結果: 対応済み。「`walk.ts` が歩けない木」を2つ目の例外として書いた

## 検証

- `npm run verify` … 通る（rebase 直後に1回、r9 の修正後にもう1回）
- `npm run verify:rust` … 通る（rustdoc warnings 34 / baseline 34）
- `bash .claude/hooks/verify-gate.test.sh` … 通る（assertion 203 本）

**アプリは一度も起動していない。** 実機で Finder が開くことは誰も確かめていない。
