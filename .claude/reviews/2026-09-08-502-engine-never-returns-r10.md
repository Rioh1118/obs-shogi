# レビュー 502-engine-never-returns ラウンド10

- 日付: 2026-09-09
- 範囲: `fix/441-stop-analysis-on-unmount...HEAD`
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `5fddd4e1`
- 前ラウンド: [r1](2026-09-08-502-engine-never-returns-r1.md) 〜 [r9](2026-09-08-502-engine-never-returns-r9.md)

**変異を当てたのは robustness だけ**（r8 から同じ取り決め）。

## このラウンドで分かった一番大きなこと

**r9 の修正が塞いだ先で、別の窓が開いていた。**

r9 で門を世代にしたことで「畳んだ後も起動し直す」ようになったが、
**`shutdown` の継続だけが世代を持たない**ままだった。3人が独立に同じ場所へ着いた:

| reviewer     | 何を言ったか                                                               |
| ------------ | -------------------------------------------------------------------------- |
| react        | `shutdown` が `await` の向こうで世代を見ない（**r9 で外した1件の裏返し**） |
| architecture | 世代は React 側、プロセスは api / Rust 側——どちらも単独では守れない        |
| robustness   | **IPC の順まで実測**（`init, shutdown, init, shutdown, init`）             |

**私の新設テストが、その巻き添えを期待値として固定していた**
——`toBeGreaterThan(1)` は正しい2本でも巻き添えの3本でも緑になる。
テストのコメントも「もう誰の待ち相手でもない」と**逆を書いていた**（comment / architecture）。

## 所見

### HIGH-1 追い越された畳みが、後から起きたエンジンを殺す（react / architecture / robustness）

`shutdown` は飛んでいる起動を待つ回がある。眠っている間に新しいエンジンが起き切っても、
目を覚ました時点で `shutdown_engine` を撃つ。**Rust の `shutdown` は `engine_id` を
無条件に take する**ので、殺されるのはいま起きたエンジン。

着地は2通りでどちらも悪い:

- 殺しが `setoption` の前に着く → 新しい起動が `NotInitialized` で落ちる →
  同じ設定なので理由は **`failed`（終端）** → **正常なエンジンについて
  「解析中に使えなくなった」と告げ、解析だけが止まる**
- 後に着く → 起こし直しが1回まるごと余分に走る。**断りは1つも出ない**

### HIGH-2 `restart()` が凍った設定で起こし直す（robustness。基底からの持ち越し）

`await shutdown()` の間に利用者がもう一度保存すると、クロージャに焼き付いた
——すでに捨てられた——設定で起動する。実測で保存2回に対しエンジンが**3回**起動し、
途中に「利用者が既に捨てた設定で走っている」窓がある。理由は `starting` なので断りは出ず、
**「設定を保存したら解析が黙って消え、しばらく待たされ、また戻ってくる」**。

### HIGH-3 台帳の採番が基底と二重になっていた（oss-hygiene）

**基底ブランチが30コミット進んでいた。** 新しい F-37（AI フォルダ）が割り込み、
「設定の書き込み」が F-38 へずれている。こちらは F-37 のまま F-38 / F-39 を採っていたので、
**マージすると F-38 が2行**になる。

### HIGH-4 `engine.md` の「埋まっていないセル」が、同じ PR のテストを数えていない（oss-hygiene / comment）

「`initializer.ts` にテストが無い」「`__tests__` が見ているのは理由の並びと呼び出し回数」と
書いてあるが、`startGate.test.tsx` は本物の `initializer.ts` を通している。
**※7 の「`starting` は必ず `ready` か `failed` へ動く」はこの門に依っている**のに、
doc は「その1本を消しても何も止まらない」と読める。

**同じ節の最後の文が、途中で切れてもいた**（comment）——私が入れた欠落。

### HIGH-5 新設テストのコメントが、同じテストの前提と正反対（comment / architecture）

「もう誰の待ち相手でもない」——実際には1本目の畳みがまだ待っている。
`settle()` が2回要る理由も、assert が緩い理由も、そこから読めない。

### MEDIUM-6 この PR がいちばん頼っている性質に、オラクルが1つも無い（robustness）

世代の突き合わせ3箇所を個別に潰しても **1034 件が全部緑**。

**これは半分しか閉じられなかった。** 2つ（`shutdown` の `dispatch` と
`initializer` の IPC）は新しい assert が捕まえる。残り（`initialize` 側の世代照合、
両者の `finally` の同一性判定）は**観測できる差を作る筋が見つからなかった**
——中間の `ready` は同じ tick の `shutdown` とバッチで畳まれて commit されない。
**判別しないテストは残さない**ので、そのために書いた2本は落とし、
`engine.md` の「埋まっていないセル」に事実として書いた。

### MEDIUM-7 〜 MEDIUM-12

- `EngineInitializer` の契約が型にも doc にも無く、provider のコメントだけが api の内部を語る（architecture）
- `isRecoverableNotReady` だけ `model/types.ts` に居て、述語が2階層に散る（architecture）
- ※7 の「畳む側は失敗を返さず」が E8 / ※3 と噛み合わず、**しかも結論に要らない**（oss-hygiene）
- ※7 の `starting` 行が S0 の窓を「畳み損ねた回」としか書かず、**初回マウントと正常な畳み直しが抜けている**（oss-hygiene）
- ※7 が、出典側の「はず／未確認」を**「必ず」に格上げ**している（comment）
- effect の依存のコメントが、1手で反例の出る理由を根拠にしている（comment）／
  bool の門が壊れる理由の説明が実際と違う（comment）／G-6 を落とした欠番（oss-hygiene）

## 修正の結果（`/review-fix`）

| 所見                            | 結果                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| HIGH-1 / HIGH-2                 | `34c8c01c`。門を provider と initializer の両方に置き、`initialize` は撃つ時点の設定を読む |
| HIGH-3                          | `b1363ec3`。基底を取り込み、新規2行を **F-39 / F-40** に採り直した                         |
| HIGH-4 / MEDIUM-9 〜 MEDIUM-11  | `34c8c01c`。切れた文を閉じ、`startGate.test.tsx` を数え、※7 の根拠と断定の強さを直した     |
| HIGH-5 / MEDIUM-6               | `34c8c01c`。コメントを現物へ、assert を実数へ。**判別しない2本は落とした**                 |
| MEDIUM-7 / MEDIUM-8 / MEDIUM-12 | `8be62413`                                                                                 |

**変異を当てて確かめたもの**（名指しした assert が落ちることまで）——
`provider` の `shutdown` から世代の門を外す／`initializer` の追い越し判定を外す、
のどちらでも `startGate.test.tsx` が落ちる。
**捕まらなかった3つの変異は、上の MEDIUM-6 のとおり doc に書いて残した。**

## マージで分かったこと（次ラウンドへ）

- 理由の導出は**両側が独立に同じ形へ収束していた**（`desiredRuntime` の有無を先に見る）。
  こちらを残した——基底の版は `phase === "error"` を無条件に `failed` へ倒すので、
  r6 で見つけた「起動し直す口が在るのに終端と読む」窓を持つ
- **`analysis/model/provider.tsx` は git が「衝突なし」で畳んだが意味が壊れていた**
  （基底が結果の反映を `useResultFlush` へ切り出し、対応表を改名していた）。手で繋ぎ直した
- **基底の `notReadyReason.test.tsx` と、こちらの `provider.test.tsx` が重なっている。**
  どちらも `EngineProvider` の理由の並びを見る。**次ラウンドで畳むかを見ること**

## 見ていない範囲

- `perf` / `ui` / `rust` reviewer は10ラウンドとも走らせていない
- **実プロセスでの確認は10ラウンドを通して1件も無い**
- r8 の flake は robustness が29回走らせて再現せず（2ラウンド連続）。**機構は不明のまま**
- マージで取り込んだ基底の30コミット分は、レビューしていない
