# レビュー file-tree-error ラウンド1

- 日付: 2026-08-29
- 範囲: issue #169（`fix/169-file-tree-error`、`main...HEAD` の7ファイル）
- 走らせた reviewer: architecture / react / ui / robustness / comment
- 対象コミット: `653d937`

所見 **29件**（HIGH 7 / MEDIUM 22）。1件は検証の結果 **棄却**（下の「矛盾した所見」）。

---

## 所見

### [HIGH] H-1 改名が失敗すると、通知を閉じる操作が同じ改名を再実行して通知が戻ってくる

- reviewer: robustness
- 場所: `src/entities/file-tree/model/reducer.ts:96`、`src/widgets/file-tree/ui/FileTree.tsx:180`、
  `src/widgets/file-tree/ui/FileNode.tsx:104`、`src/widgets/file-tree/ui/InlineNameEditor.tsx:79`
- 根拠:

```ts
// reducer.ts:96 — error は renamingNodeId を落とさない
case "error":
  return { ...state, isLoading: false, error: action.payload };
// reducer.ts:108 — conflict_opened だけが落としている
case "conflict_opened":
  return { ...state, isLoading: false, menu: null, renamingNodeId: null, ... };
```

- なぜ問題か: 右クリック → Rename → `a/b` → Enter で `invalid_name` になる。`renamingNodeId` が残るので
  インライン入力は開いたまま、その上にモーダルが重なる。`Modal` はフォーカスを移さないので入力は裏で
  フォーカスを保つ。オーバーレイをクリックして閉じると mousedown で入力が blur → `commit()` →
  `draft` は `a/b` のままなので同じ改名が再送信され、再び失敗して通知が復活する。
  **閉じても戻ってくるうえ、クリックのたびに fs 操作が1回走る。**
  Escape だけは偶然抜けられるが、マウス操作の利用者には出口が無い。
  同じ形が `DirectoryNode.tsx:89` / `RootNode.tsx:65,74` にもある。
- 直し方: `reducer.ts:96` の `error` で `conflict_opened` と同じく
  `renamingNodeId: null, creatingDirParentPath: null, menu: null` を落とす。
- **結果: 対応済み。** 提案どおり reducer 側で畳んだ。表示側では直していない。
  編集行が開いたままであること自体が原因なので、出口（`InlineNameEditor` の `onBlur`）を
  塞いでも `DirectoryNode` / `RootNode` の3経路に同じ手当てが要る。
  `entities/file-tree/model/__tests__/reducer.test.ts` を新設し、先に2件が落ちることを
  確認してから直した。変異（畳む処理を戻す）で2件落ちることも確認済み。

> **この変更が作った新しい経路。** 以前は `return;` でツリーごと消えていたため、入力も一緒に消えていた。

### [HIGH] H-2 再読み込みを押すと「ツリーが消える」が再発し、`isRetrying` の UI は一度も描画されない

- reviewer: react
- 場所: `src/widgets/file-tree/ui/FileTree.tsx:71,75-82,164-167,180-189`、
  `src/entities/file-tree/model/provider.tsx:104`、`src/entities/file-tree/model/reducer.ts:5-6`
- 根拠:

```ts
// reducer.ts:5
case "loading":
  return { ...state, isLoading: true, error: null };
// provider.tsx:103 — 最初の await より前に同期で dispatch される
dispatch({ type: "loading" });
const res = await api.fetchTree(rootDir);
```

- なぜ問題か: `handleRetry` の `setIsRetrying(true)` と `loading` の dispatch が同じイベントで束ねられ、
  次のレンダで `error === null` / `isLoading === true` になる。結果:
  1. モーダルがクリックと同時にアンマウントし、`disabled={isRetrying}` も `"読み込み中..."` も**一度も出ない**
  2. ツリーがあっても `isLoading` で `RootNode` が `Spinner` に置き換わる
     → **「ツリーを消さない」という目的が再読み込み経路でだけ破れる**
  3. 再読み込みが失敗すると `error` が立ち直して点滅する

  `isRetrying` は provider の `isLoading` と同じ事実の二重持ちで、真実の源が2つある。

- 直し方: `isRetrying` を消し `isLoading` を唯一の源にする。
  描画側を `isLoading && !fileTree ? <Spinner/> : ...` に、モーダル条件を `(error || isLoading) && hasTree` にし、
  `isRetrying={isLoading}` を渡す。
- **結果: 対応済み（`b8a900d`）。** ただし提案どおりには直していない。
  モーダル条件を `(error || isLoading) && hasTree` にすると、**ファイル操作のたびに走る通常の
  読み直しでも通知が出る**（`loadFileTree` は成功時にも毎回呼ばれる）。
  代わりに「読み直しの引き金になった失敗」を `retriedFrom` として持ち、
  `shownError = error ?? retriedFrom` を表示に使う。`isLoading` は
  ボタンの状態にだけ使う。
  先にテストを書いて3件が落ちることを確認し、直した後に変異を3種当てて
  それぞれ落ちることを確認した（`shownError` を `error` に戻す / 読み込み中に
  Spinner へ差し替える / ボタンを押せるままにする）。

### [HIGH] H-3 検証系の失敗で「どう直すか」が本文から消え、唯一具体を持つ一文が `<details>` に隠れる

- reviewer: robustness
- 場所: `src/entities/file-tree/api/error.ts:39`、`src/widgets/file-tree/ui/FileTreeErrorNotice.tsx:21`、
  `src-tauri/src/file_system/utils.rs:39`
- 根拠:

```rust
// utils.rs:39 — 具体を持っているのは Rust の message だけ
return Err(FsError::new(FsErrorCode::InvalidName, "名前にパス区切りを含めることはできません"));
```

- なぜ問題か: `invalid_name` / `invalid_path` / `invalid_destination` / `invalid_extension` は
  **利用者の入力が原因**で、直し方は入力を変えることしかない。Rust は空 / `.` / `..` / パス区切り / NUL の
  5種を1つの code に潰しているので、何が悪いかを持つのは `message` だけ。
  それを `<details>` に畳んだ結果、画面には「その名前は使えません」しか出ない。
  `a/b` と入力した利用者は区切り文字が原因だと分からず、再読み込みを押しても当然直らない。
- 直し方: 検証系（`invalid_*`）は `message` を本文の2行目に出す。Rust の文言は既に利用者向けの日本語で、
  隠す理由が無い。生メッセージを本文に出さない方針を守るなら Rust の code を細分し、
  `describeFsError` 側で具体文を返す。

> **「Rust の生メッセージを本文にしない」という判断が、この分類では情報を殺している。**

### [HIGH] H-4 同じ widget に `console.error` がもう1つ残っている（ルートの改名）

- reviewer: robustness
- 場所: `src/widgets/file-tree/ui/RootNode.tsx:51-58`
- 根拠:

```tsx
try {
  nextName = validateBasename(nextNameRaw);
} catch (e) {
  console.error(e);
  return;
}
```

- なぜ問題か: この issue が潰したのは `FileTree.tsx` の `console.error` だけ。
  ルートフォルダを改名して `a/b` と入れると `validateBasename` が throw し、コンソールに出て終わる。
  `state.error` に積まれないので通知も出ない。`cancelInlineRename` も通らないので入力は開いたまま。
  利用者には「Enter が効かない」としか見えない。
- 直し方: `makeFsError("invalid_name", <検証関数のメッセージ>, node.path)` に変換して `pushError` 相当へ流す。
  provider に公開 API が無いなら `clearError` の並びに `reportError(error: FsError)` を足す。

### [HIGH] H-5 同じ失敗に対して表示が二重に出る（作成モーダル内と、その上のモーダル）

- reviewer: architecture
- 場所: `src/widgets/file-tree/ui/FileTree.tsx:180`、
  `src/features/create-file/ui/SfenKifuCreateModal.tsx:114`、`src/entities/file-tree/model/provider.tsx:70`
- 根拠:

```tsx
// SfenKifuCreateModal.tsx:114
setErrorMsg(result.error.message ?? "ファイルの作成に失敗しました");
// provider.tsx:70 — 同じ失敗が state.error にも積まれる
} else { pushError(error); }
```

- なぜ問題か: `SfenKifuCreateModal` は `createNewFile` を呼ぶ。`already_exists` 以外の失敗では
  `handleFailure` が `pushError` に落とす。`AppModalLayer` と `FileTree` は同時にマウントされているので、
  1回の失敗に対して「作成モーダル内のインライン（生 `message`）」と
  「その上に重なるモーダル（`describeFsError`）」が**同時に、違う文言で**出る。
  `FileCreateForm` / `KifuImportForm` も同じ経路。
- 直し方: `state.error` の表示所有者を1つに決める。既存の `kifuError` / `conflict` と同じく
  `pages/AppModalLayer.tsx` に置くか、`createNewFile` 系の失敗を `pushError` させず呼び出し元へ返しきる。

### [HIGH] H-6 `FsErrorCode` → 段 の対応が無く、10種すべてが `warning` で描かれる

- reviewer: architecture / comment（両者が独立に指摘）
- 場所: `src/widgets/file-tree/ui/FileTreeErrorNotice.scss:8-11`、`src/index.scss:21-24`
- 根拠:

```scss
// 10種類の code すべてが warning
border-left: 3px solid index.$color-warning;
background: rgba(index.$color-warning, 0.1);
```

- なぜ問題か: `$color-danger`（別の操作が要る）と `$color-fatal` を定義しておきながら、
  code → 段 を表す関数も型も無い。結果、`permission_denied` / `invalid_extension` /
  `invalid_destination` / `invalid_name` のように**再読み込みでは絶対に直らない**失敗にも
  「再試行で直る」の色が付き、唯一の主ボタンが「再読み込み」になる。
  権限不足でフォルダを作れなかった利用者は、効果のない再読み込みを押し続ける。
  段の判断がスタイルシートに埋まっているので、code を増やしても誰も気づかない。
- 直し方: `error.ts` に `fsErrorTier(code): "info"|"warning"|"danger"|"fatal"` を
  `describeFsError` と同じ網羅 switch で置き、段を modifier（`ftError--danger`）に反映する。
  `danger` では「再読み込み」を主ボタンから外す。

> ADR-0004 の決定3「**直らないものに再試行を出すと、通知が無いより悪い**」に真っ向から反している。

### [HIGH] H-7 コメントが指す `ADR-0004` と `docs/state-transitions/file-tree.md` がこのブランチに存在しない

- reviewer: comment / architecture / robustness（3人が独立に指摘）
- 場所: `src/index.scss:18`、`src/widgets/file-tree/ui/FileTreeErrorNotice.tsx:14`、
  `src/widgets/file-tree/ui/__tests__/FileTree.test.tsx:10`
- 根拠: `docs/decisions/` にあるのは `0001` `0002` `0003` と `LOG.md` のみ。
  `docs/state-transitions/` にあるのは `engine-position-sync.md` のみ。
- なぜ問題か: 4段に切った根拠と「復帰に何が要るか」という軸を外部文書に委ねているのに、
  読み手が開くと存在しない。段の定義を誰も検証できず、次に触る人が根拠不明のまま段を増減させる。
  テストの `S3` が何かも辿れない。
- 直し方: 両文書は `docs/state-transition-tables` ブランチにある。**このブランチに含めるか、
  そちらを先にマージして rebase する。** どちらもしないなら参照を消し、根拠をコメントに自己完結で書く。

### [MEDIUM] M-1 コメントが自分を否定している（「もう一度で直る」の次に「やり直さない」）

- reviewer: comment
- 場所: `src/widgets/file-tree/ui/FileTreeErrorNotice.tsx:14-16`
- 根拠:

```tsx
 * 段は「再試行で直る」（ADR-0004）。ファイルシステムの失敗は一時的なものが
 * ありうるので、同じ操作をもう一度で直る見込みがある。復帰路は再読込のみで、
 * 失敗した操作そのものはやり直さない。
```

- なぜ問題か: 同じ段落が自分を否定している。実際に押せるのは `refreshTree` だけで、
  同じ操作の再実行はどこにも無い。「〜だから」に対応する条件式が存在しない。
- 直し方: 「この段は再読込という1本の復帰路しか持たない」と書き切る。
  「同じ操作をもう一度で直る」の一文は残さない（この画面ではできない）。

### [MEDIUM] M-2 「呼び出し元しか知らない」が誤り。呼び出し元も知らない

- reviewer: comment
- 場所: `src/widgets/file-tree/ui/FileTreeErrorNotice.tsx:16` と `FileTree.tsx:73-74`
- 根拠: コンポーネント側は「何が失敗したかは呼び出し元しか知らない」、
  widget 側は「失敗を積んだ側（provider）に残っていない」と**逆のことを書いている**。
  `handleFailure` は `already_exists` 以外で `request` を捨てるので、失敗した操作は state に残らない。
- 直し方: 「失敗した操作の内容は state に残らない（`already_exists` のみ `conflict` に retain される）ので、
  `onRetry` は再読込に限る」へ直す。同じ事実を2箇所に書かない。

### [MEDIUM] M-3 `error.cause` は `state.error` に決して入らない（死んだ分岐）

- reviewer: ui
- 場所: `src/widgets/file-tree/ui/FileTreeErrorNotice.tsx:26-35`、`src-tauri/src/file_system/error.rs:19-26`
- 根拠: Rust の `FsError` は `code / message / path / existing_path` の4つだけで `cause` を持たない。
  `cause` を詰めるのは `provider.tsx:219-224` の1箇所のみで、それは `kifu_error` → `state.kifuError` に入る。
- なぜ問題か: 「技術的な詳細」を開いても `code` と `message` しか出ない。
  `message` は `makeFsError("invalid_name", "名前を入力してください")` のように日本語の場合があり、
  リードが「その名前は使えません」・詳細が「invalid_name / 名前を入力してください」という
  **技術情報ゼロの折り畳み**が常に1つ増える。`KifuReadErrorDialog` は `hasDetail = !!error.cause` で
  無いときは出さない。同じ役割で挙動が割れている。
- 直し方: 詳細に出す情報が実際にあるときだけ `<details>` を描く。または `pushError` 側で `cause` を詰める。

### [MEDIUM] M-4 `describeFsError` に `default` が無く、`FsError` でない値が届くと見出しが空になる

- reviewer: robustness
- 場所: `src/entities/file-tree/api/error.ts:21,33`、`src/entities/file-tree/api/service.ts:41`
- 根拠:

```ts
export function asFsError(error: unknown): FsError { return error as FsError; }  // 検証していない
// service.ts:41 — parse は try の中。投げるのは KifuParseError で FsError ではない
} catch (e) { return { success: false, error: e as FsError }; }
```

- なぜ問題か: どの `case` にも当たらない値では `undefined` を返す。
  `<p className="ftError__lead">{describeFsError(error.code)}</p>` なので、
  **見出しが空・パスも無し・畳まれた詳細だけ**の警告箱が出る。
  `service.ts` の9箇所すべてが `e as FsError` で、`importKifu` は `KifuParseError` を投げる関数を
  try の内側で呼んでいる。網羅 switch は型の話であって、外から来た値の検証にはならない。
- 直し方: `default: return "原因が分かりませんでした";` を足し、網羅性は直前の
  `const _exhaustive: never = code;` で担保する。`asFsError` を型ガードにする。

### [MEDIUM] M-5 conflict と error が同時に立ち、Modal が2枚重なる。Escape は下だけを閉じる

- reviewer: robustness
- 場所: `src/entities/file-tree/model/provider.tsx:483`、`src/shared/ui/Modal.tsx:56`
- 根拠: `resolveConflictByRename` → `createNewFile` → `invalid_name`（`already_exists` ではない）→
  `pushError` へ回り、`conflict_closed` は投げられない。両方 z-index 9999。
- なぜ問題か: 画面が二重に暗くなり下の入力に触れない。Escape は**先に登録された conflict 側**が
  `preventDefault` するので下だけが閉じ、上の通知は残る。保留していた解決操作は失われる。
- 直し方: `resolveConflictByRename` の失敗は `conflict` の中に出すか、`pushError` 時に `conflict` を閉じる。

### [MEDIUM] M-6 ルートが開けないとき、設定への導線が消えた

- reviewer: robustness
- 場所: `src/widgets/file-tree/ui/FileTree.tsx:166-172`
- 根拠: 新しい分岐に入るので、置き換えられた側にあった
  「設定でルートディレクトリを選択してください」が出なくなった。
- なぜ問題か: `root_dir` を Finder で移動・削除した状態で起動すると `not_found` になる。
  出るのは説明文とパスと**再読み込みボタンだけ**で、このボタンは同じ `root_dir` を読み直すので
  何度押しても必ず失敗する。歯車から設定へ行けることを知らない利用者は行き止まりになる。
- 直し方: `FileTreeErrorNotice` に副アクションを渡せるようにし、`error && !hasTree` では
  「ルートフォルダを選び直す」を並べる。少なくとも `not_found` / `invalid_type` / `permission_denied`
  では再読み込みだけを出さない。

> **この変更が導線を1本減らしている。**

### [MEDIUM] M-7 テストが分岐しか固定しておらず、H-2 をすり抜けた

- reviewer: react / comment / robustness（3人が独立に指摘）
- 場所: `src/widgets/file-tree/ui/__tests__/FileTree.test.tsx:22,107-118`
- 根拠:

```ts
const refreshTree = vi.fn(async () => ({ success: true }) as const);
expect(refreshTree).toHaveBeenCalledTimes(1);
```

- なぜ問題か: `stub` が静的でモックは `isLoading` も `error` も動かさないので、実物なら必ず起きる
  H-2 の挙動が見えない。テスト名は「再読み込みで復帰できる」だが、検証しているのは
  **関数が1回呼ばれたこと**だけ。`clearError` を呼び忘れて失敗表示が残り続ける実装でも緑になる。
  provider をモックしたので provider 側の遷移が1件も固定されていない
  （`already_exists` が `pushConflict` へ回ること、`loading` が `error` を消すこと、
  `error` が `renamingNodeId` を落とさないこと＝H-1 の原因）。
- 直し方: モックを状態遷移込みにし、(1) 再読み込み中もツリーが残る (2) 成功後に alert が消える
  (3) 失敗し続けたときボタンが再び押せる、を別テストで固定する。
  あわせて `entities/file-tree/model/__tests__/reducer.test.ts` を足し、reducer の遷移を表で固定する。

### [MEDIUM] M-8 「Rust の生メッセージは畳んだ中に置く」テストが、本文側を見ていない

- reviewer: comment
- 場所: `src/widgets/file-tree/ui/__tests__/FileTree.test.tsx:83-93`
- 根拠: `detail.textContent` に `os error 5` が含まれることは見ているが、
  `ftError__lead` に生メッセージが**出ていない**ことを見ていない。
- なぜ問題か: `describeFsError` を `error.message` に差し替えても緑のまま。名前を信じた人が誤認する。
- 直し方: リード要素のテキストに `os error 5` が含まれないことを1行足す。

### [MEDIUM] M-9 `CONTRIBUTING.md` が「意味色はトークンにありません」のまま

- reviewer: comment
- 場所: `CONTRIBUTING.md:231-233`、`docs/OPEN-QUESTIONS.md` Q-005
- 根拠: CONTRIBUTING は SCSS の唯一の入口として「トークンにありません。Q-005 を先に見てください」と
  断言している。
- なぜ問題か: 次に通知 UI を書く人はこれを読んで `$color-warning` を探さず、また直値で色を発明する。
  Q-005 が数えた「warning が3通り・danger が3通り」の4通り目が増える経路が開いたまま。
- 直し方: `CONTRIBUTING.md` を「意味色は `src/index.scss` の4つから選ぶ」に書き換える。

### [MEDIUM] M-10 使っていない3段のコメントが用途を断定している

- reviewer: comment / architecture
- 場所: `src/index.scss:19,21,23-24`
- 根拠: `$color-warning` の参照は `FileTreeErrorNotice.scss` の3箇所のみ。
  `$color-info` / `$color-danger` / `$color-fatal` は定義以外に参照が0。
  既存の危険操作（`ContextMenu.scss:65` / `FileConflictDialog.scss:273` / `IconButton.scss:97` /
  `KifuForkActions.scss:113`）はいずれも自前の値のまま。
- なぜ問題か: 「danger は危険な操作の確認にも使う」と現在形で書いてあるので、
  読み手は統一済みだと思って実装を読み、値がバラバラなのを見て判断できなくなる。
- 直し方: 用途の断定を「未使用。寄せ先の候補」に改めるか、既存の danger 面を1つ寄せて実物を作る。

### [MEDIUM] M-11 `$color-danger` が `--color-danger` と別の値で二重定義

- reviewer: architecture
- 場所: `src/index.scss:23`、`src/shared/ui/IconButton.scss:98,100,104,105`
- 根拠: `--color-danger` はリポジトリのどこにも定義が無く、IconButton は常にフォールバック `#dc3545` を使う。
  そこに `$color-danger: #b5645c` が加わり「danger の赤」の答えが2つになった。
- 直し方: `IconButton.scss` を `index.$color-danger` に寄せて `var(--color-danger, #dc3545)` を消す。

### [MEDIUM] M-12 主ボタンの定義が4つ目になった（前景色・ホバー・無効化が食い違う）

- reviewer: ui
- 場所: `src/widgets/file-tree/ui/FileTreeErrorNotice.scss:58-95`、`src/shared/ui/Form/Form.scss:158-198`、
  `src/features/kifu-read-error/ui/KifuReadErrorDialog.scss:168-222`
- 根拠（実測）: 同じ `$color-secondary-dark` の面に対し前景色が2通り、無効化の減光が3通り
  （`0.45` / `0.46` / `0.5`）。

|                                       | コントラスト                    |
| ------------------------------------- | ------------------------------- |
| 新設 `$color-text-dark-1` on 銅       | **4.99:1**（ホバー面 6.24:1）✅ |
| 共有 `Button` の `$color-white` on 銅 | **3.80:1**（ホバー面 3.69:1）❌ |

- なぜ問題か: **新設側の判断が正しく、共有側が基準を割っている**のに、別ファイルで独立に定義されて
  いるため片方を直しても他方に届かない。同じ `.file-tree` の中で `ConfirmDialog` と並ぶので、
  利用者から見て「押すべきボタン」の見え方が2通りになる。
- 直し方: `.ftError__btn--primary` を独自定義せず共有 `Button` を使い、
  `Form.scss:173` の `color: $color-white` を `$color-text-dark-1` に変える（3.80 → 4.99）。
  `$color-secondary-dark-2` は元色とほぼ同一でホバーが視認できないので、銅のホバー段を1つ足す。

### [MEDIUM] M-13 `Modal` を既定値まかせで呼んでおり、`padding` が効かずスクロール経路も無い

- reviewer: ui
- 場所: `src/widgets/file-tree/ui/FileTree.tsx:181`、`src/shared/ui/Modal.tsx:36-37`、`src/shared/ui/Modal.scss:147-176`
- 根拠: `padding` 既定は `"md"` だが、その中身は `.modal__card--scroll-card` と `.modal__body` しか
  指していない。`scroll` 既定 `"none"` ではどちらのノードも生成されないので**パディングは1pxも効かない**。
  他の呼び出し元（`SettingsModal` / `StudyPositionsManagerModal` / `PositionSearchModal` /
  `StudyPositionSaveModal` / `EnginePresetEditDialogPanel`）は**全て明示**している。
- なぜ問題か: クラスは DOM に出るので、後から触る人が毎回追い直す。
  加えて `overflow: hidden` + `max-height: 80vh` に対し `.ftError__raw` に上限が無い。
  今壊れないのは中身が短いという偶然に依存している。
- 直し方: `padding="none" scroll="content"` を明示し、`.ftError__raw` に
  `max-height` + `overflow-y: auto` を入れる（`KifuReadErrorDialog.scss:146-147` と同じ）。

### [MEDIUM] M-14 色の直値がトークン規約の外に出ている

- reviewer: ui
- 場所: `src/widgets/file-tree/ui/FileTreeErrorNotice.scss:32,70,92-93`
- 根拠: `rgba(black, 0.22)` / `rgba(white, 0.06)` / `color-mix(..., white)`。
  既存の同じ役割（ghost ホバー）は `Form.scss:284` で `rgba(index.$color-white, 0.06)` とトークン経由。
- なぜ問題か: **同じ値・同じ役割なのに片方だけトークンを通らない。** `$color-white` を将来触っても
  新設側だけ取り残される。
- 直し方: `index.$color-white` / `index.$color-primary-black` に置き換える。

### [MEDIUM] M-15 `FsError` を見せるモーダルが2実装あり、置き場の規約も割れている

- reviewer: architecture / react（両者が独立に指摘）
- 場所: `src/widgets/file-tree/ui/FileTreeErrorNotice.tsx`、
  `src/features/kifu-read-error/ui/KifuReadErrorDialog.tsx`、`src/pages/AppModalLayer.tsx:25-30`
- 根拠: `state` の兄弟フィールド `error` / `kifuError` / `conflict` のうち、後ろ2つは
  `features/*` に切り出され `AppModalLayer` から常設マウントされているのに、`error` だけ widget の内側。
  `KifuReadErrorDialog` は同じ `FsError` を同じ `Modal`（ただし `theme="light"`）で、
  同じ「技術的な詳細」の折りたたみ・`path` 表示・「閉じる」を既に実装している。
- なぜ問題か: 利用者から見て、棋譜が開けないときと削除に失敗したときで別デザインのダイアログが出る。
  将来 `shared/lib/notify` に集約するとき、`features/*ErrorDialog` は候補として見えても
  widget の内側は見落とされる。**二重実装になる筋はここ。**
- 直し方: `FsError` 表示の中身を1コンポーネントに寄せ、`onRetry` を任意 prop にして両者から使う。
  モーダルの置き場も `AppModalLayer` に揃える。

### [MEDIUM] M-16 `FsError` → 文言の生成が3系統に分散し、具体的な指示が捨てられる

- reviewer: architecture
- 場所: `src/entities/file-tree/api/error.ts:33`、`src/features/file-conflict/lib/getConflictCopy.ts:4`、
  `src/features/kifu-read-error/ui/KifuReadErrorDialog.tsx`、`src/entities/file-tree/model/provider.tsx:476`
- 根拠: `FsError.message` は「Rust の生メッセージ」とコメントが言うが、実際には provider の
  169/221/476/518/536 が利用者向けの日本語を入れている。同じ型の値が画面ごとに違う規則で文章化される。
- 直し方: `message` は生ログ専用と決めて provider の日本語を code へ寄せるか、
  「`describeFsError` を既定、provider が上書きしたときは message を優先」と明示的に決めて
  `error.ts` のコメントに書く。

### [MEDIUM] M-17 唯一の復帰路であるモーダルにフォーカスが移らず、`role="dialog"` も無い

- reviewer: react
- 場所: `src/shared/ui/Modal.tsx:54-95`
- 根拠: `role` も `aria-modal` も無く、開いたときのフォーカス移動も、閉じた後の復帰も無い。
- なぜ問題か: この変更でファイル操作失敗の唯一の復帰導線がこのモーダルになった。
  キーボードだけの利用者は「再読み込み」に到達するまで背後を Tab で辿る必要がある。
  ラップされているのは `role="alert"` であって、モーダルであることは支援技術に伝わらない。
  （ポインタについては overlay がクリックを吸うので背後のツリー操作は生きていない）
  **H-1 の「入力が裏でフォーカスを保つ」の原因でもある。**
- 直し方: `Modal.tsx` 側1箇所で `role="dialog"` / `aria-modal="true"` / マウント時の focus /
  アンマウント時の復帰を入れる。既存の全モーダルが同じ穴を持つ。

### [MEDIUM] M-18 同じ述語が `hasTree` と `!fileTree` の2通りで書かれている

- reviewer: comment
- 場所: `src/widgets/file-tree/ui/FileTree.tsx:152,166,168,180`
- 根拠: `!hasTree`（166）と `!fileTree`（168）は今は同値。
- なぜ問題か: 名前を付けた側だけが将来の定義変更を受ける。片方だけ変わると、
  失敗表示と「ファイルツリーがありません」が同時に出るか、どちらも出ない分岐が生まれる。
- 直し方: 168 を `!hasTree` に揃える。

### [MEDIUM] M-19 読めないサブフォルダはツリーから黙って消える（**差分外 → issue 化**）

- reviewer: robustness
- 場所: `src-tauri/src/file_system/tree.rs:54`
- 根拠:

```rust
Err(_) => continue, // エラーは無視して続行
```

- なぜ問題か: 権限の無いサブフォルダが1つあると、そのサブツリーが捨てられ `state.error` にも積まれない。
  利用者には**完全なツリーに見える**ので、棋譜が数十件消えていても「そんなファイルは無い」と誤解する。
  横断検索の対象からも外れる。
- 直し方: 読み飛ばしたパスを一緒に返し、「N 件のフォルダを読み飛ばしました」を出す。
  **この変更の範囲外。別 issue として起票する。**

---

## 重複・矛盾した所見

### 矛盾（検証して1件を棄却した）

**`describeFsError` の網羅性が型検査で守られるか。**

- react: 「戻り値型が注釈されておらず、非網羅 switch は exit 0。**tsc で再現を確認済み**」
- comment: 「`FsErrorCode` に1件足すと `TS2366` が出る。コメントの主張は正しい」

**検証した。** `FsErrorCode` に1件足して `npx tsc -b` を走らせると

```
src/entities/file-tree/api/error.ts(34,53): error TS2366: Function lacks ending return statement
and return type does not include 'undefined'.
```

戻り値型 `: string` は最初から注釈されている（`error.ts:33`）。**comment が正しく、react の所見を棄却する。**
react は「確認済み」と書いていたが確認できていない。

ただし robustness の M-4（`default` が無いので**実行時**に `undefined` が出る）は別の問題であり、有効。
型検査は「新しい code を足したとき」を守るが、「外から来た未知の値」は守らない。

### 3人以上が独立に指摘したもの

- **H-7 参照先の文書が存在しない** — architecture / comment / robustness
- **M-7 テストが分岐しか固定していない** — react / comment / robustness

### 2人が指摘したもの

- H-6 段の割当が無い — architecture / comment
- M-15 モーダルが2実装 — architecture / react
- M-10 未使用トークンのコメント — comment / architecture

---

## 見ていない範囲

- **Rust 側**（`src-tauri/`）— 差分に含まれないため、`operations.rs` / `mv.rs` が返す code の妥当性は未確認。
  robustness が `utils.rs` / `tree.rs` / `error.rs` のみ読んだ
- **実機での描画** — ui のコントラストは SCSS の合成順からの手計算で、
  `background-blend-mode: overlay` と `backdrop-filter: blur(4px)` の影響は入れていない
- **`npm run verify` を走らせた reviewer はいない**（すべてコードの読みに基づく）
- `ScrollDropZone` 内に通知を描くことによる D&D 挙動、外部ファイルのドロップ経路
- `tsconfig.test.json` の変更が他のテストの型検査に与える影響
- `.ftError` のブロック名（`CONTRIBUTING.md:236` が命名規則を未決としており、
  既存にも `.engineTab` / `.wsTab` の camelCase があるため、この変更が新しく壊したものではない）
- `.claude/worktrees/` 配下（別セッションのチェックアウトのため対象外とした）

---

## lint / hook で強制できるもの

**3人以上が独立に挙げたもの**（このセッションで既に2回踏んでいる）:

- **コメント中の `ADR-\d{4}` と `docs/**.md`の実在検査。**`.claude/hooks/`か`src/**tests**/`に置けば`npm run test` で落とせる（既存の SCSS 走査器と同じ仕組みに乗る）

そのほか:

- `src/index.scss` で定義して `src/**/*.scss` から一度も参照されていないトークンの検出
  （`$color-info` / `$color-danger` / `$color-fatal` が該当）
- SCSS 内の裸の色キーワード（`white` / `black`）と `#rrggbb` リテラルの検出
  → ADR-0003 のラチェット走査に足せる。M-14 はこれで落ちる
- `var(--x, fallback)` で参照しているのに定義が無い CSS カスタムプロパティの検出（M-11）
- `no-console` を `src/widgets/**` と `src/features/**` に限定して有効化 → **H-4 はこれで防げた**
- `Modal.scss` のパディング指定に `--scroll-none` / `--scroll-content` を含める
  → prop の意味と描画のずれをスタイル側で保証（M-13）

**機械では防げないもの**: H-1 / H-2 / H-3 / H-5 / H-6 / M-5 / M-6（いずれも状態遷移と表示の設計）。
テスト名と assert 内容の一致、コメント内の因果と条件式の対応も同様。

---

## 次ラウンドの対象

**すべて直す。見送りは無い。** 順序は依存関係で決める。

1. **H-7 を先に解く。** ADR-0004 と `file-tree.md` をこのブランチから参照できるようにしないと、
   H-6（段の割当）の根拠が宙に浮く
2. **H-2 → H-1** の順。どちらも reducer と表示条件に触る
3. **H-6 → H-3** の順。段を入れてから、段ごとの本文と主ボタンを決める
4. H-4 / H-5 / M-5 / M-6
5. MEDIUM の残り
6. **M-19 は別 issue として起票**（Rust 側・差分外）

**M-7 は最後に回さない。** H-1 と H-2 はテストがすり抜けたから残った。
直す前にテストを書き、落ちることを確認してから直す。
