# レビュー: #354 終局判定（依存の方向・責務の置き場）

対象: `git diff origin/main...HEAD`（8cb667bd / b4ab6873 / 4d19f654）
観点: 依存の方向、責務の置き場、公開境界、型が不変条件を表現しているか。
UI の見た目と速さは見ていない。

### [HIGH] 合法手判定が2実装になっている。避けたはずの当のものが入った

- 場所: `src/entities/game/lib/gameOutcome.ts:13-18`, `src/entities/game/lib/gameOutcome.ts:99-105`,
  `src/entities/game/lib/shogiMoveValidator.ts:16-31`, `docs/state-transitions/game-session.md:22-24`
- 根拠:

  ```ts
  // gameOutcome.ts:13-18（この置き方の根拠として書かれている）
  // shogi.js 側を選べないのは、盤の表示（移動可能マスの強調・成り選択）が既に
  // それを使っていて、重ねると合法手判定が2実装になるため

  // gameOutcome.ts:101-104（実際にやっていること）
  const move = record.position.createMoveByUSI(usiMove);
  if (!move || !record.append(move)) {
    return Err({ code: "unplayable_move", usiMove, ply: index + 1 });
  }
  ```

  `Record.append` は `Position.doMove` → `isValidMove` を通る
  （`node_modules/tsshogi/dist/cjs/position.cjs:332`）。`isValidMove` は
  二歩（`:314`）・打ち歩詰め（`:320`）・王手放置（`:287-296`）・行き所のない駒（`:284`）を
  すべて見る**完全な合法手判定**である。つまり `judgeGameOutcome` は毎手、
  対局の全手を tsshogi の合法手判定に掛け直している。

- なぜ問題か: 2つの判定が割れた手は、shogi.js 側を通って Rust に着いた後、
  裁定の段で初めて弾かれる。割れる形は既に在る——`ShogiMoveValidator.isLegalMove`
  （`shogiMoveValidator.ts:19-20, 26`）は候補手と `to.x` / `to.y` だけを突き合わせ、
  **`promote` を一度も見ない**。だから「成らずで1段目に入る歩」は shogi.js 側で合法、
  tsshogi 側は `isInvalidRank` で非合法になる（強制成りは `mustPromote` という
  別の関数が UI 側で当てている前提であり、判定器の合法性の定義には入っていない）。
  この手が `submitGameMove` を通ると、`moveDecided` の裁定で
  `unplayable_move` が返り、`GameOutcomeFailure` の doc（`gameOutcome.ts:58-62`）が
  言うとおり**対局を中断するほかなくなる**。「盤と Rust が食い違った」ではなく
  「ライブラリ2つの規則が食い違った」なので、利用者に出す説明も間違ったものになる。
- 直し方: 合法手の権威を1つに決めて、その決定を doc に書く。どちらでも成立する。
  (a) tsshogi を局面の追走だけに使い、合法性は shogi.js の1本に閉じる——
  `record.append(move, { ignoreValidation: true })`（`DoMoveOption`）で通し、
  `unplayable_move` を「書式が読めない／盤に載らない」だけの失敗に落とす。
  (b) 合法手の権威を tsshogi に寄せ、shogi.js を表示（移動可能マスの強調）専用にする。
  いずれにせよ `gameOutcome.ts:13-18` と `game-session.md:22-24` の
  「shogi.js を選んだのは2実装を避けるため」は、現物と合っていないので書き直す。

### [HIGH] 対局のルールが「棋譜を読んでいる状態」の entity に入っている

- 場所: `src/entities/game/lib/gameOutcome.ts:67-78`, `src/entities/game/lib/gameRules.ts:21-35`,
  `src/entities/game-session/api/rust-types.ts:11-12`, `src/entities/game-session/index.ts:2-3`
- 根拠:

  ```ts
  // game-session/api/rust-types.ts:11-12（切れ目の出典）
  // `entities/game` の型とは別物。あちらは「棋譜を読んでいる状態」で、
  // ここは「対局が進んでいる状態」。
  ```

  新しい4ファイルが扱う語彙は全部「対局が進んでいる状態」の側にある——
  `GameProgress.startSfen` は `GameSettings.startSfen`（`rust-types.ts:135`）、
  `usiMoves` は `continueGame(gameId, moves)`（`tauri.ts:105`）、
  `GameOutcome.winner` は `endGameByRule(gameId, winner, detail)`（`tauri.ts:128-134`）、
  `GameRules` は `GameSettings` の残り半分（`gameRules.ts:2-4` が自分でそう書いている）。

- なぜ問題か: 対局設定が2つの entity に割れた。対局を始める画面は
  `GameSettings`（game-session）と `GameRules`（game）を別々の場所から集めることになり、
  「同じ対局の設定」を1つの型で持つ場所が存在しない。さらに `entities/game` の
  中身は React の context / provider / reducer（`model/provider.tsx`）で、
  ルールの純関数はその entity の同一性と関係が無い。呼ぶ側が現れると、
  ルールの入出力を game-session の語彙へ繋ぐ仕事（下の Color↔Side、
  棋譜から `usiMoves` を組む）が widgets / features に落ちる——
  ドメインの規則が画面へ染み出す典型の形。
- 直し方: 2案。(a) 判定3ファイルを `entities/game-session/` 側（`model/` か `lib/`）へ移し、
  `GameRules` を `GameSettings` の隣に置く。合法手の generator だけを
  `entities/game` から借りる同層1本の import に絞る。
  (b) 将棋の規則そのものを独立スライス（例 `entities/shogi-rules/`）に切り出し、
  合法手・成り・終局・宣言をそこに集める。`entities/game`（盤の表示）と
  対局側の両方がそこを読む形にすれば、同層の横断は「規則→表示」の1方向に揃う。
  (a) は移動量が小さく、(b) は `shogiMoveValidator.ts` が
  「棋譜閲覧 entity にあるのに対局からも要る」というねじれごと解消する。

### [MEDIUM] 手番の綴りが3つあるのに、変換の持ち主は2つ分しか無い

- 場所: `src/entities/game/lib/ruleColor.ts:16-22`, `src/entities/game/lib/gameOutcome.ts:51-55`,
  `src/entities/game-session/api/tauri.ts:128-134`, `src/entities/game-session/api/rust-types.ts:37`
- 根拠:

  ```ts
  // ruleColor.ts:16-22 — shogi.js ↔ tsshogi の2つだけ
  export function toTsColor(color: Color): TsColor
  export function fromTsColor(color: TsColor): Color

  // rust-types.ts:37 — 3つ目の綴り
  export type Side = "black" | "white";
  // tauri.ts:130 — 判定結果の行き先
  winner: Side | null,
  ```

- なぜ問題か: `judgeGameOutcome` の結果は必ず `endGameByRule` へ渡る。
  その一歩手前で要る `Color → Side` の変換だけが、どのモジュールにも無い。
  持ち主が無い変換は呼ぶ画面が自前で書くことになり、`moveDecided` を捌く
  widget/feature が増えるたびに `winner === Color.Black ? "black" : "white"` が
  複製される（`ruleColor.ts` を作った動機そのものが再発する）。
- 直し方: `Side` の出典は `entities/game-session` なので、`Color ↔ Side` の
  1本をそちら側に置く。あるいは `GameOutcome.winner` を `Side` にして、
  判定器の外に手番の綴りを1つも出さない（`ruleColor.ts:9-11` が
  「公開する型は shogi.js 側に寄せる」と決めているのは `entities/game` の
  中の話であって、対局の裁定の戻り値には当てはまらない）。

### [MEDIUM] `opponentOf` と同じ知識が、同じディレクトリに手書きで3つある

- 場所: `src/entities/game/lib/ruleColor.ts:25-27`, `src/entities/game/lib/moveValidation.ts:33`,
  `src/entities/game/lib/moveValidation.ts:186`, `src/shared/lib/turn.ts:14-28`
- 根拠:

  ```ts
  // ruleColor.ts:26
  return color === Color.Black ? Color.White : Color.Black;
  // moveValidation.ts:33（この PR で触ったファイル）
  move.from ? (testShogi.turn === Color.Black ? Color.White : Color.Black) : move.color!;
  // moveValidation.ts:186
  const opponentColor = move.color === Color.Black ? Color.White : Color.Black;
  ```

- なぜ問題か: `opponentOf` は shogi.js の `Color` だけに依る層非依存の関数で、
  同種の `Color` ヘルパは既に `shared/lib/turn.ts` が持っている
  （`turnGlyph` / `turnLabel` / `turnText`）。置き場が2つあると、次に要る人は
  どちらを読むか決められず、3つ目の手書きが増える（現に同じフォルダで2つ増えている）。
  `ruleColor.ts` という名前も、中身の3関数のうち1つだけが「2ライブラリの綴りの往復」
  でない状態になっている。
- 直し方: `opponentOf` を `shared/lib/turn.ts` へ下ろし、`moveValidation.ts:33` と
  `:186` をそれに置き換える。`ruleColor.ts` はライブラリ間の変換2本だけにする
  （名前と中身が合う）。

### [MEDIUM] `entities/game/index.ts` が公開境界として機能していない

- 場所: `src/entities/game/index.ts:1-3`, `src/entities/game-session/index.ts:14-41`,
  `src/app/providers/bridges/GameFileTreeBridge.tsx:6`
- 根拠:

  ```ts
  // entities/game/index.ts の全文
  export * from "./model/provider";
  export * from "./model/useGame";
  export * from "./model/types";
  ```

  新規の `gameOutcome` / `gameRules` / `jishogiDeclaration` / `ruleColor` は
  どれもここに出ていない。一方 `entities/game-session/index.ts` は
  公開する名前を列挙している。既に app 層から
  `import { describeKifuLoadFailure, kifuLoadFailureTier } from "@/entities/game/lib/kifuLoadFailure";`
  という深い import が1本ある。

- なぜ問題か: 呼ぶ側が現れたとき、`@/entities/game/lib/gameOutcome` を直接指すのが
  唯一の道になる。深い import が既定になると、スライスの内側の
  どれが公開面でどれが実装かを誰も宣言していない状態が固定される
  （`lib/` の8ファイルすべてが事実上の公開面になる）。
  同じ層の2スライスで境界の作り方が食い違っているのも、次の人が真似る先を選べない。
- 直し方: 判定の公開面を `entities/game/index.ts` に**名前で**列挙する
  （`export *` を足すと `Color` 由来の型まで通る）。ただし前掲 [HIGH] の置き場を
  動かすなら、そちらの新しいスライスの index に列挙するのが筋で、この所見は消える。

### [MEDIUM] `GameProgress` が `GameSettings` と型で繋がっておらず、不変条件が散文しか無い

- 場所: `src/entities/game/lib/gameOutcome.ts:67-78`, `src/entities/game-session/api/rust-types.ts:20-34`,
  `src/entities/game-session/api/rust-types.ts:135-142`
- 根拠:

  ```ts
  // gameOutcome.ts:69-77
  /** 対局の根の局面。`GameSettings.startSfen` と同じもの。**`startpos` は受け付けない** */
  startSfen: string;
  /** 根から現在までの USI 指し手。**`continueGame` に渡す列と同じもの。** */
  usiMoves: readonly string[];
  ```

- なぜ問題か: 「同じもの」は文でしか書かれていない。`GameId` は取り違えを
  止めるために brand まで付けている（`rust-types.ts:20-34`）のに、
  裁定の入力は素の `string` と `string[]` なので、
  対局開始局面の SFEN を根と取り違えた列や、`initialMoves` を落とした列を渡しても
  tsc は通る。落ちるのは静かな誤判定のほう——手数が変われば `maxMoves` がずれ、
  局面の出現回数が変われば千日手を見落とす（`unplayable_move` にすらならない）。
- 直し方: 判定の入口を「対局セッションの状態から1箇所で組む」形にする。
  `startGame` に渡した `GameSettings` を保持して
  `judge(settings, movesSinceStart)` を作れば、根の SFEN を取り違えようが無い。
  最低でも根の SFEN を branded type にして、`GameSettings.startSfen` を
  作る口と同じにすること。

### [MEDIUM] トライルールの成立が「その手で着いた」ことに紐づいていない

- 場所: `src/entities/game/lib/gameOutcome.ts:80-89`, `src/entities/game/lib/gameOutcome.ts:135-137`
- 根拠:

  ```ts
  // 80-85 の doc
  // **着いた時点で成立する。** 玉がそこへ動けたなら王手はかかっていないので、
  // 「取られない」ことを別に確かめる必要はない
  // 135-137 の判定
  if (rules.jishogiRule === "try" && isOnTrySquare(shogi, lastMover)) {
  ```

  `isOnTrySquare` は最後の指し手を一切見ず、5一／5九に玉が在るかだけを見る。

- なぜ問題か: 「玉がそこへ動けたなら」という根拠に対応する条件式がコードに無い。
  途中局面から始める対局（`GameSettings.startSfen` は平手に限らない）で、
  根の SFEN が既に先手玉5一なら、先手が**何を指しても**その直後に
  `tryRule` で先手勝ちになる。玉がそこへ動いたわけでも、安全なわけでもない。
- 直し方: 直前の指し手が玉の移動で、`to` がその地点であることを条件に加える
  （`record.current.move` から取れる）。「局面として成立させる」を意図とするなら、
  doc の根拠のほうを書き直す（現状の文は実装が満たしていない前提を述べている）。

### [MEDIUM] `JishogiRule` の分岐が2ファイルに割れ、どちらも新しい値を黙って呑む

- 場所: `src/entities/game/lib/gameRules.ts:19`, `src/entities/game/lib/jishogiDeclaration.ts:52-58`,
  `src/entities/game/lib/gameOutcome.ts:135`
- 根拠:

  ```ts
  // jishogiDeclaration.ts:52-58
  if (rule === "none" || rule === "try") return Ok("unavailable");
  const declarationRule =
    rule === "general24" ? JishogiDeclarationRule.GENERAL24 : JishogiDeclarationRule.GENERAL27;
  // gameOutcome.ts:135
  if (rules.jishogiRule === "try" && ...)
  ```

- なぜ問題か: 4つの値の扱いが2ファイルに相補的に散っていて、
  どちらにも網羅の強制が無い。`JishogiRule` に値を1つ足すと、
  `jishogiDeclaration.ts` は三項の else 側に吸われて**黙って27点法**になり、
  `gameOutcome.ts` は `!== "try"` として素通りする。tsc は両方とも通す。
- 直し方: `switch (rule)` で書き、`default` で `never` に代入する形にして
  網羅を tsc に見させる。規則ごとの「自動終局か／宣言か」を1つの表
  （`gameRules.ts` 側）に持たせ、2つの判定器はその表を読むだけにするのが素直。

## 見ていない範囲

- Rust 側（この差分は `src-tauri/` を触っていない）。`lib.rs:99-107` の
  対局コマンド9本と `docs/spec/features/game-play.md` の「9本」が
  一致していることだけ確認した。モジュール間の依存や trait の抽象は見ていない
- 判定そのものの将棋のルールとしての正しさ（千日手の回数、27点法の点数、
  打ち歩詰めの扱い）。tsshogi に委譲している部分は委譲先を検証していない
- 速さ（毎手ゼロから Record を組み直す代償、`hasLegalMove` の実測）。
  観点の担当外として意図的に飛ばした
- `npm run test` は走らせていない。走らせたのは `npm run lint`（clean。
  既存の `AppErrorBoundary.tsx` の warning 1件のみ）と
  `bash scripts/knip-ratchet.sh`（`149 (baseline 149)` で緑）
- `docs/` の文言の細部（表の体裁、リンク先の存在）。参照している識別子のうち
  `SearchOutcome::DeclareWin`・`RULING_TIMEOUT`・`MAX_PLIES`・`GameView.currentTurn`・
  `SelectedPosition`・`JKFSpecial` の `TSUMI`/`SENNICHITE`/`JISHOGI` は実在を確認した

## lint / hook で強制できるもの

- **同層の横断 import**（`entities/A` → `entities/B`）は現在どのルールも見ていない。
  `vite.config.ts` の `upperLayers(layer)` は上位層しか禁じず、
  `sliceSelfBarrels` は自スライスの barrel だけを禁じる。
  [HIGH] の置き場を動かすと横断が1本増えるので、
  「許す組み合わせを列挙して、それ以外を禁じる」override を足せば機械で固定できる
- **スライス外からの深い import**（`@/entities/game/lib/...`）は
  `no-restricted-imports` の patterns で禁じられる（現に app 層に1本ある）。
  公開面を index に集める方針を採るなら、これで固定するのが確実
- **手番の綴りの手書き**（`=== Color.Black ? Color.White : Color.Black`）は
  `src/__tests__/` の走査ラチェット（`sourceText.ts` 系）で件数を止められる。
  同種の綴り検査は既に何本か在るので、置き場が決まっているなら新規追加を止められる
- `JishogiRule` の網羅は lint ではなく `switch` + `never` で tsc に見させるのが確実
