# レビュー: #169 ファイル操作の失敗を出す — ラウンド9

- 日付: 2026-08-30
- ブランチ: `fix/169-file-tree-error`
- 範囲: ラウンド8 の対応（`acb848d` / `87d6d88`）以降に動いた全て
- 観点: architecture / react / ui / robustness / rust / comment / oss-hygiene（7観点、並列）
- 前のラウンド: [r8](./2026-08-29-file-tree-error-r8.md)

## 対応の書き方

ラウンド8 で「`git log --no-merges <base>..HEAD --stat` を先に出して対応列をそこから引く」と
決めた。それでも r8.md には誤りが2件あった（[r8 の訂正節](./2026-08-29-file-tree-error-r8.md)）。
止まったのは**帰属**（どのコミットか）の誤りで、**「そのコミットで解決した」という判定**は
止まっていない。

ラウンド9 からは、解決したと書く行について**その主張を固定するテストを指す**。
テストが無いものは「未検証」と書く。

結果、**BLOCK 5 / HIGH 8 / MEDIUM 12**。うち**8件がラウンド8 で私が入れた退行**。

---

## BLOCK

### B-1: `setRootDir` の失敗が `isLoading` を `true` で固定し、逃げ道そのものを塞ぐ

- 検出: robustness / react（独立に2件）
- 内容: ラウンド8 で `catch` から `dispatch({type:"error"})` を外したとき、その1つ手前の
  `dispatch({type:"loading"})` を残した。`configReducer` で `isLoading` を降ろすのは
  `loaded` / `updated` / `error` の3つだけなので、**この経路だけ二度と `false` に戻らない**。
  ルート改名 → ディスク上の改名は成功 → `app.json` の書き込みが落ちる、でそうなる。
  そこから抜ける手として案内している設定タブの「変更して再読み込み」は `isLoading` で
  無効化されるので押せず、`/` へ回っても `AppLoading` が起動スプラッシュのまま止まる。
  **ラウンド8 が「そこでしか脱出できない」と書いた場所が、同じ失敗で死んでいた。**
- **対応**（`c633f41`）: 失敗を積まずに `isLoading` だけ降ろす `settled` を足す。
  固定：`src/entities/app-config/model/__tests__/provider.test.tsx`
  （`settled` を消すと落ちることを確認）。

### B-2: `truncated` が Rust の中で行き止まり

- 検出: robustness / comment / oss-hygiene / architecture / rust（独立に5件）
- 内容: ラウンド8 の B-2 で足した `truncated` は `RustFileTreeNode` に無く、`adapter` も
  写していない。上限に当たったフォルダは `children` の無いノードとして届き、
  **空のフォルダと同じに描かれる**。`types.rs` の doc が「空のフォルダと区別できる形に
  しておく」と宣言した性質は、シリアライズの形にしかなかった。
- **対応**（`095e765`）: `rust-types` → `adapter` → `TruncatedNotice` まで通す。
  この境界にはどちらのコンパイラも立っていないので、写し忘れを止める検査も置いた。
  固定：`src/__tests__/fileTreeWire.test.ts`（受け口から欄を消す変異、
  adapter から写しを消す変異のどちらでも落ちることを確認）。

### B-3: `MAX_NODES` の予算がファイルを数えていなかった

- 検出: rust / architecture
- 内容: 予算はディレクトリへ降りるときだけ減っていたので、1つのフォルダに数十万の棋譜を
  置いた形（floodgate の取り込み）では上限が一度も効かない。
- **対応**（`6610086`）: 項目の種類を問わず数え、尽きたらそこで打ち切る。
  打ち切る前に名前で並べる（`read_dir` の順は OS まかせなので、並べないと読み直すたびに
  消える行が入れ替わる）。固定：`the_node_budget_counts_files_too` /
  `truncation_falls_on_the_same_entries_every_time`。

### B-4: 状態遷移表が、blur の扱いを変えた実装と逆のことを書いている

- 検出: comment / react
- 内容: 表は「E2 で blur → 名前の失敗なら **E0**（閉じる）」と太字で宣言しているが、
  実装は `onCancel()` を呼ばず `focus()` する（E3）。この表は
  `InlineNameEditor.tsx` から名指しで参照されている唯一の規範文書で、
  r7・r8 の所見もこの表を根拠に書かれている。
- **対応**（`b394c4c`）: 実装の側を変えた（下記 H-3）うえで、表も E3 / E4 に書き直した。
  「E4 を作らない」という規則は、E4 を焦点で解くほうが害が大きいので撤回した。

### B-5: `MAX_DEPTH` と `Walk` の doc が、互いの不在を根拠にしている

- 検出: comment
- 内容: `MAX_DEPTH` の「上限が無いとスタックオーバーフローで落ちる」の原因は
  `ancestors` が止めており、`Walk` の「1本あるだけで無限に降りる」は `MAX_DEPTH` が
  止めている。**どちらの「〜だから」も現在の条件式を指せない。** 読み手はどちらの doc を
  根拠にしても、もう一方を落とせると読める。
- **対応**（`9786871`）: 「この上限は何を止めるか」で書き直し、実際に残る危険
  （相異なるディレクトリを鎖状に繋いだ symlink では深さが伸びる）を `MAX_DEPTH` に書いた。

---

## HIGH

| #   | 検出                     | 内容                                                                         | 対応                                                                  |
| --- | ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| H-1 | oss / react / robustness | **`acb848d` のメッセージが、差分に無い変更（モーダルの `fallback`）を主張**  | `a4bc4c3` ＋ r8.md に訂正                                             |
| H-2 | ui                       | `> *` の `display` が `.file-name` の省略記号を消した（**私の退行**）        | `21c1046`                                                             |
| H-3 | react                    | 焦点を奪い返す `focus()` が、どのテストでも落とせない（**私の退行**）        | `b394c4c`                                                             |
| H-4 | react / comment          | 状態遷移表とコード内コメントが逆（B-4 と同根）                               | `b394c4c`                                                             |
| H-5 | rust                     | `create_ai_profile_dirs` が `engines` と重複名で `Ok` を返す                 | `7eb83a4`                                                             |
| H-6 | ui                       | `min-height` で全行が 4px 高くなり、縦中心が3通りに割れた（**私の退行**）    | `21c1046`                                                             |
| H-7 | comment                  | `ancestors` の doc が、その例を止めている1行を指していない                   | `9786871`                                                             |
| H-8 | robustness               | `dispatch("error")` → `/` → 出口の無い画面、が5経路のうち1つしか直っていない | `ddf714c` ＋ [#249](https://github.com/Rioh1118/obs-shogi/issues/249) |

### H-2 / H-6: ラウンド8 の SCSS が、直そうとした相手より広い範囲を壊した

`.node-box__main > *` に `display: inline-flex` と `min-height` を配ったが、

- `display` は `.file-name` にも当たる。フレックスコンテナの中身に `text-overflow` は
  適用されないので、**長い名前が「…」無しで断ち切られる**。「まだ続いている」という
  手掛かりが画面から消える
- `min-height` は `margin: 0.2rem` を持つ `.file-icon` のマージンボックスを 2.8rem にし、
  全行を 4px 高くする。chevron・アイコン・名前・操作ボタンの縦中心が 12 / 13 / 14 に割れる
  （変更前は4つとも 13.0 で揃っていた）
- `.inline-name-editor` と `display` を同詳細度で争い、勝敗が CSS の出力順にだけ支えられる

**揃えるつもりの変更が、一番よく見る通常の行を揃った状態から崩していた。**
元の狙い（失敗の箱で行が伸びるとアイコンが箱の中央へ落ちる）は行を1枚の要素にしないと
解けないので、[#246](https://github.com/Rioh1118/obs-shogi/issues/246) へ送って戻した。

### H-3: `focus()` は一度も落ちていなかった

react-reviewer が変異で確かめた。`inputRef.current.focus()` を `void 0;` に置き換えても
10件とも通る。`fireEvent.blur` は happy-dom の `document.activeElement` を動かさないので、
`expect(document.activeElement).toBe(input)` は**成立しようがない条件が無い**assertion に
なっていた。r8.md の「変異を当てて落ちることを確認したもの」には、この行の変異は入っていない。

そのうえで、`focus()` そのものが害だった。名前の失敗は同期で返るので、`focus()` は blur を
起こした click より前のマイクロタスクで走る。**利用者が移った先から焦点を引き戻す。**
押した行は開くのにキーボードは改名欄に残り、入力欄は `onKeyDown` を全て
`stopPropagation()` するので Escape が他の受け口にも届かない。しかも同じ処理で
`rejectedRef` が立つので、次の blur で結局打った文字列が捨てられる。

焦点を動かさない形にし、判定を `inputRef.current` の有無へ寄せて `leftFieldRef` を消した。
測り方も変えた（実際に別の要素へ焦点を移し、戻ってこないことを見る）。

## MEDIUM（12件）

- **react**: `reconcilePathMutation` が closure に閉じ込めた `activeKifuPath` を読む
  （IPC 3往復のあいだに別の棋譜を開くと、その内容が古いパスへ保存される）→ `c3ac21c`
- **robustness / react**: `blankStrings` が正規表現リテラルで同期を失い、`path.ts` 以降が
  丸ごと走査から外れる → `a5b7415`（自前の字句解析をやめ、TypeScript の parser へ）
- **architecture**: `escapeReceivers` の下限が実測値ちょうど → `a5b7415` で 5 へ
- **architecture**: `create_ai_profile_dirs` が `validate_basename` を呼ぶことを機械で
  要求していない → `fb2ebc5`（`EXTRA_GUARDS`）
- **comment / oss**: `permission_denied` を段のために借りている → `754149b`
  （`config_write_failed` を足し、見出しも分けた）
- **comment**: `MAX_NODES` の doc が「上限」と言うが総数はこれを超える → `6610086` で
  実際に超えない形にした。**テストの上限を下げた（`<= 600` → `<= 501`）というのは
  この時点では事実でなく、ラウンド10 の `331a19d` で入った**（下記の訂正）
- **comment**: `invalid_path` / `load_root_dir` の doc の置き場と重複 → `26db74a` / `af7bc3e`。
  **`rust-types.ts` の `truncated` の doc の複写はこの2つでは直っていない**
  （どちらもこの TS ファイルを触っていない）。ラウンド10 の `ead9c23` で直した
- **comment**: `error` action の意味が `setRootDir` の中にしか書かれていない → `ddf714c`
- **comment / ui**: `FileTree.scss` のコメントの持ち主がずれた → `06c450d`
- **ui**: 同じ `FileTreeErrorNotice` が、モーダルでは余白ありサイドバーでは無し → `06c450d`
- **ui**: `color-mix` の百分率を部品に直書き → `c66fafe`（`$surface-raised`）。
  **`c66fafe` の本文にある「どちらも名前を持たない」は誤り**で、94% の2つは
  以前から `$surface-warning` / `$surface-danger` という名前を持っていた。
  `NodeBox.scss` の 88% も残っていた（ラウンド10 の `cd7a685` で `$surface-overlay` へ）
- **oss**: `scssScaleRatchet` の適用範囲を、文書が実装より広く書いている → `12aeb5b`
- **comment**: コードの逐語訳が7箇所 → `9786871` / `26db74a`

## 範囲の外へ送ったもの

| 内容                                                                        | 送り先                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------- |
| 行を1枚の要素にして、失敗の箱が伸びてもアイコンの縦位置が崩れないようにする | [#246](https://github.com/Rioh1118/obs-shogi/issues/246) |
| `AppConfig` の `error` が「起動できない」と「更新できなかった」を兼ねている | [#249](https://github.com/Rioh1118/obs-shogi/issues/249) |

## 訂正（ラウンド10 で判明）

**3件、事実でないことを書いていた。**

### 1. B-3 が、直す前の欠陥を取り違えている

「予算はディレクトリへ降りるときだけ減っていた」と書いたが、`6610086^` の

```rust
if child_path.is_dir() || is_kifu_file(&child_path) {
    walk.depth += 1;
    walk.budget = walk.budget.saturating_sub(1);   // ← ファイルでも減っていた
```

のとおり、**減算はファイルでも起きていた**。効いていなかったのは**判定**のほうで、
`walk.budget == 0` を見るのはディレクトリの入口だけ。1つのディレクトリの中で
項目を積み続けるあいだ、予算は一度も見られなかった。

結論（数十万の棋譜を1フォルダに置くと上限が効かない）が正しいので、
**誤りが結論の正しさに隠れていた**。`6610086` のコミット本文も同じ取り違えを
しているが、履歴は書き換えられないのでここに残す。

### 2. テストの上限を下げたと書いたが、その差分はどのコミットにも無かった

`git log -S"501" 0090fcc..HEAD -- src-tauri/` は0件。書いた時点で `<= 600` のまま
だった。原因は、編集を当てるスクリプトが検証ゲートに弾かれて**一度も走っていない**
のに、走ったものとして報告書を書いたこと。同じスクリプトに入っていた `budget` の
doc の書き換えも未了だった。どちらもラウンド10 の `331a19d` で入れた。

### 3. `truncated` の doc の複写を、直していないコミットに帰属していた

`26db74a` は `ai_library.rs` と `types.rs`、`af7bc3e` は `error.rs` / `operations.rs` /
`utils.rs` しか触っていない。`rust-types.ts` の複写（`lastModified` の上に
`truncated` の doc が写っていた）はラウンド10 まで残った。

**書き戻しの誤りは7ラウンド続いている。** ラウンド9 で決めた「テストを指す」は
BLOCK にしか適用できておらず、HIGH と MEDIUM には「固定」も「未検証」も
書かなかった。ラウンド10 からは**表に「固定」列を持たせ、空欄を作らない**。

## 検証

- `npm run verify` — 緑
- `npm run build` — 緑
- `npm run verify:rust` — 緑

件数は書かない（`CLAUDE.md`）。`npm run test` と `cargo test` の末尾で確認する。

変異を当てて落ちることを確認したもの:

- `settled` を消す → `AppConfigProvider` のテストが落ちる
- `truncated` を受け口／adapter から消す → `fileTreeWire` が落ちる
- `create_ai_profile_dirs` から `validate_basename` を外す → `root_guard` が落ちる
- Escape のハンドラに `stopPropagation()` を足す → `escapeReceivers` が落ちる
- 確定の失敗後に `focus()` を戻す → `InlineNameEditor` のテストが落ちる
