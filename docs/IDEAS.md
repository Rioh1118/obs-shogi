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
  `bridges/` は effect で繋いで `null` を返す）。**合っていないのは
  `AnalysisBridge` / `EngineRuntimeBridge` の2つ**で、どちらも gate の形で `bridges/` に居る
  （数は書かない。橋を1本足すたびに腐る）。**揃えるのはファイル2つの移動と改名で済む**
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
- **`AsyncResult` のラチェットが、深いプロパティ経路の呼び出しを見ていない** —
  `src/__tests__/asyncResultUse.test.ts` の `bareCallOf` が拾えるのは `await f(` と
  `await obj.f(` の2形だけ。`await a.b.c(` と `await a!.b(` は素通りする。
  いま素通りしている 15 行は全て test か `AsyncResult` を返さない呼び出し
  （`navigator.clipboard.writeText`）なので**本番のコードで漏れているものは無い**が、
  緑を「戻り値を捨てている箇所は無い」と読める状態ではない。
  **正規表現を1箇所広げるだけでは済まない**——広げた瞬間に 15 行が赤くなり、
  1件ずつ「読むべきか、印を付けるべきか」を決めることになる。まとめて着手するときに
  1度で決めること

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
- **解析ペインの帯の右余白だけが器の幅に比例する** — `padding-right: clamp(4rem, 18%, 20%)`
  で、ペインを広げるほど道具の並びが中央側へ寄る。左は `4rem` 固定で非対称。
  **なぜ右だけ空けるのかが現物からも履歴からも復元できない**（`419bd5df` で `20%` として
  登場し、`cc8ec2d4` で軟らかくなったが、どちらのメッセージにも理由が無い）。
  避けている相手があるのか、見た目の判断なのか、名残なのかが読めないので**動かせない**。
  #113 の C18 が「この余白の『なぜ』を書く」を予定していたが、
  **推測で「なぜ」を書くのは腐ったコメントを1つ足すのと同じ**なので書かずに残した

## `.tsx` のインライン直値が、どのラチェットにも数えられない（#436 のレビューで出たもの）

`.claude/reviews/2026-09-08-436-error-boundary-layers-r1.md` の r1-21（ui reviewer）。
**その PR では直値そのものを消した**ので、走査は要らないまま残した。

- `scssScaleRatchet` も `contrastRatchet` も `scssFiles(SRC)`（`.scss` だけ）を歩く。
  `tsFiles` を歩いて `style={{` の中の長さ・色リテラルを数えれば、「ここだけは直値でよい」という
  例外が意図した数に留まっていることを機械で保てる。**いまは例外が無言で増やせる。**
  実測は ADR-0003 の「諦めるもの」が持つ

## 到達しない分岐が `Board` に残っている

`.claude/reviews/2026-09-06-app-shell-wiring-r2.md` の r2-10 の付随（ui reviewer）。
**SCSS の話ではない**ので上の節とは分けてある。

- **`Board` の「盤面を読み込み中...」は到達しない** — `AppLayout` の `hasKifu` が同じ `view` を
  見て門番しているので、`Board` が描かれた時点で `player?.shogi` は必ずある。しかも
  `.board-loading` の CSS 規則はリポジトリに1つも無く、ビルド後の CSS にも出ない。
  **仕様の側は直してある**（`docs/spec/screens/board.md` の P0 の※）。残っているのは
  枝そのものを畳むかどうかで、畳むなら `GameView` の `hasKifu` の doc が言う
  「`?.shogi` を残してあるのは `cursorView` の catch を将来ゆるめたときの保険」と
  一緒に決めることになる

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

## `entities/game/lib/moveValidation.ts` に、本番から到達しない駒打ちの規則が6つ残っている

#113 のレビュー（architecture reviewer）。`hasFuInColumn` / `canDropFu` / `canDropKe` /
`canDropKy` / `isInCheck` / `isUchifudume` は knip の未使用 export 一覧に載っている。二歩と行き所のない駒の
規則を、`entities/position/lib/inspectPosition.ts` が別の表現（`getIllegalUnpromotedRow`
と同じ式）で書き直したので、**同じ規則が2通りある**。片方だけ直すと、対局の駒打ちと
組む面の断りで規則が割れる。

到達しない側は `canDropKe` が `[1, 2]` / `[8, 9]` の直値、新しい側が
`illegalUnpromotedRow` × `rowToOppositeEnd` の式。消すか、`inspectPosition` を呼ぶ
薄皮にするかは、対局側で駒打ちの検査をいつ使い始めるかで決まる。

## `entities/app-config` と `entities/engine-presets` が互いを読んでいる

#113 で同層横断の走査（`src/__tests__/crossSliceImports.test.ts`）を入れたときに出た。
`import/no-cycle` は**輪になるまで黙っている**ので、往復しているだけでは落ちない。
輪でなくても、2スライスが互いを読む形は「どちらが器か」を消してしまう。

走査には `KNOWN_MUTUAL` として1組だけ控えてある。**新しく増えたら赤くなる**ので、
放置しても悪化はしない。直すなら片方の向きを消す（控えを伸ばすのは直し方ではない）。
どちらを器にするかは、エンジンの設定をどちらが所有するかの判断になる。
