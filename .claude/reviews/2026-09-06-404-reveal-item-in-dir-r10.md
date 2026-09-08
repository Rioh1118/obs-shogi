# レビュー 404-reveal-item-in-dir ラウンド10

- 日付: 2026-09-07
- 範囲: `fix/404-reveal-item-in-dir`（`origin/main` = `89ba0270` に rebase 済み、r9 の修正まで）
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `6b848118`
- 前ラウンド: `2026-09-06-404-reveal-item-in-dir-r9.md`

所見は **16件**（18 → 21 → 24 → 20 → 13 → 14 → 6 → 11 → 9 → 16）。
重複を畳む前は19件。r9 の修正が作った所見が5件（R10-06 / R10-07 / R10-08 / R10-15 / R10-03）。

**このラウンドは変異を実際に当てている。** architecture と react が独立に r9 の3群へ変異を当て、
どちらも「当該テストだけが落ちる」ことを確かめた（react は15個の変異のうち14個が落ちた）。
落ちなかった1つが R10-13。

## 所見

### R10-13 [HIGH] `onCreateAiFolder` の関門にテストが1本も無く、切り替え後に**打った名前が消える**（react、変異で確認）

`createAiProfileDirs` の差し替えが `vi.fn()`（戻り値 `undefined`）なので、この関数を通るテストが
**1本も作れていない**。関門の1行を消しても20本すべて緑のままだった。

利用者に届く形はこう。AI 名を打って「作成」を押し、返る前に「選択…」で別のフォルダを選ぶと、
`createAiProfileDirs` は**旧ルートで成功済み**なのに関門が `null` を返す。
呼び出し元（`SetupGuide`）は `null` を「成功」と読んで**打った名前を消す**。
画面は新ルートの「AI フォルダ 0 件」のままで、作られたことも作られなかったことも伝わらない。
同じ回に名前の失敗（`already_exists` など）が返っていても握り潰される。

- 結果: 対応済み。戻り値を `FsError | "stale" | null` の3つに割り、`stale` の回は
  `setAiNameDraft("")` を通さない。`createAiProfileDirs` を握れる mock にして
  「切り替え後に返る回」のテストを足し、関門を消して落ちることを確かめた

### R10-14 [MEDIUM] `onPick` の `sameRoot` が、`await` の後に**自分の持ち物でない** ref を読む（react、実測）

`currentRootRef` は effect も書く（`aiRoot` が変わった回）。`await chooseAiRoot(...)` の後に読むと、
その瞬間 effect が進んでいれば**もう新しいルート**を読む。

いまは壊れていない —— `provider.tsx` の `dispatch({type:"updated"})` の直後に `return` するので
間に commit と effect が入る窓が無い。**壊れていない理由がこのファイルのどこにも書かれていない**のが問題で、
provider 側に `await` が1つ入れば反転する。react が `useAppConfig` を state を持つ形に差し替えた probe では、
実際に `sameRoot` が反転して新ルートの走査が2回走った（r8 が塞いだ症状がそのまま戻る）。
テストの `useAppConfig` は state を持たないので、この並びは**構造上再現できない**。

- 結果: 対応済み。判定の材料を `await` の**前**に取る（`onPick` が所有する）。並びから独立する

### R10-02 [MEDIUM] `EnginesDir` の3人目の読み手だけ状態を網羅していない（architecture / robustness の2名）

プリセット編集ダイアログの帯（`EngineFilesSection`）は文言を三項で2つに畳んでいる。
同じ型を読む2人（`SetupGuide` / `StructureOverview`）は理由まで書いて `Record` で持っている——
「表を引く手前に三項を置かない。置くと表の行が到達しなくなり、そこを書き換えても画面が変わらないまま緑で通る」。

状態が増えるのは想像上の話ではない。`EnginesDir` の doc 自身が #469（リンクの分類）を名指ししている。
`link` を足した日、`Record` の2人は tsc が落として書き足しを強制するが、**このダイアログだけは
フォルダを指すリンクが在る回に「engines/ ディレクトリが存在しません」と言い、絶対パスまで添える**。

`enginesDirPath` の鎖（`index?.engines_dir.path`）も、隣（`AiLibraryTab`）と違って途中の `?.` が抜けている。

- 結果: 対応済み。文言を `Record<EnginesDir, string | null>` にし、`unknown` は `null`（帯を出さない）。
  帯の条件を分類そのもので書き、`?.` を揃えた。仕様の表にも `unknown` の行を足した

### R10-12 [MEDIUM] 索引を読めていない回に、木だけが「AIフォルダを作成」と断言する（robustness、実測）

`StructureOverview` には `indexed` が渡っていない。`SetupGuide` の StatusCard は
`indexed` で「読めていない」と「0 件」を分けている（その理由も prop の doc にある）のに、
木のプロファイル行だけがその区別を持たない。

外付けを外す → 再スキャンが落ちる → hero もカード3枚も「読めていません」で揃うのに、
木だけが「← AIフォルダを作成」と指示する。しかもその状態では入力欄も段も描かれていない。
初回のスキャン中（`last === null`）にも必ず一度出るので、正常な利用者にも毎回ちらつく。

- 結果: 対応済み。`indexed` を必須 prop にして（渡し忘れは tsc が落とす）、
  読めていない回はこの行の note を出さない

### R10-01 [MEDIUM] gate の capability の割り当てが、ts と rust で書式の広さが食い違う（architecture / comment / oss-hygiene の3名、実測）

```
src-tauri/capabilities/default.json  -> [ts rust]
src-tauri/capabilities/default.toml  -> [ts]
```

読む側（`openerCapability`）は「書式（単体・配列・JSON5・TOML）に依らず綴りを見る」と名乗り、
実際に拡張子を問わず歩く。`capabilities/desktop.toml` を足して `core:` を打ち間違えたコミットは
ゲートでは ts しか走らず（ts が見るのは `opener:` だけ）、赤くなるのは push 後の CI になる。
R9-01 が閉じた穴が「拡張子次第で開く」形で残っている。

- 結果: 対応済み。rust 側の枝を `src-tauri/capabilities/*` に揃え、
  `verify-gate.test.sh` に `.toml` の行を1本足して、2つの case が同じ木を指すことを固定した

### R10-06 [BLOCK] テストの doc「押せる復帰の口が1つも残らない」が、同じ枝の別の doc と実装の両方に反する（comment）

r9 で書いた行。`AiLibraryTab.tsx` の `revealFailureNotice` の doc は逆を書いている——
「**「選択…」は常設で**、…」。実装でも主カラムの「選択…」は `disabled` を持たない。

この doc は「進行中も `last` を持ち歩く」設計の唯一の根拠として置かれている。
根拠を検算した人には外れて見えるので、`ScanState` を単純化しようとした人は
「この doc は嘘だから設計も要らない」と読む。

- 結果: 対応済み。失われるものを engines に対する操作（開く・作る・段）に限って書いた

### R10-07 [HIGH] `ScanState` の doc の「だから作成ボタンは出ない」が、2通りに読めて片方は偽（comment）

r9 で書いた行。「捨てると」の続きと読めば正しいが、現在の姿の記述と読むと
「スキャン中は作成ボタンが消える」という起きないことになる（捨てないので `missing` のまま残り、
`disabled` になるだけでボタンは在る）。

さらに「出ないことが問題」という評価が、`EnginesDir` の doc（`unknown` で作成を勧めないのは意図した規則）と
`docs/spec/screens/settings.md`（読めていない回に作成を出さないのは正しい、と理由付きで宣言）に
真正面からぶつかる。`unknown` の扱いを触る人が、どちらを正として直せばよいか決められない。

- 結果: 対応済み。条件を段落の頭へ戻し、失われるものを「作成ボタン」から「開く口と手順書の段」へ寄せた

### R10-15 [MEDIUM] `not.toHaveBeenCalledTimes(4)` は、その test が名乗る性質を1つも表していない（react、実測）

実測の呼び出しは3回。この行は「ちょうど4回ではない」しか言っておらず、0回でも3回でも5回でも通る。
関門を壊す変異を殺しているのは次の行だけ。正当な理由でスキャンが1回増えた将来の変更では
**この行だけが赤くなる**ので、読んだ人は数字を書き換えて緑に戻す——それでも何も守られない。

- 結果: 対応済み。r9 で足した兄弟テストと同じ形（走ったルートの列を `toEqual` で見る）に揃えた

### R10-08 [MEDIUM] テストの doc が位置（「上の2つ」）でテストを指していて、指せている先が違う（comment）

r9 で書いた行。直前の2本のうち1本（「engines/ を作成したら、読み直して開けるようになる」）は
ルートを切り替えないので**関門を1度も跨がない**。関門を跨ぐ2本の間に無関係な1本が挟まっている。
テストを1本挿し込むだけで、この参照は静かに別のテストを指す。

- 結果: 対応済み。位置ではなくテスト名で指す

### R10-09 [MEDIUM] `currentRootRef` の doc の「3つ」が、同じ doc の6行下で4つ目を挙げている（comment）

`onPick` も `await chooseAiRoot(...)` を跨いでいるので、`scanNow` 以外で `await` を跨ぐ場所は4つある。
数え上げた主張が同じブロックの中で自分に反例を出している（この doc は R5-06 / R8-05 で2回書き直している）。

- 結果: 対応済み。数を「ここで関門する口」に限った

### R10-10 [MEDIUM] `openerCapability` の doc が `codeOf` の落とすものを取り違えている（comment）

`codeOf` は行コメントも落とす。落とさないのは「行頭で開かないブロック」。
結論（JSX コメントは母数に残る）は正しいが、根拠が逆向き。赤くなった人が行コメントを疑って探すことになる。

- 結果: 対応済み

### R10-11 [MEDIUM] mock の理由を書いたコメントが、別の宣言の上に着いている（comment）

「差し替えるのは実体の側。barrel を差し替えると再 export の全部が消える」が `aiRootValue` の上にある。
説明している先は13行下の `vi.mock(...)`。

- 結果: 対応済み（R10-13 の修正と同じコミット。同じファイルの同じ宣言まわりを触るため）

### R10-03 [MEDIUM] `readdirSync` の例外の一覧が、rebase 後の現物に3例目を落としている（oss-hygiene）

r9 で「例外は2つ」と書いたが、`docsIdentifiers.ts` が `.claude/hooks/*.sh` を `readdirSync` で列挙して
**中身を読んでいる**。これは rebase で取り込んだ main（#446）が入れたもので、
例外の一覧はその後に書かれている——rebase 後の現物を見ずに書いた形。

- 結果: 対応済み。`docsIdentifiers.ts` の走査を `sourceFiles(HOOKS)` に置き換えた
  （`sourceFiles` は `.sh` を拾い、`.claude/hooks/` に下位ディレクトリは無いので集合は変わらない）。
  例外は2つのまま。`stateTransitionIndex` の説明は「表の名前を数える」と
  「`docs/**` の `.md` を列挙する」に割った

### R10-04 [MEDIUM] `settings.md` の #475 の行が、いま起きないことを書いている（oss-hygiene、実測）

「『下のフォームから作成できます』が、そのフォームが無い回に出る」と書いてあるが、
ヒントを出す条件とフォームを描く条件はどちらも `enginesCount > 0` になっていて、
ヒントが出る回はフォームも必ず描かれる。残っているのは**条件が2箇所にある**ことで、症状ではない。

- 結果: 対応済み。症状ではなく現状（条件の重複）で書き直した

### R10-05 [LOW] 台帳の F-32 の行に同じ句が2度あり、実在しない注（※6）を指している（oss-hygiene）

この枝の rebase 由来ではなく、`origin/main` にそのまま在る（#420 が入れたもの）。
同ファイルに定義されている注は ※5 だけ。読み手は「※6 に続きがある」と思って探すことになる。

- 結果: 対応済み。重複した前半を落とし、`#443` を指す後半だけ残した。
  **この枝で直す**——同じ表の隣の行を書き換えている PR で、次のラウンドでも見え続けるため

### R10-16 [MEDIUM] レビュー用 agent が、リポジトリに存在しない関数名で規約を引いている（architecture）

`.claude/agents/architecture-reviewer.md` が `buildTesuuPointer` を規約の出典として名指ししているが、
`grep` は0件。現物の規約は `entities/kifu/model/cursor.ts` が持ち、名乗っているのは
`ROOT_CURSOR` と `makeKifuCursor`。この agent を走らせるたびに、実在しない規約に対して
「違反0」か「全件違反」のどちらかが書かれる。

- 結果: 対応済み。**#404 の範囲の外だが独立して直せるので別コミットにした**（`/implement` 手順7）。
  出典をファイルの doc に寄せ、関数名を agent 側に二重に持たない形にした

## 重複・矛盾した所見

- **gate の capability の綴り**（R10-01）は3名が独立に挙げた。3名とも直し方は同じ（rust 側を `*` に広げ、
  `.toml` のケースを固定する）で、矛盾は無い
- **`EnginesDir` の網羅**（R10-02）は architecture（型が増えたとき tsc が黙る）と
  robustness（`scanReady` を緩めた人が `unknown` に嘘を言わせる）が別の理由で同じ箇所を挙げた。
  直し方（`Record` に寄せる）は一致
- **R10-06 と R10-07 は同じ r9 の修正から出ている**が、逆向き。R10-06 は「復帰の口が残らない」が
  言い過ぎ、R10-07 は「作成ボタンが出ない」が条件抜きだと偽。両方を満たす書き方は
  「捨てた回は `unknown` に落ちる。作成を出さないのは規則どおりで、**同時に開く口も閉じる**のが問題」

## 見ていない範囲

- **実機を誰も動かしていない。** Finder / Explorer / Linux のファイル管理ソフトが実際に開くか、
  toast が6秒で消えるかは1度も確かめていない（r1 から10ラウンド続けて同じ）
- ネイティブのフォルダ選択が開いている間に「選択…」をもう一度押せるか（Tauri の挙動を確かめる手段が無かった）。
  押せるなら `onPick` の失敗枝に関門が要る
- `dedupeKey` が同じ通知を provider が実際にどう畳むか（差し替えか無視か、タイマが延びるか）は読んでいない。
  「連打しても1枚」はテストの主張を確認していない
- SCSS（`AiLibraryTab.scss` / `SetupGuide.scss`）。`ui-reviewer` は走らせていない
- Rust 側（`ai_library/{dir,scan,engines}.rs`）。この枝の Rust の差分は capability の10行削除だけ
- `src/features/settings/ui/ai-library-tab/steps/` のうち `Step1SelectRoot` / `Step2CreateEngines` /
  `Step4PlaceAssets` / `FolderConcept` / `StepTree`
- r1〜r8 の所見が全て塞がっているかの通読

## lint / hook で強制できるもの

- R10-02 は **tsc が強制する**（`Record<EnginesDir, …>` に直せば、状態が増えた日に落ちる）。追加の検査は要らない
- R10-12 も **tsc が強制する**（`indexed` を必須 prop にする）
- R10-01 は `verify-gate.test.sh` に1行足すだけで固定できる
- R10-16 は走査で拾える。`docsIdentifiers` は既に `.claude/hooks/*.sh` を歩いているので、
  起点に `.claude/agents/*.md` を足せば同種の腐りは以後コミット時に落ちる。
  **ただしこのラウンドでは足さない**——`/implement` の「同じ失敗を2回するまでルールを足さない」に従い、
  1回目はルールではなく現物を直す
- R10-13 / R10-14 / R10-15 / 残りの doc の所見は機械では取れない

## 検証

- `npm run verify` … 通る（91 files / 872 tests、`verify-gate.test.sh` は assertion 204 本）
- `npm run verify:rust` … 通る

## 修正計画

上から順に直す。**R10-13 → R10-14 → R10-15 が先**（振る舞いを変えるものと、
それを守るテストの弱さ）。次に型で強制できる2件（R10-02 / R10-12）、
次に機械の側（R10-01 / R10-03）、最後に doc（R10-04 〜 R10-11 / R10-05 / R10-16）。

その修正が壊しうるもの:

- **R10-13** は戻り値の型を変えるので、`SetupGuide` の呼び出し側と、
  「名前の失敗は欄のそばに出す」という r1 からの性質に触れる。`stale` を「名前の失敗」に畳むと
  打った名前が消えないまま欄に赤字が出る形になり、別の嘘になる。**3つに割ること**
- **R10-14** は `sameRoot` の材料を早く取るので、「同じルートを選び直したら読み直す」
  （r9 で足した）が通り続けることを確かめる。effect が先に走る並びでは
  `before` が旧ルートなので `sameRoot` は false になり、effect 側が読む——結果は同じ1回
- **R10-02** は `unknown` で帯を出さなくするので、いま `scanReady && index` が塞いでいる経路と
  重なる。両方を残すと二重の門番になるため、**分類そのもので書く**
- **R10-12** は必須 prop を増やすので、`SetupGuide` 側の呼び出しを同じコミットで直さないと tsc が落ちる
- **R10-01** は rust 側の枝を広げるので、`verify-gate.test.sh` の既存の期待
  （`src-tauri/tauri.conf.json` → `rust`）に影響しないことを確かめる
- **R10-03** は `docsIdentifiers` の走査対象が変わる。集合が同じであることを、
  置き換え前後で列挙して確かめること（減ると検査が黙る）

次ラウンドの焦点: この修正群が「戻り値の型」「必須 prop」「走査の集合」を動かすので、
**R10-13 の3値と `SetupGuide` の分岐が全部の組み合わせで正しいか**、
**`docsIdentifiers` が置き換え後も同じファイルを見ているか**、
**`Record` に寄せた文言が現物の画面と1行ずつ合っているか**。
