# 状態遷移表: engine（L1）

対象: `src/entities/engine/model/provider.tsx` と `src/entities/engine/api/initializer.ts`、
および対応する Rust 側 `src-tauri/src/engine/bridge.rs`。

上位は [app.md](app.md)。局面の送信は [engine-position-sync.md](engine-position-sync.md)、
解析セッションは [analysis.md](analysis.md) が持つ。

## 状態（フロントエンド）

| 記号   | 状態     | 判定                                                            |
| ------ | -------- | --------------------------------------------------------------- |
| **S0** | 未起動   | `phase === "idle"`、`activeRuntime === null`                    |
| **S1** | 起動中   | `phase === "initializing"`、`initializer.inFlight !== null`     |
| **S2** | 起動済み | `phase === "ready"`、`engineInfo !== null`                      |
| **S3** | 失敗     | `phase === "error"`、`error !== null`、`activeRuntime === null` |

`isReady` は S2 と同義ではない。`desiredRuntime` と `activeRuntime` の一致まで見る
（`provider.tsx`）。**設定を変えた直後は S2 のまま `isReady === false`。**

## 外部の状態（Rust プロセス）

**この列を忘れたことが issue #120 の BLOCK だった。** 必ず並べる。

| 記号   | 状態                             | 判定                                                    |
| ------ | -------------------------------- | ------------------------------------------------------- |
| **P0** | プロセス無し                     | `analyzer` が未初期化                                   |
| **P1** | 起動処理中                       | `initialize_engine` が in-flight                        |
| **P2** | 生きている                       | `analyzer` が初期化済み                                 |
| **P3** | 生きているが解析セッションを保持 | `active_sessions` に席あり → [analysis.md](analysis.md) |

## イベント

| 記号   | イベント                                        | 発生源                                      |
| ------ | ----------------------------------------------- | ------------------------------------------- |
| **E1** | `desiredRuntime` が付く                         | プリセット選択（`EngineRuntimeBridge`）     |
| **E2** | `desiredRuntime` が外れる                       | プリセット未選択に戻す                      |
| **E3** | `desiredRuntime` が**別の値に変わる**           | プリセット切替・プリセットの編集            |
| **E4** | `desiredRuntime` が**同じ値のまま再設定される** | `selectedPresetVersion` の更新              |
| **E5** | 初期化が成功する                                | `setupYaneuraOuEngine` の resolve           |
| **E6** | 初期化が**失敗する**                            | 同 reject（パスが無い、評価関数が無い、等） |
| **E7** | 停止が成功する                                  | `shutdownEngine` の resolve                 |
| **E8** | 停止が**失敗する**                              | 同 reject                                   |

## 表

|           | E1 runtime が付く   | E2 runtime が外れる            | E3 別の runtime                  | E4 同じ runtime      | E5 初期化成功 | E6 初期化失敗 | E7 停止成功          | E8 停止失敗                                                                                    |
| --------- | ------------------- | ------------------------------ | -------------------------------- | -------------------- | ------------- | ------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| **S0/P0** | → S1 `initialize()` | —                              | → S1                             | —                    | —             | —             | —                    | —                                                                                              |
| **S1/P1** | 何もしない※1        | → S0 `shutdown()`              | **何もしない**※2                 | —                    | → S2/P2       | → S3/P0       | → S0                 | → S0 だが **P が不明**※3                                                                       |
| **S2/P2** | —                   | → S0 `shutdown()`              | → `restart()` = 停止してから起動 | **再起動しない**※4   | —             | —             | → S0/P0              | → S0 だが **P2 のまま**※3                                                                      |
| **S3/P0** | —                   | → S0 `shutdown()`              | → S1 再トライ※5                  | **再トライしない**※5 | —             | —             | → S0                 | → S0                                                                                           |
| **S2/P3** | —                   | 停止 → [analysis](analysis.md) | 再起動 → [analysis](analysis.md) | —                    | —             | —             | セッションも止まる※6 | **席は空く**（`shutdown_engine_impl` が先に `stop_all_sessions` を通す）。プロセスは残りうる※3 |

### 注

※1 `initialize()` は**世代の門**で早期 return する（`provider.tsx` の `startingSeqRef`）。
`state.phase` では割れない——描画のクロージャの値なので、同じコミットで setup が
2回走る回には `initialize_start` を撃った後でも `"idle"` のまま見える

※2 **`YaneuraOuInitializer.initialize` は `inFlight` があれば引数を無視して前の promise を返す**
（`initializer.ts`）。起動中に別のプリセットへ切り替えると、
**前の runtime の起動結果を新しい runtime のものとして `activeRuntime` に書く**
（`provider.tsx` の `snap` は新しい方）。
→ **未検証。この窓を踏むテストは無い**（`startGate.test.tsx` が同じファイルを
本物で通しているので、足すならそこ）。実機で踏めるかは未確認

※3 **停止が失敗しても `dispatch({ type: "shutdown" })` は `finally` で必ず走る**
（`provider.tsx`）。フロントは S0（未起動）になるが、Rust のプロセスは残りうる。
呼び出し元は `shutdown().catch(() => {})`（`provider.tsx`）なので**誰にも届かない**。
issue #120 と同型の行き止まり
→ [failure-surfacing.md](failure-surfacing.md) F-8

※4 `equalRuntime` が同値と判定すれば再起動しない（`provider.tsx`）。
ただし `engineKey` は `selectedPresetVersion` を含むので、
**プリセットを編集すると engineKey だけ変わってエンジンは再起動しない**組み合わせがある。
そのための「同じ engineKey での再起動」の扱いが
[engine-position-sync.md](engine-position-sync.md) の E3

※5 S3 では**同じ runtime なら再トライしない**（`provider.tsx`）。
無限リトライを避けるため。**再トライの導線は `clearError()` だが、UI からの呼び出し元が0。**

**「同じ runtime」はプリセットの同一性ではない**——見るのは `enginePath` /
`workDir` / `evalDir` / `bookDir` / `bookFile` / `options`（`entities/engine/lib/equalRuntime.ts`。
この判定がここの唯一の出典で、他の doc はここを指す）。だから**選択中のプリセットの
オプションを1つ変えて保存するだけでも起動し直す**——プリセットが1つしか無い利用者に
残っている道はこれだけ
→ [failure-surfacing.md](failure-surfacing.md) F-9

※6 `shutdown_engine_impl` は `stop_all_sessions()` を先に呼ぶ（`bridge.rs`）

※7 **`isReady` が false の理由は3つで、割れ目は「待てば戻るか」。**
解析側はこれを見て、走っている解析を打ち切るか待つかを決める
（→ [analysis.md](analysis.md) の ※5）ので、**`phase` の写しではない。**

**当たる順に上から。** 割るのは2段で、`desiredRuntime` の有無を先に見て
（`provider.tsx` の三項）、残りを `phase` で割る（`reasonForPhase` の `switch`）。
**`switch` の腕の並びは当たる順ではない**——`phase` で排他なので、順序に意味は無い。

| 理由        | いつ                                                          | 待てば戻るか                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `no-engine` | `desiredRuntime` が無い                                       | **戻らない**（下の effect は `shutdown` して降りるだけ。起動する口が1つも無い）                                                                                                                                                                                          |
| `failed`    | 残りのうち S3 で、`desiredRuntime` が**前回試した値と等しい** | **戻らない**（その回だけ再トライしない → ※5 / 不変条件3）                                                                                                                                                                                                                |
| `starting`  | 残り全部                                                      | 戻る（S1 の起動待ち、S2 で runtime が変わった窓、S0 の窓すべて（初回マウント・畳んだ直後・`restart()` の途中。**畳みの成否を問わない**）※、**S3 で runtime が動いた窓**、**S3 で前回試した値が無い窓**（`initialize` を通らずに `error` へ入った回。いまその口は無い）） |

**`desiredRuntime` の有無を先に見る。** 理由は「そこには起動し直す口が1つも無い」——
`phase` が何であれ結末は同じなので、`phase` に先を譲ると、初期化が落ちた後に
設定が組み立てられなくなった窓で `failed` が立ち、**起こし直す材料が揃っていないのに**
「オプションを変えて保存」と案内することになる。

**`no-engine` は「選んでいない」ではない。** `desiredRuntime` を組み立てられない回すべてで、
選んだプリセットの欄が埋まっていない回も AI フォルダが外れた回もここへ来る。
**入口をここに数え上げない**——出典は `entities/engine-presets` の `runtimeConfig` の
早期 return で、増えるたびにこの行だけが古くなる。案内を書く人はその関数を読むこと。

**`no-engine` を `phase` で割らない。** 割ると、畳んでから起こし直すまでの窓
（`restart()` の途中、および畳む invoke が落ちて `idle` の枝が拾い直す回）が
「選んでいない」に落ちる——**そこは待てば戻る**のに、読み手が戻らない側と見分けられなくなる。

※ **`starting` は「いつか ready になる」ではなく「起動し直す口が在る」。**

**`failed` を立てられるのは `initialize` が reject した回だけ**（`reducer.ts` の
`initialize_error`）。**上限で折れた回に限らない**——起動側は
`setupYaneuraOuEngine`（`entities/engine/lib/setup.ts`）の3段で、
パスが消えていて即座に折れる回も同じ枝を通る（E6 が挙げている失敗はここ）。
**待ちの上限をここに数え上げない**——出典は
[analysis.md](analysis.md) の不変条件2。

**畳めなかったことは `failed` として出ない。** 根拠は畳む側の戻り値ではなく、
`provider.tsx` の `shutdown` が **`finally` で必ず `idle` へ落とす**こと
——将来 `EngineAnalyzer::shutdown` が `Err` を返すようになっても結論は動かない。
そこから effect の `idle` の枝が起こし直す。**残ったプロセスの話は ※3 / F-8 の管轄**で、
この理由の分類とは別。

`starting` がいつか `ready` か `failed` へ動くことを、**フロント側だけでは保証しない。**
根拠は Rust 側の上限（→ [analysis.md](analysis.md) の不変条件2）と、
**起動の門が世代ごとに必ず降りること**（→ 下の「埋まっていないセル」の
`startGate.test.tsx`）。**実プロセスでは未確認**（→ F-40）——出典と同じ強さで読むこと。

**`failed` と `starting` を割る述語は `retriesAfterError`**、`phase` から理由を決めるのは
`reasonForPhase`（どちらも `lib/notReadyReason.ts`）。**述語を呼ぶのは描画時の1箇所だけ**で、
理由を決める側も起動し直す effect もその値を読む。**effect の中で呼び直さない**
——`lastTriedRef` の更新は再描画を起こさないので、呼んだ時点によって答えが割れる。

分類は `entities/engine/model/types.ts` の `isRecoverableNotReady` が持ち、
理由の並びは `src/entities/engine/model/__tests__/provider.test.tsx` が固定している。
**どちらも `engineInitializer` を差し替えた回で、実プロセスでは未確認。**

## この表が満たすべき不変条件

1. **S2（起動済み）なら `activeRuntime` は実際に起動したプロセスの設定と一致する。**
   ※2 はこれを破りうる
2. **フロントが S0 なら Rust 側も P0。** ※3 はこれを破る
3. **S3（失敗）から抜ける道が常にある。** いまは `desiredRuntime` を前回試した値から
   動かすことだけ（※5。プリセットを選び直しても、選択中のものを編集してもよい）

## 埋まっていないセル

- `(S1, E3)` 起動中の runtime 切替（※2）。**`initializer.ts` にテストが無い**
- `(S3, E4)` 失敗した状態で同じ runtime が入り直す回（※5）。`provider.test.tsx` が見ているのは
  「落ちた後そのまま放置しても再トライしない」ことだけで、**等値な別オブジェクトを
  入れ直す回は未検証**（踏めているのは S2 側の同じ形）
- `(S2, E8)` / `(S1, E8)` 停止の失敗（※3）。**Rust 側を落とす手段が無い。**
  `provider.test.tsx` が踏んでいるのは `engineInitializer.shutdown()` を reject させた回で、
  見ているのは**そのとき立つ理由**（※7）だけ——Rust 側に何が残るかは見ていない
- **`entities/engine` の `__tests__` が見ているのは理由の並び（※7）と、そこに至る
  `initialize` / `shutdown` の呼び出し回数。** `(S2, E4)` は等値な別オブジェクトを流して
  踏んでいる（`equalRuntime` が中身で比べていなければ落ちる）。
  **見ていないのは `phase` の値そのもの**——理由は `phase` の写しではないので、
  並びが合っていても `phase` が合っている根拠にならない——と、`equalRuntime` が
  **どの欄**を比べるか（単体テストが無い）
- **`startGate.test.tsx` だけは `engineInitializer` を差し替えず、本物を通す**
  （差し替えるのは IPC の4つ）。踏んでいるのは、起動を待っている間に設定が2度外れて
  戻る窓——**※7 の「`starting` は必ず `ready` か `failed` へ動く」は、この門が
  世代ごとに降りることに依っている。** 見ているのは世代の門2つ（`shutdown` の
  `dispatch` と、`initializer` の IPC）だけで、**`initialize` 側の世代照合と、
  両者の `finally` の同一性判定は潰しても赤くならない**——防御として置いてあり、
  観測できる差を作る筋は見つかっていない
- **`initializer.ts` の ※2 の窓**（飛んでいる起動の最中に別の runtime で `initialize`
  を呼ぶと、前の起動の結果が新しい runtime のものとして記録される）は誰も踏んでいない。
  足すなら `startGate.test.tsx` の構えがそのまま使える
