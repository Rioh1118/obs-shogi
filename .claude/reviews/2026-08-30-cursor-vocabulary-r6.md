# レビュー cursor-vocabulary ラウンド6

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `96e372a`
- 走らせた reviewer: comment / robustness / architecture

## robustness の差分検証（r5 の続き）

r5 で鍵の書式を変えたので走らせ直した。**退行なし。**

| 何を                                             | どう確かめたか                                                                          | 結果                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------- |
| `hitKey` / `PositionSearchContinuation` の鍵     | 乱択 JKF **3000ファイル / 160,587ノード**で、旧鍵と新鍵の**同値類そのもの**を突き合わせ | **partitionMismatch 0** |
| `cursorFromLite` の正規化が索引に対して no-op か | `walk_sequence` を TS に写して **159,783ノード**                                        | **不一致 0**            |
| `descendTo` の `base === null` 経路              | `main` の実装と **200,000ケース**（うち null が 57,563）                                | **差分 0**              |

前提の訂正が2つ返ってきた（どちらも私の依頼文の誤り）。

- **`hitKey` は React の list key ではない。** `PositionSearchHitList` は添字ベースの
  `VirtualList`。`hitKey` は「チャンク到着でリストが伸びても選択中のヒットを見失わない」
  ためだけに使う。行が消える／重複する経路は無い
- **`PositionSearchContinuation` の `key` が畳まれても再取得は止まらない。**
  `useEffect` の dep には `activeHit`（オブジェクト identity）も入っている

## 所見

### HIGH

| #   | 所見                                                                         | 結果   |
| --- | ---------------------------------------------------------------------------- | ------ |
| C1  | `PLAN_WALK_LIMIT` の doc がまた偽（`goto` は区間ごとに `c` を作り直す）      | 直した |
| C2  | 「索引は `fork_pointers` の並びを保証しない」が偽。Rust は push のたびに整列 | 直した |

**C1 は同じ定数について6回目。** `forkPointers` を渡された `goto` は
`goto(te - 1)` の連鎖へ分解され、`c = 1e4` は区間ごとに作り直される。だから
「`cursor.tesuu` がちょうど 10000 のとき」は必要条件でも十分条件でもない。
**6回とも「どちらが先に効くか」を推測して外した。比較そのものをやめ、
「比べられる1つの数は無い」と書く形に変えた。**

**C2 は自分で書いた理由が産出側と逆だった。** `push_or_replace_fork` は
`te` が既にあれば置換し、push のたびに `sort_by_key` する（自分で読んで確認）。
robustness が 159,783 ノードで正規化が no-op であることを実測している。

### MEDIUM

| #   | reviewer     | 所見                                                                             | 結果              |
| --- | ------------ | -------------------------------------------------------------------------------- | ----------------- |
| R1  | robustness   | `descendTo` に自分の層のテストが無く、番人が widget のテスト1ファイルだけ        | 直した（+テスト） |
| C3  | comment      | `cursorKey` の正規化の理由が、既に正規化済みの値しか渡さない経路を名指ししている | 直した            |
| C4  | comment      | 「再生器が返す tesuuPointer と同じ書式」のテストに再生器が出てこない             | 直した            |
| C5  | comment      | `cursor.test.ts` の fixture が `KifuCursor` を手で組み、自分で書いた規約を外す   | 直した            |
| C6  | comment      | `descendTo` / `buildCursorWithForkSelection` に同じ doc が2つ（#306 は片方だけ） | 直した（畳んだ）  |
| A2  | architecture | `provider.tsx` に `JKFPlayer` 直呼びが3行。`playerCursor.ts` の宣言と食い違う    | 直した            |
| A1  | architecture | 行の `branchForkPointers` だけ計画由来。コメント欄も壊れる（#196 に無い経路）    | **#196 へ追記**   |
| R2  | robustness   | 続き手の取得が理由付きの例外を捨てて「（続きなし）」に化ける                     | **issue #308**    |

**R1 が r5 の R1 と同じ形の再発。** r5 で「`model/cursor.ts` の export に対応する
テストの存在検査を入れよ」と書いたが実装しなかったので、その直後のコミットで
新設した `descendTo` が同じ穴に落ちた。変異を3つ当てて落ちることを確認した。

## 重複・矛盾した所見

**C4 と C5 は同じ根（fixture が実物を通らない）の別の面。**
r4 A2 で `cursorSelection.test.ts` の fixture を実物経由に直したが、
r5 で新しく足した `cursor.test.ts` が同じ間違いを繰り返していた。
「実物と同じ構築関数を通す」という判断を、テストを足すたびに適用できていない。

**A1 は #196 の範囲だが、本文に無い被害経路が見つかった。**
削除・入れ替えだけでなく**コメント欄**も同じ根で壊れる（コメントが有る手なのに
空で開き、保存は `{ ok: false }` で「保存済み」と出る）。#196 にコメントで追記した。

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）。`index_builder.rs` / `node_table.rs` /
  `query_service.rs` は C2 と鍵の同値検証の裏取りに読んだ。Rust は1行も実行していない
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- perf（`hitKey` が旧 41ms → 新 118ms / 100,000ヒットになったが、`findIndex` は
  一致時点で止まり既定の選択は先頭なので、実使用で効く経路を再現できなかった。
  reviewer 自身が「所見にしない」と判断）
- react（r2 で1件、#227 へ送った）

## 確かめ切れていない観察

robustness が正直に置いた1件を記録する。3000ファイルの走査で、
**同一ファイル内の 159,783 ノードのうち 37,791 が、他のノードと
`(tesuu, fork_path)` を共有していた**（`push_or_replace_fork` が同じ te を
置換するため、変化の先頭手にさらに変化を足すと親と同じ経路文字列になる）。
旧鍵・新鍵で分割が完全に一致しているので**この差分の退行ではない**が、
「索引が出したヒットのカーソルが別のノードを指す」可能性がある。
JKFPlayer 側でその線に降りられるかを確かめていないので所見にしていない。

## lint / hook で強制できるもの

- **`model/cursor.ts` の各 export に対応する `describe` が `cursor.test.ts` に
  あることの検査。** r5 で挙げて実装せず、R1 として再発した。**two-strikes を満たしている**
- **`player.goto(` / `player.getTesuuPointer(` を `entities/kifu/lib/` の外に
  書かせないラチェット。** A2 の直しで違反は2箇所（どちらも #302 の `nodeId` 用）に減った
- **束縛なしの空 `catch {}` を `features/**/ui/`と`widgets/**/ui/` で禁止**（R2）
- （再掲・未実装）`src/` 直下にレイヤ名以外のディレクトリを作らせない検査

## 次ラウンドの対象

`gotoPath` の新設、`descendTo` へのラッパ畳み込み、`cursor.test.ts` の
fixture 変更を見る。所見が0件になるかを確かめる。
