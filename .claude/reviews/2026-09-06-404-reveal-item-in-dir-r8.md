# レビュー 404-reveal-item-in-dir ラウンド8

- 日付: 2026-09-07
- 範囲: `fix/404-reveal-item-in-dir`（`/tidy-commits` 後の5コミット、`origin/main` = `8d53ea45`）
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 前ラウンド: `2026-09-06-404-reveal-item-in-dir-r7.md`

所見は **11件**（18 → 21 → 24 → 20 → 13 → 14 → 6 → 11）。
r7 の修正（読み直しの関門・後から届くルート）が作った所見が4件。

## 所見

### R8-01 [MEDIUM] `engines` の分類に2つ目の実装が残っている（architecture）

プリセット編集ダイアログ（`EnginePresetEditDialogPanel` → `EngineFilesSection`）は
`exists` だけを見ている。フォルダでないものが在る回に**警告を1つも出さないまま**、
エンジンの一覧だけが空になる。`AiLibraryTab` のコメント「分類は `classifyEnginesDir` が持つ」は
その時点で事実でなかった。

- 結果: 対応済み。ダイアログも同じ関数を通し、`other` の文言と作成ボタンの出し分けを揃えた

### R8-02 [MEDIUM] 「選択…」を1回押すと `scan_ai_root` が2回走る（architecture / react の2名、実測）

`chooseAiRoot` は設定を書き換えてから返るので、`onPick` の `scanNow` と
`aiRoot` の effect の `scanNow` が同じルートに対して両方走る。r7 の修正で入った重複。
世代が畳むので画面は壊れないが、**どちらが load-bearing か読めない**。

- 結果: 対応済み。別のルートなら effect に任せ、同じルートを選び直した回だけ `onPick` が呼ぶ

### R8-03 [MEDIUM] `setLocalAiRoot` を落としても14本が緑（react、変異で確認）

R7-04 のテストは「スキャンを出したか」しか見ていない。
落とすと `canOperate` が false のまま、索引の照合も外れて**「未設定」の画面**になるのに、
テストは通る。

- 結果: 対応済み。「画面に載ったか」まで見る。成功した「開く」で読み直さないことも固定した

### R8-04 [MEDIUM] `engines/ を作る段`の副動作だけ、開く先を名乗っていない（robustness）

「フォルダを開く」を押すと開くのは AI ルート（の親）。同じ画面の他の label は
r7 で「AI ルートを開く」「engines/ を開く」に揃っている。

- 結果: 対応済み

### R8-05 [MEDIUM] `currentRootRef` の doc が3つ目（読み直し）の機構を取り違えている（comment）

作成の2つは「閉包のルートで関門する」、読み直しは「ref の現在値で走らせる」で**逆**。
doc は3つとも同じ形だと書いていた。対称に揃えにいくと、切り替えた回の読み直しが落ちる。

- 結果: 対応済み。扱いが2通りであることが分かる形に割った

### R8-06 [MEDIUM] 壊れたリンクは `other` ではなく `missing` に来る（comment）

`DirInfo.exists` は `Path::exists` なのでリンクを辿る。壊れたリンクは `exists = false` で
`missing` に落ち、「engines/ を作成」が出て `create_dir_all` が EEXIST で落ちる。

- 結果: 対応済み（doc を実際の分類に合わせた。判定そのものは #469）

### R8-07 [MEDIUM] 評価関数の hero が、押しても表示されないフォルダの名前を本文に書いている（comment）

本文は `Suisho5/eval/` を見せると言い、実際に開くのは AI ルートの親。

- 結果: 対応済み（「AI ルートの場所を表示します。その中の …」に直した）

### R8-08 [MEDIUM] `enginesDirPath` のコメントが #404 の原因を誤って書いている（comment）

#404 は「実在しないパスを渡した」形ではなく、**scope がディレクトリを弾いた**形。
経緯（`〜だった` ＋ 裸の issue 参照）でもある。

- 結果: 対応済み（現在形の規則だけにした）

### R8-09 [MEDIUM] 門番が `src-tauri/capabilities/*` をどちらの検証にも割り当てていない（oss-hygiene）

`openerCapability` はそこを歩くのに、**許可だけを触ったコミットでは1度も走らない**。
#404 は capability と呼び出し元の食い違いで起きたので、いちばん素通しさせたくない組み合わせ。

- 結果: 対応済み（`verify-gate.sh` の case と `verify-gate.test.sh` の期待を1件ずつ）

### R8-10 [MEDIUM] `settings.md` の「失敗の振り分け」が #456 と食い違ったまま（oss-hygiene）

spec は「名前で直せる失敗は名前の欄へ返す」と書くが、`already_exists` は漏れている。
`いま満たしていないこと` にも #456 / #475 が無いので、spec だけを読んでも既知の穴に出会えない。

- 結果: 対応済み

### R8-11 [LOW] 到達しない所見 ID と、台帳の日付の不一致（oss-hygiene）

r2 の本文が `R2-22`（存在しない ID）を指し、台帳の F-13 だけ日付が1日ずれていた。

- 結果: 対応済み

## 重複・矛盾した所見

- **R8-02 は2名**が独立に挙げ、どちらも probe で実測している
- R8-03 / R8-05 / R8-08 は同じ根——**r7 で足した機構の説明とテストが、機構より1歩狭い**

## 見ていない範囲

- **実機の挙動は8ラウンドとも誰も見ていない**
- Rust 側（この差分は `capabilities/default.json` 以外触っていない）
- SCSS・実描画・支援技術での読み上げ
- issue 送りのもの（#448 #450〜#456 #461 #462 #464 #468 #469 #474 #475 #476）

## この作業で起きた事故（隠さない）

レビュー中、シェルの作業ディレクトリが主ワークツリーへ戻っていることに気づかず、
**主ワークツリーのファイル2つを書き換えた**（`EnginePresetEditDialogPanel.tsx` /
`EngineFilesSection.tsx`）。差分がこちらの編集だけであることを確かめてから `git checkout` で戻し、
`git status` が clean であることを確認済み。ユーザーの作業（別ブランチのコミット）には触れていない。

## lint / hook で強制できるもの

- R8-01 は走査で拾える（`engines_dir.exists` / `.kind` を読む綴りが分類の外に出たら落とす）
- R8-09 は入れた（門番の case と、その検査）
- R8-02 / R8-03 は静的には拾えない。**テストの mock を本番の振る舞いに合わせる**ことでしか
  再現しない並びがある（`chooseAiRoot` が `config` を書き換える、など）
