# レビュー game-cursor-plan ラウンド10

- 日付: 2026-08-30
- 範囲: `git diff a51c8ef..HEAD`（ラウンド9の修正4件）
- 対象コミット: `ebb041a`
- 走らせた reviewer: comment / react / oss-hygiene
- 前ラウンド: [r1](2026-08-30-game-cursor-plan-r1.md) 〜 [r9](2026-08-30-game-cursor-plan-r9.md)

**BLOCK 0・MEDIUM 3。HIGH 以上は初めてゼロ。** 差分は4コミット・ほぼコメントと doc だけ。

## 所見

| #   | 深刻度 | 所見                                                                                             | reviewer                    | 結果                    |
| --- | ------ | ------------------------------------------------------------------------------------------------ | --------------------------- | ----------------------- |
| W1  | MEDIUM | V2 の直しが不完全。`as TesuuPointer` は4箇所あるのに2箇所しか挙げていない                        | comment / oss-hygiene — 2本 | 対応済み（`2d8186d`）   |
| W2  | MEDIUM | V1 で足したテストが、固定したい根拠の載っている側を触っていない                                  | react                       | 対応済み（`578b910`）   |
| W3  | MEDIUM | `game.md` が指す #196 の本文が、このブランチが実装した修正を「これからやること」として書いている | oss-hygiene                 | 対応済み（#196 を改稿） |

### W1 — 例外を数え上げる書き方そのものが腐る

r9 の V2 で `CLAUDE.md` を直したとき、報告書には3箇所（`cursorFromSource` /
`cursorAdapter` / `PositionNavigationModal`）を列挙したのに、**`CLAUDE.md` には2箇所しか
書かなかった**。実際は `ROOT_CURSOR` を入れて4箇所。

落ちた `PositionNavigationModal.tsx:148` は、`tesuuPointer` を正規化済みの
`sim.getTesuuPointer(...)` から取りながら `forkPointers` には `te > tesuu` を残す、
**このブランチが brand で分けようとした「不整合な `KifuCursor`」を実際に作る唯一の場所**。
真っ先に挙がるべきものが落ちていた。

**3回続けて同じファイルの同じ行を直しては外している**（U3 で断定を間違え、V2 で
列挙を間違え、W1 で列挙をやめた）。件数と一覧を書くのをやめ、数え方（`grep`）だけ
書いて #243 に寄せた。

### W2 — テストが名乗った性質を検査していなかった

V1 で足したテストは選択肢を `[null, 0, 1, 2]` と**手で書いていた**。
`resolveForkSelection` は `===` で比べるだけなので、これは「`9 !== null/0/1/2`」を
言っているに等しい。

固定したい性質は「範囲外の計画値は必ず選択肢集合 `{null} ∪ [0, forkCount)` の外にある」で、
その**載っている側**は `buildStreamRows` が `forkTexts` を `forkAndForward` と同じ位置・
同じ `forks` から作ること。ところが `forkTexts` / `forkCount` を検査するテストは1本も無かった。

react が具体的な破り方を示した: `getReadableForkKifu()` を `getReadableForkKifu(te)`
（1手ずれ）にすると、メニューが `te` の `forks` と無関係な本数の選択肢を出し、
範囲外の計画値が**選択肢の内側に入る**。そのとき `selected === forkIndex` が真になって
`goToIndex` に落ち、行の ✓ は本譜のまま盤だけ別の線に着く。**不変条件2 が防ぎたかった
ちょうどその失敗**で、既存テストは全部緑のまま通る。

選択肢を行の `forkCount` から組み、`forkCount` / `forkTexts` 自体も別に固定した。

### W3 — 直した側の issue が「これからやること」のまま

`game.md` の「見ていない範囲」が #196 を指しており、docs 側の記述
（行の `branchForkPointers` が計画から作られる）は**正しい**。一方 #196 の本文は
原因を `selectedForkIndex` と書き、直し方の案として r8 の U2 でやったことを挙げていた。

残っている本当の欠陥は `buildStreamRows.ts` の

```ts
const branchForkPointers = (cursor?.forkPointers ?? []).filter((p) => p.te < te);
```

で、**経路（パス）が計画のまま**という別の穴。`onDeleteBranch` / `onSwapBranch` が
これをクエリの `forkPointers` に渡す。#196 から辿った人は本文の再現手順を試して
「再現しない」「直し方はもう入っている」と確認でき、**残余に気づかないまま close する**。

#196 を残余だけに書き直した。**このループは #245 で2回、#196 で1回、同じ外し方をしている**
（実装を変えたのに、その関数を引用している issue を洗い直していない）。

## 重複・矛盾した所見

- **W1 は comment と oss-hygiene が独立に検出。** どちらも `grep -rn "as TesuuPointer" src/` の
  結果と突き合わせている
- **矛盾なし**

## 確かめて所見にならなかったこと

- **V1 の新しい根拠は成立している。** comment と react が別々に `node_modules/json-kifu-format`
  まで降りて確かめた。`getReadableForkKifu()` と `forkAndForward` は**同一の `forks` 配列**を
  見ており、間に挟まる `forward()` / `backward()` はこの位置では `currentStream` を変えない。
  `KifuMoveCard` の `hasFork = row.forkCount > 0 && row.te !== 0` がトグルとメニュー本体の
  両方を塞ぐので、**選択肢0本ではメニューが開かない**（「押せない」の前提は崩れない）
- react が1点だけ補正: `forkAndForward` が `false` を返すのは
  「`forks.length <= num` のときだけ」ではなく、`forks[num]` が空配列のとき末尾の
  `this.forward()` が `false` を返す経路もある。ただしその場合 `getReadableForkKifu()` が
  先に TypeError を投げるので、食い違いに到達する前に落ちる。**結論は変わらない**
- V4 の `F-12a` / `F-12b` は実在し、`rg -n "227" docs/` も1件返る
- V3 の追加入力（`{te:1, forkIndex:0}`）は本当に `forkAndForward` の `!forks` 経路に当たる

## 途中で踏んだもの（このブランチの外）

**`npm run verify` が、テスト397件すべて緑のまま `Errors 1 error` で落ちることがある。**
`.claude/hooks/verify-gate.sh` はこれを失敗として扱うので**コミットが止まる**。
`AnalysisProvider` が予約したタイマーが happy-dom の teardown 後に発火し、
`window.clearTimeout` で `ReferenceError` になる。

`git diff origin/main HEAD -- src/entities/analysis` は**0行**なので、このブランチの
変更ではない。`origin/main` の `c6e1deb` 時点で再現する。→ **#272**

## 見ていない範囲

- **`src-tauri/`** — 10ラウンド続けて誰も読んでいない
- **実行時検証** — 10ラウンドすべて静的な読みと vitest のみ
- `KifuForkActions` / `KifuMoveActions` / `KifuCommentNote` の中身（#263 / #266 / #268 で
  issue になっているので、そちらで読む）
- `entities/game/model/provider.tsx` の `goToIndex` の内部・`computeLeafTesuu`

## lint / hook で強制できるもの

1. **`as TesuuPointer` の出現箇所を数える検査**（W1）→ #243 で既出。これがあれば
   `CLAUDE.md` に例外を書く必要自体が消える。**3回外している以上、入れる価値がある**
2. **`failure-surfacing.md` の F 番号の参照検査**（r9 V4）→ 未実装のまま
3. **W2 / W3 は機械で防げない。** ただし W3 は手順として機械化できる:
   実装を変えたコミットで、その関数を引用している open issue を
   `gh search issues --repo ... '<関数名>'` で洗い直す一手を `/review-fix` に足す
4. `docs/**/*.md` を verify-gate に（#251）/ `vp lint --deny-warnings`（r5 から）→ 持ち越し

## ラウンド11の対象

- W1〜W3 を直した状態で回す。**まだ所見ゼロのラウンドは出ていない**
- HIGH 以上は初めてゼロになった
