# レビュー r2: #354 終局判定（依存の方向・責務の置き場）

対象: `git diff origin/main...HEAD`（10コミット）。r1 の所見と
`2026-09-09-354-r1-plan.md` を読んだうえで、**r1 の修正で構造が変わった点だけ**を見た。
計画が理由を書いて見送った3件（置き場・`GameProgress` の組み立て・barrel への公開）は蒸し返していない。

## 依頼された4点の検証結果

### 1. `entities/game/lib` → `@/entities/game-session` の同層 import — **所見なし**

3ファイルが `import type { Side } from "@/entities/game-session"` を持つ
（`src/entities/game/lib/ruleColor.ts:19`, `src/entities/game/lib/gameOutcome.ts:33`,
`src/entities/game/lib/jishogiDeclaration.ts:21`）。以下を実際に当てて、いずれも妥当だった。

- **barrel を通っている。** 深い `@/entities/game-session/api/rust-types` ではないので
  `src/__tests__/sliceBarrels.test.ts` に触れない（実行して緑を確認）
- **循環が無い。** `entities` 配下のスライス間の辺を全部並べると
  `game → game-session`、`game-session → engine`、`game → kifu` で、逆向きの辺は無い
  （`game-session/api/*.ts` の import は `@tauri-apps/*`・`./rust-types`・`@/entities/engine` だけ）。
  `import/no-cycle` も緑。なお `app-config ⇄ engine-presets` の循環は既存で、この差分とは無関係
- **レイヤ規則に触れない。** `upperLayers("entities")` が禁じるのは app/pages/widgets/features だけ
- **`import type` なので実行時の辺は増えない**（`tsconfig.app.json` は `verbatimModuleSyntax: true`）
- **橋は `ruleColor.ts` に閉じている。** `src/entities/game` 全体を
  `"black"` / `"white"` で引くと、リテラルを作っているのは `ruleColor.ts:22` の `toSide` と
  `ruleColor.ts:26` の `sideToTsColor` だけ。`gameOutcome.ts:196,201,212` はすべて `toSide` 経由で、
  `winner === Color.Black ? "black" : "white"` の手書きは1つも無い

### 2. `scripts/knip-ratchet.sh` の 149 → 184 — **所見なし（増分の中身を突き合わせて確認した）**

`git archive origin/main` と `git archive HEAD` をそれぞれ別ディレクトリへ展開し、
同じ `npx knip --include exports,types,files --reporter json` を掛けて項目単位で差分を取った。

```
main total: 149   head total: 184   delta: 35
ADDED   (39件): すべて src/entities/game-session/{index.ts, api/tauri.ts, api/events.ts, api/rust-types.ts} の export/type
REMOVED ( 4件): FILE src/entities/game-session/{index.ts, api/events.ts, api/rust-types.ts, api/tauri.ts}
```

39 − 4 = 35。**`entities/game-session` の外で増えた項目は1件も無い。**
「新しく死んだ export」ではなく「『未使用ファイル1件』が『未使用 export 39件』へ展開された」
であることが、この差分で確定する。スクリプトに足された説明（`scripts/knip-ratchet.sh:9-14`）は
現物と合っている。

（`git archive HEAD` の側＝追跡済みファイルだけでも 184。作業ツリーに転がっている
未追跡のスクラッチは数に影響していない。）

### 3. `generateLegalMoves` / `getAllLegalMoves` / `hasLegalMove` と `MoveValidator` — **所見あり（下記 [MEDIUM] ①）**

### 4. `declarationRuleOf` の `switch` — **半分寄った。残りは下記 [MEDIUM] ②**

---

### [MEDIUM] ① 合法手の数え上げが2本のままで、r1 の性能修正が片方にしか入らなかった

- 場所: `src/entities/game/lib/moveValidation.ts:217-256`,
  `src/entities/game/lib/shogiMoveValidator.ts:45-70`,
  `src/entities/game/model/moveValidator.ts:8`,
  `src/entities/game/model/provider.tsx:188-189`, `src/entities/game/model/provider.tsx:631`
- 根拠:

  ```ts
  // moveValidation.ts:247-253（この PR で順を入れ替えた側。理由のコメント付き）
  // **`wouldBeInCheckAfterMove` を先に見る。** 積の条件なので結果は変わらないが、
  // `canDropPieceAt` は歩について `isUchifudume` を通り、その中で相手の合法手を
  // また数え上げる。…（実測 66 秒 → 1ms 未満）
  if (wouldBeInCheckAfterMove(shogi, move)) continue;
  if (!canDropPieceAt(shogi, kind, move.to.x, move.to.y, color)) continue;

  // shogiMoveValidator.ts:66-69（同じ規則のもう1つの写し。順は昔のまま）
  return allDrops
    .filter((move) => move.kind === kind)
    .filter((move) => canDropPieceAt(shogi, kind, move.to.x, move.to.y, color))
    .filter((move) => !wouldBeInCheckAfterMove(shogi, move));
  ```

  `origin/main` の `getAllPossibleMoves` は `shogiMoveValidator.getLegalDropsByKind` と
  **同じ順**だった（`git show origin/main:src/entities/game/lib/moveValidation.ts` の 238-245）。
  この PR で片方だけを入れ替えたので、いま2つの写しは順が違う。

- なぜ問題か: 「持ち駒の打ち手を数え上げる」という同じ規則が
  `moveValidation.ts:242-255` と `shogiMoveValidator.ts:57-70` に2度書かれていて、
  盤上の移動手も `moveValidation.ts:219-228` と `shogiMoveValidator.ts:45-51` に2度ある。
  結果として、**測って理由まで書いた修正が、盤が実際に通る側（`getLegalDropsByKind`。
  `provider.tsx:189` の持ち駒選択と `provider.tsx:631` から呼ばれる）に届いていない。**
  コメントは `moveValidation.ts` にしか無いので、次に `getLegalDropsByKind` を読む人は
  順に意味があることを知る手掛かりが無く、`moveValidation.ts` 側を「無駄な入れ替え」と読んで
  戻す余地が残る。
  併せて `MoveValidator` が抽象として働いていない:
  - `MoveValidator.getAllLegalMoves`（`moveValidator.ts:8`）と
    `ShogiMoveValidator.getAllLegalMoves`（`shogiMoveValidator.ts:37-39`）は
    **呼び出し元が repo に1つも無い**（`rg` で `src` 全体を引いて確認。`provider.tsx` が使うのは
    `getLegalMovesFrom` / `getLegalDropsByKind` / `isLegalMove` / `canPromote` / `mustPromote` だけ）。
    素の委譲1行だけのメソッドが interface に載っている
  - この PR の改名で、その死んだメソッドと自由関数が**同名**になった。名前は
    「同じもの」と言っているのに、経路は `getLegalDropsByKind` を通らない別物である
  - `MoveValidator` に `hasLegalMove` が無いので、`gameOutcome.ts:36` は interface を
    迂回して `moveValidation` の自由関数を直接読む。**合法性の窓口が interface ではない**
- 直し方: `ShogiMoveValidator.getLegalMovesFrom` / `getLegalDropsByKind` を
  `generateLegalMoves` の中から使う形に寄せて、写しを1つにする。
  具体的には `generateLegalMoves` を `(shogi, color)` から
  `getLegalMovesFrom` / `getLegalDropsByKind` を呼ぶだけの実装にし、
  順の入れ替えは `getLegalDropsByKind` の中で1度だけ行う。
  そのうえで `MoveValidator.getAllLegalMoves` は**呼ぶ側が無いので消す**か、
  残すなら `hasLegalMove` も interface に載せて `gameOutcome.ts` をそこへ通す
  （どちらかにしないと、interface は「関数の寄せ集めを包んだだけ」のまま）。

### [MEDIUM] ② `JishogiRule` の網羅は片側だけ。`gameOutcome.ts` は新しい値を黙って呑む

- 場所: `src/entities/game/lib/jishogiDeclaration.ts:46-56`,
  `src/entities/game/lib/gameOutcome.ts:200`, `src/entities/game/lib/gameRules.ts:14-19`
- 根拠: `src` 全体を `jishogiRule|"try"|"none"|general24|general27` で引くと、
  値を見ている場所は2つしかない。

  ```ts
  // jishogiDeclaration.ts:46-56 — 網羅する側
  function declarationRuleOf(rule: JishogiRule): JishogiDeclarationRule | null {
    switch (rule) { case "general24": … case "none": case "try": return null; }
  }

  // gameOutcome.ts:200 — 網羅しない側
  if (rules.jishogiRule === "try" && reachedTrySquare(shogi, lastMover, progress.usiMoves)) {
  ```

  `git archive HEAD` の写しで `JishogiRule` に `"trycheck"` を1つ足して `npx tsc -b` を掛けたところ、
  出た誤りは**1件だけ**だった。

  ```
  src/entities/game/lib/jishogiDeclaration.ts(46,48): error TS2366:
    Function lacks ending return statement and return type does not include 'undefined'.
  ```

  `gameOutcome.ts:200` は無言で通る。

- なぜ問題か: 「自動で終局するのは `try` だけ」という規則が
  (a) `gameRules.ts:14-17` の散文、(b) `jishogiDeclaration.ts` の `switch`（`try` を `null` 側に置く）、
  (c) `gameOutcome.ts:200` の `=== "try"` の3箇所に散っている。
  自動終局する規則をもう1つ足すと——たとえば「トライ＋直前が王手でないこと」や
  floodgate 系の変種——tsc が指すのは (b) だけで、そこを直しても
  `judgeGameOutcome` はその規則を**終局として一度も返さない**。
  対局は永久に続き、`RULING_TIMEOUT` まで誰も気付かない。
  r1 の P7 は (b) だけを塞いだので、割れ目そのものは残っている。
- 直し方: r1 で書かれていた「規則ごとに『自動終局か／宣言か』を1つの表に持つ」を
  `gameRules.ts` 側で実装する。たとえば

  ```ts
  // gameRules.ts
  const JISHOGI_RULE_KIND: Record<JishogiRule, "none" | "declaration" | "automatic"> = {
    none: "none",
    general24: "declaration",
    general27: "declaration",
    try: "automatic",
  };
  ```

  `Record<JishogiRule, …>` なら値を足した瞬間に tsc がこの表を指す。
  `declarationRuleOf` も `judgeGameOutcome` もこの表を読むだけにすれば、
  分岐の持ち主が1つになる。`gameRules.ts:14-17` の散文はその表の説明に落とす。

## r1 から持ち越し（新しい所見ではない・再提出でもない）

r1 arch の [MEDIUM]「`opponentOf` と同じ知識が同じディレクトリに手書きで3つある」は、
**直っておらず、`r1-plan.md` の「直さない」表にも載っていない**——束ねる段で落ちている。
現物は `ruleColor.ts:35` / `moveValidation.ts:33` / `moveValidation.ts:186` の3つのまま。
所見としては r1 のものを引くだけなので、ここでは中身を書き直さない。
拾い直すか、意識して落としたのなら理由を表に足すかのどちらかが要る。

## 見ていない範囲

- **Rust 側の依存とコマンド登録。** この差分の `src-tauri/` の変更は
  `engine/game/session.rs` と `engine/utils.rs` の**doc コメント2箇所だけ**で、
  `lib.rs` の `invoke_handler` もモジュール構成も動いていない。
  よって trait・モジュール間依存・コマンドと実装の対応は今回の対象外として見ていない
- 判定そのものの将棋のルールとしての正しさ（27点法の点数、千日手の回数、
  トライ成立の要件）。tsshogi へ委譲した部分は委譲先を検証していない
- 速さの実測。`getLegalDropsByKind` に修正が届いていないことの**値段**は測っていない
  （観点の担当外。①は「写しが2つあるので修正が片方にしか届かない」という構造の話として挙げた）
- `docs/` の文言の細部。参照している issue 番号 #532 / #536 / #374 が実在すること
  （`gh issue view`）と、`docs/` の識別子ラチェット（`src/__tests__/docsIdentifiers.test.ts`
  ほか30ファイル）が緑であることだけ確認した
- **`npm run lint` と `npx vitest run src/__tests__` は現在赤い。** ただし原因は
  レビュー中に**別のレビュアーが作った未追跡のスクラッチ**
  （`src/entities/game/lib/__tests__/zzprobe.test.ts` → `zzprobe2.test.ts`。
  実行のたびに名前が変わっている）で、`git diff origin/main...HEAD` には入っていない。
  それを除けば lint は既存の `AppErrorBoundary.tsx` の warning 1件のみ、
  `src/__tests__` は 30ファイル / 327件が緑。**コミット前に消すこと**
- `npm run verify:rust` は走らせていない（Rust の変更が doc コメントだけのため）

## lint / hook で強制できるもの

- **①の「同じ規則の写しが2つ」は機械で止められない**——両方とも別の関数名を持つ普通のコードなので、
  走査ラチェットで書けるのは「`getDropsBy(` を呼ぶ場所は2つまで」のような当てにならない形になる。
  写しを1つにするほうが確実
- **①の「呼び出し元の無い interface メソッド」は機械で拾える。** knip は
  `--include classMembers` を足すと class のメンバを見る。いまの
  `--include exports,types,files` では `MoveValidator.getAllLegalMoves` のような
  死んだメソッドが**1件も数に乗らない**（現に乗っていない）。
  ラチェットの範囲を広げるなら、基準を取り直したうえで `classMembers` を足すのが素直
- **②は lint ではなく型で止めるのが確実。** `Record<JishogiRule, …>` の表に寄せれば
  値を足した時点で tsc が落ちる。`switch` + `never` を各所に足すのは、
  分岐の数だけ足し忘れる先が増えるので表より弱い
- **同層の横断 import**（`entities/A` → `entities/B`）は r1 で backlog へ送られている。
  今回その辺が1本増えた（`game → game-session`）ので、two-strikes の数え直しに使える材料はある。
  判断は `.claude/knowledge/mechanization-backlog.md` 側
