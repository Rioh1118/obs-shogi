# レビュー file-tree-error ラウンド2

- 日付: 2026-08-29
- 範囲: issue #169（`fix/169-file-tree-error`、`main...HEAD` の61ファイル）
- 走らせた reviewer: architecture / react / ui / robustness / rust / comment / oss-hygiene
- 対象: `main...HEAD`（短ハッシュは rebase で消えるので範囲で書く。r1 の教訓）

**所見 63件を統合して 34件**（BLOCK 3 / HIGH 12 / MEDIUM 19）。

ラウンド1 は29件だった。**増えている。** 範囲を ADR-0005 のデザインシステム適用まで広げたため、
新しい面が露出した。**うち5件はこの変更が作った退行**（B-1 / B-2 / H-1 / H-2 / H-5）。

---

## BLOCK

### B-1 新規作成とインポートの失敗が、どこにも出なくなった

- reviewer: robustness / architecture（独立に指摘）
- 場所: `entities/file-tree/model/provider.tsx` の `deferFailure`、
  `features/create-file/ui/FileCreateForm.tsx`、`features/create-file/ui/KifuImportForm.tsx`
- 根拠:

```tsx
// FileCreateForm.tsx — result.error を見る場所が1つも無い
const result = await createNewFile(dirPath, { ... });
setIsLoading(false);
if (result.success) { toggleModal(); }
```

- なぜ問題か: **ラウンド1 H-5 の対応（`deferFailure`）の前提が間違っていた。**
  「3フォームとも自分の中に失敗を出す場所を持つ」と判断したが、**持っているのは
  `SfenKifuCreateModal` だけ**。残り2つは `result.error` を捨てている。

  ファイル名に `a/b` と入れて「作成」を押す → `invalid_name_separator` →
  `deferFailure` は `already_exists` でないので何もしない → `pushError` も呼ばれない →
  **画面は Spinner が消えてフォームが残るだけ。** 利用者は「作成」を押し続ける。
  `permission_denied` / `io` / `invalid_path` も同じ。

  **この変更の前は `handleFailure` 経由で通知が出ていた。退行。**

- 直し方: 2つのフォームに `FsErrorView` を置く（部品はこの変更で既にある）。
  置かないなら `deferFailure` をやめて `handleFailure` に戻す。
  あわせて `features/create-file` にテストが1件も無いので、この経路を固定する。

### B-2 明るいモーダルが1つ残っており、共通ボタンの「キャンセル」が 1.15:1 で消える

- reviewer: ui / comment（独立に指摘）
- 場所: `features/create-file/ui/CreateFileModal.tsx`（`theme="light"`）、
  `shared/ui/Button/Button.scss`（`color: $color-text-primary`）、`shared/ui/Modal.tsx`（既定 `light`）
- 根拠（実測）: 明るいカード（実効 `#cdc9bd`）の上で

| 要素                            | 比         |
| ------------------------------- | ---------- |
| neutral の文字 `#dcd7c9`        | **1.15:1** |
| neutral の枠 `rgba(#fff,0.1)`   | 1.06:1     |
| ホバー面 `rgba(#fff,0.06)`      | 1.03:1     |
| 置き換え前の `form__btn--ghost` | 2.30:1     |

- なぜ問題か: ADR-0005 決定3 は「暗い面に寄せた時点で明るい面のボタンが要らなくなる」と
  書いたが、**`CreateFileModal` が `theme="light"` のまま残っている**。
  `Modal` の既定も `light` のままなので、「暗い側を既定にしてある」という
  `Button.tsx` のコメントに対応する条件式が存在しない。
  `showCloseButton` も渡していないので、見える離脱手段が「作成」だけになる。
- 直し方: `CreateFileModal` を `theme="dark"` にする（`CreateFileModal.scss` の明面前提も一緒に）。
  `Modal` の `theme` 既定を `dark` に変えると、同じ抜けが構造的に消える。
  `PositionNavigationModal` の `theme="light"` も棚卸しする。

### B-3 `message` を画面に出す箇所が残り、日本語から英語のログへ退行した

- reviewer: architecture / robustness（独立に指摘）
- 場所: `features/create-file/ui/SfenKifuCreateModal.tsx`、`src-tauri/src/file_system/utils.rs`
- 根拠:

```tsx
setErrorMsg(result.error.message ?? "ファイルの作成に失敗しました");
```

- なぜ問題か: M-16 の対応で Rust の `message` を日本語から英語の生ログへ変えた。
  この行はそれをそのまま画面に出すので、**`name contains a path separator` と英語で表示される**。
  変更前は「名前にパス区切りを含めることはできません」だった。**退行。**
  `message` は必須の `string` なので `?? "..."` は到達しない死んだフォールバック。
- 直し方: `FsError` をそのまま持って `FsErrorView` で描く。B-1 で2つのフォームに足す表示と同じ形にする。

---

## HIGH

### H-1 ルートが消えたとき「ワークスペースを選び直す」が出ない（M-6 の対応が効かない）

- reviewer: robustness
- 場所: `widgets/file-tree/ui/FileTreeErrorNotice.tsx`、`entities/file-tree/api/error.ts`、
  `src-tauri/src/file_system/tree.rs`
- 根拠: `root_dir` が消えたとき Rust は `NotFound` を返す。`fsErrorTier("not_found")` は `warning`。
  `fallback` は `tier !== "warning"` のときしか描かれない。
- なぜ問題か: **M-6 で作った逃げ道が、実際に起きるケースで発火しない。**
  出るのは「見つかりません」と**「再読み込み」だけ**で、同じ `rootDir` を読みに行くので必ず失敗する。
  サイドバーの中で完全な行き止まり。
  テスト（`FileTree.test.tsx` の「ワークスペースを選び直せる」）は `permission_denied` を使っており、
  **実際に起きる `not_found` を通らないのですり抜けた。**
- 直し方: 段ではなく「ツリーがあるか」で分ける。`fallback` が渡されているときは段に関わらず並べる。
  テストを `not_found` に差し替えて先に落ちることを確認する。

### H-2 主ボタンのホバーが 4.02:1 で、決定2 が守ろうとした基準をホバー中だけ割る

- reviewer: ui
- 場所: `src/index.scss`（`$color-secondary-solid-hover: #9e7757`）、`shared/ui/Button/Button.scss`

| 状態       | 面        | 白文字        |
| ---------- | --------- | ------------- |
| 通常       | `#8f6b4e` | 4.79:1 ✅     |
| **ホバー** | `#9e7757` | **4.02:1** ❌ |

- なぜ問題か: ホバー面は捨てたはずの `#a27b5c` 側へ戻した値。**主ボタンは押す直前に必ずホバーする**ので、
  読みにくくなるのが「押そうとしている瞬間」。ADR-0005 にホバー段の実測が書かれていないので、
  次に触る人は測られていないことに気づけない。**ラウンド1 M-12 が指摘した穴が、値を変えただけで残っている。**
- 直し方: ホバーを**暗く**する。`#866549`（白文字 5.30:1）。明るくする方向を保つなら上限は
  `#916e52`（4.61:1）だが、差が小さくホバーが見えない。ADR に実測を書き足す。

### H-3 `danger` が 4.47:1 で、確認ダイアログの実行ボタンが基準を割る

- reviewer: ui
- 場所: `shared/ui/Button/Button.scss`、`src/index.scss`

| 状態   | 面        | `#0e1110`     |
| ------ | --------- | ------------- |
| 通常   | `#b5645c` | **4.47:1** ❌ |
| ホバー | `#bf7a73` | 5.64:1 ✅     |

- なぜ問題か: primary は測って新トークンまで足したのに、**同じコミットで作った `danger` は測っていない**。
  通常が割れてホバーで上がるという逆転（primary はホバーで下がる）。
  付くのは削除の確定・ワークスペース変更など、取り消せない操作。文言が読めることが一番要る場所。
- 直し方: `$color-danger-solid: #b96d66`（4.94:1）を足して面に使う。`$color-danger` は枠・文字・薄い面に残す。

### H-4 `FsErrorView` が2つの面に載り、サイドバー側で段の色と本文が基準を割る

- reviewer: ui
- 場所: `entities/file-tree/ui/FsErrorView.scss`、`widgets/file-tree/ui/FileTree.tsx`

| 要素                         | 暗いカード `#1c2325` | サイドバー `#3f4e4f` |
| ---------------------------- | -------------------- | -------------------- |
| `__path` / warning           | 6.03:1               | **3.79:1** ❌        |
| `summary` / warning          | 5.46:1               | **3.52:1** ❌        |
| `border-left`（段） / danger | 3.36:1               | **1.92:1**           |
| primary の面 vs 背景         | 2.83:1               | **1.60:1**           |

- なぜ問題か: `FsErrorView` は面を持たず `rgba(意味色, 0.1)` を親に重ねるだけなので、実効値が親で変わる。
  **サイドバー側は「ツリーごと開けなかった」ときにしか出ない**＝ `danger` が出る場所で、
  段を伝える左の 3px が 1.92:1 まで落ちる。逃げ道のボタンの面も背景と 1.60:1 で箱として見えない。
  ADR-0005 決定5 は「1つの部品」と決めたが、**1つの部品が2つの面に載ることは決めていない。**
- 直し方: `FsErrorView` に不透明な自分の面を持たせて親から独立させる
  （`color-mix(in srgb, $color-primary-black 88%, $color-warning)` など）。

### H-5 入力の訂正を求める失敗が、直すための入力欄を道連れに消す

- reviewer: robustness / comment（独立に指摘）
- 場所: `entities/file-tree/model/reducer.ts`（`case "error"`）、`widgets/file-tree/ui/RootNode.tsx`
- なぜ問題か: **ラウンド1 H-1 の対応（編集行を畳む）が、入力の訂正を求める失敗にも当たっている。**
  `研究/2026` と入力 → `invalid_name_separator` → 入力欄が消え、**打った文字列も捨てられる**。
  段は `danger` なので再読み込みは出ず、`fallback` はツリーがあるとき渡していないので
  **押せるのは「閉じる」だけ**。閉じたら右クリックからやり直して全部打ち直す。
  ADR-0004 は F-14 を「入力欄の下」と決めており、`failure-surfacing.md` も「入力を直す」と書いているので、
  **文書が実装と逆のことを言っている。**
- 直し方: 検証（`invalid_name_*`）の失敗は `state.error` に積まず、`FileConflictDialog` の
  `submitError` と同じく入力欄の直下に出して入力を保つ。ADR-0004 の割り当てとも揃う。

### H-6 衝突の再解決で失敗したとき、`submitError` が `[conflict]` のリセットに消される

- reviewer: react
- 場所: `features/file-conflict/ui/FileConflictDialog.tsx`、`entities/file-tree/model/provider.tsx`（`pushConflict`）
- なぜ問題か: `b.kif` も既にある → `deferFailure` が `pushConflict` を呼び、`conflict` が**新しいオブジェクト**になる
  → `[conflict]` の effect が `setSubmitError(null)`。**設定した直後に消える。**
  同時に `setDraftName` で `canSubmit` が false になり、**ボタンも押せず表示も出ない**状態で止まる。
  ラウンド1 M-5 で足した表示が、**このダイアログが存在する理由そのもの**（`already_exists`）で働かない。
- 直し方: リセットの鍵をオブジェクトの識別子でなく中身にする。`key={getRequestedName(conflict)}` か、
  依存を値に落とす。

### H-7 処理中にフォーカスが `<body>` へ落ち、モーダルの外へ出る

- reviewer: react
- 場所: `shared/ui/Button/Button.tsx`（`disabled={disabled || isLoading}`）、`shared/ui/Modal.tsx`
- なぜ問題か: フォーカスを持つ要素が `disabled` になるとブラウザは blur する。
  `Modal` はマウント時の移動とアンマウント時の復帰しか持たないので、**開いたまま中で失うと戻す経路が無い**。
  `#modal-root` は `#root` の後ろにあるので、`<body>` からの Tab は**オーバーレイの裏のアプリ本体**に入る。
  ラウンド1 M-17 で足したフォーカス移動はマウント時しか見ていないので、ここを通さない。
- 直し方: `Modal` に閉じ込めを足す。または `Button` の busy を `disabled` でなく
  `aria-disabled` + `onClick` の早期 return にする（`aria-busy` は既に出している）。

### H-8 Rust が棋譜の変換失敗に `InvalidType` を返し続け、「ファイルとフォルダを取り違えています」と出る

- reviewer: robustness
- 場所: `src-tauri/src/file_system/operations.rs`（2箇所）、`entities/file-tree/api/error.ts`
- なぜ問題か: M-16 の対応で code を細分したが、**細分したのは TS 側だけ**。
  Rust は棋譜の正規化・直列化の失敗を `InvalidType` に載せたまま。
  `describeFsError` が `invalid_type` に「取り違え」という断定的な意味を与えたので、
  **以前は曖昧だった表示が明確に誤った表示になった。**
- 直し方: Rust に `KifuConversionFailed` を足して2箇所を向け、TS の union と2つの switch に足す
  （網羅なので `tsc` が連れて行く）。`InvalidType` は `is_file()` / `is_dir()` の判定だけに残す。

### H-9 Rust の code を1つ増やすと、TS 側で `message` と `path` が消えて `[object Object]` になる

- reviewer: architecture / rust（独立に指摘）
- 場所: `entities/file-tree/api/error.ts`（`asFsError`）、`entities/file-tree/api/fileSystem.ts`
- なぜ問題か: Tauri の reject 値はプレーンオブジェクトなので、`isFsErrorCode` を通らないと
  `String(error)` = `"[object Object]"` に落ちる。**どのファイルで何が起きたかが全部消える。**
  Rust 側に `FsErrorCode` を網羅 `match` する箇所が1つも無いので、片側だけ増やしても何も言われない。
  `error.test.ts` の「落とすときも元の内容は残す」は `new Error(...)` しか渡しておらず、
  実際に起きるオブジェクトの経路を1件も踏んでいない。
- 直し方: フォールバックで `message` / `path` / `existingPath` を拾い直す。
  Rust 側に網羅 `match` のシリアライズ名テストを置く（下の lint 節）。

### H-10 `CLAUDE.md` から消した WIP=1 が、ADR-0001 と OPERATING-MODEL と weekly-review に残っている

- reviewer: oss-hygiene
- 場所: `docs/decisions/0001-branch-and-pr-policy.md`、`docs/OPERATING-MODEL.md`、
  `.claude/skills/weekly-review/SKILL.md`
- なぜ問題か: **同じ文が2箇所にそのまま残っている。** 2件目に着手した状態で `/weekly-review` を回すと
  「WIP 違反」と指摘される。さらに `OPERATING-MODEL.md` は `docs/decisions/` を
  「append-only。覆す時は新 ADR で supersede」と定めており、**ADR-0001 の決定を新 ADR も LOG も無しに
  運用文書側だけで撤回したのは、このプロジェクト自身が決めた覆し方に従っていない。**
- 直し方: ADR-0006 を1本書いて ADR-0001 の該当決定を supersede し、LOG に1行足し、
  残る2箇所を落とす。あわせて ADR-0001 のブランチ名規則（`issue-<番号>/<slug>`）も
  直近10本中1本しか従っていないので、同じ棚卸しで片付ける。

### H-11 状態遷移表の注が、同じファイルの本文と正反対のことを言い続けている

- reviewer: oss-hygiene / architecture / robustness / comment（**4人が独立に指摘**）
- 場所: `docs/state-transitions/file-tree.md`（※1 の見出し、※2 の全体）
- なぜ問題か: S3 の定義を「ツリーは描いたまま」に書き換えたのに、参照先の注が
  「**S3 ではファイルツリー全体が描画されない**」のまま。3行下の本文と正反対。
  ※2 の3点（`handleFailure` が全部流す / どれもツリーを消す / 種類は使われていない）は
  **すべて偽になった**。この表は `reducer.test.ts` と `FileTree.test.tsx` が根拠として指す先。
- 直し方: ※1 の見出しを削って本文だけ残す。※2 を `handleFailure` / `deferFailure` の2経路として書き直す。

### H-12 `failure-surfacing.md` が「Q-005 を決める材料」のまま、2行だけ #169 後に更新されている

- reviewer: oss-hygiene
- 場所: `docs/state-transitions/failure-surfacing.md`
- なぜ問題か: Q-005 は ADR-0004 で決着済みなのに、冒頭が「Q-005 を決めるための材料」、
  §5 が「Q-005 で決めること」のまま。そこへ F-3 / F-14 の2行だけ「#169 で対応済み」と書いたので、
  同じファイルで「ツリーを消す」（§1）と「ツリーは残す」（§2）が矛盾している。
  **スナップショットとして読むなら2行の更新が不当、生きた台帳として読むなら残り全部が嘘。**
- 直し方: 役割を1つに決める。生きた台帳にするなら冒頭を書き換え、§4 §5 を落として ADR-0004 へのリンクにし、
  §1 と §3 を現状に合わせる。

---

## MEDIUM（19件・要点のみ）

| #    | 内容                                                                                                                                                       | reviewer               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| M-1  | `Button` の `motion` / `block` / `quiet` / `lg` / `sharp` が**呼び出し元ゼロ**。「連続で押す場所では切る」の該当箇所（MultiPV のステッパー）で切っていない | architecture / comment |
| M-2  | `SButton` の `ghost`(18) と `subtle`(5) を両方 `neutral` に潰した。**軸は増やしたが区別は減った**                                                          | architecture           |
| M-3  | `FsError` の語彙が `entities/file-tree` に閉じておらず、棋譜スライスがファイルツリーに依存。`shared/lib/` へ下げるべき                                     | architecture           |
| M-4  | `entities/file-tree/index.ts` が公開境界として機能していない。同じ差分で `FsErrorView` が barrel と深い経路の2通りで import されている                     | architecture           |
| M-5  | `error.test.ts` の `ALL_CODES` が手書きで、code を増やしても落ちない。`FS_ERROR_CODES` から導出すべき                                                      | architecture           |
| M-6  | `AiLibraryTab` が `String(FsError)` で `[object Object]` を出す（差分外だが同じファイルを触っている）                                                      | architecture           |
| M-7  | `role="dialog"` を足したがアクセシブル名が無く、全モーダルが「ダイアログ」としか読まれない                                                                 | react                  |
| M-8  | `role="alert"` がボタンと `<details>` まで包み、読み込み中の文言変化で全文が読み上げ直される                                                               | react                  |
| M-9  | 読み直し中の Escape とオーバーレイが黙って効かない（`onClose` が `retriedFrom` を消さない）                                                                | react                  |
| M-10 | Spinner のテストが Spinner を見ておらず、その行を消しても通る                                                                                              | react                  |
| M-11 | `isLoading` を新設したのに `ConfirmDialog` と `FileTreeErrorNotice` が使わず、busy が3通りに                                                               | react                  |
| M-12 | `FileConflictDialog` だけ `Modal` の既定 padding が二重に効く（36px）。**M-13 と同じ形が新しいコードで再発**                                               | ui                     |
| M-13 | `Button.scss` が裸の `rgba(0,0,0,…)` を書き戻した。**M-14 の再発**                                                                                         | ui                     |
| M-14 | ヘッダの枠が 1.20:1 で、面を落とした分の構造を担えていない。バッジの文字も 10.43→5.30 に落ちた                                                             | ui                     |
| M-15 | 衝突ダイアログの失敗理由が 3.74:1。**唯一の表示なのに読めない**                                                                                            | ui                     |
| M-16 | `rgba($color-text-primary, N)` が18通り。この変更で5通り足した。うち 0.55 は 4.34:1                                                                        | ui                     |
| M-17 | Rust の `validate_basename` が trim した文字列を検証し、生の名前でパスを組む                                                                               | rust                   |
| M-18 | Rust の `message` 規約が同じファイル内で2つに割れた（英語ログと日本語が混在）                                                                              | rust                   |
| M-19 | ADR-0005 の数字が実測と合わない（118件 vs 130件、5→1 vs `ControlButton` が6系統目として現存）                                                              | comment / oss-hygiene  |

そのほか、**使われていない宣言に現在形の説明が付いている**（`.fsError__hint` / `.uiBtn--quiet` / `.uiBtn--block`）、
**コメントが自分を否定している**（`FileTreeErrorNotice` の「復帰路は読み直しの1本だけ」/ `ConfirmDialog` の
「色でしか分からなくなる」と言いながら色で分ける）、**`validateBasename` の「Rust と同じ検証」が偽**（2規則 vs 4規則）、
**テストのコメントに変更の経緯が1件**、**報告書 r1 のハッシュが rebase で解決不能**、
**`CONTRIBUTING.md` の #180 リストの 2/4 が事実と違う**、**`CLAUDE.md` の「テストは片手で数えられる本数」が
実測 211件と2桁違う**、**`implement` と `review-round` が「誰が決めるか」で食い違う** が挙がっている。

---

## 前ラウンドとの関係

**ラウンド1 の対応が原因で新しく壊れたもの**:

| r1 の所見              | 対応           | r2 で出た問題                                     |
| ---------------------- | -------------- | ------------------------------------------------- |
| H-5 表示が二重         | `deferFailure` | **B-1** 2つのフォームが失敗を捨てている           |
| H-1 通知が閉じられない | 編集行を畳む   | **H-5** 入力の訂正でも入力欄が消える              |
| M-6 設定への導線       | `fallback`     | **H-1** `not_found` が `warning` なので発火しない |
| M-12 主ボタンの定義    | 共通 Button    | **H-2 / H-3** ホバーと danger が基準割れ          |
| M-15 モーダル2実装     | `FsErrorView`  | **H-4** 1つの部品が2つの面に載る                  |
| M-16 文言の分散        | 案A            | **B-3 / H-8** 出す側と Rust 側に取り残し          |
| M-13 Modal の既定値    | 明示した       | **M-12** 別のダイアログで再発                     |
| M-14 色の直値          | トークンへ     | **M-13** 新しい共有部品で再発                     |
| M-17 フォーカス        | Modal で塞ぐ   | **H-7** busy 中の喪失は塞げていない               |

**同じ形が繰り返されている。** 「1箇所を直したが、同じ性質の場所が他に残った」が6件、
「直した仕組みを新しいコードで使わなかった」が3件。

---

## 見ていない範囲

- 実機での描画。コントラストはすべて SCSS の合成順からの手計算で、`backdrop-filter` の影響は入れていない
- `src-tauri/src/engine/` `src-tauri/src/search/`（差分外）
- `features/settings` の12ファイルは呼び出し行のみ。各タブの面との合成は未確認
- `docs/state-transitions/` のうち差分に含まれない4本
- `npm run verify` / `verify:rust` は robustness と rust の2人が走らせた（緑）。他は読みのみ

---

## lint / hook で強制できるもの

**複数の reviewer が独立に挙げたもの**:

- **コントラスト比の検査。** 同じ規則ブロックに `background` と `color` がある対を拾って 4.5:1 を割ったら落とす。
  **B-2 / H-2 / H-3 はすべてこれ1つで落ちる**
- **Rust の `FsErrorCode` ⊆ TS の `FsErrorCode` の検査。** Rust 側に網羅 `match` の
  シリアライズ名テストを置き、その出力を vitest 側で突き合わせる。**H-9 の再発を防ぐ**
- **`FsError.message` を JSX に直接埋めることの禁止。** **B-3 が落ちる**
- **`AsyncResult` を返す関数の呼び出しで `result.error` を一度も読まない箇所の検出。** **B-1 が落ちる**
- **`scssScale.ts` に色のバケツを足す。** 現在8バケツに色が無いので `rgba(0,0,0,…)` も
  裸の `white` / `black` も1件も数えられていない。**M-13 が落ちる**
- **`.scss` で定義され `.tsx` から一度も参照されないクラス名の検出。** `.fsError__hint` が落ちる
- **`Button` の union 型と SCSS の修飾子の一致検査。** 未使用の tone / size / radius が見える
- **`docs/**/\*.md`が引く`src` のパスとシンボルの実在検査。\*\* ADR / 文書の参照切れ検査（r1 で挙がった）を
  識別子まで広げる
- **`.claude/reviews/*.md` の短ハッシュが `git merge-base --is-ancestor` を満たすかの検査**

**機械では防げないもの**: B-1（呼び出し元が失敗を出すかは静的に判定できない）、H-1（段の割り当ての妥当性）、
H-5（どの失敗に入力欄を残すか）、H-11 / H-12（文書の真偽）。いずれも判断の側。

---

## 次ラウンドの対象

**BLOCK 3件と HIGH 12件は全部直す。** 順序:

1. **B-1 → B-3** — 失敗が消える経路を先に塞ぐ。同じ2フォームを触る
2. **B-2** — `Modal` の既定を `dark` にし、`CreateFileModal` を寄せる
3. **H-2 / H-3 / H-4 / M-15 / M-16** — コントラストをまとめて。**先に検査を書く**
4. **H-1 / H-5** — 段と復帰路の割り当て。ADR-0004 の F-14 と揃える
5. **H-8 / H-9** — Rust 側の取り残しと型ガード
6. **H-6 / H-7 / M-7〜M-11** — React とアクセシビリティ
7. **H-10 / H-11 / H-12 / M-19** — 文書の整合。ADR-0006（WIP=1 の撤回）を含む
8. MEDIUM の残り

**3 は検査を先に書く。** コントラストは2ラウンド続けて同じ穴が出ており、人の目では止まらない。

---

## 対応結果（書き戻し）

**BLOCK 3件と HIGH 12件はすべて対応。MEDIUM 19件のうち16件を対応、3件は反論または issue へ送った。**

| #    | 結果                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| B-1  | 対応。2フォームに `FsErrorView` を置き、衝突の引き取り判定を `isResolvedByConflictDialog` に集約。テスト5件を追加        |
| B-2  | 対応。`Modal` / `Form` の既定を `dark` に。`TagsInput` を暗い面へ寄せ、`StudyPositionSaveModal` の私物の上書きを落とした |
| B-3  | 対応。`SfenKifuCreateModal` を `FsErrorView` に。保存先の案内は失敗ではないので Select の下の hint へ移した              |
| H-1  | 対応。逃げ道は段に関わらず並べる。`not_found` を通るテストを追加                                                         |
| H-2  | 対応。ホバーを `#866549`（5.29:1）へ。ADR-0005 に実測とホバーの向きの決め方を追記                                        |
| H-3  | 対応。`$color-danger-solid`（4.92:1）と `-hover`（6.10:1）を足した                                                       |
| H-4  | 対応。`FsErrorView` に不透明な面（`$color-primary-black` 94% + 意味色）を持たせた                                        |
| H-5  | 対応。`invalid_name_*` は積まずに返し、`InlineNameEditor` が入力欄の下に出す。`deferNameFailure` を追加                  |
| H-6  | 対応。初期化の鍵を `getConflictSessionKey`（打ち直した名前では変わらない）に                                             |
| H-7  | 対応。`Modal` にフォーカスの閉じ込め（`focusout` の戻しと Tab の折り返し）                                               |
| H-8  | 対応。Rust に `KifuConversionFailed` を足して2箇所を向けた                                                               |
| H-9  | 対応。`asFsError` が `message` / `path` / `existingPath` を拾い直す。Rust↔TS の突き合わせ検査を追加                      |
| H-10 | **反論。** 下の「反論」を参照。ブランチ名規則の方は → #201                                                               |
| H-11 | 対応。※1 の見出しを削り、※2 を3経路の表に書き直した                                                                      |
| H-12 | 対応。生きた台帳として書き直し、§3 を ADR-0004 へのリンク、§4 §5 を「まだ出口が無いもの」に置き換えた                    |
| M-1  | 対応。`quiet` / `lg` / `sharp` / `block` を落とし、MultiPV のステッパーで `motion={false}`                               |
| M-2  | **反論。** 下の「反論」を参照                                                                                            |
| M-3  | **反論。**（依存は存在しない）語彙の置き場は → #202                                                                      |
| M-4  | 対応。barrel が公開しているものは外から直に読まない検査を追加                                                            |
| M-5  | 対応。`ALL_CODES` を `FS_ERROR_CODES` から導出                                                                           |
| M-6  | 対応。`describeFsError` を通す                                                                                           |
| M-7  | 対応。`Modal` の `label` を必須にし、12箇所に付けた                                                                      |
| M-8  | 対応。`role="alert"` は見出しとパスだけを包む                                                                            |
| M-9  | 対応。閉じるときに `retriedFrom` も落とす                                                                                |
| M-10 | 対応。`Spinner` に名前を持たせ、テストがそれを見る                                                                       |
| M-11 | 対応。`isLoading` に寄せた（文言の入れ替えは残す）                                                                       |
| M-12 | 対応。`padding="none"` を渡す                                                                                            |
| M-13 | 対応。`$shadow-control` / `$shadow-control-press` を足した                                                               |
| M-14 | **一部のみ。** 見出しの枠 1.20:1 は面を持たせて対応。バッジの 10.43→5.30 は場所を特定できなかった                        |
| M-15 | 対応。`$color-danger-text`（5.66:1）を足した                                                                             |
| M-16 | **一部のみ。** 基準を割っていた 0.55 の2箇所を 0.7 へ。段の設計は → #184                                                 |
| M-17 | 対応。`validate_basename` が検証した形を返し、呼び出し元がそれでパスを組む。Rust のテスト3件を追加                       |
| M-18 | 対応。Rust の `message` を英語に揃え、`FsError` の型に規約を書いた                                                       |
| M-19 | 対応。118→143件、「5→1」→「文脈の5系統のうち4系統を畳んだ。実物はいま3系統」                                             |

**そのほか**の8件も対応:
`.fsError__hint` を削除 / `FileTreeErrorNotice` のコメント（H-1 と同時）/ `ConfirmDialog` のコメント /
`validateBasename` を Rust と同じ4規則に / テストのコメントから経緯を削除 /
ラウンド1 の短ハッシュを範囲へ / `CONTRIBUTING.md` の #180 リストを表に /
`CLAUDE.md` のテスト件数 / `review-round` と `implement` の食い違い。

### 反論

**H-10「`CLAUDE.md` から消した WIP=1 が3箇所に残っている」→ この反論は誤りだった
（ラウンド3 H-9 で覆った）。**

当初「`git log -S "WIP" -- CLAUDE.md` が空だから書かれたことは一度も無い」と書いたが、
**`CLAUDE.md` の文言は「着手中の issue は**常に1件**」で `WIP` という語を含まず、
検索語が当たらなかっただけ**だった。実際にはこのブランチの `090127b`
（`chore: 実装の進め方から確認の手数と着手数の縛りを外す`）が
`CLAUDE.md` と `implement/SKILL.md` の両方から削っている。所見は正しい。

対応: ADR-0006 を書いて ADR-0001 の該当1行を supersede し、`LOG.md` に1行足し、
`OPERATING-MODEL.md` と `weekly-review/SKILL.md` から落とした。

同じ所見が併せて挙げていたブランチ名規則（`issue-<番号>/<slug>`）の方も事実で、
直近の非 dependabot ブランチ6本中1本しか従っていない。**こちらは運用の決定**なので
勝手に覆さず → #201。

**M-2「`ghost` と `subtle` を `neutral` に潰した。軸は増やしたが区別は減った」→ 意図的。**
畳んだ理由は `b9a2252` のコミットメッセージに書いてある
（「枠を落とすと押せる場所が分からなくなる」）。区別を戻すなら枠を持たない段が要るが、
その `quiet` こそ呼び出し元ゼロで、同じレビューの M-1 が落とせと言っている。
両方を同時には満たせないので、**枠を残す側を採る**。

**M-3「棋譜スライスがファイルツリーに依存」→ 依存は存在しない。**
`entities/kifu` / `entities/position` / `entities/study-positions` から `file-tree` への
import は0件。棋譜の失敗を作っているのは `file-tree` の `provider.tsx` の側。
残る「語彙の名前と置き場が中身より広い」は本当なので → #202。

**M-14 のバッジ「10.43→5.30」は場所を特定できなかった。**
差分に含まれるヘッダを持つ4ファイル（`FileConflictDialog` / `KifuReadErrorDialog` /
`StudyPositionSaveModal` / `UpdaterScreen`）と `SettingsBadge` / `sp-save__contextItem` /
`sfen-kifu-create__turnBadge` を見たが、`color` を宣言していないか、比が合わなかった。
1.20:1 のヘッダ枠（`StudyPositionSaveModal.scss`）は特定できたので対応した。
測れる対はこのラウンドから `contrastRatchet.test.ts` が全部見る。

### 足した装置

- **`src/__tests__/contrast.ts` + `contrastRatchet.test.ts`** — 文字と面の対の比を測る。
  差分の外の12件は `BASELINE` に置いた → #185
- **`src/__tests__/fsErrorCodes.test.ts`** — Rust ⊆ TS の突き合わせ。Rust 側に網羅 `match` の
  シリアライズ名テスト（`src-tauri` 初の `#[test]`）
- **`src/__tests__/sliceBarrels.test.ts`** — barrel が公開しているものへの外からの直 import を止める
- テストは **19ファイル / 211件 → 30ファイル / 249件**。Rust は 0 → 4件

### 立てた issue

| #    | 内容                                                       |
| ---- | ---------------------------------------------------------- |
| #183 | 分岐選択のモーダルだけが明るい面に残っている               |
| #184 | 文字の薄さ `rgba(text-primary, N)` が15通りあり段が無い    |
| #185 | コントラスト検査に載せた既存の12件（IconButton は 1.03:1） |
| #201 | ADR-0001 のブランチ名規則が守られていない                  |
| #202 | `FsError` の語彙が「ファイルツリーの失敗」より広い         |
