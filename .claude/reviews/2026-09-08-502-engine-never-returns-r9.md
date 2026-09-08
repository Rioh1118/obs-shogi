# レビュー 502-engine-never-returns ラウンド9

- 日付: 2026-09-09
- 範囲: `fix/441-stop-analysis-on-unmount...HEAD`
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `8fa6dba9`
- 前ラウンド: [r1](2026-09-08-502-engine-never-returns-r1.md) 〜 [r8](2026-09-08-502-engine-never-returns-r8.md)

**変異を当てたのは robustness だけ**（r8 と同じ取り決め）。r7 のような「実測が信用できない」の申告は今回も0件。

## このラウンドで分かった一番大きなこと

**r8 で私が入れた修正が、#502 と同じ症状を新しく1つ作っていた。**

r8 の MEDIUM-7（react）は「StrictMode で `initialize` が2回走る」だった。
私はそれを `startingRef`（bool）で塞いだ。**その門が、畳む回と重なると永久に降りない。**

3人の所見が1点へ集まった経緯:

| reviewer     | 何を言ったか                                                                                |
| ------------ | ------------------------------------------------------------------------------------------- |
| architecture | 「`startingRef` が true のまま `phase` が `idle` になると二度と起動しない」——**危険を特定** |
| react        | 「取りこぼす窓は作れなかった」——**逆の結論**。`shutdown` を1本しか考えなかった              |
| robustness   | **2本目の `shutdown` で開くことを実測**（本物の initializer を通した）                      |

react が外したのは、`YaneuraOuInitializer.shutdown()` が `await` の**前**に
`inFlight` を null にするため——**2本目の `shutdown` は飛んでいる起動を待たない**。
私も `initializer.ts:32-33` を読んで確認した。

## 所見

### BLOCK-1 再入の門が畳む回と重なると降りず、エンジンが二度と起動しない（robustness が実測 / architecture が独立に特定）

`startingRef` は `initialize` 自身の `finally` でしか降りない。踏む筋:

1. 起動が遅い（評価関数が大きい）状態で、適用中のプリセットを削除
   → 保存の往復で `runtimeConfig` が `null` を通る（#518 の窓）→ `shutdown()` A
2. `shutdown` A が `inFlight` を **null にしてから**待つ
3. もう1枚消す → `shutdown()` B。**B が見る `inFlight` は既に null なので待たずに戻り**、
   `phase` を `idle` に落とす。**この時点で `startingRef` はまだ true**
4. `desiredRuntime` が戻る → `idle` の枝 → `initialize()` → **門で即 return**。
   以後 `state` が動かないので effect も再実行されない

**このときの理由は `starting`（戻る側）** なので、この PR が入れた断つ effect は門で降りる。
**「解析中」の丸が回り続け、`state.error` も立たない**——#502 そのもの。
▶ を押すと「少し待ってからもう一度」と出るが、待っても永久に起動しない。

**実測**（本物の `initializer.ts` / `setup.ts` を通し、差し替えたのは `api/tauri` の invoke だけ）:

| 版                  | `initialize_engine`     | 最後の `notReadyReason`  |
| ------------------- | ----------------------- | ------------------------ |
| HEAD                | **1**（起動し直さない） | **`"starting"`**（永久） |
| 門の1行を消しただけ | 3                       | `null`（ready に着く）   |

**基底ブランチ側では着地していた。** `f6ded400` の門が原因。

同じ場所で、**`if (state.phase === "initializing") return false;` はもう到達しない**（architecture）。
門を ref に替えたとき、置き換えられた側が残っている。

### HIGH-2 `engine.md` ※7 の脚注が、同じ台帳の F-39 と正反対（oss-hygiene / comment が別の角度から同じ4行）

r8 で私が「直した」4行が、2つの意味で誤っている。

- **「畳めなかった原因が続いても `starting` のまま留まる」は成り立たない。**
  `phase: "error"` を作るのは `initialize_error` **だけ**で、`shutdown` は `idle` へ落ちる
  （`reducer.ts:34-42`）。その `idle` を effect が即座に拾って起こし直す。
  **矢印の先の F-39 は「どこかで `failed` へ落ちるはず」と逆を書いている**
- **「`failed` へ落ちるのは起動側の上限で折れた回」は狭すぎる。**
  `setupYaneuraOuEngine` の3段はどれも上限と無関係に `Err` を返す口を持つ
  （`registry.rs:136-143` のパス解決、`analyzer.rs:279-292`、`setup.ts:22`）。
  **実際にいちばん踏まれるのはパスが消えた回**で、`engine.md:41` の E6 が自分でそう書いている

**r8 で私が狭めたのが行き過ぎだった。** oss-hygiene が r8 で示した事実
（`shutdown` は常に `Ok`）は正しく、そこから私が引いた結論だけが誤り。

### HIGH-3 台帳が3箇所で「エンジン初期化の失敗は設定タブで見える」と書くが、読み手は0（robustness）

`EngineTab.tsx:29` が赤帯に出しているのは **`engine-presets` の**一覧の読み書きの失敗で、
`initialize_error` が積む `Engine initialization failed: ...` ではない。
`useEngine()` の呼び手は2つだけで、どちらも `isReady` / `notReadyReason` しか読まない。

利用者に起きること: **パスが間違っていても画面はどこも変わらない。**
▶ を押して初めて断りが出るが、その読み手も0（F-2 / #277）。
**「どのパスが無いのか」は最後まで一度も出ない**のに、復帰導線は
「オプションを変えて保存」——直す先が分からないまま撃つ操作になる。

しかも G-6 は**「すでに届いているもの」**の節に居るので、#277 を計画する人が
「出口ができている例」として読む。**この PR は F-9 の行を書き直している**（隣を通り過ぎたのではない）。

### MEDIUM-4 r8 で足した「安定性の assert」が、構造上どの変異でも赤くならない（react）

`:722` と `:728` は逐語コピーで、間の `advance` で `candidates` を動かせる経路が無い
——`cutRunningAnalysis` が `stop_analysis` を撃つので `analyzingRef` が false になり、
生き残ったタイマーが起きても `flushLatest` は先頭の門で降りる。

**r8 の報告書の「遅れて戻る形が在るなら毎回赤くなるようにした」は成り立たない。**
r4/r5 で自分に課した「名指しした assert が赤くなることまで見る」を、私が守らなかった。

### MEDIUM-5 「三項の並びと同じ順」が現物に無い構造を指す（comment / oss-hygiene）

三項はいま2枝しかない。表の `failed` / `starting` を割っているのは `reasonForPhase` の
`switch` で、その並びは **phase 順**（`starting` が先）——表の**理由順**とは軸が違う。
「順を変えるときは一緒に直すこと」が実行できない。

### MEDIUM-6 `retriesAfterError` の TSDoc「差が出るのは `lastTried` が無い1点だけ」が誤り（comment）

反転するのは**片方だけが `null` の2通り**。`(desired=null, lastTried=X)` は現物で到達する
（`provider.tsx:41` は `desiredRuntime` が null の回も毎描画で呼ぶ）。
いま観測差が出ないのは**呼び手が先に降りているから**で、述語の性質ではない。

### MEDIUM-7 engine provider テストの冒頭 doc「見るのは並びだけ」が、同じファイルの assert と食い違う（comment）

`initialize` / `shutdown` の呼び出し回数も固定している。とくに StrictMode の1本は
**回数だけ**を見て理由の並びを1つも見ていない。`engine.md:127` は正しく書けている。

### MEDIUM-8 `analysisRefusals` の「見るのは4つ」が、また合わない（comment / oss-hygiene）

検査は6本。漏れているのは「0件で黙らない」と「**表に文言を直書きさせない**」——
後者はこの検査で一番効いている枝。r8 で「2つ」を「4つ」に直したが、**数え直しではなく
別の誤った数に置き換わった**。`CLAUDE.md` の「件数をここに書かない」の実例になっている。

### MEDIUM-9 上限の綴りが4つの doc に写され、既に数が食い違っている（oss-hygiene）

`engine.md` は2つ、`analysis.md` は3つ（`WRITE_TIMEOUT` を含む）。
3つ目は実在する（`applyEngineSettings` → `SetOption` は `requires_ready` に入らない →
`run_writer` の `timeout(WRITE_TIMEOUT, ...)`）。
`engine.md` 自身が「入口をここに数え上げない」という規律を持っているのに、この事実だけが写っている。

### MEDIUM-10 `analysis.md` ※1 の1つ目の分類に、いま踏める口が1つも無い（oss-hygiene）

E12（`LISTENERS_FAILED_MESSAGE`、購読の失敗）も席に触らずに撃つし、**踏める**。
表の `(S0/P0, E12)` と F-4 が「起きる」側で数えているのに、※1 の5分類のどれにも載っていない。

### MEDIUM-11 F-38 / F-39 の出どころだけがコミット SHA（comment）

台帳の他の行は全てブランチ名。squash merge 後は `main` に存在しないハッシュになる。

### 差分の外（この PR では直さない）

- **MEDIUM-12** `entities/app-config` の barrel が、直後のコメントが禁じる口を自分で開けている
  （`loadConfig` / `saveConfig`。スライス外の呼び手は**0件**——確認済み）
- **MEDIUM-13** `PresetId` が `app-config` ↔ `engine-presets` の双方向依存を作っており、
  `engine-presets` には barrel が無いので `sliceBarrels` が見ていない

## 変異の結果（robustness。所見ではない）

- `reasonForPhase` の3変異（`ready` / `idle` / `initializing` → `failed`）は既存テストが捕まえた
- `cutRunningAnalysis` の新設2行は**両方とも効いている**（片方ずつ落とすと別のテストが落ちる）
- **effect の依存から `willRetryAfterError` を外しても、テストは1本も落ちない**
  ——コメントと ※7 が安全機構として名指ししている割に、効いている経路が無い

## r8 HIGH-1（flake）について

**robustness は29回（フル12回・単体を3並列×6回、CPU を埋めた状態）走らせて再現しなかった。**
r8 の仮説（`flushLatest` が `latestResultRef` を空けない）は `dropPendingResult` が空けるので
単独では成立しない、という判断を robustness も支持。別筋（テスト間で `listeners` が
前のインスタンスを指す）も見たが、それだと候補手は**0**になり症状と逆。

**機構は依然として不明。** 2ラウンド続けて再現できていない。

## 修正の結果（`/review-fix`）

| 所見                  | 結果                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| BLOCK-1               | `cc9a7408`。門を世代にし、`shutdown` が世代を上げる所で落とす。到達しない門も削除       |
| HIGH-2 / MEDIUM-5     | `b7668b4a`。※7 の脚注と「当たる順」を現物へ。上限の綴りは不変条件2 に寄せた（MEDIUM-9） |
| HIGH-3 / MEDIUM-11    | `4211dd83`。§1 を 0 に、F-9 を書き直し、G-6 を「届いている」節から外した                |
| MEDIUM-4              | `18401ee9`。効いていない assert を落とし、r8 の報告書に訂正の印                         |
| MEDIUM-6 / MEDIUM-7   | `2c05c558`                                                                              |
| MEDIUM-8 / MEDIUM-10  | `24648a77`                                                                              |
| MEDIUM-12 / MEDIUM-13 | `docs/IDEAS.md` へ（差分の外）                                                          |

**変異を当てて確かめたもの**——BLOCK-1 の門を bool へ戻すと、
`startGate.test.tsx` の**名指しした assert が**
`expected 1 to be greater than 1` で落ちる（robustness の実測 1 対 3 と同じ形）。
このテストは `engineInitializer` を差し替えず本物を通す。

## 見ていない範囲

- `perf` / `ui` / `rust` reviewer は9ラウンドとも走らせていない
- **実プロセスでの確認は9ラウンドを通して1件も無い**（BLOCK-1 の実測も JSDOM 上）
- 基底ブランチ側でも `analysis.md` が動いている。マージ時の衝突は見ていない
- `initializer.ts` にテストが1本も無い（`engine.md` の「埋まっていないセル」が言うとおり）
