# レビュー kifu-write-path ラウンド4

- 日付: 2026-08-30
- 範囲: `fix/kifu-write-path`（`main` = `9aa963b` からの差分）
- 走らせた reviewer: `robustness` / `react`
- 対象コミット: `c229801`
- 前ラウンド: [r3](2026-08-30-kifu-write-path-r3.md)

**2体が独立に、同じ2つの根へ当てた。**

1. **ノートは閉じる手続きを通らずに閉じたり移ったりする。** `handleRequestClose` に積んだ
   約束（K1-3 の再試行、K2-3 の鍵の保持、#227 の失敗の箱）が、どれもその経路には効かない
2. **`isLoading` が1つの真偽値で、並行する書き込みが共有していた。** r3 で降ろす責任を
   `finally` へ一本化したことで、**先に終わった1本が他の書き込みの最中に「操作中」を解く**

## 所見

### [BLOCK] R4-1 書き込みの最中に別の書き込みが終わると「削除する」を押し直せるようになり、確認していない枝が消える（robustness / react の2体）

- 場所: `reducer.ts` の `set_loading` / `set_error`、`provider.tsx` の4つの `finally`、
  `KifuStreamList.tsx` の `ConfirmDialog isLoading`
- 根拠: `set_loading` は真偽値で入れ子を数えない。`isLoading` を立てる書き込みは4つあり
  （`edit` / `swapBranches` / `deleteBranch` / `loadGame`）、**どれの `finally` も無条件に
  false を撃つ**。`set_error` も `isLoading: false` を巻き込む。
  `ConfirmDialog` はこの1つの旗で `disabled` / `closeOnEsc` / `closeOnOverlay` を全部決めている。
  並行する書き込みが実在することは R4-2 で確認済み（ノートを閉じてもタイマーは発火する）。
- なぜ問題か: 20手目に「本譜 / 変化1 / 変化2」がある棋譜で、
  1. コメントを打ち、900ms 経つ前に20手目の「分岐」を押す（ノートは閉じるがタイマーは生きている）
  2. 「変化1を削除」→ 確認 →「削除する」。`jkf_replaced` でメモリの候補が `[本譜, 変化2]` に減り、
     書き込みを待つ
  3. その待ち時間に自動保存が終わり、その `finally` が `set_loading false` を撃つ
  4. 「削除中...」が消え、キャンセルも Escape も戻る。**削除の書き込みはまだ終わっていない**
  5. 反応しなかったと読んでもう一度押すと、1つ減った候補列に同じ `target=1` が当たり
     **変化2が消える**

  **K2-1 で直した「確認していない枝が取り消し不能に消える」が、書き込みの失敗を1度も
  必要とせずに再現する。**

- 直し方: `pendingWrites` を数え、`isLoading` をその射影にする。`set_error` からも
  `isLoading: false` を落とす。確認ダイアログはさらに**その削除自身の**ローカルな旗を見る
  （`isLoading` は「誰かが書いている」であって「この削除が書いている」ではない）。
- 導入コミットの sha: `a787119`（**ラウンド3で私が** `jkf_replaced` から `isLoading: false` を
  落とし、`isLoading` の意味を「書き込みが走っている」に変えて確認ダイアログへ繋いだ）
- 主張を固定するテスト名: `reducer.test.ts`「先に終わった1つでは isLoading が解けない」
  「set_error は走っている書き込みを終わらせない」（変異2つで確認）

### [BLOCK] R4-2 分岐メニューを開いてノートが閉じると、書きかけの本文が黙って消える（robustness / react の2体）

- 場所: `KifuCommentNote.tsx` の取り込みの効果とタイマーの効果、
  `KifuStreamList.tsx` の `toggleMoveMenu` / `onToggleForkMenu` / `[state.loadedAbsPath]` の効果
- 根拠: ノートを閉じる3経路はどれも `handleRequestClose` を通らず `setOpenComment(null)` を
  直に呼ぶ。別の手のコメントボタンは `open` を true のままカーソルだけ差し替える。
  取り込みの効果は鍵が変われば無条件に `setDraft(sourceText)` / `setSaveError(null)` を撃つ。
  タイマーの効果の dep は `[draft]` だけで `open` を見ておらず、`KifuCommentNote` は
  `KifuStreamList` に常設されて unmount されないので**張ったタイマーはそのまま発火する**。
  `FloatingNote` は閉じていると `return null` なので、`role="alert"` の箱は DOM に存在しない。
  robustness が probe を書いて実測（`afterClose: {calls:1, alert:false}` →
  別の面を開くと `alertText:""`、`editor:""` → 戻っても `totalCalls:1`）。
- なぜ問題か: 20手目に「重要な変化」と打ち、900ms 経つ前に別の行の「分岐」を押す →
  タイマーが発火して保存が失敗（読み取り専用・権限なし）→ **画面には何も出ない** →
  別の手のコメントを開く → その瞬間に下書きと失敗の記録が両方消える → 20手目は空。
  **ディスクにもメモリにも残らず、失敗した事実も残らない。**
  #227 が塞いだはずの穴が、ノートの**外側の閉じ方**から開いている。
- 直し方: 面を値として持ち、入れ替わる前に出ていく面へ書き切る。書く先は `doSave` の
  引数で受け取る（`stateRef` の「いまの面」を読むと、待っている間に入れ替わった別の面へ書く）。
  書けなかったぶんは鍵と対で預かり、同じ手を開き直したら本文と理由を出し直す。
- 導入コミットの sha: `d83b6b9`（`setSaveError` を入れ、失敗の唯一の出口をノートの中だけにした）。
  閉じる3経路自体は `main` から在る
- 主張を固定するテスト名: `KifuCommentNote.test.tsx`「別の手のコメントへ移る前に、
  出ていく面へ書く」「閉じる手続きを通らずに閉じられても、出ていく面へ書く」
  「書けなかった本文は、同じ手を開き直したときに出し直す」（変異で3本とも落ちることを確認）

### [HIGH] R4-3 下書きを抱えたまま閉じて開き直すと、エディタの中身と `draft` が食い違う（react）

- 場所: `KifuCommentNote.tsx` の `initialMarkdown` と、K2-3 で入れた「鍵を忘れない」
- 根拠: `FloatingNote` は閉じているとき `null` を返すので `LiveMarkdownNote` は unmount する。
  開き直すと同じ `key` でも新しく mount され、`LexicalComposer` の `initialConfig` は
  `initialMarkdown`（＝ `sourceText`、メモリの棋譜）から組む。一方 K2-3 の直しは
  下書きを抱えていると鍵を保つので、取り込みが早期 return して `draft` は古いまま残る。
  `OnChangePlugin` は `registerUpdateListener` なので mount では発火しない。
- なぜ問題か: 「aaa」と書く → 保存が失敗（赤い箱）→ どこかの行の「分岐」を押す →
  もう一度その手のコメントを開く。画面に出るのは**巻き戻し後のメモリの本文**で、
  「aaa」はどこにも見えない。赤い箱だけが「書いた本文はこのまま残っています」と言い続ける。
  **箱が指している本文が画面に無い。** ここで Escape を押すと `handleRequestClose` が
  `draft`＝「aaa」を書くので、**画面に出ていなかった文字列がファイルに入る**。
  1文字打つと逆に「aaa」が消える。どちらに転ぶかを予測する手がかりが画面に無い。
- 直し方: 書きかけならエディタの初期値を下書きから組む。
- 導入コミットの sha: `d5ec818`（**ラウンド2で私が入れた**「鍵を忘れない」）
- 主張を固定するテスト名: **未検証。** 既存のテストが `LiveMarkdownNote` を
  uncontrolled な `<textarea>` に差し替えているので `initialMarkdown` も `key` も観測できない
  → #276

### [HIGH] R4-4 削除の失敗が、確認文の続きに同じ薄いグレーで1文足されるだけになる（robustness）

- 場所: `KifuStreamList.tsx` の `describeDelete`、`ConfirmDialog.tsx` / `.scss`
- 根拠: 失敗を `subtitle` へ文字列連結していた。受けるのは
  `<p className="confirm-dialog__sub">` 1つで、`.confirm-dialog__sub` は
  `margin` / `font-size: $font-hint` / `color: rgba($color-text-light-1, 0.55)` しか持たず
  **`white-space` の指定が無い**。HTML では `\n` は空白1つに畳まれる。
  `ConfirmDialog` に `role="alert"` も `aria-live` も無く、`Modal` の `label` はタイトル（不変）。
- なぜ問題か: 押した利用者から見えるのは**同じ位置・同じ 55% グレー・同じ字送りの段落が
  少し長くなること**だけ。押した直後に注意が向いているのはボタンで、段落末尾の追記は
  視覚的に何の合図も持たない。支援技術も読まない。中身は `saveKifuToFile` が返す
  OS の生文字列（`Permission denied (os error 13)`）で、**何をすればよいかが1文字も無い**。
  確認文が「棋譜ファイルもすぐ書き換わります」と断言している以上、破れたことは
  断言と同じ強さで出る必要がある。`KifuCommentNote` 側は `$surface-danger` の箱まで
  作ってあるのに、削除だけ扱いが揃っていない。
- 直し方: `ConfirmDialog` に `error?: string` を足し、独立した箱（`role="alert"`、
  ノートと同じ `$surface-danger` / `$color-danger-text` の対）で描く。
  文言に**次にできること**を書く。
- 導入コミットの sha: `9d3a63d`（**ラウンド1で私が入れた**書き戻し）
- 主張を固定するテスト名: **未検証**（`KifuStreamList` にテストが無い）→ #276

### [MEDIUM] R4-5 `await` の後の `set_error` だけ compare-and-swap が入っていない（robustness / react の2体）

- 場所: `provider.tsx` の `persistIfPossible`、`KifuCommentNote.tsx` の `doSave`
- 根拠: 門番は `await` の**前**に済むので K1-5 の形は残っていない。残っているのは
  **書き戻す側**で、`jkf_restored` が `expectedJkf` で守られているのに対し
  `set_error` は「いまの state が自分の書き込みに対応しているか」を確かめない。
  `doSave` も同じで、`cursor` / `draft` を `await` の前に読み、
  `setSaveError` / `setBaseText` を面の突き合わせ無しに書いていた。
- なぜ問題か: A の保存が失敗して返ってきたときに B が読み込まれていると、B を表す state に
  A の失敗理由が載る。`state.error` を描く場所が無い（#277）ので今日は見えないが、
  描いた瞬間に**別のファイルの失敗が新しく開いたファイルの上に出る**。
  `doSave` 側は、遅れて返った失敗が**閉じたノートに立つ**（誰にも見えない）。
- 直し方: `write_failed` を足し、reducer が `state.jkf !== expectedJkf` なら積まない。
  `doSave` は書く先を引数で受け取る形にした（R4-2 の直しに含む）。
- 導入コミットの sha: `dispatch` 自体は `main` から。`Err` 返しを足したのは `f67a2eb`
- 主張を固定するテスト名: `reducer.test.ts`「書こうとした棋譜がもう別物なら、失敗を積まない」

## 重複・矛盾した所見

R4-1・R4-2・R4-5 は2体が別経路で当てている。矛盾は無い。

## 確認して問題が無かったもの

- **`jkf_restored` の compare-and-swap が「戻すべき場面で戻さない」ことは無い。**
  `state.jkf` を書く action は4つ（`game_loaded` / `jkf_replaced` / `jkf_restored` /
  `reset_state`）で、値の出どころは全て `cloneJkf`（`structuredClone`）か `loadGame`。
  **参照を保ったまま中身だけ変わる経路は無い**ので、参照の同一性で判定して安全。
  `navigated` は `jkf` を触らないので、待っている間に移動しても巻き戻しは正しく走る
- **`isLoading` が立ちっぱなしになる経路は無い。** 4つの `set_loading true` はすべて
  同じ `try` の `finally` を持ち、早期 return も全て `try` の内側
- **`confirmDelete` の書き戻しの守り（R3-2 の直し）は効いている。** `pendingDelete.query` は
  `onDeleteBranch` が作った1つのオブジェクトで、失敗時の書き戻しが `{...prev, error}` なので
  **再試行を跨いでも参照が保たれる**
- **`file-tree` の新しい効果はルートの改名では発火しない。** robustness が probe で
  `(rootDir, activeKifuPath)` の履歴を取り、`setRootDir` と `active_kifu_reconciled` が
  **同じレンダに落ちる**ことを確認した。`isSameOrDescendantPath` は `/ws/A` と `/ws/AB` を
  取り違えない（`workspaceGuard.test.tsx` が固定）。無限ループも無い
- **`KifuMoveCard` の memo は効くべきところで効いている。** 局面が動かない再レンダ
  （ノート・分岐メニュー・手のメニュー・確認の開閉）では `rows` も全ハンドラも参照が変わらない
- **`persistIfPossible` の依存による churn は増えていない**（`GamePersistenceGate` が
  `[activeKifuPath, kifuFormat]` で memo、`state.loadedAbsPath` は `game_loaded` でしか変わらない）
- **key の衝突は無い。** `rows.map` の `key={r.te}` は1手数につき1行。`editorKeyFor` が
  `absPath` を混ぜているので別ファイルの同じ手数でも Lexical の鍵は衝突しない
- **キーボードの登録は重なっていない**（Escape は `FloatingNote` / 分岐メニュー / `Modal` が
  それぞれ `isTop()` 越し、Cmd+Enter は `ContentEditable` の中だけ）
- **この差分にセキュリティ上の新しい口は無い。** `dangerouslySetInnerHTML` は増えておらず、
  ファイル由来の文字列は全て React のテキストノード経由

## 見ていない範囲

- 実機で動かしていない。R4-1 の並行タイミング（削除の書き込み中に自動保存が終わる）は
  必要条件を確認したところまでで、実際の書き込み時間で人間が踏めるかは未測定
- R4-3 は Lexical を実際に mount して確かめていない（既存テストが Lexical を差し替えているため、
  テストからも確かめられない）→ #276
- `docs/state-transitions/game.md` に `jkf_restored` / `write_failed` / `write_started` の
  行を足していない
- Lexical の markdown 往復の非可逆性（r2 から引き続き）
- 未保存の下書きを抱えたままのアプリ終了
- Rust 側（この差分に無い）、`npm audit`
- `src/__tests__/modalOverlayTitlebar.test.ts` が並行実行下で 5000ms を超えて落ちることがある
  （単体では 1.4s）。この差分と無関係だが**このラウンドで実際に踏んだ**

## lint / hook で強制できるもの

- **`await` を跨いだ closure 変数を `dispatch` / `setState` の payload に使う形。**
  R3-1（`before`）・R3-2（`pendingDelete`）・R4-5（`persistIfPossible` / `doSave`）で
  **3件目**。直したところの隣が毎回開いているので走査を書く価値がある
- **単一の真偽値を複数の並行操作が `finally` で降ろす形**（R4-1）。
  `dispatch({type:"set_loading", payload:false})` が `finally` に複数現れるファイルは拾える
- **`useEffect` の dep から `open` 系 prop が落ちているタイマー**（R4-2）
- **`\n` を含む文字列を、`white-space` を宣言していないクラスへ渡している箇所**（R4-4）。
  SCSS 側のクラス定義と突き合わせる走査は `contrastRatchet` と同じ位置に置ける
- `role="alert"` を持たない要素に「失敗」「できませんでした」を含む文字列が入る経路
  （ADR-0004 の割り当て表と突き合わせられる）

## 結果（書き戻し）

| 所見 | 直したコミット | 何をしたか                                                           |
| ---- | -------------- | -------------------------------------------------------------------- |
| R4-1 | `6500b05`      | `pendingWrites` を数え、確認ダイアログはその削除自身の旗を見る       |
| R4-2 | `18be853`      | 面が入れ替わる前に出ていく面へ書き、書けなかったぶんは鍵と対で預かる |
| R4-3 | `18be853`      | 書きかけならエディタの初期値を下書きから組む                         |
| R4-4 | `431312a`      | `ConfirmDialog` に独立した失敗の箱を足す                             |
| R4-5 | `57a934f`      | `write_failed` を足し、棋譜が別物なら積まない                        |

## 4ラウンドで繰り返した形

r1 の修正3つが r2 の所見3つに、r2 の修正1つが r3 の所見3つに、r3 の修正が r4 の所見2つになった。

**根は毎回同じで、「`await` を跨いで state が変わる」を数え落としている。**
r4 で新しく見えたのは、それが `dispatch` の payload だけでなく
**旗（`isLoading`）と、コンポーネントが出している面**にも及ぶこと。
`edit` は3経路とも `await` を持ち、その間 UI は完全に生きている。
`KifuCommentNote` は常設されるので、閉じてもタイマーは死なない。

**次にこの範囲を触るときは、`await` の前後で変わりうるものを3種類とも数える:
state の値・旗・いま出している面。**
