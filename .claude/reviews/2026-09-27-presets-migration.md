# レビュー presets-migration

- 日付: 2026-09-27
- 範囲: `feat/presets-v2`（origin/main 0fa2bbe1 からの差分。PR D1: プリセットのファイルに版を付け、読み込み時に移し、読めないものを上書きしない）
- 走らせた reviewer: rust / robustness / react / architecture / comment
- 対象コミット: 5d9be2e7（1巡目）

## 入れた機械

どれも直した箇所を戻す変異で落ちることを確かめた。

- Rust `a_newer_version_is_decided_before_the_shape`: 新しい版は `presets` の形を問わず読み取り専用（形を版より先に見る変異で落ちる）。1e30 の版も新しい版
- Rust `an_unmigrated_file_is_never_overwritten`: 移していない古い版には `save_to` が書かない（古い版を受ける変異で落ちる）。**判定の出典を Rust に寄せた**——画面の `writable` だけが守っていた
- Rust `fields_it_does_not_know_inside_analysis_survive_a_save`（`analysis` の `extra` を外す変異で落ちる）
- Rust `hand_edited_forms_are_read_rather_than_moved_aside`（BOM・`2.0`・`null`）と `a_negative_version_counts_as_broken`（BOM を読み飛ばさない変異で落ちる）
- serde_naming `every_exempt_name_is_a_real_type`: 対象外の名前が実在する型であること（消えた `PresetsFile` が残っていた）
- TS provider: 描画を挟まずに続けた変更がどちらも残る（最後に書けた一覧を更新しない変異で落ちる）／同時に撃った変更が1本ずつ通りどちらも書ける（列を外す変異で落ちる）／0件で既定の1件を書けなかった理由が残る（取り込みで消す変異で落ちる）
- TS 橋: 読み込みの呼び出しが失敗したら帯（出さない変異で落ちる）／読み直したら同じ件数でも伝え直す（`loadSeq` を依存から外す変異で落ちる）／読み込みの通知の段と動作を種類ごとに固定／移した先のファイル名／知らない種類でも落ちない
- `presetsWire` に `LoadedPresets` の欄の綴りの突き合わせを足した
- `noPlanReferences`: ソースが `.claude/plans/`（git に載らない）を指していないこと（計画を指すコメントを足す変異で落ちる）。rust と comment と architecture の3人が同じ所見を出した
- `wireHelpers`: Rust の宣言を読む道具を `src/__tests__/rustEnum.ts` の1か所に（3つの写しで値つきのバリアントの拾い方が割れていた。自前の読み方を書く変異で落ちる）

## 直した所見

1巡目の直しは1コミットにまとめた（同じファイルの中で所見が重なる）。

- 新しい版で `presets` の形が違うと壊れた扱い → 退避して空から始め、既定の1件を v2 で書く（rust / robustness）
- `save_to` が v1 を `.bak` 無しで上書きできた（rust / architecture）
- 続けた変更の片方が消える、二度押しが自分どうしの `conflict` になる（react / robustness）→ 変更を1本ずつ通す列と、最後に書けた一覧（`presetsRef`）
- 初回に既定の1件を書けなかった理由が直後の `loaded` で消える（react / robustness / comment）→ 取り込みと一緒に渡す
- 読み込みの呼び出しそのものの失敗がどこにも出ない（robustness）→ 帯
- 移した先・残した原本のファイル名が本文に無い（robustness）
- `analysis` の知らない欄が消える（rust）、BOM・`2.0`・`null` の版で退避される（rust）
- 移行の書き戻しが直前に読み直さない（rust）
- 版を上げるときに触る場所が1つに無い（architecture）→ `upgrade` の段と `engine_presets.v<元の版>.bak`
- `newerVersion` の段のコメントと表の食い違い（react / comment）→ 段の決め方を書き分けた（新しい版だけ warning）
- 読み直しの通知の出し直しが effect ごとに違う（react）→ `loadSeq`
- 名前: `PresetsNotice` → `PresetsLoadNotice`、`fileNotice` / `notice` → `loadNotice`、見せ方の型 → `PresetsFileNoticeView`（architecture）。写しは `api/rust-types.ts` へ
- `asSaveFailure` と `asStartFailure` の同形 → `shared/lib/kindedFailure.ts`（architecture）
- 読み込みの取り込みが2か所 → `adopt`（architecture）
- doc: 古い版のアプリでの互換の断言（読めない件を含むと古い版は読めない、`extra` は古い版の保存で消える）、保存の表（`conflict` と `readOnly` の順）、`recovered` の「空」、F-5 の復帰の列と §4、ADR-0004 の F-5、ADR-0007 の `PresetsFile`、CONTRIBUTING の「通知を1枚も出さない」（comment / robustness）

## 送ったもの / 直さなかったもの

- `docs/IDEAS.md`「設定ファイルの書き込みまわり」: `atomic_write` の一時ファイル名が固定（rust）／読めない設定ファイルを退避する仕組みが2つ（architecture）／重複した `id` の採番し直し（rust）
- 編集中の入力が「読み直す」で消える（robustness）: 案 (b) を採った（`conflict` の本文に「読み直すと元に戻ります」）。draft を読み直しで保つ案 (a) はダイアログの作りを変えるので D2 の画面の作り直しと一緒に
- 64ビットを超える整数の丸めと欄の順（rust）: 直さず doc の主張を弱めた（「値として持ち回る。表記と順は保たない」）

## 機械にできなかったもの

- 段と動作の決め方、doc の断言の正しさは機械にしていない（表のテストで現物は固定した）
- `mechanization-backlog.md` への書き戻しは無し（機械にしたものは表に入れる前に塞いだ。1件目で残したものは無い）

## 見ていない範囲

- 実機（古い版のファイルを置いてアプリを起動する）での通知の見た目
- 権限を落として書き込みを失敗させる経路（F1b / F1w / F3x / F5）は踏めていない（判定表に ✗）
- Windows
