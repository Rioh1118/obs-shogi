# レビュー file-tree-error ラウンド4

- 日付: 2026-08-30
- 範囲: issue #169（`fix/169-file-tree-error`、`main...HEAD`）
- 走らせた reviewer: architecture / react / ui / robustness / rust / comment / oss-hygiene
- 対象: `main...HEAD`（短ハッシュは rebase で消えるので範囲で書く）

**所見 56件を統合して 40件**（BLOCK 1 / HIGH 15 / MEDIUM 24）。

**うち10件はラウンド3 の対応が作った退行または未着地。**
とくに次の3つは、**コミット本文が主張した内容が差分に入っていなかった**。

| コミットの主張                               | 実際                                         |
| -------------------------------------------- | -------------------------------------------- |
| `CreateFileModal` に `padding="none"` を渡す | `.tsx` に入っておらず、余白は逆に12px 増えた |
| `failure-surfacing.md` §4 の抽出条件を対応   | §4 の本文に変更が1行も無い                   |
| 書き戻しの「34ファイル / 267件」             | 実測は 31ファイル                            |

**書き戻しを検証していなかった。** 以後、書き戻しの各行は `git log -- <path>` と
`grep` で確かめてから書く。

---

## BLOCK

### B-1 `reducer.ts` のコメントが、同じブランチの `Modal.tsx` の修正で成立しなくなった

- reviewer: comment
- 場所: `src/entities/file-tree/model/reducer.ts` の `case "error"`
- 根拠: 「モーダルが2枚重なり、Escape は先に登録された下のダイアログだけを閉じる」と書いてあるが、
  重なりの順序を共有した時点でその挙動は無くなっている。
- なぜ問題か: このガード（`if (state.conflict)`）を残すべき理由は別にあるのに、
  その理由が**もう存在しない不具合**に載っている。`Modal` 側を知っている人は
  「この分岐はもう要らない」と読んで消しにかかる。
- 直し方: 残る理由だけにする。

---

## HIGH

### H-1 読み直しを待たなくなったので、操作は成功したのにツリーが古いまま返る

- reviewer: robustness / react（独立に指摘）
- 場所: `src/entities/file-tree/model/provider.tsx` の6箇所（`void loadFileTree()`）
- 根拠: 「新しいフォルダ」→ 名前を打って Enter → 入力行は消えるが、ツリーには現れない。
  読み直し中であることも画面のどこにも出ない（`Spinner` は `!hasTree` のときだけ）。
- なぜ問題か: **ラウンド3 H-4 の対応が作った退行。**
  「読み直しの失敗を操作の失敗として返さない」は正しいが、
  **返さないことと待たないことは別**で、後者まで一緒に変えていた。
  利用者には「押しても何も起きなかった」と見え、もう一度打つと `already_exists`。
  改名では `cancelInlineRename()` の直後に**古い名前で**描き直される。
- 直し方: 待って、結果だけ捨てる。

### H-2 読み直しが2本重なると、選択と reveal の受け渡しが古い木に食われる

- reviewer: react
- 場所: 同上、および `pendingSelectedPathRef` / `pendingRevealPathRef`（単一スロット）
- 根拠: `loadFileTree` に世代も in-flight の印も無く、ref は単一スロット。
  R1 が着地したときに R2 の目的地を消費し、`findNodeChain` が `null` を返して
  `selected_node_reconciled: null` になる。
- なぜ問題か: 「改名したら選択の強調が消え、改名先が畳まれたフォルダの中に隠れる」。
  **この変更が無くそうとしている症状そのもの。**
- 直し方: H-1 と同じ（待てば直列化される）。

### H-3 背景の読み直しが着地すると、その間に積まれた失敗通知が消える

- reviewer: react
- 場所: `src/entities/file-tree/model/reducer.ts` の `tree_loaded`（`error: null`）
- 根拠: 移動が成功 → 読み直し R1 を投げて即戻る → 次の操作が `permission_denied` →
  Modal が出る → R1 が着地して `error: null` になり Modal が消える。
- なぜ問題か: 「失敗がどこにも出ない を無くす」の直接の逆行。
- 直し方: H-1 と同じ（待てば交差しない）。

### H-4 `commitName` の絞り込みが `invalid_extension` を落とす

- reviewer: robustness
- 場所: `src/widgets/file-tree/lib/commitName.ts`、`src/entities/file-tree/api/error.ts`
- 根拠: 棋譜を右クリック → Rename → 拡張子を落として Enter → Rust が `invalid_extension`。
  `isNameInputError` が偽なので通知へ積まれ、reducer が編集行を畳んで**打った文字列が消える**。
- なぜ問題か: **ラウンド3 M-4 / M-5 の対応が作った退行。**
  それ以前は全部の失敗を入力欄へ返していたので、打った文字列は残っていた。
  `isNameInputError` の TSDoc が書いている条件（「打った名前を直せば通る」）を
  `invalid_extension` は満たしている。
- 直し方: `isNameInputError` に足し、網羅の `switch` にする。

### H-5 `asyncResultUse` が `void f()` を見ないので、同じ PR が入れた9箇所が全部素通り

- reviewer: react / robustness（独立に指摘）
- 場所: `src/__tests__/asyncResultUse.test.ts`
- 根拠: 正規表現が `await` を必須にしていた。`void loadFileTree()` 7件と
  `void openKifuNode(node)` 2件は1件も一致しない。
- なぜ問題か: ラウンド3 H-7 の対応として置いた装置が、**同じラウンドの H-4 が主流にした
  書き方を見ていない**。`await` を消すだけで抜けられる。
- 直し方: `void f(` も拾う。

### H-6 blur 後の Escape は物理的に届かない。テストが実在しない発火元を使っている

- reviewer: react / ui / comment（**3人が独立に指摘**）
- 場所: `src/widgets/file-tree/ui/InlineNameEditor.tsx`、同 `.scss`、そのテスト
- 根拠: `span` に `tabIndex` は無く、失敗の箱は `pointer-events: none`。
  blur 後の `activeElement` は `<body>` で、`#root` の祖先なので React のルートを通らない。
  テストは `fireEvent.keyDown(screen.getByRole("alert"), ...)` と、
  **ブラウザでは起こり得ない target** で押している。
- なぜ問題か: **ラウンド3 H-2 の3点目が未着地のまま、緑のテストが付いて閉じられた。**
- 直し方: 落ちた名前のまま外へ出たら編集を閉じる。テストも実際の経路にする。

### H-7 `CreateFileModal` に `padding="none"` が渡っていない

- reviewer: ui
- 場所: `src/features/create-file/ui/CreateFileModal.tsx`
- 根拠: SCSS 側だけ「Modal の padding は none」と書いて、`.tsx` は触られていない。
  既定の `md` が効いたままなので、余白は 20px + 12px に**増えた**。
- なぜ問題か: **コミット本文が主張した内容が差分に入っていない。**
  さらに 30px のずれの原因も `Modal` ではなく `Form` の左右 padding で、
  因果の説明が誤っていた。
- 直し方: 実際に渡す。因果の説明も実際の出所に直す。

### H-8 `contrast.ts` の `opacity` 合成が面側で何もしていない

- reviewer: ui
- 場所: `src/__tests__/contrast.ts`
- 根拠: `composite({ ...under, a }, under)` は `fg` と `bg` が同じ色なので恒等式。
  **この行を消しても出力は1件も変わらない。** 実測で 4.235 と報告、実物は 4.445。
  また `opacity` を無条件に掛けているので、`&:hover { opacity: 1 }` が「戻す」にならない。
- なぜ問題か: 「両方に掛けている」と主張しながら片方しか掛けておらず、
  テストもそれを固定できていなかった。
- 直し方: 薄める先は**親の面**。擬似クラスの入れ子では掛けずに置き換える。

### H-9 `unmeasured` が「色そのものが解けない宣言」を数えない

- reviewer: ui
- 場所: 同上
- 根拠: `color: currentColor` / `var(--x, ...)` は `next.color === null` になり、
  `pairs` にも `unmeasured` にも入らない。実測20件。
- なぜ問題か: 同じ書き方で新しい部品を1つ足すと、どちらの数も動かず、
  検査対象がゼロで増える。
- 直し方: 数える。

### H-10 呼び忘れ検査は属性の書き方かコメント1行で素通りする

- reviewer: rust
- 場所: `src-tauri/src/file_system/mod.rs`
- 根拠: `#[command]` で `split` しているだけなので、`#[tauri::command]` に書き換えると
  コマンドを1件も見つけられず `missing` が空になる（この crate では両方の表記が既に混在）。
  `body.contains` なので、`// validate_under_root は不要` というコメントでも通る。
  ファイル一覧も手書きなので、`.rs` を1本足すと検査の対象にならない。
- なぜ問題か: 「呼び忘れが静的に見えない」ことを補うために置いた装置が、
  呼び忘れの主要な経路を3通りとも見逃す。
- 直し方: ディレクトリを実行時に列挙し、両方の表記を拾い、行コメントを落とし、
  見つけた件数の下限を置く。

### H-11 `get_file_tree` を除外した理由が成立していない

- reviewer: rust
- 場所: `src-tauri/src/file_system/tree.rs`
- 根拠: `invoke("get_file_tree", { rootDir: "/Users/x" })` でホーム以下の
  全ディレクトリ名・棋譜のフルパス・サイズ・更新時刻が返る。
  呼び出し経路は1本で、渡る値は常に `config.root_dir` なので**突き合わせは今すぐできる**。
- なぜ問題か: `main` にもある穴だが、**この変更で「意図的な例外」として明文化された**。
- 直し方: `AppHandle` を受けて `validate_under_root` を通す。

### H-12 `AppModalLayer` が union を非網羅の `===` で分けている

- reviewer: architecture
- 場所: `src/pages/AppModalLayer.tsx`
- 根拠: 同じ union を分ける他の5箇所は全部網羅 `switch`。ここだけ `||` の連鎖。
- なぜ問題か: 変種が8つ目になったとき、`switch` の5本はコンパイルエラーで直しに
  連れて行かれるが、ここだけ `false` に落ちる。**落ちた先で起きるのはラウンド3 H-5 そのもの。**
- 直し方: 網羅 `switch` の述語に切り出す。置き場も `features/file-conflict/lib`。

### H-13 `ModalType` に呼び出し元ゼロの値が残っている

- reviewer: architecture
- 場所: `src/shared/lib/router/useURLParams.ts`
- 根拠: `"analysis"` は定義行以外に出現0。解析ペインは常設でモーダルではない。
- なぜ問題か: 呼び出し元ゼロの union 値は**3ラウンド続けて同じ形**で出ている。
  しかも `CLAUDE.md` が連動必須と名指ししている唯一の union。
- 直し方: 落として、対応を検査で保つ。

### H-14 ADR-0006 が扱っていない規則が同じコミットで消えている

- reviewer: oss-hygiene
- 場所: `docs/OPERATING-MODEL.md` §2、`docs/decisions/0006-drop-wip-limit.md`
- 根拠: 「Now が終わるまで、新しい issue を Now に上げない」も同時に削られたが、
  ADR には一言も無い。しかも ADR の理由は「効いているのは件数ではなく
  **終わらせずに次を始めないこと**」で、**その当のルール**を記録なしに消している。
- なぜ問題か: いまリポジトリに「終わらせずに次を始めない」を表す文が1つも無い。
- 直し方: ADR に書く。

### H-15 この PR が新設した append-only の境界を、この PR 自身が破っている

- reviewer: oss-hygiene
- 場所: `docs/OPERATING-MODEL.md`、`docs/decisions/0005-one-button-one-dialog.md`
- 根拠: 境界は「`LOG.md` に行が入った後は決定そのものを書き換えない」。
  ADR-0005 は LOG 記録後に決定5 を書き換えている（実測値でも誤記でもない）。
- なぜ問題か: 「同じ規約が都合よく引かれる」を防ぐために書いた文が、1件目から割れている。
- 直し方: 実際に効いている境界（`main` に入った後）に書き直す。

---

## MEDIUM（24件・要点のみ）

| #    | 内容                                                                                            | reviewer     |
| ---- | ----------------------------------------------------------------------------------------------- | ------------ |
| M-1  | 「Escape は span で拾う」の理由が、その span では実現できない状況を挙げている                   | comment      |
| M-2  | `mod.rs` の doc に変更の経緯（`残っていた`）。新設した検査が拾わない語                          | comment      |
| M-3  | `already_exists` の行き先を「通知」と書いている箇所が3つ（実際は衝突の対話）                    | comment      |
| M-4  | `TODO(#184)` の件数が実測と合わず、同じファイルが「件数を書くな」と決めている                   | comment      |
| M-5  | `mv.rs` の「移動先が呼び出し側から来る唯一のコマンド群」が事実でない                            | comment      |
| M-6  | `provider.tsx` の「3つの名前」が、参照先の表（5経路）と `deleteNode` の実装に合わない           | comment      |
| M-7  | `submitRename` の TSDoc が隣の `const kind` に付いている                                        | comment      |
| M-8  | `commitName` の「5つある入力欄」が、モーダル側の3つを含んでいない                               | comment      |
| M-9  | `handleCommit` が「失敗したが出さない」を成功と同じ `undefined` で返す                          | react        |
| M-10 | `FileConflictDialog` だけ処理中が `isLoading` に揃っていない（送信中は focusable が0）          | react        |
| M-11 | `getConflictCopy` の `canRename` が7分岐すべて `true` で、対話側の分岐が到達不能                | robustness   |
| M-12 | 衝突の対話が開いている間に届いた**背景の**読み直しの失敗が、どこにも出ないまま消える            | robustness   |
| M-13 | 状態遷移表の不変条件1と S1 行が、待たなくなった実装と合わない                                   | robustness   |
| M-14 | `entities` の reducer が持つ不変条件を、`widgets` にしか無いヘルパが満たしている                | architecture |
| M-15 | 「Escape は最上位だけ」が `Modal` の中に閉じており、付箋・メニューが従えない                    | architecture |
| M-16 | `src/__tests__` の `src` を歩くヘルパが7本。`__tests__` を含めるかが検査ごとに違い理由が無い    | architecture |
| M-17 | `Select.scss` だけ畳まれておらず、`<Form>` の外に置くと明るい面が出る                           | ui           |
| M-18 | `StudyPositionSaveModal` が `.form__*` の内部を上書きし続けている                               | ui           |
| M-19 | 失敗の箱が不透明のまま行を覆い、`pointer-events: none` で「見えない行を押せる」                 | ui           |
| M-20 | 1.14:1 を「読めない」として捨てた直後に 1.12:1 をホバーの唯一の手掛かりにしている               | ui           |
| M-21 | 対応する規則が1つも無いクラスが3件（`ButtonGroup.align` ほか）                                  | ui           |
| M-22 | `src` の root 検査を存在確認より前に置いたので、親ごと消えた場合にパスが表示から消える          | rust         |
| M-23 | `dest_dir` が直接検証されておらず、存在確認だけが root 検査より前に走る（存在の oracle になる） | rust         |
| M-24 | `root_dir` 未設定なら関門は無条件で開く。テスト名と doc がそれを言っていない                    | rust         |

そのほか文書側: 改名した `deferFailure` がテストのコメントに残る／
ADR-0006 の「4つの文書が同じことを言う」が単一 Now 前提の2箇所で成立していない／
ADR-0001 の本文に撤回の印が無く grep で死んだ決定を拾う／部分 supersede の書式が未定義／
#214 / #215 / #216 がコードから辿れない／`CONTRIBUTING.md` の「意味色は4つ」がこの PR の
トークンを含まない／足した3つの検査と逃げ道が `CONTRIBUTING.md` に無い／
`failure-surfacing.md` §1 の件数が同じ PR の後続コミットで腐っている／
ADR-0004 が使う `F-12a` / `F-12b` が採番元に無い／`file-tree.md` S3 / S5 行の内部矛盾。

---

## 重複・矛盾した所見

- **H-6 は3人が独立に指摘。** 直し方は割れた（`tabIndex={-1}` を付けて箱へフォーカス /
  `document` で拾う / 閉じてしまう）。**判断が要る**
- **H-1 と H-2 と H-3 は同じ原因**（待たなくなったこと）。1つ戻せば3つとも消える
- **M-14 と M-15 は「共有すべきものが1つの部品の中に private で置かれている」という同じ形**

## 見ていない範囲

- **実機での確認は誰もしていない。** ハングの再現は happy-dom 上、
  コントラストは走査器での計算、Rust は読みと `cargo test`
- `features/settings` の12ファイルの中身、`widgets/analysis-pane` `widgets/game-board` のレイアウト
- `src-tauri/src/engine/` `src-tauri/src/search/` の並行性
- `docs/images/*.png` が現在の UI と一致するか（判定できない）
- `npm run verify:rust` は rust reviewer だけが走らせた

## lint / hook で強制できるもの

**複数の reviewer が独立に挙げたもの**:

- **`void f()` 形の `AsyncResult` 破棄の検出。** H-5
- **`focus` を取れない要素への `fireEvent.keyDown` の検出。** H-6 のテストが落ちる
- **union のリテラル値のうち呼び出し元が0の値の検出。** H-13（**3ラウンド続けて同じ形**）
- **`.tsx` が出すクラス名のうち `.scss` にセレクタが無いものの検出。** M-21
- **走査型のテストに件数の下限を必須にする。** H-10（0件で緑になる形）
- **docs 内の実測値のうち数えられるものをテストで固定する。** §1 の件数
- **報告書の書き戻しが、実際にその範囲を触ったコミットを持つかの検査。**
  H-7 と §4 の「対応と書いたが差分が空」が落ちる

---

## 次ラウンドの対象

**BLOCK 1件と HIGH 15件は全部直す。MEDIUM も #169 の範囲にあるものは全部。**

**issue に送る**: 無し（H-11 / M-22〜M-24 は `mv.rs` / `tree.rs` を触っている範囲なので直す）。
