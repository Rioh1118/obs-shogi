# レビュー kifu-write-path ラウンド2

- 日付: 2026-08-30
- 範囲: `fix/kifu-write-path`（`main` = `9aa963b` からの差分）
- 走らせた reviewer: `robustness` / `react`
- 対象コミット: `dfe0f4a`
- 前ラウンド: [r1](2026-08-30-kifu-write-path-r1.md)

**2体が独立に同じ BLOCK へ当てた。** 根は1つで、
**楽観的更新のまま「失敗したら戻す」側を作っていなかった**こと。
ADR-0004 決定7 がその形（「先に変えて、失敗したら戻す」）を明示しているのに、
戻す側が実装されていなかった。

## 所見

### [BLOCK] K2-1 書き込みに失敗したあと「削除する」を押し直すと、**別の枝**が消える（robustness / react の2体）

- 場所: `KifuStreamList.tsx` の `confirmDelete` / `provider.tsx` の `deleteBranch` /
  `branchEdit.ts` の `deleteCandidate`
- 根拠: `deleteBranch` は `jkf_replaced` を撃ってから書き込む。書き込みだけが落ちると
  **メモリからは枝が消えたまま**、確認ダイアログが `error` 付きで開き続ける（K1-6 で作った経路）。
  `target` は BranchIndex（候補列の添字）なので、同じクエリを再送すると
  **1つ減った候補列**に当たる。
- なぜ問題か: 20手目に「本譜 / 変化1 / 変化2」があるとき、変化1（`target=1`）の削除が
  書き込みで失敗 → メモリの候補は `[本譜, 変化2]` → 再試行の `target=1` は**変化2**を指す。
  2回目が通ると、ファイルからは**変化1と変化2の両方**が消える。
  `target === MAIN_LINE` でも同じ（繰り上がった線を消す）。
  末尾だった場合は `branchIndex 2 is out of range (0..1)` が内部語のまま2つ目の失敗として出る。
  **確認していない枝が、取り消し不能に消える。**
- 直し方: `persistIfPossible` が失敗したら `jkf_replaced` の前へ戻す（`jkf_restored`）。
- 導入コミットの sha: `9d3a63d`（**ラウンド1で私が入れた**「失敗したら閉じない」が経路を作った）
- 主張を固定するテスト名: `reducer.test.ts`「棋譜・カーソル・計画をまとめて戻す」（変異2つで確認）。
  **`deleteBranch` を通した経路は未検証**（`GameProvider` にテストが1本も無い → #276）

### [BLOCK] K2-2 閉じるときの再試行が一度もディスクへ届かず、その直後に「保存済み」と出る（react）

- 場所: `KifuCommentNote.tsx` の `doSave` / `provider.tsx` の `edit` / `comment.ts` の
  `setCommentsByCursorInJkf`
- 根拠: 1回目の失敗時点で `edit` は既に `jkf_replaced` を撃っており、メモリの `move.comments` は
  **その draft と同じ内容になっている**。再試行は同じ `draft` を渡すので
  `shallowEqualStringArray` が真 → `changed: false` → `run` が `false` → `edit` は
  `persistIfPossible` を通らずに `Ok`。
- なぜ問題か: 「保存できませんでした」が出ている状態で何も書き足さずに閉じると、
  `doSave` はこれを成功と読んで `setSaveError(null)` / `setBaseText(draft)` / `savedFlash` を立てる。
  画面はエラーの箱が消えて**「保存済み」**に変わり、ノートは閉じる。
  **ファイルには一度も書かれていない。** K1-3 が塞いだつもりの穴が、
  `changed: false` の早期 return を通って完全に再現している。
  r1 で足したテストは `setCommentsByCursor` を丸ごとモックして無条件に `Ok` を返すので、
  `toHaveBeenCalledTimes(2)` は満たされるが**2回目は本質的に no-op**。検出できない。
- 直し方: 巻き戻しを入れると、再試行時にはメモリから本文が消えているので `changed` が真になり、
  `persistIfPossible` を通る。K2-1 と同じ1つの直しで閉じる。
- 導入コミットの sha: `f67a2eb`（**ラウンド1で私が入れた**）
- 主張を固定するテスト名: 未検証（`setCommentsByCursor` のモックではなく
  `comment.ts` + `persistence.save` の呼ばれ方で固定しないと押さえられない → #276）

### [HIGH] K2-3 `loadedKeyRef` の null 戻しで、閉じて開き直すだけで K1-2 の状態に戻る（react）

- 場所: `KifuCommentNote.tsx` の初期化 effect / `KifuStreamList.tsx` の
  `toggleMoveMenu` と `onToggleForkMenu`
- 根拠: `FloatingNote` は非モーダルなので、ノートを開いたまま後ろの行の「分岐」ボタンを押せる。
  そこは `setOpenComment(null)` を直に呼ぶだけで `handleRequestClose` を通らない。
  このとき `draft` / `baseText` / `saveError` は残ったまま、`loadedKeyRef` だけが null に戻る。
- なぜ問題か: 失敗直後にこれを踏むと、開き直したときに
  `loadedKeyRef(null) !== editorKey` で取り込みが走り、`sourceText`（メモリの棋譜）を
  `baseText` に入れて `dirty` を落とし、`saveError` も消す。
  **書けていない本文が「保存済みと同じ見た目」で残る。** null 戻しがこの状態を能動的に作っている。
- 直し方: 下書きや失敗を抱えたまま閉じたときは鍵を忘れない（`if (!dirty && !saveError)` に限定）。
- 導入コミットの sha: `f67a2eb`（**ラウンド1で私が入れた**）
- 主張を固定するテスト名: 未検証

### [BLOCK] K2-4 開いている棋譜を改名・移動すると、開いた時点の中身へ巻き戻る（robustness）

- 場所: `GameFileTreeBridge.tsx` / `file-tree/model/reducer.ts` の `active_kifu_reconciled`
- 根拠: `GameFileTreeBridge` の effect は deps に `activeKifuPath` を持つので改名だけでも再実行され、
  `loadGame(jkfData, activeKifuPath)` を撃つ。その `jkfData` は `kifu_opened` の時点で作られた
  **スナップショット**で、以後の編集は game 側の複製にしか当たらない。
- なぜ問題か: 10手研究したあとで改名すると、盤と一覧が開いた時点へ巻き戻る。
  ファイルにはまだ10手あるので、そこで1手指すと**巻き戻った JKF が書かれて編集が消える**。
  r1 で入れた門番は**パスしか突き合わせていない**ので、
  「宛先は合っているが中身が古い」この形は原理的に検出できない。
- **このブランチの範囲外**（`main` から在る形で、4つの issue のどれでもない）。
  → **#292 を立てた**（`/implement` 手順7）。
- 導入コミットの sha: `main` から在る形

## 重複・矛盾した所見

K2-1 は2体が別経路で当てている。K2-1 と K2-2 は根が同じ（巻き戻しの不在）。

## 確認して問題が無かったもの（robustness / react が名指しで潰した分）

- **`persistIfPossible` の門番が正当な書き込みを止める経路は無い。** 開いた直後、改名直後、
  `persistence` 未設定のいずれも追って確認された（`kifu_opened` は path/jkfData/format を
  1アクションで置き、bridge は同じコミットで完走する）
- `persistence` 未設定を `Err` にしたことで壊れる `Ok` 期待の経路も無い
- 確認ダイアログの `onCancel` は失敗時も生きている（`set_error` が `isLoading:false` を立てる）
- `doSaveRef.current = doSave` をレンダ中に書くのは、この構成では問題なし。
  `useEffect` へ移すと commit 1回ぶん遅れ、**古い `doSave` を掴む窓が増える**
- `persistIfPossible` の identity churn は増えていない（`loadedAbsPath` が変わるのは
  `game_loaded` のときだけで、そこでは `state.jkf` も必ず変わる）
- `confirmDelete` の同期的な連打は `set_loading` → `Button` の `disabled` で止まる
- `sourceText` を dep に残すのは正しい（早期 return があるので空回りするだけ。
  外すと `exhaustive-deps` が必ず落ちる）

## 見ていない範囲

- 実機で動かしていない。K2-1 / K2-2 はコードから導いた筋道で、
  `persistence.save` を実際に失敗させて確認していない（テストにその手段が無い）
- Lexical の markdown 往復が非可逆かどうか。非可逆なら「開いて1文字打っただけ」で
  本文全体が正規化されて書き戻る経路がありうる
- SCSS / コントラスト（ui-reviewer の担当）
- `docs/` 4本の追随（K1-10 の書き戻し内容が実装と合っているか）
- Rust 側（このブランチの差分に無い）

## lint / hook で強制できるもの

- **「メモリを先に差し替えてから I/O する」形の検出。** `dispatch({type:"jkf_replaced"})` の後に
  `await persist...` が来る並びは走査できる。`provider.tsx` の3箇所が同型で、
  うち1つが K2-1 を生んでいる。**two-strikes を満たす**（K1-6 と本件）
- **`AsyncResult` の `Ok` に意味を兼ねさせない**のは型で分けるしかない（`Ok<{persisted: boolean}>`）
- `asyncResultUse` の検出は行頭の `await f(` / `void f(` だけで、
  `onClick={() => void deleteBranch(q)}` のような JSX の式中は素通りする
- **モックが `Ok` を無条件で返すテスト**は機械では拾えない。ただし
  「書き込み経路を丸ごと差し替えたテストに ✓ を付けている台帳の行」は
  K1-10 で入れた注の仕組みで拾える

## 結果（書き戻し）

| 所見 | 直したコミット | 何をしたか                                               |
| ---- | -------------- | -------------------------------------------------------- |
| K2-1 | `d5ec818`      | `jkf_restored` で巻き戻す。3経路すべて                   |
| K2-2 | `d5ec818`      | 同じ1つの直しで閉じる（巻き戻せば `changed` が真になる） |
| K2-3 | `d5ec818`      | 下書きや失敗を抱えたまま閉じたときは鍵を忘れない         |
| K2-4 | —              | **範囲外。#292 を立てた**                                |

## このラウンドで分かったこと

**r1 で入れた3つの修正が、そのまま3つの所見になった。**
K1-6（失敗したら閉じない）が K2-1 の経路を作り、
K1-3（閉じる前に再試行）が K2-2 の no-op を作り、
K1-2（鍵で取り込みを絞る）が K2-3 の null 戻しを作った。

共通しているのは、**「メモリとディスクが食い違っている」という状態を作ったまま
その上に UI の分岐を積んだ**こと。巻き戻しを入れると3つとも根から消える。
r1 の時点で ADR-0004 決定7 を読み直していれば、「失敗したら戻す」が
最初から書いてあったことに気づけた。
