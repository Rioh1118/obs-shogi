# レビュー 502-engine-never-returns ラウンド4

- 日付: 2026-09-09
- 範囲: `fix/441-stop-analysis-on-unmount...HEAD`（このブランチのコミットは13本。merge-base は `51811055`）
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `4e7528b4`
- 前ラウンド: [r1](2026-09-08-502-engine-never-returns-r1.md) / [r2](2026-09-08-502-engine-never-returns-r2.md) / [r3](2026-09-08-502-engine-never-returns-r3.md)

**r1〜r3 の所見は1件も再掲されなかった。**

## 対象そのものを疑う

**r3 で入れた「楽観更新＋巻き戻し」が、この ラウンドの所見の半分を1人で生んでいる。**
3本の reviewer が独立に HIGH を立て（react / architecture / robustness）、robustness は
**実際にテストを書いて2つの筋道を再現した**。

そして architecture が出典を見つけた——**ADR-0004 の決定7 が、プリセットの保存を
明示的に「悲観的更新」の側に置いている**（「`state` が唯一の正になる永続化。書けたかどうかを
後から読み直す経路が無く、ズレても誰も気づかない」）。楽観＋巻き戻しは同じ ADR が
**ファイル操作**（読み直せるもの）に割り当てた形で、プリセットには割り当てていない。

**r3 の判断は「壊れたことが画面に出なくなった」を直そうとして、機構を1つ足した。**
足す代わりに**順序を入れ替えれば**（保存が返ってから state を動かす）、
失敗しても何も変わらないので成功と見分けが付き、巻き戻しも新しい断りも要らない。

**この1点を直すと、22件中12件が消える。** 以下は残る側を中心に並べる。

## 所見

### BLOCK-1 巻き戻しが、その間に成功した別の書き込みを丸ごと捨てる（react / architecture / robustness。**robustness は再現済み**）

`previous` は `deletePreset` を作った描画時点の配列で、`await persist(next)` の間に起きた
変更を1つも含まない。`EngineTab` は保存中もボタンを無効にしない。

robustness が実際に走らせた2本:

- **[a,b,c] で b を削除 → その保存中に「追加」（成功、ディスクは `[a,c,d]`）→ 削除が落ちる**
  → 巻き戻しで画面は `[a,b,c]`。**いま作った d が消え、消したはずの b が戻る。**
  この後 a を編集して保存すると `state.presets` が書かれるので**ディスクからも d が消える**
- **a（選択中）を削除 → 保存中に c を選ぶ（`last_preset_id: "c"` がディスクへ）→ 削除が落ちる**
  → 巻き戻しが `commitSelection("a")`。**メモリは a、ディスクは c。**

r3 の計画は「`window.confirm` が直列化するので窓は狭い」と見積もったが、
**直列化されるのは確認ダイアログだけ**で、`await persist` の間 UI は完全に応答する。

### BLOCK-2 失敗した削除の赤帯が、成功した操作の後も残る（react / robustness。**robustness は再現済み**）

`status` を `"error"` から降ろすのは `"loading"` と `"loaded"` だけで、その2つを撃つのは
**初期化と「再読み込み」ボタンだけ**。`deletePreset` は r3 でこの sticky な欄に書き込む
最初の通常操作になった。実測——失敗 → 赤帯 → もう一度削除（成功、カードは消える）
→ **`status` は `"error"` のまま、同じ文が残る。**

### HIGH-3 巻き戻しは `deletePreset` にしか入っておらず、他の4つは楽観更新のまま（react / architecture）

`createPreset` / `duplicatePreset` / `updatePreset` / `mergeOptions` は失敗しても
画面が動いたまま。**「削除だけは見分けが付く」を作ったぶん、残り4つの沈黙が際立った。**
署名は同じ `Promise<void>` なのに契約が正反対（`deletePreset` だけ reject しない）で、
呼び手は3通りに割れている——`onAdd`/`onDup` は catch せず、編集ダイアログは
`await updatePreset(...)` の後ろに `onClose()` を置いているので**保存が落ちるとダイアログが
閉じないまま何も出ない**、`onDelete` だけが赤帯。

### HIGH-4 `commitSelection` の doc が、`touchPreset` の役目を別の `engineKey` にすり替えている（comment）

**`engineKey` は2つある。** `touchPreset` が動かす `selectedPresetVersion` が入るのは
`useEnginePositionSync` の `` `${id}@${version}` ``（**送信済み局面の記録の鍵**）で、
解析ペインのキャッシュ鍵（`AnalysisPane`）は `selectedPresetId` だけで version を含まない。
r3 で私が書いた doc は両者を混ぜている。しかも「中身が変わった回だけが撃つ」も偽——
`reload` は中身が変わっていなくても撃ち、`mergeOptions` は options を書き換えても撃たない。

### HIGH-5 F-38 が「起動待ちのまま戻らない」にプロセス死の仕組みを当てている（comment / robustness / oss-hygiene の3本）

現物の門は3枚。プロセス死は**入口**（`isReady`）で降りるが、起動待ちの回は
`isReady` が false なので入口を通り、**3枚目**（`isRecoverableNotReady`）で降りる。
「4つの欄が1つも動かない」も後者では偽（`phase` が動く）。
**塞ぎ方が違う**（前者は Rust からの通知、後者は分類か上限）のに同じ機構として載っているので、
片方を塞いだ人が F-38 を閉じてしまう。

さらに2つ——F-38 は「**戻ってくる理由**で止まった回とは別（あちらは断りが立つ）」と書いているが、
断りが立つのは**戻ってこない理由**の回で、逆。そして `analysis.md` と spec が
「**踏めるかは未確認**」と付けている枝に、F-38 は「**何も起きない。**」と断言している。

### MEDIUM-6 `cutRunningAnalysis` の doc「順序が3つとも意味を持つ」——本当の順序制約は1つ（comment）

本体は4文なのに doc は3項。1. の世代を上げる話は**順序ではなく「必ず撃つ」の制約**
（飛んでいる再開が世代を見るのは `await` の後で、この4文の間に制御は戻らない）。3. の「断りは最後」も文字どおりには偽——最後は `stop_analysis` で、しかも
`set_error` が既に `isAnalyzing` を倒すので**値を1つも動かさない**。
**本当に効いているのは 2→3 の順だけ**（`clear_results` が `error` を消す）。

**3ラウンド連続で同じ故障**（コメントの理由が条件式と違う）。しかもこの関数は
r3 でその是正のために括り出したもの。

### MEDIUM-7 `commitSelection` の doc の「割った理由」が、現物では成り立たない（comment）

「割らずに `selectPreset` を呼ぶと、間に本物の往復が入って描画が1枚できる」——
`selectPreset` は `commitSelection` を同期で撃ってから `await` するので、描画は割れない。
窓を開けていたのは `await persist(next)` の方。**変更前のコードの説明**を書いている。

### MEDIUM-8 裸の `※12` が、新しく書いた関数 doc に再発（comment）

r3 で `engine/model/provider.tsx` の裸の `※5` を直したのに、同じ形が
`cutRunningAnalysis` の doc とテストに入った。**直した機構を機械化しなかったラウンドに再発した。**

### MEDIUM-9 engine provider のコメントが ※7 を写しているのに ※7 を指していない（comment）

`engine.md` の ※7 は表を持ち「**当たる順に上から**（`provider.tsx` の三項と同じ順）」と
三項への依存まで宣言しているのに、provider 側のコメントが挙げる指し先は ※5 だけ。
**r3 の是正（出典を1つに決めて指す）の対象そのもの。**

### MEDIUM-10 断りの名前で、入口の軸が付いているのは片方の対だけ（comment）

`ENGINE_FAILED_MESSAGE` / `ENGINE_FAILED_WHILE_ANALYZING_MESSAGE` の対だけが軸を持たない。
`ON_START_REFUSALS` に3本目を足す人が、`_WHILE_ANALYZING` の無い名前を「共通の断り」と
読んで両表に入れる形が開いている。

### MEDIUM-11 新しいテストの名前が、この PR が否定した語彙に戻っている（comment）

「エンジンを選んでいない間だけ no-engine」「選択が外れていれば〜」——
`types.ts` と `engine.md` は「**選んでいないとは限らない**」と宣言している。
**テスト名は失敗時に最初に読まれる1行で、事実上の用語集。**

### MEDIUM-12 `duplicatePreset` の doc が、保存が落ちた回に触れていない（comment）

「窓は開かない」と安全な側だけを述べているが、`persist` が throw すると一覧に
**ディスクに無い複製が残り、しかもそれが選択される**。隣（`deletePreset`）に巻き戻しが
入ったぶん、読み手はこの関数も面倒を見てあると受け取る。

### MEDIUM-13 barrel から純関数を取ると provider が付いてくる（architecture）

`isRecoverableNotReady` を barrel から**値として**取るようにしたため、解析のテストは
`@/entities/engine` を全面モックできなくなり `importOriginal` に切り替わった。その結果、
解析の単体テストが `EngineProvider` → `api/initializer` → `lib/setup` → `api/tauri` を
**実際に評価する**。同ファイルの `api/tauri` の全面モックは `shutdownEngine` を持たないので、
いまは「呼ばれないから落ちない」だけ。**テストが `importOriginal` に切り替わったことが、
境界が壊れた最初の観測値。**

### MEDIUM-14 §3 の「F-19〜F-31 の段はどこにも無い」が、F-38 を採番しても更新されていない（oss-hygiene）

範囲式で書いてあるので末尾に追随しない。r3 の計画表が「§3 の数え方に影響する」と
予告していたのに、採番だけ入って数え方が直っていない。

### MEDIUM-15 `(S3, E4)` が engine.md の一覧から消え、**r3 の報告書が事実と違う**（oss-hygiene）

足したテストは `initialize` が resolve した後（＝ S2）に等値な別オブジェクトを流すもので、
**`(S2, E4)`**。S3 から同じ runtime を入れ直す回は踏んでいない。にもかかわらず
engine.md からは「固定できている」も「埋まっていない」も**両方消え**、r3 の報告書は当時
「`(S3, E4)` は主張を残して踏むテストの方を足した」と書いていた（`7b097266` で訂正済み）。
**報告書は次ラウンドの突き合わせ元なので、次の reviewer が検証を飛ばす。**

### 差分の外

- **`engineKey` が2つのスライスで別の式に束縛されている**（comment）。改名は #502 の外
- **`app-config` ⇄ `engine-presets`** は #516 のまま

## 重複・矛盾した所見

- **BLOCK-1 / BLOCK-2 / HIGH-3 / MEDIUM-7 / MEDIUM-12 と、architecture・robustness の
  文言と台帳の所見は、すべて「r3 で足した巻き戻し」から出ている。** 順序を入れ替えれば全部消える
- **HIGH-5 は3本が独立に指摘**し、指摘の中身が少しずつ違う（機構が片方にしか当たらない／
  「戻ってくる理由」が逆／「未確認」が消えた）。3つとも直す
- **MEDIUM-6 / MEDIUM-8 / MEDIUM-9 は、r3 の是正が届かなかった箇所**。
  是正の方向（散文を減らす・出典を1つに）は正しかったが、**新しく書いた doc に同じ癖が出た**

## 見ていない範囲

- `perf` / `ui` / `rust` reviewer は4ラウンドとも走らせていない
- **実プロセスでの確認は4ラウンドを通して1件も無い**
- oss-hygiene は `node_modules` に `vitest` が無く**テストを1本も走らせていない**
  （このワークツリーでは走る。レビュアーの環境の問題）
- **基底ブランチ側でも `analysis.md` が動いている**（`86008fe6` ほか）。
  マージ時に衝突・矛盾するかは見ていない
- `EnginePresetEditDialogPanel` は保存経路だけ

## lint / hook で強制できるもの

- **BLOCK-1 / BLOCK-2 はテストで止まる。** robustness が実際に書いて赤くなることを確かめた
- **MEDIUM-8（裸の `※N`）は r1・r3 でも挙げたのに実装していない。** 実装しなかったラウンドに再発した
- **MEDIUM-10 は `analysisRefusals.test.ts` を1行伸ばせば止まる**——
  `ON_START_REFUSALS` の値は `_ON_START_MESSAGE` で、`WHILE_ANALYZING_REFUSALS` の値は
  `_WHILE_ANALYZING_MESSAGE` で終わること
- **MEDIUM-15 は `stateTransitionCells.ts` に `engine.md` を足せば落ちる**
- **MEDIUM-14 は範囲式をやめれば検査が要らない**（そちらが安い）

## 修正計画（r4 → r5）

### 束

- **巻き戻しをやめる**: BLOCK-1 → BLOCK-2 → HIGH-3 → MEDIUM-7 → MEDIUM-12。
  順序を入れ替えると5件とも指摘箇所ごと消える
- **F-38**: HIGH-5 の3点（機構・逆・未確認）＋ MEDIUM-14 は同じ表の同じ節
- **散文の癖**: MEDIUM-6 → MEDIUM-8 → MEDIUM-9 → MEDIUM-11。**r3 の是正が届かなかった側**

### このラウンドで直すもの

| 順  | 所見                                                | なぜこの順か                                                  | この直し方で壊しうるもの                                                                                                                                                                                                          |
| --- | --------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | BLOCK-1 / BLOCK-2 / HIGH-3 / MEDIUM-7 / MEDIUM-12   | 失敗経路。他の5件の指摘箇所が消える                           | **保存が返るまで画面が動かなくなる**（IPC 1往復ぶん）。ADR-0004 決定7 が求める形だが、`EngineTab` は保存中もボタンを無効にしないので**押し直しが2重に飛ぶ**——`persist` は冪等（ファイル全体を書く）なので害は無いが、確かめること |
| 2   | HIGH-4 / MEDIUM-6 / MEDIUM-8 / MEDIUM-9 / MEDIUM-11 | コメントの嘘。1 で `commitSelection` の周りが動くので、その後 | 無し（コメントと名前のみ）。ただし**テスト名を変えると失敗時の見え方が変わる**ので、名前だけで検索している人が居ないか grep すること                                                                                              |
| 3   | MEDIUM-10                                           | 改名。ラチェットが名前で突き合わせる                          | `analysisRefusals` の ※15 の突き合わせが**定数名で**赤くなる。`analysis.md` の行も同時に                                                                                                                                          |
| 4   | MEDIUM-13                                           | 境界。テストのモックの張り方が変わる                          | `isRecoverableNotReady` を deep import に落とすと、解析のテストが全面モックへ戻せる。**barrel から値を落とすので IDEAS の記述も戻す**                                                                                             |
| 5   | HIGH-5 / MEDIUM-14 / MEDIUM-15                      | doc。実装が固まってから                                       | `(S3, E4)` を「未検証」に戻すと、r3 の報告書と食い違う——**報告書も直す**                                                                                                                                                          |

### 直さないもの（行き先）

| 所見                      | 行き先                       | 理由                                                                          |
| ------------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `engineKey` の名前の衝突  | **`docs/IDEAS.md`**          | 2スライスをまたぐ改名で、#502 の受け入れ条件の外。6週間以内に着手しない       |
| 他4つの書き込みの楽観更新 | **既存の F-5 / #170 のまま** | 1 で `deletePreset` を悲観側へ戻すと、5本とも ADR-0004 決定7 の同じ扱いに揃う |

## 修正の結果（`/review-fix`）

**15件のうち14件を直し、1件は反論して見送った。** 差分の外の2件は IDEAS と #516 へ。

| 所見                                                            | 結果                                                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLOCK-1 / BLOCK-2 / HIGH-3 / MEDIUM-7 / MEDIUM-12               | `beef588b`。**巻き戻しをやめて保存を先に撃つ**（ADR-0004 決定7）。5件とも指摘箇所ごと消えた（**`1cb0f10a` で revert**——保存先行も別の窓を開けたため → r5） |
| HIGH-4 / MEDIUM-6 / MEDIUM-8 / MEDIUM-9 / MEDIUM-10 / MEDIUM-11 | `7b097266`。コメントを効いている条件だけに絞り、断りの名前に入口の軸を付けてラチェットに入れた                                                             |
| HIGH-5 / MEDIUM-14 / MEDIUM-15                                  | `7b097266`。F-38 を F-38 / F-39 に割り、範囲式をやめ、`(S3, E4)` を未検証として戻した                                                                      |
| MEDIUM-13                                                       | **見送り（下の反論）**                                                                                                                                     |
| `engineKey` の名前の衝突                                        | `docs/IDEAS.md` へ                                                                                                                                         |

**変異を当てて確かめたもの**——保存と state の順を元に戻すと、engine-presets の2本
（「`runtimeConfig` は null を通らない」「保存に失敗したら動かさない」）が落ちる。
**（`a89c0a4f` で撤回。落ちたのは名指しした assert とは別の2つで、当の assert は
`act()` の中で潰れて一度も赤くなっていなかった → r5）**
名前の軸のラチェットは、**入れた時点で `ENGINE_STARTING_MESSAGE` を1本拾った**。

### 反論（MEDIUM-13 を直さなかった理由）

**（`a89c0a4f` で範囲を狭めた。`sliceBarrels` が禁じるのは barrel が公開している
モジュールへの deep import だけで、「barrel に載せない置き場」は残っている → r5）**

`isRecoverableNotReady` を barrel から外して `@/entities/engine/model/types` から
deep import する案を試したが、**このリポジトリの `sliceBarrels.test.ts` が
「barrel が公開しているものを、スライスの外から直に読まない」で落とす**——
`model/types` は barrel が再エクスポートしているので、提案された形はラチェット違反になる。

**この問いにはリポジトリが既に答を出している。** 残る脆さ（解析のテストが
`importOriginal` を使うので engine のモジュールグラフを評価する）は本物だが、
それは barrel を境界にすると決めたことの帰結で、`docs/IDEAS.md` の
「`entities/engine` の公開面をまとめて決める」が持っている論点。**そちらへ寄せる。**

### 次ラウンドの焦点

1. **順序を入れ替えたことで、`runtimeConfig` が null を通る窓が戻っていないか**（#502 の元の欠陥）
2. **保存中に同じボタンを押し直せる**ことで、新しい競合が生まれていないか
3. **`cutRunningAnalysis` の doc が、いま実際に効いている制約だけを述べているか**
4. **F-38 の2つの枝が、それぞれ違う機構で説明されているか**
