# レビュー app-shell-wiring ラウンド3

- 日付: 2026-09-06
- 範囲: `git diff origin/main...HEAD`
- 走らせた reviewer: architecture / react / robustness / comment / perf / oss-hygiene（6。ui は r2 で
  「悪化も改善もしていない」と判定して所見なしだったため、SCSS を1行も触っていない r3 では外した）
- 対象コミット: `aaae325e`
- 前ラウンド: [r1](2026-09-06-app-shell-wiring-r1.md)（29件）/ [r2](2026-09-06-app-shell-wiring-r2.md)（20件）
- **perf は所見なし。** r2 の数を全部数え直し、`navigate` の回数が「棋譜 k 本で k 回」から
  「トグルを押した回数ぶんだけ」に減ったことを確認している

## 所見

### [HIGH] r3-01 `hasKifu` の doc が `Hand` について嘘。`Hand` は `player?.shogi` で描画を止めない

- 場所: `src/entities/game/model/types.ts:68-69`、`src/widgets/game-board/ui/Hand.tsx:15,19,116`
- reviewer: comment（BLOCK と判定。下記の理由で HIGH に落とした）
- 根拠: doc は「`Board` / `Hand` は `player?.shogi` を直に見て自分の描画を止める」と書くが、
  `Hand` に早期 return は1つも無い。`const hands = view.player?.shogi.hands;` は
  **`shogi` の手前でチェーンが切れている**ので、`player` があって `shogi` が無ければ投げる。
- **BLOCK に上げなかった理由:** r3-02 のとおり「`player` はあるが `shogi` が無い」状態は到達できない。
  投げる経路は現状存在しない。**嘘なのは doc のほう。**
- なぜ問題か: r2-10 はこの一文を足すための修正だった。`hasKifu` の契約を読む人が最初に当たる場所で
  コードと食い違っている。「`Hand` も自分で門番している」と読むと `AppLayout` の分岐を安全に外せると考える。

### [MEDIUM] r3-02 `hasKifu` の doc が区別すると言う `player` と `player.shogi` は、この repo では同値。テストもその区別を作っていない

- 場所: `src/entities/game/model/types.ts:62`、`src/entities/game/model/provider.tsx:188`、
  `src/entities/game/model/__tests__/provider.test.tsx:94-103`
- reviewer: react
- 根拠: `cursorView` が `player` に入れるのは `null` か `buildPlayer` の返り値だけ。`buildPlayer` は
  `new JKFPlayer(jkf)` が成功したときだけ返り、そのとき `shogi` は必ずある。
  **`player !== null` と `!!player?.shogi` は全状態で同値。**
  テスト「盤に載せられない棋譜を掴まされても偽のまま」は `loadGame` が門前払いして `state.jkf` を
  null にする経路なので、1件目と同じところしか踏んでいない。式を `player !== null` にも
  `state.jkf !== null` にも書き換えて4件とも緑。
- なぜ問題か: r2-05 / r2-10 で「`hasKifu` を寄せる」と決めた当の不変条件が、doc では偽の理由づけ、
  テストでは無検査。

### [MEDIUM] r3-03 購読の `catch` だけ `cancelled` を見ておらず、同じ effect が名乗る「StrictMode-safe」が成り立たない

- 場所: `src/entities/search/model/provider.tsx:83`（コメント）, `:101-111`, `:114-119`
- reviewer: react
- 根拠: 成功枝は `if (cancelled) { u(); return; }` を持つが、r2-08 で足した catch 側の
  `setIsListenSettled(true)` にガードが無い。**畳まれた回が、生きている回の門を開ける。**
- なぜ問題か: 1回目が reject・2回目がまだ `await` 中、という並びで `isListenSettled` が真になり
  `open_project` が飛ぶ。r1-06 が潰した取りこぼしがそのまま戻る。`:83` のコメントが偽になっている。
- 併せて `:116` の `setIsListenSettled(false)` は現状どの経路でも効かない（依存が `[]` なので
  cleanup はアンマウント時だけ、そこでの setState は捨てられる）。

### [MEDIUM] r3-04 「埋まっていないセル」が、遷移があって ✓ の無いセルを2つ取りこぼしている。`(B2, E3)` は向きを戻す側でテストが1つも無い

- 場所: `docs/state-transitions/board-orientation.md:87-88`, `:130-137`、
  `src/features/board-orientation/model/__tests__/useBoardOrientation.test.tsx:78-84`
- reviewer: oss-hygiene
- 根拠: 列挙は `(B2, E7)` と `(B1, E1)` の2つだけ。`(B2, E3)`（→ B1）と `(B1, E2)`（→ B0）も
  遷移を持ちながら ✓ が無い。`fireEvent.click` は `openAndRotate` の1回だけで、
  **2度押す（`gote` → 既定）テストはリポジトリに無い。**
- なぜ問題か: `useBoardOrientation.ts` の `pov: isGotePov ? undefined : "gote"` を「常に `"gote"`」へ
  変異させても全部緑。ボタンの `title` は「先手視点に戻す」なので、**利用者から見える機能の半分が無検査。**
  表を読んだ人は「未検証はこの2セルだけ」と信じる。

### [MEDIUM] r3-05 凡例の `—` が「起きない」と「起きるが変わらない」を1記号に同居させていて、未検証かどうかが読めない

- 場所: `docs/state-transitions/board-orientation.md:74`, `:86`, `:88`
- reviewer: oss-hygiene
- 根拠: `(B0, E3)` は**起きない**、`(B2, E4)` は起きるが**変わらない**。同じ `—`。
- なぜ問題か: `—` かつ ✓ 無しのセルは「テストが要らない」と「起きるが誰も見ていない」の両方を含む。
  r2-07 は `(B2, E4/E5/E9)` にだけ ✓ を付けたが、同じ性質の `(B1, E4/E5/E9)` は無印。
  **その差が判断なのか漏れなのか判定できない。** r3-04 と同じ根。

### [MEDIUM] r3-06 表が裸の行番号 `:29` でソースを指し、行番号の検査を綴りの都合で素通りする

- 場所: `docs/state-transitions/board-orientation.md:117`、`src/__tests__/docsSourcePaths.ts:116-124`
- reviewer: comment / oss-hygiene（2人）
- 根拠: `lineNumberRefsIn` は `^[A-Za-z_][A-Za-z0-9_./-]*[#:]` で**識別子かパスで始まること**を
  要求するので、`:29` は拾われない。`board-orientation.md` は `EXEMPT` に無いので、本来は落ちるべき。
- なぜ問題か: 検査側の doc が「自リポジトリを行番号で指せば無言でずれる」と書いている、その形そのもの。
  しかも**ファイル名が無い**ので、ずれたときにどのファイルの29行目かも辿れない。
  同じ括弧の中に識別子が既にあり、行番号は情報を足していない。

### [MEDIUM] r3-07 `(B1, E1)` を未検証に置く理由（外から観測できるものが無い）が、同じ PR の修正で偽になっている

- 場所: `docs/state-transitions/board-orientation.md:135`、
  `src/features/board-orientation/model/useResetOrientationOnKifuChange.ts:31-35`
- reviewer: comment
- 根拠: r2-17（`ecb1a2b9`）で `params.pov === undefined` なら `navigate` しなくなったので、
  **`location.key` が増えないことが観測になる。** 同じファイルの
  「消す `pov` が無ければ、棋譜が載っても履歴を触らない」が `seenKeys` でその観測を既にやっている。
- なぜ問題か: 「観測できない」は**そのセルを永久に埋めない根拠**として書かれている。実際には6行で埋まる。

### [MEDIUM] r3-08 ※1 が挙げる「B0 で `?pov=gote` になる唯一の経路」は Tauri のウィンドウでは取れず、実在する経路が書かれていない

- 場所: `docs/state-transitions/board-orientation.md:96`、`src/features/settings/ui/tabs/WorkspaceTab.tsx:90`
- reviewer: oss-hygiene
- 根拠: 実在する経路は「B2 のままワークスペースを変更 → `window.location.reload()` →
  `BrowserRouter` がクエリごと復元 → 棋譜は載らない → マウント直後のエフェクトは ref と一致して
  return するので `pov` が残る」。**アドレスバーの無い Tauri のウィンドウでは「URL を直接打つ」は取れない。**
- 結論（B0 ではボタンが DOM に無い）は変わらない。直すのは経路の記述だけ。

### [MEDIUM] r3-09 E2 の発生源が「何が `activeKifuPath` を null にするか」の手前で止まっている

- 場所: `docs/state-transitions/board-orientation.md:59`、`src/entities/file-tree/model/provider.tsx:191-195,211-215,306-308,411-413`
- reviewer: oss-hygiene
- 根拠: `kifu_closed` を撃つのは4箇所で、うち `closeActiveKifu` は**スライス外の呼び出し元が0**。
  実際に踏めるのは「開いている棋譜（か親）を削除する」と「ツリーから消えた／ルートの外へ出た」の2つ。
- なぜ問題か: E7 は r2-19 で `renameNode` / `moveNode` まで名指ししたのに、E2 だけ1段手前。
  読めないと「閉じるボタンが無いなら E2 も無い」と読んで行ごと落とす人が出る——E2 は
  `BoardOrientationBridge` を盤の外に置く理由そのもので、落とすとその根拠が消える。

### [MEDIUM] r3-10 `provider.test.tsx` の doc に、r2-10 で落としたはずの「唯一の綴り」が残っている

- 場所: `src/entities/game/model/__tests__/provider.test.tsx:70`（対比: `src/entities/game/model/types.ts:62-69`）
- reviewer: comment
- なぜ問題か: 型の doc は「盤の内側は寄せていない」と唯一でないことを明示しているのに、テストの doc は
  「唯一の綴り」と書く。`Board` が直に見ているのを「規約違反だから寄せるべき」と読む人が出る。

### [MEDIUM] r3-11 r1-17 で1箇所に寄せた「なぜ」の逐語複製が、`entities/search` で2組復活している

- 場所: `src/entities/search/model/provider.tsx:71-75,77-79` と
  `src/entities/search/model/__tests__/openOnRootChange.test.tsx:79-83,99-102`
- reviewer: comment
- 根拠: r2-08 / r2-09 の書き直しで戻っている。しかもテストの冒頭は「なぜそこに寄せるかは
  `../provider.tsx` の effect の doc にある」と**既に指している**のに、その下で本文を2回写している。

### [MEDIUM] r3-12 ヘッダの中で同じ真偽値に `hasKifu` / `loaded` / `hasBadges` の3つの名前がある

- 場所: `src/widgets/app-layout-header/lib/useHeaderCenterInfo.ts:45,67,97,107`、
  `src/widgets/app-layout-header/ui/AppLayoutHeader.tsx:18,57`
- reviewer: architecture / comment（2人）
- 根拠: `const loaded = hasKifu;` は純粋な別名。`HeaderCenterInfo` は `hasKifu` と `hasBadges` という
  **常に等しい2つの真偽値**を公開している。**r2-05 の修正が新しく作った重複。**
- なぜ問題か: 「バッジだけ別の条件で出す」を入れる人は `hasBadges` の右辺を変える。tooltip は
  `loaded` を読んでいるので `hasKifu` に張り付いたまま——**バッジは消えているのにツールチップには
  手番と手数が出る**という食い違いが、型でもテストでも落ちずに残る。

### [MEDIUM] r3-13 spec の「失敗の見せ方」が、同じ節の冒頭と矛盾し、実際に差し替わるヘッダを書いていない

- 場所: `docs/spec/screens/app-layout.md:104`, `:113-124`, `:126-133`
- reviewer: robustness / oss-hygiene（2人）
- 根拠: (a) 同じ H2 の1行目が「シェル自体は失敗しない」で、9行下に「この画面は何も出さない」失敗が来る。
  r2 の計画は「別の段落にする」としたが、**冒頭の断言が残った。**
  (b) E16 では `selectedNode` / `jkfData` が新しい棋譜へ移るので、**ヘッダのファイル名と
  盤の対局者名は新しい棋譜のものに差し替わる**（#434 の混合画面）。仕様は「盤は前の棋譜のまま残る」
  としか書いていないので、見出しは信用できると読める。
  (c) 「いま満たしていないこと」に #434 が無い（`docs/spec/README.md` は issue 番号つきと定めている）。

### [MEDIUM] r3-14 `board-loading` を `docs/IDEAS.md` の SCSS の節へ送ったのは行き先が誤り。`docs/spec/screens/board.md` が到達しない状態を実在として書いたまま

- 場所: `docs/IDEAS.md:77-79,95-99`、`docs/spec/screens/board.md:40`
- reviewer: robustness
- 根拠: 節の見出しは「SCSS の既存の負債」だが、6件目は SCSS ではない（到達不能な分岐と嘘の仕様）。
  出どころも r1 ではなく r2-10 の付随。
- なぜ問題か: **`board.md:40` は P0「盤が組めない → 「盤面を読み込み中...」」を実在する状態として
  表に載せている。** #434 の直しに着手する人はまずこの画面仕様を読み、「盤が組めないときには既に
  文言が出る」と読む。行き先を SCSS の山にしたことで、`docs/spec/` を検索する人に届かない。

### [MEDIUM] r3-15 `docs/IDEAS.md` の SCSS の節が「5件」と名乗ったまま6件になり、6件目だけ出どころの報告書が違う

- 場所: `docs/IDEAS.md:78`
- reviewer: oss-hygiene
- 根拠: 箇条書きは6つ。6件目の出どころは r2。この1文が「どこから来た負債か」を示す唯一の記録。

### [MEDIUM] r3-16 `?pov` の符号化が `shared/lib/router` と `features/board-orientation` に割れているのに、feature の doc が「知っているのはここだけ」と宣言している

- 場所: `src/features/board-orientation/model/useBoardOrientation.ts:7`、`src/shared/lib/router/useURLParams.ts:13-20,44`
- reviewer: architecture
- 根拠: `"gote"` という文字列を持っているのはこの2ファイル。「既定は値の欠落で表す」という同じ理由も2回書かれている。
- なぜ問題か: 向きの表現を増やすとき、feature の doc を読んだ人は feature 側と `PovType` だけを直す。
  `useURLParams` の `povRaw === "gote"` は union が広がっても代入可能なままなので **tsc が落ちず**、
  新しい値は URL に書かれた直後に `undefined` へ潰れる。

### [MEDIUM] r3-17 `entities/search` の barrel は41個を公開していて、外に読み手があるのは6個。`entities/game` の context にも呼び出し元0の口が5つ残る

- 場所: `src/entities/search/index.ts`、`src/entities/game/model/types.ts:255,259,260,268,269`
- reviewer: architecture（2件を1つにまとめた）
- 根拠: `EVT_*` 7つ、`searchPosition` / `searchPositionBestEffort` / `cancelSearch` / `listenSearchEvents`、
  型の大半は外の読み手0。`entities/game` は `setCurrentComments` / `isAtStart` / `isAtEnd` /
  `getCurrentMove` / `getCurrentComments` が0。
- なぜ問題か: r1-07 と r2-16 が「呼び出し元0の公開面を閉じる」を2回適用したのに、
  **同じ規則が同じファイルの残りに当たっていない。** 次に読む人は残ったものを
  「使われている前提の API」と読む。

## 重複・矛盾した所見

- **r3-01 / r3-02 / r3-10 は同じ doc ブロック（`hasKifu`）に対する3方向の指摘。**
  r3-02（`player` と `shogi` は同値）を直すと r3-01 の書き方も決まる
- **r3-04 と r3-05 は同じ根**（表に「決めてある」と「見ていない」を分ける記法が無い）
- **r3-06 は2人が独立に到達。** しかも**既存の検査の穴**なので、機械側を直せば同種は今後落ちる
- **r3-13 は2人。** (b) の指摘は #434 の内容と重なるが、**spec に書いていないこと**が所見
- **矛盾は無い。** perf の「所見なし」は他と食い違わない

## 見ていない範囲

- Rust 側は誰も読んでいない（この差分は Rust を1行も触っていない）
- `docs/state-transitions/` の他の表の本文（`app.md` / `game.md` / `file-tree.md` / `search.md`）
- `docs/spec/screens/` は `app-layout.md` 全文・`board.md` 前半・`navigation-map.md` の該当節のみ
- SCSS は1行も読んでいない。`docs/IDEAS.md` の SCSS 5件の**内容**の正しさは3ラウンドとも未確認
- 実機で E16・購読の失敗・改名を踏んでいない。すべてコードの読み
- reviewer は変異を当てていない（ファイルを書き換えないため）

## lint / hook で強制できるもの

- **r3-06 は既存の検査の穴。** `lineNumberRefsIn` の綴りに「バッククォートの中身が `:\d+` で始まる形」を
  足せば落ちる。`03:00` は `^[#:]` に当たらないので既存の除外は保たれる
- **r3-04 / r3-05 は機械で拾える。** 「遷移を書いたセル（`→` を含む）に ✓ が無く、かつ
  『埋まっていないセル』の表にも居ない」を落とす走査。**r1-04 / r2-07 / r3-04 と3ラウンド続けて
  同じ class の所見が出ている**ので、ここを機械に渡す価値がある
- **r3-17 は `sliceBarrels.test.ts` の `publicModules()` を再利用して走査できる。**
  r1・r2・r3 の「lint / hook」欄が3回続けて挙げているが、まだ入っていない
- r3-01 / r3-02 / r3-03 / r3-11 / r3-12 / r3-16 は機械では防げない

## 修正計画（r3 → r4）

### 対象そのものを疑ったか

**`docs/state-transitions/board-orientation.md` が3ラウンド連続で所見の最多**（r1: 5件 / r2: 7件 / r3: 7件）。
r2 の計画は「r3 でまた集まったら、表を作り直すか落とすかを判断する」と書いた。**判断する。**

集まっている理由は3ラウンドとも同じ形だった:

| ラウンド | 所見                         | class                            |
| -------- | ---------------------------- | -------------------------------- |
| r1-04    | `(B0, E3)` が実在しない経路  | セルの主張と現物の食い違い       |
| r2-07    | `(B2, E4/E5/E9)` の ✓ が過大 | ✓ の主張と現物の食い違い         |
| r3-04    | `(B2, E3)` の取りこぼし      | ✓ の**不在**が一覧に載っていない |

**表を作り直しても落としても、この class は消えない。** 消えるのは機械が見たときだけ。
`state_transition_cells.rs` は `game-session.md` 決め打ちで、この表は3ラウンドとも人の目だけで守られてきた。

**落とす案: 表を作り直すのではなく、表に機械を掛ける。** TS 側に走査を1本足し、
「遷移（`→`）を書いたセルに ✓ が無いなら、『埋まっていないセル』の表に居ること」を要求する。
これで r1-04 / r2-07 / r3-04 の class は次から機械が落とす。**順の2に置いた。**
（`state_transition_cells.rs` を走査に変える案は、`game-session.md` と同じ列形式への作り直しが前提で
この PR の範囲を超える。TS 側の1本で今回の class は閉じる）

### 束（同じ根から出ている所見）

- **`hasKifu` の doc**: r3-02（`player` と `shogi` は同値）→ r3-01（`Hand` の記述）→ r3-10（テストの doc）。
  r3-02 を直すと残り2つの書き方が決まる
- **表の記法**: r3-04（取りこぼし）と r3-05（`—` の二義性）は同じ根。**機械（順2）を先に入れてから**
  埋めると、埋め漏れも機械が言う
- **spec の腐り**: r3-13 の3点（冒頭の断言 / ヘッダの差し替え / #434 の番号）は同じ節
- **IDEAS の行き先**: r3-14（`board-loading` は SCSS ではない）と r3-15（件数と出どころ）は同じ節

### このラウンドで直すもの

| 順  | 所見                         | なぜこの順か                            | この直し方で壊しうるもの                                                                                                                              |
| --- | ---------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | r3-06 裸の行番号＋検査の穴   | 機械で強制できるものが最初              | `lineNumberRefsIn` を広げると、**既存の doc で拾われていなかった綴りが一斉に赤くなる。** 走らせて件数を数える                                         |
| 2   | **表に走査を掛ける（新規）** | 機械。3・4 の埋め漏れをその場で言わせる | 走査が厳しすぎると、意図的に空けたセルまで赤くなる。**「遷移を書いたセル」だけを対象にする**                                                          |
| 3   | r3-04 `(B2, E3)` を埋める    | 2 の後。埋め漏れは機械が言う            | 2度押しのテストを足すと `openAndRotate` の前提（1回押した状態）が変わる。ヘルパを共有せず独立に組む                                                   |
| 4   | r3-05 `—` を2記号に割る      | 3 と同じ表。記法を変えるので後          | 記号を増やすと**既存の全セルを見直すことになる**。`×` は `(B0, E3)` の1つだけになることを確かめる                                                     |
| 5   | r3-02 `hasKifu` の式と doc   | 束の先頭。6・7 を決める                 | `!!player?.shogi` を `!!player` に縮めると、**`cursorView` の catch を将来ゆるめたときの保険が消える。** 縮めない                                     |
| 6   | r3-01 `Hand` の記述          | 5 の後                                  | `Hand` に門番を足す側を選ぶと、盤の内側の描画条件が変わる。**doc を現物に合わせる側を選ぶ**                                                           |
| 7   | r3-10 テストの doc           | 5・6 の後。同じ語に揃える               | 揃えるだけ                                                                                                                                            |
| 8   | r3-03 `catch` の `cancelled` | 失敗経路と門番                          | ガードを足すと、**購読が reject したときに `isListenSettled` が真にならない回ができる**——それは畳まれた回だけで、生きている回は別に走ることを確かめる |
| 9   | r3-12 `hasBadges` の重複     | 独立                                    | `hasBadges` を落とすと `AppLayoutHeader` の読み手が変わる。tooltip の `loaded` も同時に寄せる                                                         |
| 10  | r3-07 `(B1, E1)` の理由      | 表の残り                                | 「観測できる」と書いたら埋める責任が生じる。**埋める側を選ぶ**（6行で書ける）                                                                         |
| 11  | r3-08 ※1 の経路              | 表の残り                                | 経路を差し替えても結論（B0 ではボタンが無い）は変わらないことを明記する                                                                               |
| 12  | r3-09 E2 の発生源            | 表の残り                                | `closeActiveKifu` に呼び出し元が無いことを書くと、**それ自体が r3-17 の対象に見える。** 触らないことを書く                                            |
| 13  | r3-13 spec の3点             | 独立                                    | 冒頭の断言を限定すると、エラー境界の節の位置づけが変わる。境界の話だと明示する                                                                        |
| 14  | r3-14 + r3-15 IDEAS          | 13 の後。#434 の周辺を触ってから        | `board-loading` を SCSS の節から出すと、**節の件数がまた合わなくなる。** 数を書かない形にする                                                         |
| 15  | r3-11 複製の復活             | 最後。他の修正で本文が動き終わってから  | テストの doc を削りすぎると、何を見ているかが読めなくなる                                                                                             |
| 16  | r3-16 「符号化はここだけ」   | 最後。doc だけ直す                      | `PovType` を動かす側は選ばない（範囲外）。**doc から「ここだけ」を落とす**                                                                            |

### 直さないもの

| 所見                                  | 行き先          | 理由                                                                                                                                                          |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r3-17 barrel と context の呼び出し元0 | `docs/IDEAS.md` | r1-07 / r2-16 が閉じたのは**このブランチが呼び出し元を0にした口**。残りは変更前から0で、この差分は触っていない。閉じるなら走査ごと入れるべきで、それは別の PR |
| r3-16 の `PovType` の置き場そのもの   | `docs/IDEAS.md` | `ModalType` が上位層の名簿を持っている件と同じ形で既に載っている。doc の主張だけこの PR で直す                                                                |

### 次ラウンドの焦点

1. **足した走査（順2）が、表の他のセルを誤って赤くしていないか。** 意図的に `—` にしたセルを
   「遷移がある」と読んでいないか
2. **`(B2, E3)` のテストを足したことで、`openAndRotate` を使う既存4件の前提が変わっていないか**
3. **`—` を2記号に割ったことで、表の全セルの記号が正しく振り直されているか**
4. **`catch` に `cancelled` を足したことで、購読が reject したときに `open_project` が
   飛ばなくなる経路ができていないか**（r2-08 で直したばかりの挙動）
5. **`hasBadges` を落としたことで、ヘッダの3択（無し / 「棋譜表示中」/ 対局者名）が変わっていないか**
6. **4ラウンド目にして、まだ「doc の主張と現物の食い違い」が出るか。**
   出るなら、この差分の doc の量そのものを疑う段に来ている

### 検証の見積り

直すもの16件。`docs/state-transitions/` を触るのは 3・4・10・11・12 の5件と、走査を足す 2
（`src/__tests__/` なので `verify` のみ）。`verify:rust` が走るのは5件で約11分。
残り11件は `verify` のみ（約8秒）。**合計およそ13分。**
