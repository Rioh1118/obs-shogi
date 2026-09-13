# #441 レビュー r33（新 `review` skill の2巡目）

`main` の #517 で停止条件が「所見ゼロまで」から**2巡**に変わった。r32 が1巡目、これが2巡目。
成果は所見の件数ではなく、**増えた機械の数**で数える。

## 増えた機械（3つ）

| 機械                                                | 何を止めるか                                                                 | 拾った実物                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| `log_line_builders`（Rust）                          | 予算を見るテストが、本番の行を組む関数を1つも通っていない                    | `bridge.rs` のテスト1件            |
| `ratchetIndex` の `SECTION` を `###` で切る          | 表を跨いで動いた行が、名前を拾われて緑のまま通る                             | マージで隣の表へ落ちた3行          |
| `ratchetIndex` の列数照合                            | 見出しより多いセルを GFM が捨て、**逃げ道の列が黙って消える**                | 同上                               |

3つとも変異を当てて赤くなることを確かめた。

`log_line_builders` が拾ったのは**この PR で自分が入れた欠陥**である。
`by` を潰す行を入口に足し、同じコミットで「改行を通さない」テストを置いたが、
そのテストは `shown` を直に呼んでいて、**入口の潰しを丸ごと外しても緑のまま通った**。
1巡目の指摘で気づいたが、同じ形は他所でも作れるので機械にした。

## 直した所見

### r33-1 [HIGH] `settling_only_clears_the_handle_it_waited_on` が見たい枝を1行も通っていない

- 場所: `src-tauri/src/engine/analyzer.rs:859`
- 何が起きていたか: 2本目の合図を `wait_until_settled()` を**呼ぶ前**に差し込んでいた。
  待ちは最初から2本目を読み、誰も鳴らさないので上限まで待って諦める。
  通るのは諦めの枝で、**すぐ上の `giving_up_keeps_the_handle_for_the_next_stop` の重複**だった
- 直し: 待ちを `spawn` して `yield_now` で待ちに入らせ、その後に2本目を差し込んでから
  1本目を鳴らす。`Arc::ptr_eq` の門を外すと赤くなることを隔離コピーで確かめた
- 副産物: 実時間で3秒待っていたのが 0.01 秒になった

### r33-2 [MEDIUM] 上限を実時間で待つテストが、定数を伸ばすたびに比例して遅くなる

- 場所: 同上 `:835` / `:859`
- 直し: `#[tokio::test(start_paused = true)]`。dev-dependency に `tokio` の
  `test-util` を足した。edition 2021 の resolver は dev-dependencies の feature を
  通常のビルドへ寄せないので、**本体には入らない**（Cargo.toml にその理由を書いた）

### r33-3 [MEDIUM] `ownedIdentifiers` の「`docsIdentifiers` との違いは2つ」が、2つとも嘘

- 場所: `src/__tests__/ownedIdentifiers.ts:21`
- 何が起きていたか: 「下線を要求しないのはこちらだけ」「`src/**` のコメントを見るのは
  こちらだけ」と書いてあったが、あちらは既に camelCase を拾い（`docsIdentifiers.ts:31`）、
  `src/**` のコメントも見る（`srcCommentIdentifiers`）
- 直し: 残っている本当の違い——**綴りをどこに探すか**（repo 全体 か 所有者の中だけか）——
  だけを書き、「拾う形と範囲はあちらと同じ。違いだと書かないこと」を明記した

### r33-4 [MEDIUM] 手順0 が1ファイルしか確かめていない

- 場所: `.claude/skills/review/SKILL.md`
- 何が起きていたか: `review-protocol/SKILL.md` 1本の `diff` を書いていた。
  reviewer に配られるのは `.claude/agents/` と `.claude/skills/` の全部なので、
  1本を確かめて安心すると残りを見落とす
- 直し: 追跡下の全部を回す。**実際に走らせると差は1件ではなく7件あった**
  （`architecture-reviewer` / `comment-reviewer` / `rust-reviewer` / `implement` /
  `review-protocol` / `review` / `tidy-commits`）

### r33-5 [MEDIUM] `DiscardPoint` だけが `...ReleasePoint` を名乗っていない

- 場所: `src/entities/analysis/model/useEngineSeat.ts:19`
- 閉じた union の他の3つは `BlockingReleasePoint` / `QuietReleasePoint` /
  `InlineOnlyReleasePoint`。この PR で入れた名前なので、PR 内で揃えた

## 送った所見（この PR では直さない）

| 所見                                                          | 行き先       | 理由                                                                     |
| ------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| `Notify` を `CancellationToken` に替える（同時停止の取りこぼし） | `docs/IDEAS.md` | 合図の型を替える設計判断。`tokio-util` は既に在るので実現はできる       |
| `useEngineSeat` を `useReleaseSlot` に割る                      | `docs/IDEAS.md` | 責務の割り方の判断。#441 の欠陥とは独立していて、PR が読めなくなる      |

## 見ていない範囲

- 実プロセス（USI エンジン）を要する経路。この repo に固定は1つも無い
- SCSS とレイアウト。この PR は触っていない
- `main` 側で7件ずれているハーネス（手順0 が出したもの）。**reviewer には
  ブランチの版が届いていない**ので、`.claude/` に入れた直しがこのラウンドの
  所見に効いた保証は無い

## 検証

- `npm run verify` — Test Files 118 / Tests 1166 passed
- `npm run verify:rust` — 終了コード 0（`test result: ok` 21件）

## このラウンドで自分が作った事故（2件）

**どちらも成果物には残っていないが、書いておく。**

1. **`sed -i '' 's/\bDiscardPoint\b/.../'` が1件も置換しなかった。** BSD の `sed` は
   `\b` を語境界として解釈しない。**黙って0件成功する**ので、直後の
   `npx tsc -b` も通ってしまう。確認に使った `grep -c 'DiscardReleasePoint\|DiscardPoint'`
   が**両方の綴りを数えていた**ため、6件出たのを成功と読んだ。
   `perl -pi -e` に替えて、新旧を別々に数え直した
2. **`npm run verify:rust | grep ... ; echo "===done==="` の終了コードを、
   verify のものと読んだ。** パイプ末尾の `echo` の 0 を見ていた。
   実際は `cargo fmt --check` が2ファイルで落ちていた。
   ログをファイルへ落として `$?` を直に見る形に替えた

どちらも**「緑を見た」と読み違える形**で、コードではなく確認の手つきの欠陥。
