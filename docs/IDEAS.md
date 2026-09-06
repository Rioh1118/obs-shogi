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

- **`entities/search/index.ts` は41個を公開していて、外に読み手があるのは6個。**
  `EVT_*` 7つと `searchPosition` / `searchPositionBestEffort` / `cancelSearch` /
  `listenSearchEvents` は外の読み手0。`listenSearchEvents` を barrel から呼べば
  `isListenSettled` を経ずに購読が二重に張れる。`WorkspaceTab` が `IndexState` の union を
  手で写しているので、そこだけは**落とすのではなく import させる**のが正しい向き
- **`entities/game` の context に呼び出し元0の口が5つ**（`setCurrentComments` / `isAtStart` /
  `isAtEnd` / `getCurrentMove` / `getCurrentComments`）
- **閉じるなら走査ごと入れる。** `src/__tests__/sliceBarrels.test.ts` の `publicModules()` に
  「公開する名前ごとにスライス外の出現があること」を足せば barrel 側は落ちる。
  `model/types.ts` の context インターフェースまで広げれば context 側も同じ形で落ちる

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
- **PR テンプレートの検証チェックリストが CONTRIBUTING より狭い。**
  「TypeScript を触った場合 / Rust を触った場合」の2行しかないので、
  `docs/state-transitions/` だけを触る PR は**どちらにも当てはまらない**と読める
  （CONTRIBUTING は両方必須と書いている）
- **手元でビルドする前提が足りない。** Tauri の Linux 依存（`libwebkit2gtk-4.1-dev` ほか）は
  `.github/workflows/ci.yml` にしか無い。README と CONTRIBUTING の「前提」は
  同じ3行が二重にあり、片方だけ直すとまた食い違う
- **第三者コードの帰属表示が配布物に無い。** `src-tauri/Cargo.toml` は
  `license = ""` / `authors = ["you"]` / `description = "A Tauri App"` の雛形のままで、
  `package.json` にも `license` が無い。MIT / BSD 系はバイナリ配布でも著作権表示を求める
