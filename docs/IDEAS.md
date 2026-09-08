# IDEAS

「やるかもしれないが、6週間以内に着手しない」もの置き場。

**運用ルール**: issue を新規に立ててよいのは **6週間以内に着手するものだけ**。それ以外はここに1行で書く。
ここから issue に昇格するのは、6週間以内に着手すると決めたときだけ。

> 背景: backlog は持ち越すだけでコストになる。本当に重要なアイデアは何度でも戻ってくる。
> 以下は 2026-07-27 に `direction:maybe` ラベルごと整理したもの。**すべて issue として再オープン可能**（番号を残してある）。

---

## 解析キャッシュ永続化（旧 Phase 1 / #86–#89）

局面に解析結果を紐付けて保存する構想。4 issue に分解済みだった。

- #86 Rust `analysis_cache` モジュール（load/save + atomic write）
- #87 FE `entities/analysis-cache` + Provider 統合 + 自動書込
- #88 `KifuMoveCard` 解析済バッジ + AnalysisPane 履歴セクション
- #89 解析キャッシュの肥大化対策 policy

判断: 方針転換メモで「あると良い」＝必須ではない。解析は現状 transient で設計されており（Analysis aggregate は永続しない）、永続化は aggregate 境界の変更を伴う。T1 が片付くまで着手しない。

## 定跡まわりの周辺タスク（旧 Phase 4 / #102–#104）

- #102 解析キャッシュ import / export（JSON + CSV）← 上記が前提
- #103 AI Library UI を新 book formats に対応
- #104 `.sbk` 直接対応の調査タスク

判断: 定跡の read/write 本体（#84 #90–#101）が先。

なお ShogiHome は4形式の read/write/変換をテスト付きで実装済みだが、**それは捨てる理由にならない**。
判断の軸は「ShogiHome と張り合えるか」ではなく「将棋AI開発者の需要を取れるか」（→ `PREMISES.md` P-008）。
`.sbk` の仕様把握には ShogiHome の `src/background/book/sbk.ts` が参考になる。
**`.db.bin` は実在しないフォーマットなので #103 / #104 で拡張子を数えるときは注意すること**
（やねうら王のバイナリ定跡は `.ybb`）。

## 棋譜内しおり（#118）

「この棋譜の山場」を手にマークする機能。課題局面（study positions）とは別物。
判断: 注釈機能（marks / file-meta）の設計が未決着なので、それを決めるまで着手しない。
（「2系統に分裂」は誤りと判明している → `research/findings/L0-annotation-implementations.md`）

## #120 の積み残し（構造）

レビュー3ラウンドで「別 issue に送る」と判定した所見のうち、**失敗経路以外**のもの。
失敗経路に関わる分は #157 / #158 として issue にした。以下は構造的な負債で、
単独で着手する価値がまだ判断できていない。

- **局面の同一性キーが3系統3粒度ある** — Rust の `position_key_from_sfen` にまで及ぶ。
  横断検索は `PositionKey`(SFEN由来)、棋譜内は `tesuuPointer`、解析はまた別。**触るなら一度に揃える**
- **`tesuuPointer` の生成が3箇所に重複** — `CLAUDE.md` は「`indexOf(",")` によるパースの重複」と
  書いているが**該当0件**。実在するのは生成側の重複。記述を直すこと
- **`bridges` / `gates` の基準に合っていないファイルが2つ** — 基準そのものは
  `src/app/providers/RuntimeProviders.tsx` の doc にある（`gates/` は値を prop で渡す器、
  `bridges/` は effect で繋いで `null` を返す）。7ファイル中5つは一致していて、
  `AnalysisBridge` / `EngineRuntimeBridge` だけが gate の形で `bridges/` に居る。
  **揃えるのはファイル2つの移動と改名で済む**
- **`entities/` の公開境界が10スライス中2つ欠落** — 揃えるには3段階の順序が要る
- **`ModalType` union が上位層のスライス名簿を持っている** — 下位層が上位層の一覧を知っている
- **`app-config` ⇄ `engine-presets` の双方向依存** — `PresetId` を branded type にすると切れる
- **`convertJkfPiece` の到達不能コードと死んだ `isPromoted`**
- **Rust `open_project` にコマンド層・ドメイン・IO が同居**（144行）

**状態遷移表を他のモジュールに広げるかは未決。** いまは非同期・並行・外部プロセスが絡む箇所に
限って使う道具であって、規約ではない。

---

## 未 issue のアイデア

- **合流 / transposition を DAG として扱う** — ShogiHome issue #236（30コメント。**コメント数は2位で、ユニーク参加者は2名** → `research/findings/L2-transposition-demand.md`）が「木構造では千日手や局面の合流に対応できない、グラフを直接可視化・編集したい」と要求し未解決のまま。KIF/KI2/CSA いずれも仕様として合流を持たない。横断検索側は `PositionKey`(SFEN由来) なので既に合流に強く、棋譜内表現だけが木。**差別化の最有力候補**だが、着手前に現行 `normalizedTree` の設計影響を調べること
- **「ShogiHome で開く」導線** — エンジン/対局/検討 GUI を自前で磨くより価値が高い可能性
- **棋譜ブログ向けの出力** — ShogiHome #1271（複数棋譜横断の一括局面図）が 2025-07 から open のまま

## SCSS の既存の負債（`refactor/app-shell-wiring` のレビューで出たもの）

`.claude/reviews/2026-09-06-app-shell-wiring-r1.md` の ui reviewer が挙げたもの。
**その PR は SCSS を1行も触っていない**ので範囲外にした。どれも単独では
着手する価値を判断できていない。

- **`--kifu-w` が2ファイルで別の意味で定義されている** — `.kifu` が自分の上で
  `29rem` を再定義するので `.workspace` の `clamp(...)` は内側では見えない。
  1280px 幅で約4rem ずれる。`.kifu` を別の場所に置いた瞬間に 29rem 固定へ戻る
- **`AppLayout.scss` が widget のルートクラスを名指しで上書きしている** — 打ち消しに
  見える `border` / `box-shadow` / `background` は元の宣言が無く、何も打ち消していない。
  寸法の契約が page と widget の2ファイルに割れている
- **解析ペインの `--active` が効かない** — `.analysis-header__icon` が svg に直接
  `color` を宣言していて親の `color` が継承に負ける。オン状態の表現も
  「クラス」「`aria-pressed` だけ」「アイコン差し替え」の3通りに割れている。
  向きのトグルは `?pov=gote` が付いていても見た目が素の状態と同じ
- **閉じたサイドバーの `transition` が一度も走らない** — 実際に変わるのは親の
  `grid-template-columns` と登録されていないカスタムプロパティで、どちらも遷移しない。
  仕切り線もスロットと `.sidebar` の2箇所で別々の直値で引かれている
- **メディアクエリの breakpoint が13種類の直値で散っている** — 対象幅（1280px 以上）では
  1つも発火しない。共有の定義が `src/index.scss` に無く、`scssScale` のラチェットも
  `@media` の条件部を対象外にしている

## 到達しない分岐が、仕様では実在する状態として書かれている

`.claude/reviews/2026-09-06-app-shell-wiring-r2.md` の r2-10 の付随（ui reviewer）。
**SCSS の話ではない**ので上の節とは分けてある。

**この節は6週間ルールの例外。** #434 の前提なので、着手はそちらに引きずられる
（同じことを #434 のコメントにも積んである）。

- **`Board` の「盤面を読み込み中...」は到達しない** — `AppLayout` の `hasKifu` が同じ `view` を
  見て門番しているので、`Board` が描かれた時点で `player?.shogi` は必ずある。しかも
  `.board-loading` の CSS 規則はリポジトリに1つも無く、ビルド後の CSS にも出ない。
  **`docs/spec/screens/board.md` は2箇所でこれを実在する状態として書いている**——
  状態表の P0 と、「失敗の見せ方」の「局面が組めない → 『盤面を読み込み中...』のまま止まる」。
  #434（盤に載せられない棋譜のときに何かを出す）に着手する人はまずその画面仕様を読み、
  「盤が組めないときには既に文言が出る」と読む

## 呼び出し元の無い公開面が、スライスの barrel と context に残っている

`.claude/reviews/2026-09-06-app-shell-wiring-r3.md` の r3-17（architecture reviewer）。
`entities/file-tree/index.ts` は「ここに並ぶのはスライスの外に呼び出し元があるものだけ」を
規約として書いているが、機械が見ていないので守られているのは一部だけ。

- **barrel と context に、呼び手のいない口が残る。** `entities/search/index.ts` は
  型を中心に約30名を公開していて、スライス外の消費は7名。`entities/game` の context も
  5件が呼び手0。`sliceBarrels.test.ts` は「barrel が在ること」しか見ておらず、
  **未使用の export を数える走査は無い**。足せば落ちる
- **`entities/game` の context に呼び出し元0の口が5つ**（`setCurrentComments` / `isAtStart` /
  `isAtEnd` / `getCurrentMove` / `getCurrentComments`）
- **閉じるなら走査ごと入れる。** `src/__tests__/sliceBarrels.test.ts` の `publicModules()` に
  「公開する名前ごとにスライス外の出現があること」を足せば barrel 側は落ちる。
  `model/types.ts` の context インターフェースまで広げれば context 側も同じ形で落ちる

- 局面検索の `lib/virtual/VirtualList.tsx` は `react-window` の薄い包みで、スライスの知識を1つも持たない。`shared/ui/` へ出せる。あわせて `features/position-search/lib/` に state を持つフックと純関数が混在しているので、兄弟スライス（`board-orientation` など）と同じく `model/` を切るか決める（#447 r2 の architecture 所見）
- 局面検索の「1つの検索」という単位が `entities/search` に無く、`features` 側が rid・撃ち直しの重複除け・取り下げ・破棄を自前で組んでいる。`useSearchSession(sfen)` として下げると、モーダルから ref 2本と effect 2本が消える（#447 r2 の architecture 所見）
- **`entities/app-config/index.ts` は、直後のコメントが禁じている口を自分で開けている**
  （`loadConfig` / `saveConfig` を出しつつ「api を直に出さない。呼ぶのは `useAppConfig()` 経由」
  と書いている）。スライス外の呼び手は**0件**。落とすだけで済むが、上の走査を足せば
  この2本も一緒に落ちる。副作用として、いま `sliceBarrels` は
  「公開すべきでないと自分で書いたモジュール」への deep import を禁じている
  （#502 の r9 architecture 所見）
- **`entities/engine-presets` に barrel が無い**ので `sliceBarrels` が見ておらず、
  `model/types` も `model/provider` も外から素通しで読める。あわせて `PresetId` が
  `engine-presets` に居るせいで `app-config` との間にスライス単位の双方向依存ができている
  ——永続する欄（`last_preset_id`）を持つのは `app-config` の側。`import/no-cycle` は
  型だけの辺を見ないので黙る（#502 の r9 architecture 所見）

## `entities/engine` の context に、命令形の口が呼び手0のまま並んでいる

`initialize` / `shutdown` / `restart` / `clearError` / `state` は `EngineContextType` に
出ているが、**スライス外の読み手は `isReady` / `notReadyReason` だけ**
（`entities/analysis/model/provider.tsx` と `features/engine-position-sync`）。
`clearError` はリポジトリ全体で呼び手0。エンジンの寿命は `desiredRuntime` から導出する、
というのがこの provider の設計なので、命令形の動詞を context に出す理由が無い。

`restart()` の `Promise<boolean>` が結末5通りを1ビットに潰し、畳みの失敗だけ型の外
（reject）に出している件も、**降ろせば消える**——いま型を厚くすると、`isReady` /
`notReadyReason` という既存の観測面と二重に結末を語ることになる。

**`startingSeqRef`（起動の門）も同じ節で見ること。** `initialize_start` の重複以外に
**テストで観測できている**先が無い（実測）。ただし**外すと窓が開く**——`restart()` は
`await shutdown()` の間 `phase` が `ready` のままなので、その窓で `desiredRuntime` が
もう一度動くと effect が再入し、2本目が飛んでいる起動の結果を新しい設定のものとして
`activeRuntime` に書く（→ `docs/state-transitions/engine.md` の ※2 / 不変条件1、
`entities/engine/api/initializer.ts` の契約第1条）。**外すなら代わりに何を立てるかまで決めること。**

出どころ: #502 のレビュー r13（architecture）。

## 台帳が、閉じた issue を「これから直すもの」の追跡先に使っている

`docs/state-transitions/failure-surfacing.md` の §4 の散文が挙げる `#227` / `#200` /
`#314` / `#315` / `#157` は**5件とも closed**（2026-09-09 に確認）。§4 の見出しは
「まだ出口が無いもの」なので、読んだ人は追跡先が生きていると受け取る。
表の側（`#170` / `#171` / `#172` / `#179` / `#403` / `#434`）は全部 open で健全。

**判断: 6週間以内に着手しない。** 1件ずつ「本当に直ったか」を現物で確かめる作業で、
#502 の範囲外。着手するときは、直っているなら §2 / §4 の行ごと書き換え、
直っていないなら開き直すか #277 に寄せる。

出どころ: #502 のレビュー r14（oss-hygiene）。

## 解析の停止が、ロックを握ったまま別のロックを待つ

`.claude/reviews/2026-09-07-441-unmount-session-r2.md` の r2-21（rust reviewer）。

`EngineAnalyzer::stop_analysis` の
`if let Some(id) = self.infinite_listener.lock().await.take()` は、
`if let` のスクルーティニに置いたガードが本体の終わりまで生きるので、
**`infinite_listener` を握ったまま `protocol.remove_listener(&id).await`**
（`listeners` の write ロック待ち）に入る。同時に走る `start_infinite_analysis` は
そこで詰まる。

**判断: 6週間以内に着手しない。** いま環は無い（取得順は両者とも
`infinite_listener` → `listeners`）ので、利用者に見える症状も無い。`listeners` を握る側が `infinite_listener` を触る日が来ると環になる。
**文を分けて `await` の前にガードを落とすだけ**で消える。
clippy の `significant_drop_in_scrutinee`（nursery）が同じ形を拾う。

## 公開リポジトリとしての体裁が、配布物とドキュメントで揃っていない

`.claude/reviews/2026-09-07-441-unmount-session-r6.md` の所見（oss-hygiene）。
#441 の範囲外として持ち越した。**どれも `main` から在る。**

**判断: 6週間以内に着手しない。** 利用者に見える不具合ではなく、
公開の体裁（画像・前提・帰属）は T1 の機能が落ち着いてからまとめて直す方が安い。
帰属表示だけは配布を増やす前に要る——**Releases を人に配り始める回**が着手の合図。

- **README のトップ画像が古い。** 解析ペインのヘッダはボタン5つで、🔖（課題局面）が写っていない。
  仕様（`docs/spec/screens/analysis-pane.md`）と実装は6つ。README の Features にも
  課題局面が無いので、画像・機能一覧・仕様が揃って1機能を落としている
  （CONTRIBUTING は両方必須と書いている）
- **手元でビルドする前提が足りない。** Tauri の Linux 依存（`libwebkit2gtk-4.1-dev` ほか）は
  `.github/workflows/ci.yml` にしか無い。README と CONTRIBUTING の「前提」は
  同じ3行が二重にあり、片方だけ直すとまた食い違う
- **第三者コードの帰属表示が配布物に無い。** `src-tauri/Cargo.toml` は
  `license = ""` / `authors = ["you"]` / `description = "A Tauri App"` の雛形のままで、
  `package.json` にも `license` が無い。MIT / BSD 系はバイナリ配布でも著作権表示を求める。
  **`public/` に、どこからも参照されていない画像2枚が同梱されている**（`駒箱.jpg` /
  `kaya.jpg`）。`knip.json` の走査は `src/**` だけなので機械でも見つからない

**フォントは別**（→ #503）。`index.html` が読む Google Fonts は、アプリ自身の CSP に
オリジンが無いので**配布物では1本も読めない**。dev サーバには CSP が乗らないため
開発中と字面が違う。体裁ではなく不具合なので issue にしてある。

### 着手の合図は、もう過ぎている

`.claude/reviews/2026-09-07-441-unmount-session-r29.md`（oss-hygiene）。
上は「**Releases を人に配り始める回**が着手の合図」と書いているが、実測では
v0.1.0（2026-02-27）から v0.2.1（2026-03-21）まで**9本が既に公開済み**で、
README がそこへ利用者を誘導している。**帰属表示の判断は据え置けない。**

同じラウンドで挙がった、上に無いもの。

- **`CODE_OF_CONDUCT.md` に報告の連絡先が無い。** 「リポジトリ所有者に連絡」としか
  書いておらず、GitHub に非公開 DM は無い。公開 issue を立てさせるのは同じ文書の
  「報告者の身元は秘匿されます」と矛盾する。`SECURITY.md` の窓口を流用できる
- **CI が `verify` と同じものを走らせていない。** `test:hooks` と `ratchet:rustdoc` が
  抜けているので、`CONTRIBUTING.md` が「手で流してください」と書いた2つは
  誰も流さなければ緑のまま通る
- **`docs/` に索引が無い。** 直下に運用の記録（`IDEAS` / `PREMISES` /
  `OPEN-QUESTIONS` / `OPERATING-MODEL`）と利用者向け（`spec/`）が並び、
  アルファベット順で最初に来るのが「やらないこと置き場」
- **Rust の版が3箇所で違うことを言っている。** README と CONTRIBUTING は `stable`、
  `rust-toolchain.toml` は固定、`Cargo.toml` の `rust-version` は雛形の既定値
- **画面仕様2本が、`.gitignore` された `.claude/plans/` を設計の出典に挙げている。**
  外部の人は辿れない
- **`AGENTS.md` が `vp install` を指示している。** README / CONTRIBUTING は
  `npm install` で、`vp` はグローバル導入が前提の綴り

**ここに並べたものは issue にしない**（`docs/OPERATING-MODEL.md`）。着手すると決めた
時点で昇格すること。

## `entities/engine` の公開面が barrel と deep import に割れている

`.claude/reviews/2026-09-07-441-unmount-session-r12.md` の所見17（architecture）。

`entities/engine/index.ts` は provider・型・**戻るかどうかの分類1本**
（`isRecoverableNotReady`。意図して解析側へ跨がせている → `engine.md` の ※7）を公開しているが、`api/` は
**barrel を通さずに読まれている**（`rg -n '@/entities/engine/api/' src --glob '!src/entities/engine/**'`
で本物の import が10本。内訳は `aiLibrary` 6 / `tauri` 3 / `events` 1。ほかに `vi.mock` の行が4つ——`entities/analysis` のテスト2ファイルと `features/engine-position-sync` のテスト1ファイル）。
`sliceBarrels` はこれを見ない——禁止するのは barrel が実際に公開しているモジュールだけなので、
**公開しない限り深く読める**。

**判断: 6週間以内に着手しない。** 利用者に見える不具合ではない。
どちらへ寄せるかは `entities/engine` の公開面をまとめて決める作業で、
どちらを選んでも `features/settings` と `features/engine-position-sync` に波及する。

- **(a) `api/` を境界として認めて barrel に載せる。** 載せたモジュールの deep import が
  その瞬間に `sliceBarrels` の違反になる（`vi.mock` を含むファイルは免除）。
  `api/tauri` だけなら3ファイル（うち範囲外は `features/engine-position-sync` の1つ）、
  `api/aiLibrary` まで広げると `features/settings` の6ファイル
- **(b) `api/` を非公開のままにする。** スライスを跨ぐ語彙（`SeatReleasePoint` など）は
  跨がせず、呼び手側が自分で持つ。IPC の境界の型が緩む

## `SetupGuide` が親の状態をフラットに受けている

`.claude/reviews/2026-09-06-404-reveal-item-in-dir-r1.md`（react reviewer）。
`AiLibraryTab` の `ScanState` 1つが、`scanStatus` / `isScanning` / `scanError` の3つに
バラされて渡り、`data.engines_dir` も `enginesDir`（4状態）/ `enginesDirPath` に割れている。
状態を1つ足すたびに、親の派生・`Props`・子の分岐の3箇所を揃えて触ることになる。
`isScanning`（= `status === "loading"`）と `scanStatus === "loading"` が両方渡っていて、
**片方だけ更新しても型は通る。**

- props を `scan` と `library` の2つに畳んで、真実の源を1つのまま渡す
- `nextAction` を組む部分（hero）を切り出しても、**そこに閉じるコールバックは
  `onOpenAiRoot` の1本だけ**。残りは Step 側でも使うので、畳むなら Step へ渡す口ごと
  設計し直すことになる

## AI ライブラリタブの部品と SCSS の持ち主が別ディレクトリ

`.claude/reviews/2026-09-06-404-reveal-item-in-dir-r12.md`（architecture reviewer）。
`aiLibraryTab__step*` / `aiLibraryTab__tree*` の規則は `ui/tabs/AiLibraryTab.scss` に在るのに、
使う `.tsx` は `ui/ai-library-tab/` に7ファイル（そちらは `SetupGuide.scss` しか import しない）。
r11 で `types.ts` をこのディレクトリに新設したので、次の書き手は「AI ライブラリタブのものは
`ai-library-tab/`」と読み、新しい段のスタイルを `SetupGuide.scss` に書く——
`.aiLibraryTab` の入れ子の外に出て**何も当たらない**。tsc も lint も見ないので緑のまま通る。

- `AiLibraryTab.tsx`（+ `.scss` + `__tests__`）を `ui/ai-library-tab/` へ移して
  1ディレクトリ = 1画面にする（`engine-preset-dialog/` が既にその形）
- 移さないなら、`aiLibraryTab__step*` / `__tree*` の規則を `SetupGuide.scss` 側へ移す

## 「作成を出すのは無いときだけ」の理由が3箇所にある

`.claude/reviews/2026-09-06-404-reveal-item-in-dir-r12.md`（comment reviewer）。
`canCreateEnginesDir` の doc と、`AiLibraryTab` の `ENGINES_DIR_WARNING` の行内コメントと、
`EngineFilesSection` の JSX コメント。条件を変えた日（`other` でも作成を出す判断に倒す等）に、
述語の doc だけ直して2つが古い理由を主張する。理由は述語の doc に1つだけ置き、
呼び出し側は参照1行にする。

## 関数の本文に説明コメントが何行も続く関数が3つ

`.claude/reviews/2026-09-06-404-reveal-item-in-dir-r12.md`（comment reviewer）。
`AiLibraryTab` の `onPick`（本文26行に説明10行）と `revealOrNotify`（22行に9行）、
`SetupGuide` の `handleCreateFolder`（37行に8行）。
`CONTRIBUTING.md` の「関数本文の中に説明コメントが何行も必要になったら、関数を分ける合図」に当たる。
`onPick` は「ref の読み書きの順序」と「同じルートを選び直した回の再走査」という別々の判断を
1つの本文に抱えている。

## 画面の中だけで使う型の置き場に、逆向きの前例が2つある

`.claude/reviews/2026-09-06-404-reveal-item-in-dir-r12.md`（oss-hygiene reviewer）。
`features/settings/model/types.ts` の `ThreadsMode` / `HashMode` は
プリセット編集ダイアログの中だけで使われるのに `model/` に在り、
r11 が新設した `ui/ai-library-tab/types.ts` は「画面の中で閉じるならその場に置く」と
理由付きで名乗っている。どちらでも正当化できるので、散り始めると型を探す人が2箇所を見る。

## `EngineTab` が選択中のプリセット id を `console.log` している

`src/features/settings/ui/tabs/EngineTab.tsx` の、`selectedId` だけを依存に持つ `useEffect` の中。
`no-console` が lint に入っていないので落ちない。

**判断: 6週間以内に着手しない。** 出るのは開発者コンソールだけで、利用者に見える
不具合ではない。ただし**`console.log` は他のスライスにもある**し、この1行だけを消しても同じものがまた入るので、
着手するなら `no-console` を lint に入れるところまで。そのとき、
**`failure-surfacing.md` の §2 が「いま起きること」に `console.error` のみと書いている行は
全部残すこと**——あれらは台帳が数えている唯一の出口で、消すと失敗の手掛かりが1つも
無くなる（解析側の例は `useEngineSeat` の `shootQuietly`）。

出どころ: #502 のレビュー ラウンド1（robustness が範囲外として記録）。

## `engineKey` という名前が、2つのスライスで別の式に束縛されている

- `features/engine-position-sync` の `engineKey` は `` `${selectedPresetId}@${selectedPresetVersion}` ``
  ——**送信済み局面の記録**を捨てる鍵。中身が変わった回に外したい
- `widgets/analysis-pane` の `engineKey` は `selectedPresetId` だけ
  ——**候補手のキャッシュ**の鍵。version を含まないので、オプションを変えただけでは外れない

同じ名前で別の粒度なので、「`engineKey` が動けばキャッシュが外れる」と読んだ人が
両方に当てはめる（実際、#502 のレビューでその形のコメントを1本書いて指摘された）。

**同じ名前の問題ではなく、粒度の問題として実害がある**——ペインの鍵は version を含まないので、
**選択中のプリセットのオプションを変えて保存 → 起こし直しが落ちる**回に、
`cacheKey` が1ビットも動かない。解析が断たれて `state.candidates` が空になっても、
ペインは停止中にキャッシュを出すので**死んだ設定で出した読み筋がそのまま盤の下に残る**。
断りの読み手は0（→ #277）なので、画面には何の手掛かりも出ない
（#502 の r11 react 所見。**この PR の断りが案内している操作がちょうどこの窓を踏む**）。

**判断: 6週間以内に着手しない。** 改名は2スライスに跨り、鍵を1箇所から配る形
（`state.activeRuntime` の同一性など、実際に起きているプロセスを指す値）まで含めて決める必要がある。
着手するなら `syncKey` / `presetKey` のように**鍵ごとに違う名前**へ。正は
「同じ名前が別の式に束縛されていないこと」で、どちらを改名するかは問わない。

出どころ: #502 のレビュー ラウンド4（comment）。

## 自動再開に、差の出る筋を組めていない門が2つある

`.claude/reviews/2026-09-07-441-unmount-session-r29.md`（react reviewer）。
`provider.tsx` の追従 effect にある `bookIfRestarting()` と、`runRestart` の
`sentSfenRef` の門。**3ラウンド続けて、落としても全テストが緑になる筋しか作れていない。**
落とすのは危ない（差が無いことを示せていないだけで、無いことの証明ではない）が、
「効いている」と読める根拠も無い。**#489 で自動再開の8本の ref を切り出す回に、
機構ごと見直す対象として拾うこと。**

## `useEngineSeat` の doc が、`analysis.md` ※12 と同じ知識を二重に持っている

`.claude/reviews/2026-09-07-441-unmount-session-r29.md`（comment reviewer）。
`shootQuietly` の「落ちても利用者には出せない」の枝の列挙と `onEngineGone` の説明が、
※12 の「どの失敗で席が本当に残るか」と重なる。そのファイル自身が4箇所で
「理由は ※12 に1つだけ置いてある」と名乗っているので、方針と現物がずれている。
コメントとコードの比が 1.8:1 なのはその結果。**密度そのものは指標にしない**
（削るべき行を名指しできないので）。出典を ※12 に寄せる作業として拾う。

## 解析セッションの IPC が `entities/engine` に在るが、語彙は `entities/analysis` のもの

`.claude/reviews/2026-09-07-441-unmount-session-r30.md`（architecture reviewer）。
`SeatReleasePoint` の値（`unmount` / `no-position` / `late-start` / `late-restart` /
`sync-timeout`）は全部**解析ペインのライフサイクルと局面同期**の語なのに、型は
`entities/engine/api/tauri.ts` に在る。解析側が席を返す口を1本足すたびに別スライスの
IPC 型を編集することになり、その同期漏れを捕まえるためだけに `_EveryPointIsAssigned`
という型の仕掛けが要っている。**仕掛けの存在自体が置き場のずれの症状。**

解析の IPC（`startInfiniteAnalysis` / `stopAnalysis` / `AnalysisSessionId` /
`SeatReleasePoint` / `setupAnalysisEventListeners`）を `entities/analysis/api/` へ
移せば、同スライスに閉じて仕掛けを落とせる。呼び手は `entities/analysis` の2ファイルだけ。
**#524（席を取る口が3つ）と同じ回に決めるのが安い。**
