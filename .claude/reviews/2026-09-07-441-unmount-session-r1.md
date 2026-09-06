# レビュー 441-unmount-session ラウンド1

- 日付: 2026-09-07
- 範囲: `git diff main...HEAD`（`fix/441-stop-analysis-on-unmount`、4コミット）
  — `src/entities/analysis/model/provider.tsx` / 同テスト / `docs/state-transitions/analysis.md` / `docs/spec/screens/analysis-pane.md`
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `02c68520`

## 所見

### [HIGH] 1. 席を握った事実が effect 経由でしか残らず、dispatch と unmount が同じバッチに入ると誰も返さない

reviewer: architecture / react（独立に同じ根に到達、どちらも実測）

`analyzingRef` / `sessionIdRef` を書くのは `provider.tsx:80-83` の passive effect だけ。
`startInfiniteAnalysisCore()` が解決した直後に畳まれると、

- `unmountedRef` の門（`:283` / `:370`）は「まだ畳まれていない」を見て素通りし `dispatch` へ進む
- 直後の unmount で cleanup の門（`:143`）は両方空を見て早期 return

停止が1本も飛ばず、席が残る。**#441 が直したかったものが、狭い窓の中にそのまま残っている。**
両 reviewer が一時テストで `stopCore.mock.calls === []` を実測している。

入口は「開始の応答と `app-config` のエラーが同じレンダバッチに入る」＝ `RequireRootDir` の差し戻し。

### [HIGH] 2. 再開の最中に停止ボタンを押すと、後から返った応答が解析を再開させる

reviewer: react / robustness（どちらも実測）

`stopAnalysis` は `restartSeqRef` を上げるだけ（`:387`）で、in-flight のクロージャは
`await` の後に世代を見ない。実測値:

```
{ isAnalyzing: true, sessionId: "session-2", stops: [["session-1"], ["session-1"]] }
```

■ を押したのに `isAnalyzing` が true に戻り、`session-2` の探索が走り続ける。
撃たれた停止は2本とも古い ID。`analysis.md` ※10 が「表で追えていない」と書いていた穴の実体。
**今回 `unmountedRef` の門を足した、まさにその行の隣。**

### [HIGH] 3. 追加した3つの `.catch(() => {})` が、唯一の観測点で証拠を捨てている

reviewer: robustness

`:150` `:284` `:371`。`:284` / `:371` が reject する主経路は `stop_session` の照合失敗
（`bridge.rs:473-476`）＝**別のセッションが席に居る**ときだけで、その分岐は
`analyzer.stop_analysis()` を呼ばずに返る（畳まれた画面のための `go` が止まらない）。
`:150` が届く前に落ちれば #441 がそのまま再発し、その後の利用者体験は
「▶ を押しても何も起きない」（※4）。**この catch が最後の防壁で、抜けられたら誰にも届かない。**
同じファイルの `safeUnlisten`（`:72`）は無視する失敗に `console.debug` を残している。

### [HIGH] 4. コメントが書いた「なぜ」が、doc ※13 と正反対

reviewer: comment

`provider.tsx:280-282` は「そのとき席は既に Rust に在り…後始末は先に走り終えているので誰も返さない」。
`analysis.md:122-123` は「席は**後始末が走り終えた後に**作られる」。**同じ窓について2つの文書が反対を言う。**
後始末は ID を使わない一括停止なので、「既に在る席」ならむしろ返せている。
このガードが要るのは `take_session` が一括停止より後に走った回。

同種の食い違いが `:367-369` にもある。「上限いっぱいの2秒待つ」は `waitUntil`（`:356`）の話で、
それは `startInfiniteAnalysisCore()` の**前**＝このガードが守る窓の外。

### [HIGH] 5. 表に `S0/P1` の行が無く、追加したテストが表のどのセルにも対応しない

reviewer: oss-hygiene / comment

手動開始の応答待ちはフロント S0（`isAnalyzing === false` / `sessionId === null`）・Rust P1。
表は `S0/P0` しか持たず、その E13 は `—`。一方 ※13 は「手動開始（E1）と自動再開の両方が同じ形」と書く。
**表と注が反対を言っている。** ※7 の後（停止失敗で `sessionId` を捨てた状態）も `S0/P1` に入る。
この文書の冒頭は「3つ目の状態機械を列に入れ忘れたことで #120 の BLOCK が入った」と書いている。

あわせて不変条件5「※12・※13 がこれを守る」は、※7・※6 の経路で破れる
（両 ref が空なので cleanup の門が閉じる）。不変条件1が「※1・※7 がこれを破る」と
破る側を名指ししているのと不揃い。

## MEDIUM

6. **席の出し入れが6箇所・3方針に散っている**（arch / react）。
   `:150` `:240` `:263` `:284` `:371` `:396`。`:284` と `:371` は4行まるごと同一。
   「席は誰が取り、いつ返すか」を1箇所で読めないので、経路を1つ足すたびに返し忘れが1つ増える
   （#120 → #365 → #441 で3回目）。
7. **「Rust に席を持っているか」を2箇所が別の式で、別の答えで決めている**（arch）。
   `:143` は `isAnalyzing || sessionId`、`:390` は `isAnalyzing && sessionId`。
   S6（`set_error` で `sessionId` だけ残る）で答えが割れる。
8. **無指定 `stop_analysis` は今回はじめて実際に使われる形なのに、境界の両側にテストが無い**（robustness）。
   Rust 側に `stop_analysis_impl(None)` を通る `#[test]` は0本。TS 側は `api/tauri` を丸ごと mock。
   受け渡しが壊れても**新規テストは全部 green のまま**。
9. **テストのコメント2件が実装と食い違う**（comment）。`provider.test.tsx:219` は
   「席の ID を誰も知らない」と書くが、止まる理由は門の早期 return。`:259-260` は
   「後始末が止めたのは古い方」と書くが、後始末は引数なしで撃つ（同ファイル `:168-170` が
   `toHaveBeenCalledWith(undefined)` で固定している）。
10. **cleanup 本文が実コード5行に対しコメント13行**（comment）。effect の頭は
    「タイマーを止める」しか名乗っておらず、席の後始末を探す読み手が辿り着けない。
11. **`stopAnalysis()` の「引数を省くと全部止まる」契約が公開面のどこにも無い**（comment）。
    `tauri.ts:84` に TSDoc 無し、`bridge.rs` の `stop_analysis_impl` だけ `///` 無し。
12. **「台帳」が2つの別物を指す**（comment）。Rust 側で 台帳 = `EngineRegistry`。
    `active_sessions` の中身は既存コメントでは一貫して「項目」。
13. **E12 だけ列が無いまま E13 を列に足した**（oss-hygiene）。イベント13件・列12本。
    `README.md` の「セルは必ず埋める」と、`game-session.md` が E1〜E18 を残らず持つのに対して不揃い。
    `—` の凡例も analysis.md には無い。
14. **新しい握り潰し2箇所が `failure-surfacing.md` の台帳に載っていない**（oss-hygiene）。
    結末は F-7 と同一（席が残り以降の開始が全部弾かれる／復帰導線はエンジン再起動）。
15. **`analysis-pane.md:82` の参照だけリンクになっていない**（comment）。
    同じ表の他の行は `→ [engine.md](../../state-transitions/engine.md)` 形式。

## 重複・矛盾した所見

- 所見1は architecture と react が独立に、別の実測で同じ根に到達した。**直し方の提案も一致**
  （席の在処を state の写しから導かず、握った行で立てる ref にする）。
- 所見2は react と robustness が同じ再現値を出した。**両者とも「範囲外なら issue 化」と留保**している。
- 所見5は oss-hygiene と comment が別の入口（表の行／注の記述）から同じ欠けを指した。
- 矛盾は無し。

## 見ていない範囲

- `npm run verify:rust` / `cargo test` は誰も走らせていない（この PR は Rust 未変更）。
- Rust 側の並行性——unmount の `stop_all_sessions` と、同時に飛んでいる
  `start_infinite_analysis_impl` の `take_session` がどちらの順でも収束するか
  （`analyzer.rs` の `stop_analysis` 前後を読み切っていない）。
- 「畳んで開き直す」再マウント窓。ワークスペースの選び直し（ネイティブのピッカー）が挟まるため
  筋を組み立てられず、所見にしていない。
- `features/engine-position-sync`（`syncPosition` が畳まれた後に何をするか）。
- 差分に含まれる #420 由来のファイル（`position-search` 系）は範囲外。

## lint / hook で強制できるもの

- **空の `.catch(() => {})`**。oxlint の `no-restricted-syntax` で拾える。所見3は全部これで防げる
  （既存にも `:240` に1件ある）。
- `startInfiniteAnalysisCore` / `stopAnalysisCore` を呼ぶ口を1モジュールに閉じる
  `no-restricted-imports` の override。席を取る／返す口が増えたら lint で落ちる。
- **イベント一覧に在る記号が `## 表` の列見出しに無い**（所見13）は機械で落とせる。
  `state_transition_cells.rs` は `game-session.md` 決め打ち（`:66-72`）なので、
  **analysis.md をどう書き換えても Rust 側は何も見ない**——「両方通した」を
  表の正しさの根拠に読まないこと。
- 所見1・2・4・5・9・10 は機械では止まらない。

## 修正計画

`/review-plan` が書く（下記）。

### 束ね方と順

所見1・6・7 は**同じ根**（席の真実の源が state の写しに散っている）。1本の修正で3つとも消える。
所見4・9・10 は1の直し方が決まるまで書けない（説明する対象が変わる）。
所見5・13・14・15 は doc だけで閉じる。所見2は独立。

1. **所見1・6・7 → 席を持つ ref を1本立てる**（`seatRef: useRef<string | null>`）。
   `startInfiniteAnalysisCore()` が解決した行で代入し、返し切った行で戻す。
   cleanup の門・`stopAnalysis` の門を両方これで書く。
   **停止が失敗したときは戻さない**——※7 の経路（フロントだけ S0）で畳んでも席を返しにいける。
   壊しうるもの: StrictMode の setup→cleanup→setup で撃たないこと（既存テストが見ている）、
   `onComplete`（Rust 側が席を片付ける）で戻し忘れると、畳むたびに空撃ちが1本出る。
2. **所見2 → 世代の門を `unmountedRef` の隣に置く。** 抜けるときは席を返す。
   壊しうるもの: `pendingAfterRef` の再開予約と噛み合うか（世代で抜けた回の `finally` は
   そのまま走る）。
3. **所見3 → `console.warn` に痕跡を残す。** `safeUnlisten` と同じ形に揃える。
4. **所見4・9・10・12 → コメントを1〜3の結果に合わせて書き直す。**
   「〜だから」と書いた条件が、コードのどの行かを指せることを1件ずつ確認する。
5. **所見11 → `stopAnalysis` に TSDoc、`stop_analysis_impl` に `///`。**
6. **所見8 → `bridge.rs` の `mod tests` に `stop_analysis_impl(None)` を1本。**
   プロセスは要らない（台帳の clear が `analyzer` の呼び出しより前）。
7. **所見5・13・14・15 → doc。** `S0/P1` 行と E12 列を足し、不変条件5に破る側を名指しし、
   ※13 を順序の断定でない書き方にし、F-7 に新しい握り潰しを足し、リンクを直す。

### 次ラウンドの焦点

- 1の `seatRef` が**返し忘れの新しい口**を作っていないか（設定する行と戻す行の数を数える）。
- 2の世代の門が、`pendingAfterRef` の予約と二重に走らないか。
- 4で書き直したコメントが、また実装と食い違っていないか（1件ずつ行を指す）。
- doc の `S0/P1` 行が、他の行の判定（`## 状態` の定義）と矛盾していないか。
