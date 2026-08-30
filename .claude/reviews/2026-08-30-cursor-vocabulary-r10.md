# レビュー cursor-vocabulary ラウンド10

- 日付: 2026-08-30
- 範囲: `git diff main...HEAD`
- 対象コミット: `f3638b5`
- 走らせた reviewer: comment / architecture / robustness

## 所見

### BLOCK

**C1 [comment] `game.md` が「`provider.tsx` にテストが1本も無い」と5箇所で言い続けている**

このブランチが `provider.test.tsx` を足したのに、E1 と E16 のセルは `✗`（テスト無し）のまま。
**自分で書いた doc が、同じブランチの後のコミットで腐った形。**

この表は「どこが未検証か」を判断するためのものなので、埋まったセルが `✗` だと、
次に E16 の番人を触る人が「どうせテストは無い」と読んで
`buildPlayer(nextJkf, ROOT_CURSOR)` を消す。それは r9 が実測で
「盤も棋譜ペインも空・文言なし・`error` すら null」と確かめた退行そのもので、
`provider.test.tsx` はまさにそれを止めるために置いた。**表がその番人を隠していた。**
→ E1 / E16 を `✓※6` に、※6 で範囲（`loadGame` の2つだけ）を明示。テスト一覧にも追加。

### HIGH

**R1 [robustness] `reachedCursor` が「届かなかった」を検出できず `true` を返す**

ラウンド9で足した関数が、`buildPlayer` の doc が挙げる2つのずれのうち
**1つ目（届かずに手前で止まる）を素通り**していた。

`getTesuuPointer(tesuu)` は**引数の `tesuu` をそのまま文字列に埋めるだけで
`player.tesuu` を見ない**。だから3手の棋譜に `tesuu: 40` を要求して player が
3 で止まっても、要求どおりの鍵が返る。自分でも再現した
（`{ playerTesuu: 3, reached: true }`）。

**沈黙する失敗を検出するために作った関数が、その沈黙をもう一段深くしていた。**
最初の客になる #296 で一番起きるのはまさに1つ目の形なので、
「`reachedCursor` で警告を出す」直しが緑のまま通ってしまう。
→ 観測を `cursorFromPlayer` から取る形に直し、その場合のテストを足した。旧実装で落ちる。

### MEDIUM

| #   | reviewer     | 所見                                                                     | 結果             |
| --- | ------------ | ------------------------------------------------------------------------ | ---------------- |
| C2  | comment      | `cursorKey` の「同じ鍵 = 同じ要求」が偽（`te > tesuu` を落とす）         | 直した           |
| C3  | comment      | `reachedCursor` に本番の呼び出し側が無いことが3つの doc に書かれていない | 直した（→ #296） |
| A1  | architecture | `app-config` ↔ `engine-presets` のスライス単位の相互依存                 | **issue #313**   |

**C2 は #239 を直す人が踏む形。** 鍵は `te <= tesuu` しか見ないので、
「先の計画だけが違う2つの要求」が同じ鍵になる。doc の「`CursorPath` どうしを
比べる鍵はこれ1つ」に従って `applyCursor` の no-op ガードを書くと、
局面ナビで先の分岐を選んでから ← で戻して確定した要求が**丸ごと落ちる**。
例外も `error` も出ない。→ 鍵が見る範囲を明示し、重複判定に使わないことを書いた。

**A1 は差分に1行も含まれない既存の形。** reviewer 自身が
「#279 を閉じる妨げにはしない」と明記している。

## エピック #279 の完了判定（architecture）

**「依存の向きと責務の置き場に関しては閉じてよい。差分の中に未決・番号なしのものは
見つからなかった。」**

- `tesuuPointer` を手で分解・手で組む経路は `src/` に **0件**
- `as TesuuPointer` は `model/cursor.ts` 内の **3箇所だけ**
- `p.te` を手で回すコードは `entities/kifu` の外に **0件**
  （`features` / `widgets` の `forkPointers` 参照は `planByTe` / `truncateFrom` /
  `forkIndexAt` / `descendTo` / `.length` のみ）
- 上向き import **0件**・モジュール循環 **0件**（層ごとに機械的に確認）
- 残りは全て番号付き（#216 / #295 / #297 / #302 / #304 / #306 / #310 / #313）

## 見ていない範囲

- `src-tauri/`（差分に1行も無い）
- SCSS / レイアウト / キーボード操作 / フォーカス管理
- 実アプリを起動しての動作確認
- perf（r1 / r6 で実測済み）
- `usePositionHitNavigation` の `selectNodeByAbsPath` が `false` を返す経路
  （差分の外。`findNodeByPath` が現物でいつ `null` になるかを再現できていない）
- 差分に含まれるテストの個々のケースの説明文（`describe` 名と `exportsTested` の
  対応だけ確認）

## robustness が確かめて「所見なし」とした点

barrel 経由化（`cursorFromLite`）で余計なモジュールを読み込むようになっていないか:

- 循環なし（`import/no-cycle` 緑）
- `orderPositionHits.ts` の唯一の import 元は `PositionSearchModal.tsx` で、
  そこは元から `@/entities/search` を読んでいる。**モジュールグラフは増えていない**
- `entities/search/api/tauri.ts` と `model/provider.tsx` にトップレベルの副作用は無い

## lint / hook で強制できるもの

- **スライス単位の循環検査**（A1）。`import/no-cycle` はモジュール単位なので
  今回の辺を拾えない。#313 に書いた
- **「テスト無し」と書いている doc の行に、対応する `__tests__/` が実在しないこと**の検査。
  今回の C1 の一部（`:151` `:270`）はこれで落ちる
- 束縛なしの空 `catch {}` を UI 層で禁止（#308、未実装）

## 次ラウンドの対象

`reachedCursor` の修正、`game.md` のテスト列、`cursorKey` の doc を見る。
所見が0件になるかを確かめる。
