# レビュー 410-cap-sfen-spelling ラウンド5

- 日付: 2026-09-07
- 範囲: `fix/410-cap-sfen-parse-error`（`origin/main` 2273b3a0 との差分、35コミット）
- 走らせた reviewer: rust / robustness / architecture / comment
- 対象コミット: `畳み込み済み`
- 前のラウンド: `-r1.md` 〜 `-r4.md`

**r4 の焦点への答え**:

1. 刈る段は1つになったか → **なった**（rust / robustness が呼び手を数えた）。
   ただし `position/` 側は2回掛かる（R5-06）
2. `followed_by` を締めて足りなくなった場所 → **無い**（呼び手は1箇所）
3. 改名の残骸 → **無い**（`capped` / `Capped` は `src-tauri` / `docs` から0件）
4. `Deserialize` を落とした影響 → **無い**（`from_str` する呼び手は存在せず、
   `serde_naming.rs` は `Serialize` だけでも走査対象に入る）

## 所見

### [HIGH] R5-01 走査に失敗しても索引が `Ready` を名乗り、古い結果が「最新」として出る（robustness）

根フォルダが移動・取り外しされると `run_rescan_diff_apply` は警告を1件出して
`return` するが、戻り値が `()` なので呼び手が**無条件に `Ready` を emit する**。
検索の `stale` は false になり、画面は「索引の更新中」を出さない。
利用者は古い索引の結果を最新として受け取り、追加した棋譜が出てこないのを
「その局面は指されていない」と読む。**再走査は watcher 頼りなので、根が無い限り来ない。**

しかも唯一の手掛かりである文言が `scan failed: {e}`（英語・失うものを言わない）で、
**同じ差分が `IndexWarnPayload::message` の doc に書いた基準を満たしていない。**

### [MEDIUM] R5-02 JKF の腕で、案内が引用に押し出されて消える（robustness）

`ParseError::Serde` の腕は案内を `{by_crate}` の**後ろ**に置いていた。
`serde_json` は読めなかった値を丸ごと引用する（`moves` に文字列を入れた `.jkf` で実測565文字）
ので、組み上がりを `parse_failed` が刈った時点で案内が落ちる。
画面に出るのは「壊れています」と利用者自身が書いた指し手の羅列だけ。

**R4-02 と同じ形**（上限の内側に置いた案内が長い引用に押し出される）が、
`parse_failed` の doc が名指しで禁じているのに腕の中に残っていた。
既存のテストは案内が**先頭**にある腕しか題材にしていない。

### [MEDIUM] R5-03 私が足したテストが空振りしうる（rust / architecture）

1. 一時ディレクトリを手写しして、共有版が入れているプロセス番号とスレッド番号を
   落としていた。並行実行で別の失敗経路（ファイルが無い）に落ちても `ends_with` は通る
2. 題材が上限に届いたことを見ていないので、クレートが引用の仕方を変えたら
   **二重刈りを戻しても緑**になる

### [MEDIUM] R5-04 doc が指した先が実在しない・別の場所（rust / comment / robustness）

- `parse_failed` が `KifuReadError::NothingToIndex` を名指す（実在するのは `ReadOutcome` 側）。
  「刈る対象が無く直に組む」も、型が禁じるようになったので**この差分で偽になった**
- `file_build` が読み手側の刈る場所を `read/diagnosis` と書く（実際は `read_path_inner`）
- `index_builder` が `map_err(|e| e.to_string())` という**もう存在しない呼び方**を指す
- `docs/state-transitions/search.md` が `NothingToIndex` を `Err` 側に置く。
  `outcome.rs` が節を割いて禁じている読み方をさせる

**rustdoc ラチェットはこれを拾えない**（`--document-private-items` が無いので
`pub(crate)` の doc を検査しない）。`comment_identifiers` も下線を含む綴りしか候補にしない。

### [MEDIUM] R5-05 `IndexWarnPayload` の「読む手段は無い」の導出が書かれていない（comment）

**結論は正しいが、根拠が辿れない書き方だった。** comment は
`.settings__main { overflow: auto }` を根拠に「横スクロールで読める」と結論したが、
**より近い祖先の `.sui-section`（`SSection.scss:24`）が `overflow: hidden`** なので
そこで切られる（自分で辿って確認。rust も同じ結論）。doc が切る祖先を名指していなかった。

### [MEDIUM] R5-06 `position/` は2回刈るのに、「1回だけ」を crate 全体の規約として読ませていた（architecture）

`invalid()` が刈った値を `query_service` がもう一度刈る。`#[error]` の前置き14文字ぶん
だけ短くなる。ここで `followed_by` を使うと R4-02 と同じ故障が再現する。

### [MEDIUM] R5-07 `for_screen` の doc に「刈り終えた値を渡さない」が無い（comment）

R4-02 を生んだ形なのに、禁止が呼び出し側のコメントにしかなかった。
`Display` は `#[error("{0}")]` が要るので外せず、**型では止められない**制約。

### [MEDIUM] R5-08 `# Errors` が「読めなかったときだけ」と言うが、読めても `Err` になる（comment）

`BuildPolicy::Loose` でも `BuildError::Initial` は返る（`build_report` の doc が明記）。

### [MEDIUM] R5-09 `file_build` のモジュール doc に変更の経緯が残っている（comment）

「2つに分かれていたときは…」。`CONTRIBUTING.md` の直接の対象。

### [MEDIUM][差分外] R5-10 `search/` の4モジュールは crate の外から一度も辿られていない（architecture）

`pub(crate) mod` にすれば `dead_code` が効くようになる。

## 重複・矛盾した所見

- **R5-05 で comment と rust が逆。** comment は `.settings__main` の `auto` を見て
  「横スクロールで読める」、rust は `.sui-section` の `hidden` を見て「切られる」。
  → **rust が正しい**（自分で祖先を辿って確認）。より近い祖先が先に切る。
  ただし comment の指摘には価値がある —— **doc がその祖先を名指していなかった**ので、
  読み手が同じ辿り方をして違う結論に着いた
- **R5-04 は3人が別々の箇所で同じ形を挙げた。** doc が指した先の実在は
  5ラウンド連続で腐っている

## 見ていない範囲

- アプリを起動した実測は無い（4人とも）
- `npm run verify`（TS 側）/ `cargo audit` / `npm audit` は未実行
- `benches/search_bench.rs` / `search/cache` / `search/store` の中身
- R5-02 の565文字は `serde_json` 単体への実測で、クレート経由の実測ではない

## lint / hook で強制できるもの

- **R5-01 は型で止まる。** `run_rescan_diff_apply` の戻りを `Result` にすれば
  `#[must_use]` で呼び手の無視が見える（issue #472 へ）
- **R5-04 の一部は機械化できる。** `rustdoc-ratchet.sh` に `--document-private-items` を
  足せば非公開項目の doc リンクまで見る（BASELINE の測り直しが要る）。
  `search_doc_names.rs` の候補条件を「先頭が大文字で `::` を含む綴り」まで広げれば
  `docs/` 側の型名・バリアント名も見られる
- **R5-05 / 描画の記述は5ラウンド連続。** 「doc がバッククォートで名指した CSS クラスが
  `src/**/*.scss` に実在すること」だけなら `docsIdentifiers` と同型で書ける（違反は現状0件）
- R5-02 / R5-06 / R5-07 は機械で止まらない。テストと doc で持つ

## 修正計画（r5 → r6）

### このラウンドで直したもの

| 所見           | 直し方                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| R5-01          | 文言を直した（`畳み込み済み`）。**状態の側（`Ready` を名乗る）は issue #472**                                                                   |
| R5-02          | 語順を規約にした（`畳み込み済み`）。案内が残ることを腕ごとに固定し、**変異で落ちることを確認**（旧語順に戻すと赤くなる）                        |
| R5-03          | 共有の一時ディレクトリを使い、題材が上限に届いたことを先に見る（`畳み込み済み`）                                                                |
| R5-04 〜 R5-09 | doc を現物に合わせた（`畳み込み済み`）。**1所見1コミットから外れている** — 同じ文を複数の角度から書き直すもので、分けると差分が読めなくなるため |
| R5-10          | **見送り（#399 へコメント）**。刈り込みとは別の関心事で、それ自体を検証する変更として出すべきもの                                               |

### 次ラウンドの焦点

1. **R5-02 の直しで、他の腕の語順が揃ったか。** `unreadable_record` の6腕すべてで
   案内が引用より前にあるか
2. R5-01 の文言が、`IndexWarnPayload::message` の doc の基準を本当に満たしているか
3. **doc が指した先の実在**（5ラウンド連続で腐っている）。今度こそ全部引けるか
4. テストが空振りしていないか（R5-03 と同じ形が他に無いか）
