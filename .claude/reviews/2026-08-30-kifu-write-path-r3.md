# レビュー kifu-write-path ラウンド3

- 日付: 2026-08-30
- 範囲: `fix/kifu-write-path`（`main` = `9aa963b` からの差分）
- 走らせた reviewer: `robustness`
- 対象コミット: `e040794`
- 前ラウンド: [r2](2026-08-30-kifu-write-path-r2.md)

**r2 で入れた巻き戻しが、そのまま4件の所見になった。** 根は1つで、
**`await` より前に読んだ値を、後から無条件に書き戻していた**こと。

## 所見

### [BLOCK] R3-1 巻き戻しが、待っている間に入った編集・別ファイルの読み込みを上書きする

- 場所: `provider.tsx` の `edit` / `swapBranches` / `deleteBranch`、`reducer.ts` の `jkf_restored`
- 根拠: `before` は `edit` に入った時点の closure。`await` を跨いだあとに
  **いまの state が自分の置いた `nextJkf` のままか**を一度も確かめずに書き戻す。
- なぜ問題か: 2経路。
  - **(a) 別ファイルの中身が入る。** A を開いて1手 → `await save(A)` が遅い →
    その間に B をクリック → `loadGame(B)` が `jkf=B` / `loadedAbsPath=B` を置く →
    `save(A)` が失敗して巻き戻しが **A の jkf を書き戻す**。`loadedAbsPath` は B のまま。
    次の1手で門番は `persistence.absPath(B) === loadedAbsPath(B)` で**通る**ので、
    **A の棋譜が B のファイルへ書かれる**。K1-5 の門番が塞いだ形が、別の入口から復活している
  - **(b) 後から指した手が消える。** 手 A → `await save(A)` の間に手 B → `save(A+B)` は成功 →
    遅れて `save(A)` が失敗し、巻き戻しが**どちらも無い元の棋譜**へ戻す。
    ディスクには A+B があり、メモリには無い。次の1手で**両方消える**
- 直し方: compare-and-swap。置いた `nextJkf` の参照を持ち回り、
  `state.jkf !== expectedJkf` なら戻さない。`cloneJkf` も `loadGame` も必ず新しい
  オブジェクトを作るので参照の同一性で両方判定できる。
- 導入コミットの sha: `d5ec818`（**ラウンド2で私が入れた**）
- 主張を固定するテスト名: `reducer.test.ts`「置いた棋譜がもう別物なら戻さない」（変異で確認）

### [BLOCK] R3-2 `confirmDelete` が stale な `pendingDelete` を書き戻し、閉じた確認が開き直す

- 場所: `KifuStreamList.tsx`
- 根拠: `await` の間に `pendingDelete` が null になっていても、closure が閉じ込めた
  古いオブジェクトを無条件に `setPendingDelete` する。
- なぜ問題か: Escape で閉じた確認が数百ms後に勝手に開き直る。
  破壊的になるのはファイル切り替えのとき。`[state.loadedAbsPath]` の effect は
  「確認を出したまま棋譜が変わると別のファイルの枝が消える」ために確認を畳んでいるのに、
  その直後に `confirmDelete` が**同じクエリを持った確認を復活させる**。
  押すと `deleteBranch` が**いまの `state.jkf`**（別のファイル）へ古い `te` / `target` を当てる。
  **effect が名指しで防いでいた事故がそのまま起きる。**
- 直し方: `setPendingDelete` を関数形式にし、`prev` が同じクエリのときだけ書く。
- 導入コミットの sha: `9d3a63d`（**ラウンド1で私が入れた**）
- 主張を固定するテスト名: 未検証

### [HIGH] R3-3 `jkf_replaced` が `isLoading: false` を立てるので、書き込み中「操作中」を名乗れない

- 場所: `reducer.ts`
- 根拠: `set_loading true` → `jkf_replaced`（`isLoading: false`）→ `await persistIfPossible` の順。
  `await` の間ずっと false。
- なぜ問題か: `ConfirmDialog` の「削除中...」は**一度も描かれない**。
  `closeOnEsc` / `closeOnOverlay` / キャンセルの `disabled` も全て無効。
  K1-6 で「先に閉じると `isLoading` も一度も描かれない」と直したはずのものが、
  閉じる位置を直しただけで**状態の側は直っていなかった**。
  `KifuMoveCard busy` も false のままなので、書き込み中の連打が全部通る。
  **これが R3-1 と R3-2 の前提条件になっている。**
- 直し方: `jkf_replaced` から落とす。3経路とも `finally` が `set_loading false` を持つので
  立ちっぱなしにはならない。代償は書き込み中に盤と一覧が一時的に触れなくなること
  （ファイル書き込みは短く、ADR-0004 決定7 とも矛盾しない。進むのは `jkf` であって
  `isLoading` は「書き込みが走っている」を意味する）。
- 導入コミットの sha: `main` から在る形
- 主張を固定するテスト名: 未検証

### [HIGH] R3-4 巻き戻しによって、`makeMove` / `swapBranches` は「黙って操作が取り消される」に変わった

- 場所: `provider.tsx` の `selectSquare` / `KifuStreamList.tsx` の `onSwapBranch`
- 根拠: 巻き戻しの成否は `state.error` にしか出ない。この2経路は
  `async-result-ignored: 出す場所が無い → #277` の印が付いている。
  `useGame().state.error` を描いている場所は `src/` に1つも無い。
- なぜ問題か: 巻き戻しの前は、失敗しても指した手は盤に残っていた（間違っているが**見えていた**）。
  いまは `jkf` / `cursor` / `branchPlan` が戻り、`selectedPosition` も null になるので、
  **駒が元のマスへ戻り、選択も消え、画面には何も出ない**。
  読み取り専用の棋譜で7六歩を指すと、駒が一瞬進んで戻る。利用者はクリックがずれたと解釈して
  もう一度指し、また戻る。
  **#227 の「失敗したのに成功と同じ見た目」を直した代わりに、
  「成功も失敗も操作しなかったのと同じ見た目」を作っている。**
- **直していない。** 選択肢は2つあり、どちらも設計の判断（`/implement` 手順7）:
  - (a) この2経路にも最小の出口（`role="alert"` の一行）を入れる。#277 の先取り
  - (b) 出口のある経路（削除＝確認ダイアログ、コメント＝失敗の箱）だけ巻き戻し、
    出口の無い2経路は巻き戻さない。**メモリとディスクの不一致は残る**
    → **報告で伝える。**
- 導入コミットの sha: `d5ec818`（**ラウンド2で私が入れた**）

## 確認して問題が無かったもの

- **巻き戻したあとの `cursor` / `branchPlan` の整合。** `before` の3つは同一レンダの
  `state` から取るので必ず同じ dispatch が置いた組。`buildPlayer` が throw する
  組み合わせは `jkf_restored` 単体では作れない
- **`error` を消さないことによる矛盾表示は、現時点では起きない**（`state.error` に描画側の
  消費者が無いため）。ただし #277 で描いた瞬間、「移動しただけでエラーが消える」と
  「巻き戻しの理由が残り続ける」が同時に露出する
- **`KifuCommentNote` は巻き戻し後も意図どおり。** `loadedKeyRef` の早期 return により
  `sourceText` が巻き戻っても `draft` / `baseText` は動かず、`dirty` が真のまま残るので
  再試行が `changed: true` になる（K2-2 の意図どおり）

## 見ていない範囲

- 実機で動かしていない。R3-1 / R3-2 は `await` を跨ぐ closure と dispatch の順序から
  導いた筋道（`GameProvider` にテストが1本も無い → #276）
- R3-1 (a) の窓が実際の書き込み時間で人間に踏めるかは未測定
- `docs/state-transitions/game.md` に `jkf_restored` の行を足していない
- SCSS / コントラスト、Rust 側

## lint / hook で強制できるもの

- **`await` を跨いだ closure 変数を `dispatch` / `setState` の payload に使う形。**
  R3-1（`before`）と R3-2（`pendingDelete`）が同型で、別ファイル・別レイヤ。
  **two-strikes を満たす**
- `isLoading` を書く action の数をラチェットにすれば、`set_loading` 1つへ寄せる方向を保てる
- `async-result-ignored` が指す issue が OPEN であることの検査は、
  K1-10 で挙がっている「CLOSED な issue への参照」の走査に相乗りできる

## 結果（書き戻し）

| 所見 | 直したコミット | 何をしたか                                                         |
| ---- | -------------- | ------------------------------------------------------------------ |
| R3-1 | `a787119`      | `expectedJkf` を持ち回る compare-and-swap                          |
| R3-2 | `a787119`      | `setPendingDelete` を関数形式にし、同じクエリのときだけ書く        |
| R3-3 | `a787119`      | `jkf_replaced` から `isLoading: false` を落とし `finally` に一本化 |
| R3-4 | —              | **設計の判断。報告で伝える**                                       |

## 3ラウンドで繰り返した形

r1 の修正3つが r2 の所見3つになり、r2 の修正1つが r3 の所見3つになった。
毎回「直したつもりの穴の**隣**」が開いている。

共通しているのは **`await` を跨いだ状態の扱い**。
r2 は「メモリとディスクが食い違う」を直したが、その直し方自体が
「`await` の前後で state が変わりうる」を見ていなかった。
`edit` は3経路とも `await` を持ち、その間 UI は完全に生きている。
**次に `provider.tsx` を触るときは、`await` の前に読んだ値を後で使っていないかを先に見る。**
