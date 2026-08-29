# レビュー issue-31-move-notation ラウンド1

- 日付: 2026-08-29
- 範囲: `fix/31-relative-kanji` の `main...HEAD`（2コミット）
  - `src/features/position-navigation/lib/shogi-format.ts`
  - `src/features/position-navigation/lib/__tests__/shogi-format.test.ts`（新規）
- 走らせた reviewer: `comment-reviewer` / `robustness-reviewer` / `architecture-reviewer`
  （観点を絞る指示のため `react` / `ui` / `perf` / `rust` / `oss-hygiene` は不実施）
- 対象コミット: `71438e0`
- 変更の意図: JKF の `relative`（Latin コード）を日本語に直す（issue #31）。あわせて手番の ☗/☖ を付ける。

## 所見

### [BLOCK] `promote: false`（不成）が黙って消える — robustness

`shogi-format.ts:80-83` が `if (move.promote)` と truthy 判定している。`promote` は
`true` / `false` / `undefined` の3値で、`false` は「成れたのに成らなかった」＝**不成**を意味する。

実データで確認済み（`tsshogi` の `importKIF` → `exportJKF` に平手の `３ ２二角(88)` を通した実測）:

```
{"color":0,"piece":"KA","to":{"x":2,"y":2},"from":{"x":8,"y":8},"promote":false,"capture":"KA"}
  formatMove ==> ☗2二角          （JKF の canonical: ☗２二角不成）
```

利用者に起きること: 不成を含む棋譜を開くと BranchCard に「☗2二角」と出て、
「成れない位置での普通の移動」と読める。**壊れて見えないので誤解に気づけない。**
成/不成は同一マスに対する2分岐になる典型で、まさに BranchCard が並べる場面。

`promote !== undefined` で3値を扱い、`false` は `"不成"` を出す。

### [HIGH] 「JKF の手 → 日本語」の実装が2本あり、同じ分岐が画面ごとに違う文字列で出る — architecture

- 手書き: `features/position-navigation/lib/shogi-format.ts`（`BranchCard.tsx:22`）
- ライブラリ: `widgets/kifu-stream/lib/buildStreamRows.ts:31,35,57` が
  `JKFPlayer.getReadableForkKifu()` / `getReadableKifu()` を呼ぶ（`KifuForkMenu.tsx:71,78`）

`KifuForkMenu` と `BranchCard` は「本譜 / 変化N + 指し手」という同じ情報の同じ形の一覧で、
ラベルまで揃えてある。同一の分岐が棋譜ストリームでは `☖３四歩`、局面ナビでは `☖3四歩` になる。

今回の相対表記・手番記号・語順の3点は、**いずれもライブラリ側が最初から正しく実装していた**。
`relativeMap` は `JKFPlayer.relativeToKan` と1文字も違わない同じ表。今回の修正は
「二重実装の片方を手で追いつかせた」だけで、次に片方だけ直される構造は残っている。

ただし単純な差し替えは不可。2点だけライブラリに無いものがある:
1. 曖昧でない駒打ちの「打」（下記 MEDIUM 参照）
2. `special`（投了・中断）は `buildStreamRows` 側が必要とする

### [MEDIUM] 「打」の補完を正当化するコメントが事実と違う — comment / robustness（重複）

`shogi-format.ts:76-78` のコメント「駒打ちは JKF なら "H" が入るが、KIF を経由せず
組み立てられた手には付かない」が**誤り**。両プロデューサで確認:

- `json-kifu-format` `normalizer.ts:63,144,301`（3経路すべて同じ）:
  `if (shogi.getMovesTo(...).length > 0) move.relative = "H"` — **曖昧なときだけ**
- `tsshogi` `jkf.cjs:360-368`: `getDirectionModifier` が空なら `relative` を出さない

実測（`５ ４五角打`、曖昧でない打）:

```
{"color":0,"piece":"KA","to":{"x":4,"y":5}}   formatMove ==> ☗4五角打  （canonical: ☗４五角）
```

つまりこのフォールバックは「手書きで作られた手」ではなく**曖昧でない打すべて**で発火する。
挙動自体は分岐一覧では有用（`applyMoveWithBranch.ts:50` が気にする「3九金(49)」と「3九金打」の
取り違えを表示上も防げる）ので方針として残してよいが、**それは判断であってコードから読めない**。
コメントを実態に直し、「曖昧でなくても打を出す」判断の理由を1行書く。

### [MEDIUM] テストが実データを一度も通っていない — robustness

20件すべて手書きリテラルで、パーサ出力を一度も通していない。結果として:

- `promote: false` のテストが0件。**上の BLOCK が 63件 green のまま素通りした**
- 逆に `:78`「表に無いコードはそのまま残す」が守る経路は**どちらのプロデューサからも到達しない**
  （`tsshogi` は未知修飾子を捨て、`json-kifu-format` は L/C/R/U/M/D しか生成しない）
- 駒打ちのテストが「KIF 経由でない手」という**誤ったデータモデルを固定している**

最低1本、`parseKifuContentToJKF` を通す実データテストを足す。

### [MEDIUM] 棋譜表記のロジックが `features/` にあるため widgets から使えない — architecture

`shogi-format.ts` の依存は `json-kifu-format` と `shogi.js` だけで、`position-navigation` 固有の
ものが1つも無い。`app → pages → widgets → features → entities → shared` の規則により
`widgets/kifu-stream` からは import できず（`vite.config.ts:33-42`）、上の二重実装は
**置き場が高すぎて共有できなかったことの直接の結果**。今回の変更は高いほうに機能を足した。

移すなら `entities/kifu/lib/`。`src/**/lib/*.ts` 約50本中 kebab-case はこの1本だけなので
ファイル名も揃う。

### [MEDIUM] `isSameMove` / `getMoveHash` は参照0件のまま `entities/kifu/lib/eqMove.ts` と重複 — architecture

リポジトリ全体で定義行以外の出現が0件（確認済み）。`eqMove.ts` は `applyMoveWithBranch.ts:4` から
使われ、テストもある現役実装で、issue #74 の非対称ケースを織り込んでいる。
今回このファイルにテストが付いたことで**死んだコードが「保守されている現役の場所」に見えるようになった**。

### [MEDIUM] ☗/☖ の直書きが7箇所目になり、既に取り違えが1件出ている — comment

この概念には既に `turnGlyph: "☗" | "☖"`（`useHeaderCenterInfo.ts:24`）という名前がある。
名前が無い箇所では既に逆転が混入している:

- `entities/position/ui/BoardPreview.tsx:111,123` — `☗後手` / `☖先手`（**逆**）
- `entities/position/ui/PositionPreviewPane.tsx:71-72` — `☗先手` / `☖後手`（正）

本 PR で ☗/☖ が棋譜テキストという最も目に付く場所に出るようになり、盤プレビューの
逆転表示と画面上で並んで矛盾する。

### [MEDIUM] 駒種 → 漢字が7実装に散っている — architecture

`formatPiece` の自前表のほか、5つの `features/*/ui` に一字一句同じ
`const toKan = useMemo(() => (k: string) => JKFPlayer.kindToKan(k as Kind) ?? k, [])` が並び、
`entities/position/ui` へ props で注入されている（依存の向きは合っているが知識の所在が逆）。
`formatPiece` と `kindToKan` は `OU` が 王 / 玉 で食い違う。

## 重複・矛盾した所見

- **「打」のコメント**: comment-reviewer は BLOCK、robustness-reviewer は MEDIUM。
  両者とも同じ事実誤認を独立に突き止め、`normalizer.ts` の該当行も一致。
  実害はコメントのみ（挙動は妥当）なので MEDIUM に統合した。
- **ライブラリへの委譲**: 3 reviewer 全員が独立に「`JKFPlayer.moveToReadableKifu` の手書き
  再実装」と指摘。ただし**結論は割れている**:
  - architecture / robustness: 委譲する薄いラッパにすべき
  - comment: 委譲しないなら「意図した相違点」を TSDoc に列挙すれば足りる

  半角数字 `7六` を採るか全角 `７六` を採るかは**表示仕様の判断**で、reviewer は決めていない。
  委譲すると全角になり、既存の doc コメントの例（`"７六歩"`）とは一致する一方、
  BranchCard の pill 幅に効く。ここは人が決める。

## 見ていない範囲

- 実画面での見え方（`npm run verify` は green だが UI は未確認）。`ui-reviewer` は不実施
- CSA / KI2 経路での `promote` / `relative` の出方。KIF と JKF の2経路しか実測していない
- Rust 側（差分に無い）
- `formatMove` の将来の利用者（現状 `BranchCard.tsx:22` の1箇所のみ）
- セキュリティは確認済みで問題なし（`dangerouslySetInnerHTML` 0件、戻り値は JSX テキストノード）

## lint / hook で強制できるもの

- **`isSameMove` / `getMoveHash` のような参照0件の export**: `knip` / `ts-prune` 相当を
  `npm run verify` に足せば自動で落ちる。oxlint の `no-unused-vars` は export された関数を拾わない
- **☗/☖ の直書き**: `shared` に定数を置いたうえで `no-restricted-syntax` で文字列リテラルを禁じる。
  現状 `BoardPreview.tsx` の取り違えは人のレビューでしか拾えない
- **`promote` の3値取りこぼし / ライブラリ関数の手書き再実装**: lint では防げない。
  実パーサを通すテスト1本が唯一の自動防御（CLAUDE.md「1回目はルールではなくテストを書く」に沿う）

## 次ラウンドの対象

判断が要るものが混ざっているため、ユーザーの決定を待つ。

- 即直す（判断不要）: BLOCK（不成）、「打」コメントの事実誤り、実データテスト追加、
  到達しない `"X"` テストの削除
- 判断が要る: ライブラリへの委譲と共通化の範囲（半角/全角の表示仕様を含む）、
  `entities/kifu/lib` への移設、`isSameMove` / `getMoveHash` の削除
- 別 issue が妥当: ☗/☖ 定数化と `BoardPreview` の逆転、`toKan` の7重複
