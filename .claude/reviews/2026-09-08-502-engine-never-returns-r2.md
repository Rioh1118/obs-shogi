# レビュー 502-engine-never-returns ラウンド2

- 日付: 2026-09-08
- 範囲: `fix/441-stop-analysis-on-unmount...HEAD`（4コミット）
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `c9e92502`
- 前ラウンド: [r1](2026-09-08-502-engine-never-returns-r1.md)

**r1 の所見は1件も再掲されなかった。** 以下は全て新規、うち**3件は r1 の修正が作った**。

## 所見

### BLOCK-1 新設テストのコメントが、同じ PR が doc 側で潰した嘘を保っている（comment）

`provider.test.tsx` の「**死んだエンジンの読み筋を、いま見ている盤の下に残さない。**」は
`state.candidates` しか見ていない。ペインは停止中に `state.candidates` を読まないので、
**盤の下の読み筋は盤を動かすまで出続ける**——r1 の HIGH-3 で ※5 と spec を直したのに、
**このコメントと表題だけが直す前の主張のまま**。次の読み手は「キャッシュを消す変更を
このテストが守っている」と誤読する。

### HIGH-2 断つ effect のコメントが、実装している条件と違う（comment）

```
// **反映待ちの下書きも落とす。** 落とさないと、間引きのタイマーが後から起きて
// 死んだエンジンの最後の1本を `candidates` へ戻す。
```

`flushLatest` は先頭が `if (!analyzingRef.current) return;`。この effect は `set_error` と
`stop_analysis` を必ず撃つので、80ms 後にタイマーが起きた時点で `analyzingRef` は false。
**書いた失敗は踏めない。** 同じファイルの `takeSeatAndGo` は正しい条件を持っている
（「この経路は `stop_analysis` を dispatch しないので、そのタイマーは起きて commit される」）。
実際にこの行が効いているのは**既に commit 済みの `candidates` を空にすること**。

**CLAUDE.md が名指ししている再発パターン**（「コメントに書いた理由が、実装している条件と違う」）。

### HIGH-3 `deletePreset` の途中で `no-engine` が立ち、r1 で入れた断ちが誤爆する（architecture / robustness。react は「文言だけ」と評価）

```ts
const next = state.presets.filter((p) => p.id !== id);
dispatch({ type: "set_presets", payload: next });   // ← commit される
await persist(next);                                 // ← 実 IPC で中断
if (state.selectedPresetId === id) { ... await selectPreset(fallback); }
```

**自分で確かめた**（`entities/engine-presets/model/provider.tsx`）。`set_presets` の commit から
`set_selected` までの間、`selectedPresetId` は消したプリセットを指したままなので
`selectedPreset` が undefined → `runtimeConfig` が null → `desiredRuntime` が null → `no-engine`。
削除ボタンは `presets.length <= 1` で無効なので**必ず代替が自動で選ばれる**のに、
その窓で解析が「設定でエンジンを選んでください」と断たれる。

**深刻度が割れた。** architecture は HIGH（同じ結末に着く「カードで切り替える」経路は
`runtimeConfig` が null を通らないので解析が続く——**同じ操作の結末が途中の1コミットで割れる**）、
robustness は MEDIUM（断つのは正しい。壊れているのは案内）、react は所見に立てず
（「エンジンが本当に別物に入れ替わるので断つのは正しい。文言だけがずれる」）。

**この窓は r1 より前から在り、無駄なエンジンの畳み直しを起こしていた。**
r1 の修正はそこに「解析を誤った文言で断つ」を足した。

### MEDIUM-4 `failed` が `no-engine` に優先するのに、コードにも doc にもその順序が無い（comment / react / oss-hygiene の3本）

```ts
state.phase === "error" ? "failed" : desiredRuntime ? "starting" : "no-engine";
```

直上のコメントと `engine.md` の ※7 は「**判定は `desiredRuntime` の有無だけ**」と断言している。
実際は `phase === "error"` が先に勝つので、**初期化が落ちた後にプリセットを外した窓**では
`failed` が立ち、▶ に「オプションを変えて保存してください」と案内する——
**選ばれているプリセットが1つも無いのに。** 新設テストもこの重なりを踏んでいない。

### MEDIUM-5 「どの理由が戻るか」の機械可読な出典が `entities/analysis` にある（architecture）

`refusals.ts` は「出典は `engine.md` の ※7」と書いた直後に `starting: null` でその判定を書いている。
`entities/engine` 側にはこの分類を持つ値も型も無い。**理由が増えた回は tsc が両方を埋めさせるが、
既存の理由の分類が動いた回は守られない**——engine 側で `no-engine` から起動し直す口を1つ足しても
（HIGH-3 がまさにその状態）、解析側は緑のまま通る。

### MEDIUM-6 `no-engine` の断りが、この理由が立つ2つの入口のうち片方にしか効かない（robustness）

`runtimeConfig` が null になる口は3つ——未選択・`aiRoot` 無し・**選んでいるが未設定**
（`isPresetConfigured`）。3つ目は「設定 → 追加 → その新しいプリセットを押す」で踏め、
**利用者は今まさに選んだ直後**。「設定でエンジンを選んでください」に従っても何も変わらない。
`refusals.ts` の TSDoc「選択が外れた」・`types.ts` の `no-engine` の doc・`engine.md` ※7 の行も
同じ思い込みを写している。

### MEDIUM-7 ラチェットの表の一覧が二重手書きで、書き漏らすと**黙って**外れる（architecture）

`PARTS` に足し忘れれば赤くなるが、`TABLES` に足し忘れると**何も起きない**——その表だけ
検査を通らないまま増える。失敗の向きが非対称で、危ない側が黙る。`allowsNull` も型注釈の写し。

### MEDIUM-8 解析側の engine モックが `EngineReadiness` の不変条件を捨てている（architecture）

`{ isReady: boolean; notReadyReason: EngineNotReadyReason | null }` と推論されるので、
`{ isReady: false, notReadyReason: null }` が tsc を通る。その状態で断つ effect は
`WHILE_ANALYZING_REFUSALS[null]` から `undefined` を得るが、門は `=== null` の厳密比較なので
降りず、**`set_error` に `undefined` が載る**。`types.ts` はまさにこれを禁じるために合併を作っている。

### MEDIUM-9 同じ鍵を取る2つの表の名前が別々の軸で付いている（comment）

`NOT_READY_REFUSALS`（エンジンの状態で命名）と `WHILE_ANALYZING_REFUSALS`（いつ出すかで命名）。
どちらも `EngineNotReadyReason` を鍵に取り、どちらも「`isReady` が false のときの断り」。
**名前の対からは選べない。** 前者に足すと、ボタンを押していない人に「もう一度 ▶ を押してください」が出る。

### MEDIUM-10 `refusals.ts` の裸の `※5` が、同じファイルが指す2つの ※5 のどちらか分からない（comment）

同ファイルは `engine.md` の ※5（起こし直し方）と `analysis.md` の ※5 を両方指している。
しかも取り違え先の engine.md ※5 は、**この定数が案内しないと明言している内容**。

### MEDIUM-11 `F-2` の「3通り」が `LISTENERS_FAILED_MESSAGE`（アプリ再起動）を数え落とした（comment）

ADR-0004 でただ1つ「アプリ再起動」に当たる枝。3通りのまま UI を起こすと、
**再起動しないと二度と ▶ が効かない断りが「押し直せば直る」側に混ざる**。
r1 の MEDIUM-11 で同じ列を書き直した直後に、別の枝で同じ数え落としが入った。

### MEDIUM-12 spec が「候補手は出続ける」を無条件で書いた（oss-hygiene）

焼き付けは条件付き（`candidates.length > 0` かつ `analyzedSfen === currentSfen`）。
起こし直しの後に盤を動かした回・▶ の直後に落ちた回は**空欄**になる。
※5 は条件付きで書いているのに、spec だけが言い切っている。

### MEDIUM-13 ※7 の `starting` が「畳み損ねて S0 に落ちた窓も戻る」と断定している（oss-hygiene）

畳めなかった原因が続いていれば、起動し直しも `analyzer.rs` の `initialize_engine` 冒頭の
`shutdown().await?` で折れて `failed` へ落ちる。**「待てば戻る」ではなく「待てば `failed` に変わる」。**
断ち切りの結末は結果的に正しいが、doc が実プロセス未確認のことを断定している。

### MEDIUM-14 `engine.md` の「埋まっていないセル」が節の中で矛盾（oss-hygiene）

`(S3, E4)` の行を消して「埋まった」と読ませつつ、直後に「遷移そのものにテストは無い」と書いた。
実際のテストは `initialize` / `shutdown` の呼び出し回数まで見ている。

### MEDIUM-15 `analysis.md` ※5 が「ここに写さない」の直後に写している（oss-hygiene）

「出典は ※7——**ここに写さない**。`starting` だけが戻る側で、断らない。」
後半が ※7 の結論そのもの。理由が増えたとき、この1文だけが緑のまま古くなる。

### MEDIUM-16 `IDEAS.md` の指し先が現物と違う（oss-hygiene）

`console.log` は `selectPreset` の中ではなく、`selectedId` だけを依存に持つ `useEffect` の中。
IDEAS は数か月後に文脈ゼロで読む台帳で、位置情報はこの1行しか無い。

### 小さいもの2件

- **不変条件2 が「2つ」と書いた直後に箇条書きを3つ並べている**（robustness）。3つ目は
  「口が無いので踏めない」と自分で書いているが、数え直しの手間が要る
- **`engine` の新設テストの `expect(view.reasons).not.toContain("no-engine")` が同義反復**（react）。
  そのテストで `desiredRuntime` は一度も null にならないので、式の形からして落ちようがない

## 重複・矛盾した所見

- **MEDIUM-4 は3本が独立に指摘**。直し方も一致——三項の順を入れ替えて `!desiredRuntime` を先にする。
  `WHILE_ANALYZING_REFUSALS` はどちらも終端なので**解析の切り方は1ビットも変わらず**、
  変わるのは ▶ の断りだけ（その窓では `NO_ENGINE_SELECTED_MESSAGE` が正しい）
- **HIGH-3 は深刻度が3通りに割れた。** 判断は「同じ結末に着く2つの操作が、途中の1コミットの
  違いだけで割れてよいか」。**割れてよくない**と判断する——`deletePreset` の窓は
  r1 以前から**無駄なエンジンの畳み直し**を起こしており、断りの文言以前に直すべきもの。
  ただし robustness が指摘するとおり、**畳んでも MEDIUM-6 は閉じない**（未設定の入口が残る）
- **MEDIUM-5 と MEDIUM-9 は同じ根**（表の置き場と名前）。分類を engine へ移すと
  `WHILE_ANALYZING_REFUSALS` の鍵が `TerminalNotReadyReason` に狭まり、
  2つの表の**型が違う**ようになる。名前だけに頼らなくなる
- **`starting` の窓が戻るか（r1 の焦点1）は robustness と react が独立に全経路を辿り、
  どちらも「拾わない組み合わせは無い」で一致。** 不変条件2 の穴は増えていない

## 見ていない範囲

- `perf-reviewer` / `ui-reviewer` / `rust-reviewer` は r1 と同じ理由で走らせていない
- **実プロセスでの確認は今ラウンドも1件も無い。** 全て happy-dom ＋ mock 越し
- `failure-surfacing.md` の差分全体（各 reviewer とも F-2 行と冒頭の規約だけ）
- `entities/analysis/model/provider.tsx` の既存の effect 12本のうち、新 effect の周辺以外
- HIGH-3 の経路は**実行して確かめていない**（コードと commit 順序の読みによる）

## lint / hook で強制できるもの

- **MEDIUM-5 / MEDIUM-8 は型で止まる。** 分類を engine へ移して `Record<TerminalNotReadyReason, string>` に、
  モックに `EngineReadiness` を付ける
- **MEDIUM-7 は表の一覧をソースから引けば手書きごと消える**
- **MEDIUM-10 は検査できる**（2つ以上の表を指すファイルの裸の `※N`）
- **BLOCK-1 / HIGH-2 / HIGH-3 / MEDIUM-4 は機械では止まらない。** どれもコメントや doc の
  主張と条件式の突き合わせ。歯止めは `entities/engine-presets` にテストを1本置くこと
  （このスライスにもテストが無い）

## 修正計画（r2 → r3）

### 束

- **理由の割り当て**: MEDIUM-4 → MEDIUM-5 → MEDIUM-9。三項の順を直し、分類を engine へ移すと、
  MEDIUM-9 の「名前でしか選べない」は型が肩代わりする
- **`no-engine` の意味**: HIGH-3 → MEDIUM-6。窓を1つ潰しても未設定の入口は残るので、
  文言は両方を覆う形に直す
- **コメントの嘘**: BLOCK-1 → HIGH-2。どちらも「state を落とすこと」と「画面から消えること」の取り違え
- **doc**: MEDIUM-11 〜 MEDIUM-16 と小さいもの2件

### このラウンドで直すもの

| 順  | 所見                                   | なぜこの順か                                        | この直し方で壊しうるもの                                                                                                                                                                                                                                                            |
| --- | -------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MEDIUM-4 + MEDIUM-5 + MEDIUM-9         | 型を先に入れる（手順3-1）。他の所見の土台           | 三項の順を変えると、`phase: "error"` かつ `desiredRuntime` 非 null は今までどおり `failed`、null なら `no-engine` に変わる。**▶ の断りが1つ入れ替わる**。分類を engine へ移すと `WHILE_ANALYZING_REFUSALS` の鍵が狭まり、`starting` の枝が**書けなくなる**（書いたら tsc が落とす） |
| 2   | HIGH-3                                 | 門番の向きを変える（手順3-3）。積み上がる前に       | `deletePreset` の2つの dispatch を同じ同期区間に畳むと、**エンジンの畳み直しが1回減る**。`persist` が落ちた回に選択だけが進む（いまは `persist` の後なので進まない）——**その回の復帰は選び直し**で、`persist` の失敗は元から誰にも届かない                                          |
| 3   | MEDIUM-6                               | 2 の後（窓を1つ潰してから、残る入口に文を合わせる） | 文言が長くなる。`analysisRefusals` は文言の中身を見ないので赤くならない                                                                                                                                                                                                             |
| 4   | MEDIUM-7 + MEDIUM-8                    | 機械の穴。1 で表の形が変わった後に                  | 表をソースから引くと、正規表現が拾えない書き方（複数行・スプレッド）で**0件になって黙る**。番人（`length > 1`）を同時に置く                                                                                                                                                         |
| 5   | BLOCK-1 + HIGH-2                       | 本体が固まってから                                  | 無し（コメントと表題のみ）                                                                                                                                                                                                                                                          |
| 6   | MEDIUM-10 〜 MEDIUM-16 と小さいもの2件 | doc の整合。最後にまとめて                          | doc のみ。ラチェットは ※15 の節しか見ないので**赤で気づけない**                                                                                                                                                                                                                     |

### 直さないもの（行き先）

無し。**r2 の所見は全部このラウンドで直す。**
r1 で #510 と IDEAS へ送ったものは、そのまま。

### 検証のコスト

6コミット。`npm run verify` は実測 6〜7分で、gate がコミットごとに走る。
手前の確認は `typecheck + lint + test`（`test:hooks` を外す）で済ませ、全体は gate に任せる。

### 次ラウンドの焦点（次の `/review-round` に渡す）

1. **三項の順を入れ替えたことで、▶ の断りが変わった窓が本当に正しくなったか。**
   `phase: "error"` × `desiredRuntime: null` で `NO_ENGINE_SELECTED_MESSAGE` が出るのは妥当か
2. **分類を `entities/engine` へ移したことで、公開面が増えていないか。**
   呼び手が1つしか無い型や定数を barrel に出していないか（このリポジトリが嫌う形）
3. **`deletePreset` を畳んだことで、`persist` が落ちた回の結末が変わっていないか。**
   選択だけが進んで永続化されない組み合わせができていないか
4. **文言を両方の入口に広げたことで、どちらの入口にも中途半端な案内になっていないか**
