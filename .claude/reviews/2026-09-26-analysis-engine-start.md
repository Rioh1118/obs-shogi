# レビュー analysis-engine-start

- 日付: 2026-09-26
- 範囲: `feat/analysis-engine-start`（origin/main 9c4aa676 からの差分。PR C2: フロントを `start_analysis_engine` へ切り替え、失敗を種類ごとの帯で伝える、旧コマンドの削除）
- 走らせた reviewer: architecture / comment / react / robustness（Rust の差分は削除が主なので rust は architecture に含めた）
- 対象コミット: a2126cc8（1巡目）

## 入れた機械

- `src/__tests__/startFailureKindWire.test.ts`: Rust の `StartFailureKind` が TS の写しの union に全部あること（`gameOverReasonWire` と同じ形）。写しから1つ落とす変異で落ちる。線の綴りが camelCase であることは Rust 側の `every_start_failure_kind_goes_on_the_wire_as_camel_case`（見本の数を宣言と突き合わせる）
- `START_FAILURE_KINDS` を `satisfies Record<StartFailureKind, true>` に。1つ落とすと tsc が落ちる（配列の写しは部分集合でも通っていた）
- 帯の表のテスト: 種類ごとの段と「もう一度起動」を2列で固定（段から再試行を導く形に畳むと `quarantined` が落ちる）。「もう一度起動」を出さない種類は `invalidValue` だけで、その本文は自動で起動し直すと言う（行き止まりの帯を作らない）。`spawnFailed` の再試行を外す変異で落ちる
- 起動が長引いた帯（`SLOW_START_MS`）と「起動をやめる」: fake timer で固定。タイマーを外す変異で落ちる
- provider: 撃つたびに上がる番号を起動・停止に付ける／停止の往復中に撃った起動を停止の結果で撃ち直さない（門を外す変異で落ちる）／起動をやめたら同じ設定で起動し直さずに止まる（`idle` に戻す変異で落ちる）
- Rust: 古い番号の起動・停止は動いているエンジンに触らない（`begin_start` / `shutdown` の門をそれぞれ外す変異で落ちる）／送れない値の起動も前の起動を取り消す（検査を `begin_start` の前へ戻す変異で落ちる）

## 直した所見

1巡目の直しは1コミットにまとめた（同じファイルの中で所見が重なる）。

- 撃った順と Rust に着く順が逆転すると、フロントが捨てた古い起動が `engine_id` に載り、新しい要求が `cancelled` で S3 に落ちる（react）→ フロントの世代を `request` として Rust に渡し、古い要求は何もせずに断る
- 停止の `finally` が世代を見ずに `idle` を書き、同じ設定で2回起動する（react。隔離コピーで実測）→ 世代が変わっていたら書かない
- 起動中に送れない値の設定へ切り替えると前の起動が残る（robustness）→ 値の検査を前の起動を取り消した後に
- `readyok` を返さないエンジンで起動中のまま何も出ない（robustness）→ `SLOW_START_MS` を越えたら「起動をやめる」を持つ帯。やめたら `cancelled` の失敗で止まる
- 設定の外を直す種類（実行権限・置いたファイル・ドライブ）で帯が行き止まり（robustness）→ `invalidValue` 以外に「もう一度起動」。本文は直した場所ごとの起動し直し方を書く
- `exitedEarly` の本文がエンジンの場所を案内しない（robustness）
- 段と再試行が同じ軸だと書いた doc（comment / architecture / react / robustness の4人）→ 表の doc に2軸を書き、bridge は表を指すだけに
- `KINDS` が union の2つ目の手書き（architecture）→ `satisfies Record`
- 名前: `EngineFailure` が対局の `GameOverReason::EngineFailure` と衝突（architecture）→ `EngineStartFailure` / `asStartFailure` / `ENGINE_START_FAILURE_NOTICES`。帯の取っ手も `engine-start-failure`。「初期化」→「起動」（F-9 / G-6 の見出し、`tauri.ts` の節）
- api → lib → api の折り返し（architecture）→ `startEngine` を消し、`lib/setup.ts` は純粋な合成だけに
- Rust の doc: `message` を「詳細の欄」に出す（存在しない）、`Cancelled` を「見せない」（comment / architecture）
- テストの doc の「唯一の入口」「手動でも起動し直さない」が E9 で偽（comment）
- 「同じ理由で」「表の (S1, E3)」（comment）
- engine.md のテスト一覧に `notReadyReason.test.tsx` が無い／`※7` が種類を写している（comment / architecture）
- failure-surfacing の F-9 / G-6 の復帰の列（comment）、ADR-0004 の追記の種類の列挙（architecture）
- `obs-shogi-spec.md` の付録 A と §5 に消したコマンドが残る（architecture）

## 送ったもの / 直さなかったもの

- **表を entities へ下ろす案（architecture）は採らない。** 段と再試行を読むのは帯だけで、解析ペインや設定タブに種類を出す話（#523）はまだ無い。出すときに下ろす
- `docs/proposals/naming-and-module-layout.md` の改名表は提案（未採用）の記録なので触らない
- `exitedEarly` を「`usiok` の前」と「後」に割る案（robustness）: 分類は Rust（`start_failure.rs`）の範囲。本文を3点（エンジン・評価関数・必要なファイル）にして閉じた

## 機械にできなかったもの

- `mechanization-backlog.md` に1行: 「正典の写し」を名乗る表（`obs-shogi-spec.md` 付録 A）と `lib.rs` の `generate_handler!` の突き合わせ（1件目）
- 「同じ理由で」の禁止語（comment）は `commentHistory` と同じ走査で書けるが、1件目なので入れていない（同じく backlog へ）

## 見ていない範囲

- 実機（やねうら王 / zermelo）で帯と「起動をやめる」を踏むこと
- Windows
- 通知層で帯の動作を押した後の見た目（自動で閉じるか）
