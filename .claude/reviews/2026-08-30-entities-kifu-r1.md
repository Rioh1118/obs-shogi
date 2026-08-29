# レビュー entities-kifu ラウンド1

- 日付: 2026-08-30
- 範囲: `refactor/163-entities-kifu`（issue #163 / #164 / #165 / #166）の `origin/main` からの差分 18ファイル
- 対象コミット: `e6817e3`
- 走らせた reviewer: architecture / react / robustness / perf / comment

## 所見

### 直す（この PR 内）

| 番号  | 深刻度 | reviewer              | 内容                                                                                                                                                                                                                                              | 結果                                           |
| ----- | ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| R1-01 | BLOCK  | comment, robustness   | `write.ts` の doc「書き出しは Rust 側で正規化を通る」が実装に無い。`write_kifu_file_internal`（`src-tauri/src/kifu.rs:41-57`）は `normalize()` を呼ばない。`normalize()` を呼ぶのは `convert_jkf_to_string_internal` だけで、保存経路には入らない | 直した                                         |
| R1-02 | HIGH   | comment, robustness   | `write.ts` の doc「失敗はすべて…そのまま利用者に見せられる日本語のメッセージ」が保証されていない。`atomic_write` の `std::io::Error` がそのまま `Err` に入る                                                                                      | 直した                                         |
| R1-03 | HIGH   | comment, architecture | `cloneJkf` の doc「型引数を JKF の部分木に絞ってある」が実際には絞れていない。`JKFMove` は全プロパティ optional な weak type なので、キーが1つ重なれば任意のオブジェクトが通る                                                                    | 直した（doc を実態に合わせる方を採用）         |
| R1-06 | MEDIUM | architecture          | クローンを1本に寄せたのに `parse.ts:66` が `structuredClone` を直接呼んでいる                                                                                                                                                                     | 直した                                         |
| R1-07 | MEDIUM | comment               | `neighborBranchIndex` の doc「呼び出し側が入れ替えの可否を先に判断している前提」を満たす呼び出し側が無い。実際は下限だけを呼んだ後に見ており、上限は `swapBranchesInKifu` の throw まで届く                                                       | 直した                                         |
| R1-08 | MEDIUM | comment               | `shiftBranchIndexDown` の `Down` と `neighborBranchIndex(b, "down")` の `down` が逆方向を指す                                                                                                                                                     | 直した（branchIndexAfterRemoval に改名）       |
| R1-09 | MEDIUM | comment               | 「parse の出口だけで呼ぶ」契約が `sanitizeJkfMoves` 側に書いてあり、実際に parse が呼ぶ `sanitizeJkf` は無 doc。`parseKifu*` の doc にも「空の変化を含まない」保証が書かれていない                                                                | 直した                                         |
| R1-10 | MEDIUM | comment               | `buildNextOptions.ts` のコメントが空の変化が来ない理由を tsshogi に帰しているが、実際に落としているのは `parse` の `sanitizeJkf`                                                                                                                  | 直した                                         |
| R1-11 | MEDIUM | comment               | `ParsedKifu.detectedFormat` の doc が保存経路と逆。保存形式は拡張子から決めており、`detectedFormat` を読む本番コードは無い                                                                                                                        | 直した                                         |
| R1-12 | MEDIUM | comment               | `cloneJkf.test.ts` のコメントに変更の経緯（「1本にまとめた理由」）が入っている                                                                                                                                                                    | 直した                                         |
| R1-13 | MEDIUM | comment               | `finishJKFData` は周囲の命名（`stripBom` / `normalizeNotation`）と流儀が違い、名前から役割が読めない                                                                                                                                              | 直した（normalizeAndSanitize に改名）          |
| R1-14 | MEDIUM | comment               | `MAIN_LINE` を入れたのに周囲のコメントは素の `0` / `1` / `fork(1)` のまま                                                                                                                                                                         | 直した                                         |
| R1-15 | MEDIUM | architecture          | `forkIndexFromBranchIndex` の呼び出しが0件で、同じ変換が `branchEdit.ts:51` に手書きで残っている。`setBranchIndex` の `<= 0` は負値を黙って main 扱いにする                                                                                       | 直した                                         |
| R1-16 | MEDIUM | comment               | `branch.ts` で唯一 throw する `forkIndexFromBranchIndex` に doc が無い。同じ公開面で doc の有無が割れている                                                                                                                                       | 直した                                         |
| R1-17 | MEDIUM | comment               | 同じものを「変化 / フォーク / 分岐」と3通りで書いている。UI 表示は `branchLabel` が「変化N」を返すので利用者語彙は「変化」                                                                                                                        | 直した                                         |
| R1-18 | MEDIUM | react                 | `KifuForkMenu` の `branchForkPointers` prop は宣言だけで使われていない                                                                                                                                                                            | 直した                                         |
| R1-19 | MEDIUM | perf                  | `readCandidates` / `writeCandidates` が私有コピー済みの部分木をもう2回コピーしている。分岐点以下の指し手 M に対しコピー量が約 3M。実測 M=1300 で 6.22ms → 3.78ms、M=7000 で 34.95ms → 18.45ms                                                     | 直した（複製 5回→1回。回数テスト付き）         |
| R1-20 | MEDIUM | architecture, react   | `features/position-navigation` の `selectedBranchIndex` は `BranchOption[]` の添字であって `BranchIndex` ではない。`buildNextOptions` が空の変化を読み飛ばす以上ずれうる                                                                          | 直した（selectedOptionIndex に改名）           |
| R1-21 | MEDIUM | architecture          | `cursorSelection.ts` が `ROOT_CURSOR` と同じ値を作り直し、`tesuuPointer` を手書きで組み立てている                                                                                                                                                 | 直した（cursorSelection.ts のみ。残りは #190） |

### 直さない（反論）

| 番号  | 深刻度 | reviewer | 内容                                                                                                                                                       |
| ----- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-22 | MEDIUM | comment  | 「`BranchOption.id` を消した結果、key の作り方が `BranchList` と `KifuForkMenu` の2箇所に手書きで散った。`branch.ts` に `branchKey()` を置いて共有すべき」 |

反論: React の key はリスト単位でしか意味を持たず、この2つは別コンポーネントの別リストなので、両者が同じ文字列規則である必要は無い。片方が `fork-` を `branch-` に変えても壊れるものは無い（reviewer の言う「誰も気付かない」は、気付く必要が無いことの言い換えでもある）。issue #166 は `entities/kifu/model` が React のリスト key という描画都合を抱えていること自体を問題として挙げており、フィールドを関数に変えて同じ場所に戻すと、その指摘に真正面から反する。共有すべき知識は「本譜と変化を区別する軸は `forkIndex` の有無だけ」で、これは既に `BranchOption` の判別可能ユニオンが型として表している。

## 重複・矛盾した所見

- R1-01 / R1-02 は comment-reviewer と robustness-reviewer が同じ doc を別の理由で指摘した。統合して2件として扱う。
- R1-03 は comment-reviewer（doc が嘘）と architecture-reviewer（保証が欲しいならオーバーロード4本）で提案が割れた。**doc を実態に合わせる方を採る。** `IMoveFormat` が weak type である以上、構造的部分型で「JKF の部分木だけ」は表現できず、オーバーロードにしても完全には塞げない（architecture-reviewer 自身がそう書いている）。塞げないものを塞いだ形にすると、doc の嘘が型の嘘に移るだけ。
- R1-20 は architecture と react が独立に同じ改名を提案した。
- perf-reviewer と robustness-reviewer は、`sanitizeJkf` の安全網を1つ減らした件について「現時点で到達可能な穴は無い」で一致した（`createInitialJKFData` / `applyMoveWithBranch` / `branchEdit.writeCandidates` / Rust の `normalized_jkf` を個別に確認した結果）。

## 別の issue へ送る

| reviewer                          | 内容                                                                                                                                                                                                         | 理由                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| react [HIGH]                      | #196 `RowModel.selectedForkIndex` は「計画」であって「実際に辿った枝」ではない。`forkAndForward` が失敗して本譜へ逃げた行が `selectedForkIndex` を持ったままになり、その行から削除すると無関係な変化が消える | `buildStreamRows.ts` / `entities/game/lib/cursor.ts` は本 PR の範囲外。reviewer 自身が別コミットを推している |
| robustness [HIGH]                 | #186 保存の失敗が画面に出ない。`GameContextState.error` を描画している箇所がリポジトリに1つも無い                                                                                                            | 描画経路の新設は範囲外。doc 側（R1-02）だけこの PR で直す                                                    |
| robustness [MEDIUM]               | #187 `PositionSearchContinuation` の catch が、読めなかった棋譜を「（続きなし）」と同じ表示にする                                                                                                            | 範囲外                                                                                                       |
| robustness [MEDIUM]               | #188 `service.importKifu` の `e as FsError` が `code` の無い値を通し、`FileTree` が丸ごと消える                                                                                                              | 範囲外。`origin/main` にもある                                                                               |
| robustness [MEDIUM]               | #189 `structuredClone` 前提が実質的な最低 OS 要件になっているが `tauri.conf.json` に `minimumSystemVersion` が無い。残存する到達不能フォールバック3箇所も                                                    | 最低 OS 版はリリース方針の決定を伴う。勝手に決めない                                                         |
| architecture [MEDIUM]             | #190 `tesuuPointer` の手書き組み立てが3箇所（`branch.ts` / `cursorSelection.ts` / `entities/search/lib/cursorAdapter.ts`）。`buildTesuuPointer` を `model/cursor.ts` へ移す                                  | 本 PR で触る `cursorSelection.ts` だけ R1-21 で直し、スライスをまたぐ移動は範囲外                            |
| architecture [MEDIUM]             | #191 `entities/kifu` に `index.ts` が無く、`sanitizeJkf` の「parse の出口だけ」が lint で強制できない                                                                                                        | barrel の新設と lint override の設計判断を伴う                                                               |
| architecture, robustness [MEDIUM] | #192 `convertJkfToFormat` / `normalizeJkf` / `WriteKifuResponse.normalized_jkf` の呼び出し側が0件                                                                                                            | Rust のコマンド削除を伴う                                                                                    |
| react [MEDIUM]                    | #193 `KifuForkMenu` の `memo` は親の inline アロー prop により一度も効かない                                                                                                                                 | 範囲外                                                                                                       |
| perf [MEDIUM]                     | #194 `KifuStreamList` の `rows` useMemo が、棋譜が変わっていないのにカーソルが動くたび JKF 全体を深くコピーする。実測 1.6〜7.8ms/打鍵                                                                        | useMemo の粒度変更は範囲外。ただし本 PR が触った行の上にある                                                 |
| perf [MEDIUM]                     | #195 局面検索のヒット送りがキーリピート1回ごとにファイル読み込みと全解析を起こす。デバウンスが無い                                                                                                           | 範囲外                                                                                                       |

## 見ていない範囲

- Rust 側は `src-tauri/src/kifu.rs` と `file_system/utils.rs` の該当関数のみ。`atomic_write` / `validate_under_root` / `patch_gote_start` の中身、`operations.rs` の正規化経路は未確認。本 PR に Rust の差分が無いため `npm run verify:rust` も未実行
- SCSS とレイアウト。key の変更で mount アニメーションの発火が変わりうる点は ui-reviewer を走らせていないので未確認
- WebKit（実行環境）での `structuredClone` の速度。perf の測定はすべて V8（Node v26）
- `json-kifu-format` / `tsshogi` のライブラリ実装。`getReadableForkKifu` が空フォークで TypeError になる点は既存コメントを根拠にしており、ソースでは確認していない
- 実機での操作確認。react の HIGH はコード読解と `forkAndForward` の単体挙動確認に基づく再現手順で、UI では踏んでいない

## lint / hook で強制できるもの

- `sanitizeJkf` を `entities/kifu/api/**` 以外から import 禁止（`vite.config.ts` の `no-restricted-imports` に1件）
- `structuredClone` の直接呼び出し禁止（`cloneJkf.ts` を除外）。4本目のクローン実装を機械で止められる
- `src/` 直下に層に属さないファイルを禁止（レビュー中に `src/__probe.ts` が混入しかけた）
- コメント内の作業語（`今回` / `〜した` / `PR #`）の grep hook
- `branchEdit` のコピー回数は `vi.spyOn(globalThis, "structuredClone")` で回数を assert するテストにできる（R1-19 と一緒に入れる）
- 拾えないもの: doc と実装の食い違い、命名（R1-08 / R1-13 / R1-20）、未使用 prop、useMemo の粒度

## 対応結果

直す対象に挙げた19件はすべて直した。範囲外の11件は #186〜#196 に切った。
R1-22 は反論を書いて直していない。

検証: `npm run verify` を各コミットで通した（17ファイル → 18ファイル / 173 → 179 テスト）。

## 次ラウンドの対象

R1-01〜R1-21 を直したうえで、修正で新しい問題が入っていないかを同じ5観点で見る。特に doc の書き換えが多いので、comment-reviewer の「コメントに書いた理由の行を指せるか」を重点にする。
