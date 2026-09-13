# レビュー 502-engine-never-returns ラウンド1

- 日付: 2026-09-08
- 範囲: `fix/441-stop-analysis-on-unmount...HEAD` の差分（`src/entities/analysis/model/` の3ファイルと `docs/` の3ファイル）
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `05cf53f2`

## 所見

### BLOCK-1 `no-engine` にも終端があり、#502 の症状がそのまま残る（react / robustness / comment / oss-hygiene の4本が独立に指摘）

`entities/engine-presets` の `runtimeConfig` は3つの口で null になる——プリセット未選択、`aiRoot` 無し、
必須欄（`aiName` / `enginePath` / `evalFilePath`）が空。どれも解析中に設定タブから踏める。
null になると `EngineProvider` の effect は `shutdown()` を撃って `return` し、
**以後 `initialize` を呼ぶ口が1つも無い**（`entities/engine/model/provider.tsx` の `if (!desiredRuntime)` の枝）。
`phase: "idle"` ＋ `desiredRuntime: null` の理由は `no-engine` なので、新しい effect は
`notReadyReason !== "failed"` で降り続ける。**「解析中」の丸とタイマーが回り続ける。**

しかも `analysis.md` の不変条件2 と ※5 は「まだ破れるのは `starting` のまま戻らない回」と
**断言している**ので、次に読む人はこの経路を塞がっていると読む。

### BLOCK-2 「`no-engine` は健全な起こし直しの途中に観測される」は現物では起きない（oss-hygiene / robustness が実測）

両者が本物の `EngineProvider` を張って `notReadyReason` の commit 列を取った。

| 経路                             | commit された理由の並び                          |
| -------------------------------- | ------------------------------------------------ |
| 起動                             | `no-engine` → `starting` → `ready`               |
| runtime を変えて restart（成功） | `starting` → `ready`（**`no-engine` は出ない**） |
| 同上（`shutdown` が reject）     | `starting` → `no-engine` → `starting` → `ready`  |
| 初期化が落ちる（同じ設定）       | `no-engine` → `starting` → `failed`              |

`shutdown` の dispatch と `initialize_start` の dispatch は隣り合う microtask なので、
正常な `restart()` では1レンダに畳まれて `phase: "idle"` が commit されない。
**判断の結論（`no-engine` で断たない）はかろうじて保つが、書いた根拠が偽。**
`provider.tsx` のコメント・`analysis.md` の ※5 の表・コミットメッセージの3箇所に同じ嘘が入った。

実際に `no-engine` が立つのは2つだけ——**`shutdown` の invoke が落ちた回**（終端でない。
`idle` の枝が起動し直す）と、**`desiredRuntime` が null になった回**（終端。BLOCK-1）。

### HIGH-3 「候補手も消える／画面は空になる」は現物と逆（react / comment / robustness / oss-hygiene）

`AnalysisPane` は `isAnalyzing` が false なら `state.candidates` を**一切見ず**、局面ごとの
キャッシュを出す。落ちる直前の1本はその局面の鍵で既に焼き付いているので、
`clear_results` を撃っても**盤を動かすまで同じ候補手が出続ける**。
鍵の `engineKey` は `selectedPresetId` で、#502 の引き金（同じプリセットのオプションを変えて保存）では動かない。

したがって `analysis-pane.md` の「**候補手も消える**（画面は空になるだけ）」と
`refusals.ts` の「出ていた候補手も消えた」は嘘。`provider.tsx` のコメントの
「停止中のペインはそれを合法手として描き続ける」も逆（停止中は描かない）。

**issue #502 の受け入れ条件は満たしている**——破れていたのは `isAnalyzing` が true のまま
`pvBaseSfen = state.analyzedSfen` で**別の局面**の読み筋が新しい盤の下に描かれる経路で、
そこは `isAnalyzing` を倒したことで閉じた。残るのは「同じ局面のキャッシュが出る」ことで、
これは仕様の N1（停止中・結果あり。**古い可能性がある**）そのもの。**嘘なのは doc の側。**

### HIGH-4 不変条件2 から「プロセスが落ちただけの回」の穴が消えた（comment）

書き換えた不変条件2 は「まだ破れるのは `starting` のまま戻らない回」と排他的に書いている。
だが同じファイルの ※5 の後段が「プロセスが落ちただけの回はフロントの4つの欄が1つも
変わらないので `isReady` は true のまま」と書いており、その回は新しい effect の
`if (isReady) return` で必ず降りる。**穴を1つ数え落とした。**
`analysis-pane.md` からは旧行「エンジンが落ちた → 「解析中」の表示が残ることがある」を
削除してしまったので、spec からもこの経路が消えた。

### HIGH-5 終端の判定が `!== "failed"` のリテラルで、理由が増えても tsc が止めない（architecture / react / robustness）

このリポジトリは同種の判断を必ず型に守らせている（`NOT_READY_REFUSALS` の
`Record<EngineNotReadyReason, string>`、`useEngineSeat` の `_EveryPointIsAssigned`）。
ここだけが不等号で、`EngineNotReadyReason` に4つ目が増えると黙って「終端でない」側に落ちる。
`provider.test.tsx` も理由の語彙を手で写している（`"no-engine" | "starting" | "failed" | null`）ので止まらない。

### HIGH-6 `failure-surfacing.md` の裸の `※5` が、同じファイルの `※5` に当たる（oss-hygiene / comment）

同じセルの直前は `[analysis.md](analysis.md) の ※9 / ※15` と表を添えているのに、
続きだけ裸で書いた。この台帳には自前の `※5`（F-12a）が実在し、しかも台帳自身が
冒頭で「**記号だけで書かない。どの表かを添えること**」と規約を置いている。

### MEDIUM-7 コメントに変更の経緯が入っている（comment）

- `provider.tsx` 「どちらかで断つと、**#441 が入れた**「戻ってきた回に張り直す」を毎回殺す」
- `provider.test.tsx` 「**これが盤の下に残り続けるのが #502。**」
- `analysis.md` 「**時間で切る案は採らなかった**（#502 の案 A）」

`useEngineSeat.ts` の `#463 の窓` は**失敗の形の名前**として issue を指しているのに対し、
これらは「誰がその振る舞いを入れたか」「この PR が直した症状」で、CONTRIBUTING の禁止に当たる。

### MEDIUM-8 同じ理由が3箇所に写されている（comment）

`provider.tsx` の14行・`analysis.md` の ※5・`refusals.ts` の TSDoc が、
「`failed` が終端である理由」「`starting` / `no-engine` が終端でない理由」「候補手を落とす理由」を
ほぼ同じ文で持っている。**BLOCK-2 と HIGH-3 の嘘が、まさにこの形で同時に3箇所へ入った。**
`analysis.md` の ※12 は同種の判断について「**この理由をここに1つだけ置く**」と明文化している。

### MEDIUM-9 断ち切りの後始末が2通りに割れ、`stop_analysis` を明示していない（architecture）

「読む局面が無くなった」回は `stop_analysis` を明示的に dispatch するのに、新しい effect は
`set_error` の副作用（`reducer.ts` が `isAnalyzing: false` を書く）に任せている。
他の停止経路（同期の打ち切り・自動再開の失敗）はどちらも両方を撃つ慣行。

### MEDIUM-10 席の着地の断りだけが理由を見ていない（architecture）

`landed === "engine-gone"` は理由を問わず `ENGINE_RESTARTED_MESSAGE`（「もう一度 ▶ を押してください」）を出す。
終端的に落ちた回にここを踏むと、押しても始まらない案内を1回挟む。
**この変更で入った欠陥ではない**が、「終端かどうかで案内を変える」という規則を持ち込んだ結果、
この1箇所だけがその規則の外に残った。

### MEDIUM-11 `F-2` の3分類が ※15 と割れたまま拡張された（oss-hygiene）

F-2 の「復帰導線」は前置きの門を丸ごと「エンジンを選ぶ／起動を待つ」に入れているが、
そのうち `ENGINE_FAILED_MESSAGE` の次の一手は「起こし直す」。
**同じ「起こし直す」で終わる2本が別の群に散る。**

### MEDIUM-12 spec の新2行だけ `F` 番号を持たない（oss-hygiene）

同じ表の既存5行は全て `→ F-7` などで終わる。1行目は F-2 そのもの（台帳側からは繋いだのに片道）。
2行目（`starting` / `no-engine` のまま止まる回）は**台帳に対応する行が1本も無い**。

## 重複・矛盾した所見

- **BLOCK-1 / BLOCK-2 は同じ根**（`no-engine` の意味が2つに割れている）。直し方も1つ——
  engine 側で理由を割る。react は `starting` の条件へ `phase: "idle"` かつ `desiredRuntime` 非 null を
  足す形を、robustness は理由そのものを増やす形を挙げた。**前者を採る**（理由の語彙は増やさず、
  `no-engine` を「選んでいない」だけの意味に戻す。`NO_ENGINE_SELECTED_MESSAGE` の文言とも一致する）
- **HIGH-3 の直し方で2案が対立**。(a) キャッシュの鍵にエンジンの世代を混ぜて画面からも消す、
  (b) 現物のまま doc とコメントを直す。**(b) を採る**——(a) は「停止中はキャッシュを出す」という
  ペインの仕様（N1）を #502 の都合で変えることになり、`state.error` の読み手が0である以上
  画面の情報量は増えない。読み手を作るのは #277 / ADR-0004 の仕事
- robustness が A 案（時間で切る）不採用の**補強材料**を出した。Rust 側の初期化に上限がある
  （`SPAWN_TIMEOUT` 10s / `USI_OK_TIMEOUT` 30s / `WRITE_TIMEOUT` 2s）ので、`starting` のまま
  永久に戻らない回は現物では踏みにくい。※5 の「残る穴」の書き方をこれに合わせる

## 見ていない範囲

- **perf-reviewer は走らせていない。** この変更はループもデータ変換も IO も足しておらず、
  effect 1本で走っている処理を止める側なので、当てる面が無いと判断した
- `ui-reviewer` / `rust-reviewer` も同じ理由で走らせていない（`.scss` と `src-tauri/` に差分が無い）
- **実プロセスでの確認は1件も無い。** 全ての実測は happy-dom ＋ `engineInitializer` の mock 越し
- `docs/state-transitions/app.md` の `(A5, E8)`「解析中にエンジンが落ちる」への追従の要否
- `provider.test.tsx` の既存テスト全体（今回足した3本と、E6 の周辺のみ読んだ）

## lint / hook で強制できるもの

- **HIGH-5 は型で止まる。** `Record<EngineNotReadyReason, ...>` の形にすれば、理由を1つ足した
  瞬間に `tsc -b` が分類を迫る。いまの不等号は値が増えても黙って通る
- **HIGH-6 は検査できる。** `failure-surfacing.md` の中で、直前に `〜.md の` を伴わない `※\d+` を落とす
- `provider.test.tsx` が理由の語彙をリテラルで写している形は、`analysisRefusals.test.ts` と
  同じ手（`types.ts` の union を走査して、テストに同じ集合が書き下ろされていないことを要求）で止まる
- **BLOCK-1 / HIGH-3 / HIGH-4 は機械では防げない。** どれも「コードを読んで得た事実」と
  「doc の散文」の突き合わせで、鍵が無い。`entities/engine` に `__tests__` を1つ作り、
  理由の並びを固定するのが唯一の歯止め（`engine.md` が自分で穴として挙げている）

## 修正計画（r1 → r2）

### 束（同じ根から出ている所見）

- **理由の語彙**: BLOCK-1 → BLOCK-2 → HIGH-5。`no-engine` が「選んでいない」と
  「`idle` で初期化待ち」の2つを兼ねているのが根。engine 側で意味を割れば、
  BLOCK-2 の「根拠が偽」は指摘箇所ごと書き直しになり、HIGH-5 の表もその上に載る
- **doc の嘘**: HIGH-3 → HIGH-4 → MEDIUM-11 → MEDIUM-12。どれも
  「※5 と不変条件2 と spec と台帳が同じことを言っているか」の1点に落ちる
- **コメント**: MEDIUM-7 → MEDIUM-8。経緯を落とすときに重複も落ちる

### 対象そのものを疑う（手順4）

所見が `notReadyReason` の1点に集まっている（BLOCK-1 / BLOCK-2 / HIGH-5 / MEDIUM-10 の4件）。
**機構を落とす案はない**——理由の語彙そのものは #441 が入れた必要なもので、
issue #502 もそれを前提にしている。集約する先は engine 側の1つの表。
**同じ判断をする場所は現在4箇所**（▶ の前置きの門・同期待ちの打ち切り・席の着地・今回の effect）で、
そのうち席の着地だけが理由を見ていない（MEDIUM-10）。**今回は集約せず、issue に出す**
——「席の着地でどの断りを出すか」は文言の設計判断が絡み、#502 の受け入れ条件には入っていない。

### このラウンドで直すもの

| 順  | 所見                                          | なぜこの順か                                                                  | この直し方で壊しうるもの                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | BLOCK-1 / BLOCK-2（engine 側）                | 機械（型）を入れる前に、判定に必要な情報を理由が持つようにする。他の3件の土台 | `phase: "idle"` かつ `desiredRuntime` 非 null の窓の理由が `no-engine` → `starting` に変わる。**▶ をその窓で押した人への断りが `NO_ENGINE_SELECTED_MESSAGE` から `ENGINE_STARTING_MESSAGE` に変わる**（案内としては正しくなる）。`useEnginePositionSync` は `isReady` しか読まないので影響なし |
| 2   | HIGH-5（型で守る）                            | 手順3-1。人の注意に頼る修正より先                                             | `Record<EngineNotReadyReason, string \| null>` を足すと `analysisRefusals.test.ts` の「対応表の値は登録済みの断りだけ」が `null` を値名として拾う。**`PARTS` に表名を足す必要がある**（`NOT_READY_REFUSALS` と同じ扱い）                                                                       |
| 3   | BLOCK-1（analysis 側）                        | 1 と 2 の上に載る本体                                                         | `no-engine` でも断つようになるので、**`shutdown` の invoke が落ちた回**（`starting` に変わっているので断たない）と**起動直後**（`isAnalyzing` が false なので降りる）の2つが誤爆しないことを、テストで固定してから入れる                                                                       |
| 4   | MEDIUM-9（`stop_analysis` を明示）            | 3 と同じ effect を触るので直後に                                              | 無い（`set_error` が既に `isAnalyzing` を倒しているので、状態は1ビットも変わらない）。**変わるのは意図の見え方だけ**                                                                                                                                                                           |
| 5   | HIGH-3 / HIGH-4（※5・不変条件2・spec）        | 実装が固まってから doc を合わせる。逆順だと2回書く                            | doc のみ。`analysisRefusals.test.ts` は ※15 の節しか見ないので、※5 と不変条件2 を触っても緑のまま——**赤で気づけない。人が読んで確かめるしかない**                                                                                                                                              |
| 6   | HIGH-6 / MEDIUM-11 / MEDIUM-12（台帳と spec） | 5 と同じ「doc の整合」の束。分けるのは触るファイルが違うから                  | `failure-surfacing.md` の F-2 を「対応は ※15 の表」に寄せると、**台帳だけを読む人が枝を辿れなくなる**。※15 へのリンクを必ず残すこと                                                                                                                                                            |
| 7   | MEDIUM-7 / MEDIUM-8（コメント）               | 最後。本体が動いている間に削ると、削った理由がどれか分からなくなる            | 削りすぎると「世代を先に上げる理由」「`clear_results` の後に `set_error` を撃つ理由」が消える。**この2つはここでしか読めない**ので残す                                                                                                                                                         |

### 直さないもの（行き先）

| 所見                                                       | 行き先                         | 理由                                                                                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MEDIUM-10                                                  | **issue**                      | 席の着地の断りに理由を見せるかは**文言の設計判断**（`/implement` 手順7 の「直し方に判断が要る」）。この変更で入った欠陥ではなく、#502 の受け入れ条件にも入っていない                                 |
| HIGH-3 の (a) 案（キャッシュの鍵にエンジンの世代を混ぜる） | **見送り。報告書に反論を書く** | ペインの N1「停止中はキャッシュを出す」は仕様として決まっている。#502 の都合でそれを変えても、`state.error` の読み手が0である以上**画面の情報量は増えない**。読み手を作るのは #277 / ADR-0004 の仕事 |
| `EngineTab.tsx` の `console.log`（robustness が記録）      | **`docs/IDEAS.md` に1行**      | 範囲外の既存の汚れ。6週間以内に着手しない                                                                                                                                                            |

### 検証のコスト（手順7）

直すのは7件。ただし **1所見1コミットを守ると、型の追加（順2）だけでは `tsc` が
「未使用」で落ちる**ので、順2と順3は1コミットに畳む（同じ根＝BLOCK-1 の本体）。
実コミットは6本。`src/` と `docs/` だけなので Rust の検証は走らない。
`npm run verify` の実測は今回 **6分46秒**（1回）。6本で 40 分前後を見込む。
**件数は減らさない**——BLOCK が2件あり、次のラウンドへ送れるものが無い。

## 修正の結果（`/review-fix`）

| 所見                                             | 結果                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| BLOCK-1 / BLOCK-2                                | 直した（`65c69efa` + `983e9fdd`）。engine 側で `no-engine` を `desiredRuntime` の有無だけに絞り、解析側は表で断つ          |
| HIGH-5                                           | 直した（`983e9fdd`）。`WHILE_ANALYZING_REFUSALS: Record<EngineNotReadyReason, string \| null>`。テストの語彙の写しも消した |
| MEDIUM-9                                         | 直した（`983e9fdd`）。`stop_analysis` を明示                                                                               |
| HIGH-3 / HIGH-4 / HIGH-6 / MEDIUM-11 / MEDIUM-12 | 直した（`b8070cb9`）。ただし **HIGH-3 は doc 側を現物に寄せた**（下の反論）                                                |
| MEDIUM-7 / MEDIUM-8                              | 直した（`983e9fdd` に同梱）。経緯の3箇所を落とし、`provider.tsx` の14行を ※5 と engine.md ※7 への参照に削った              |
| MEDIUM-10                                        | **直さず #510 へ**                                                                                                         |

**変異を当てて確かめたもの**——理由の三項を元に戻すと engine の2本が落ちる。
`WHILE_ANALYZING_REFUSALS` の `no-engine` を `null` に戻すと「選択が外れたら断る」が落ちる。
表を全部 `null` にすると `analysisRefusals` が落ちる。効果を外す3つの変異
（effect を素通し・`supersedeRequests` を抜く・`discardShownResults` を抜く）も、
それぞれ意図したテストだけが落ちた。

### 反論（直さなかったもの）

**HIGH-3 の (a) 案（キャッシュの鍵にエンジンの世代を混ぜて画面からも消す）を採らない。**
ペインの N1「停止中はキャッシュを出す」は画面仕様が決めていることで、
#502 の都合で変えるものではない。しかも `state.error` の読み手が0である以上、
候補手を画面から消しても**利用者に届く情報は1ビットも増えず**、「解析中の丸が消えた」
以上のことは分からないままになる。読み手を作るのは #277 / ADR-0004 の仕事。
**doc を現物に寄せる側で閉じた**——嘘だったのは doc であって、実装ではない。

**#502 の受け入れ条件は満たしている。** 破れていたのは
「`isAnalyzing` が true のまま `pvBaseSfen` が前の局面を指し、**別の局面**の読み筋が
新しい盤の下に合法手として描かれる」経路で、そこは `isAnalyzing` を倒したことで閉じた。
盤を動かさない限り出続けるのは**その局面自身の**候補手で、これは停止中の通常の見え方。

### 次ラウンドの焦点（次の `/review-round` に渡す）

1. **理由の意味を割ったことで、`starting` 側に落ちた窓が本当に戻ってくるか。**
   特に `shutdown` の invoke が落ちた回。`entities/engine` に新設するテストが
   その並びを固定できているか（mock の作り方が本物の遷移を再現しているか）
2. **`no-engine` で断つようになったことで、起動直後や棋譜を開いた直後に誤爆しないか。**
   `isAnalyzing` の門だけで足りているか
3. **doc の4ファイル（※5・不変条件2・spec・台帳）が互いに矛盾していないか。**
   特に「まだ破れる回」の数え上げが3箇所で一致しているか（プロセス死・`starting` のまま・
   それ以外があるか）
4. **削ったコメントで、ここでしか読めない理由が消えていないか**
