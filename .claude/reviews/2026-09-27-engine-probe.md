# レビュー engine-probe

- 日付: 2026-09-27
- 範囲: `feat/engine-options`（origin/main a2e37a5d からの差分。PR G1: エンジンを起こして申告だけを取るコマンドを足し、取った定義をプリセットに残す）
- 走らせた reviewer: rust / architecture / react / robustness / comment
- 対象コミット: 663d5e21（1巡目。本体）

## 入れた機械

どれも直した箇所を戻す変異で落ちることを確かめた。

- `requestNumber.test.ts`: 読み直した（モジュールを読み直した）後の最初の番号が、前の最後の番号より大きい（単純な数え上げに戻す変異で落ちる）
- `provider.test.tsx`「番号は時刻を下限にしていて、0 から数え直さない」（provider を `++seqRef` に戻す変異で落ちる）
- Rust `the_same_token_twice_is_refused_without_starting`（`<=` を `<` に戻す変異で落ちる）
- `probeStatus.test.ts`: 失敗は失敗したパスがいまのパスのときだけ／どの種類も次にすること（「オプションを読み込む」）を言う／手で打ったパスの空白を見ない
- `withDefinitions.test.ts`: 空白を落として比べる・`hasCurrentDefinitions`
- `presetDialogProbe.test.tsx`: 読み込みをやめると保存でき後の結果を使わない（`abandonProbe` を外す変異）／手でパスを打ち換えたら前の定義を付けない／取得中にプリセットが読み直されても保存は塞がったまま（初期化で取得中の印を下ろす変異）／失敗は注意（`role="alert"`）で出す
- 2巡目: 直した箇所を戻す変異を上の全部に当て直した。重複した `cancelled` の弾き（ダイアログと `probeStatusText` の2か所）は変異が効かなかったので1か所に寄せた

## 直した所見

- webview を読み直すとフロントの番号が 0 に戻り、Rust の「最新」は残るので、取得も**解析の起動も**黙って断られる（react / rust / robustness。HIGH）→ 4d7646c0。**解析の側は #601 からある不具合**で、同じ仕組みなので一緒に直した
- 同じ番号の取得が2本来ると後の取得の取り消し口が外れる（rust）→ 457acb0d
- doc: 「同時に1本」「起動と同じ文言」「button は保存しない」「reserved を読み取り専用にする」（rust / comment / architecture）→ 457acb0d（Rust）・33f5d747（TS）
- 失敗の文言が次にすることを言わない、`timedOut` の読み替えが違う、詳細が console だけ、注意の色でない（robustness）→ 33f5d747
- 手でパスを打ち換えた後に前のパスの失敗が残る（robustness）→ 33f5d747
- 返らない取得で保存が最長 40 秒塞がり、同じボタンは待ちを延ばす（robustness）→ 33f5d747（「読み込みをやめる」）
- 初期化の effect で取得中の印を下ろし、プリセットの読み直しで取得中に保存が開く（react）→ 33f5d747
- 「定義がいまのエンジンのものか」が表示の関数の中、パスの空白の扱いが保存と違う（architecture）→ 33f5d747（`hasCurrentDefinitions`）
- 古い結果を捨てる役割の doc（`isLatestProbe` と `withDefinitions`）、`withDefinitions` が値に当てない理由（comment / architecture）→ 33f5d747

## 送ったもの / 直さなかったもの

- 失敗の文言の表が2つ（解析の帯と取得）: 下げて共有する案（architecture）は採らず、別表にする理由を `probeStatus.ts` の doc に書いた（次にすることが違う: 帯は「もう一度起動」、ここはダイアログの中で読み込み直す）
- エンジンを選んだだけで起こす（robustness の問い）: 候補は engines/ に利用者が置いた実行ファイルで、解析でも同じファイルを起こすので受け入れる。仕様に書いてある
- `crates/*` のテストが verify:rust でも CI でも走らない（検証中に見つけた。`cargo test --workspace` で `fs` のテストがコンパイルできない）: 既存の #528
- 解析の `Request` と取得の番号を1つの Rust の世代に寄せる案は採らない（別々の列で足りる）

## 機械にできなかったもの

- doc の断言の正しさ（`mechanization-backlog.md` の「機械では止まらないもの」1・4）。回数の書き戻しは無し

## 見ていない範囲

- 実機のエンジンでの取得（台本のエンジンだけ）
- 取得を待つ間にダイアログを閉じた後、起こしている途中のプロセスが `usiok` の上限まで残ること（仕様に書いた。実測はしていない）
