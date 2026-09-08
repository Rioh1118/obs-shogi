# レビュー 404-reveal-item-in-dir ラウンド1

- 日付: 2026-09-06
- 範囲: `fix/404-reveal-item-in-dir`（`origin/main` からの6コミット）。8ファイル
- 走らせた reviewer: architecture / react / robustness / comment / rust / oss-hygiene
- 対象コミット: `畳み込み済み`

## 所見

### R1-01 [BLOCK] 存在しないフォルダを reveal し、実行できない案内を出す（architecture / react / robustness / rust の4名）

`reveal_item_in_dir` は先頭で `std::fs::canonicalize` を通す
（`tauri-plugin-opener-2.5.4/src/reveal_item_in_dir.rs`）ので、**存在しないパスは ENOENT で reject**。
`enginesDirPath` は `engines/` が無いとき `<root>/engines` にフォールバックし
（`AiLibraryTab.tsx:181`）、主カラムの「engines/ を開く」は `disabled={!canOperate}` だけ
（`:301`）なので押せる。押すと「ファイル管理ソフトから直接開いてください: `<root>/engines`」が出るが、
**そのフォルダは無い**。無反応だったボタンが、従えない指示を出すボタンになる。
`SetupGuide` 側の同じボタンは `enginesDirExists` で塞がれている（`StepShell` が children を描かない）ので、
**取り残されているのは主カラムだけ**。

同型がもう1つ。AI ルートが消えている（外付けを外した）ときの「フォルダを開く」も同じ本文を出す。

`revealInFileManager.ts` の「渡すのがファイルでもディレクトリでも通る」に**「存在すれば」が抜けている**。
この一文が、呼び出し元が存在を確かめなくてよいと読める唯一の根拠になっている。

- 結果: 対応済み（畳み込み済み）engines/ が無い間は主カラムのボタンも押せなくし、本文から実行できない指示を落とした。押せない条件と本文はテストで固定

### R1-02 [HIGH] `Forbidden path` はこの経路では起きない（comment / robustness）

`ForbiddenPath` は `open_path` の scope 判定でしか作られず（`commands.rs`）、`reveal_item_in_dir` は
scope を見ない。しかも scope 拒否の Display は `Not allowed to open path ...` であって
`Forbidden path` ではない。`AiLibraryTab.tsx:159` のコメントの例、
`revealInFileManager.test.ts:32` の fixture、同 `:19-22` の「scope で拒まれる」、
`openerCapability.test.ts:12` の「scope で拒む側」——**4箇所が起きない形を根拠にしている**。
capability から `opener:allow-open-path` を落とした以上、いま拒むのは scope ではなく ACL（許可の不在）。

- 結果: 対応済み（畳み込み済み）fixture と doc を、この経路が実際に返す形（io エラーの文字列 / 親を辿れないときの Error）に寄せた

### R1-03 [HIGH] `system-dialogs.md` が「通知の土台に載っている失敗が1つも無い」と書いたまま（oss-hygiene）

通知の土台の決まりを持つ唯一の spec がここで、`navigation-map.md` もここへ送る。
台帳（`failure-surfacing.md`）は「F-13 の1件だけ」に書き換わったのに、この節だけが古い。
次に載せる人が「前例が無い」と読む。

- 結果: 対応済み（畳み込み済み）`system-dialogs.md` を「土台を通っている失敗は F-13 の1件だけ」に。残りが手書きであること（#277）は残した

### R1-04 [HIGH] 台帳が自分で課した「書き換えたら測定日を添える」を、書き換えた行が守っていない（oss-hygiene）

`failure-surfacing.md:13-18` の規約。冒頭が「初回の棚卸しは `畳み込み済み` の実測」と宣言しているので、
**日付の無い行は初回のままと読まれる**。F-12b / F-31 は行内に日付を持っている。
書き換えた F-13 の行と §0 に新設した「通知」の行に日付が無い。

- 結果: 対応済み（畳み込み済み）F-13 の行と §0 の「通知」の行に `（2026-09-06 / fix/404-reveal-item-in-dir）` を添えた

### R1-05 [HIGH] 失敗の理由がどこにも残らない（architecture / robustness / rust）

`revealInFileManager` が組み立てた `error` を読む本番コードが0。変更前にあった
`console.error("finder 開けない", e)` は消えている。`Notice.tsx` は
「**画面には利用者の言葉、原因はログ。** どちらか片方に寄せると、押した人に伝わらないか、
後から誰も辿れないかのどちらかになる」と逆の方針を明記している。
`reveal_item_in_dir` の失敗理由はプラットフォームごとに違う（ENOENT / zbus / `ILCreateFromPathW`）ので、
「開くが効かない」の報告から切り分ける材料が消える。実質 `AsyncResult<void>` が boolean になっている。

- 結果: 対応済み（畳み込み済み）`notify` の前に理由を `console.error` へ。画面には出さない判断はそのまま

### R1-06 [MEDIUM] `dedupeKey` が無く、押した回数だけ同じ toast が積まれる（react / robustness）

この失敗は**同じ操作を繰り返しても必ず同じ結果**になる。しかも元は「押しても何も起きないボタン」で、
利用者の反応は連打。3回押せば同一文面が3枚、それぞれ別の6秒時計を持つ。
`dedupeKey` を付けると `foldInto` が本文を最後のもので置き換えて件数を増やし、
時計の鍵が `${id}:${count}` なので押すたびに数え直される。

- 結果: 対応済み（畳み込み済み）`dedupeKey: reveal:<path>` を付けた。別のフォルダの失敗は畳まれない

### R1-07 [MEDIUM] `openerCapability` が `default.json` 決め打ち（architecture / robustness / rust の3名）

Tauri は `src-tauri/capabilities/` 配下の全 JSON を合成する。2枚目に `opener:allow-open-path` を
書いても検査は気づかない。**違反が減るのではなく見る対象が減る**——`walk.ts` が
`rustRoots()` で名指しして避けている形そのもの。

- 結果: 対応済み（畳み込み済み）`capabilities/*.json` を全部読む形に。読めていることも1本で固定

### R1-08 [MEDIUM] `openerCapability` が動的 import と `invoke("plugin:opener|...")` を素通しする（rust）

`const { openPath } = await import("@tauri-apps/plugin-opener")` は `OPAQUE_IMPORT` にも
`NAMED_IMPORT` にも当たらない（`import\s+` が `import(` に一致しない）。IPC 名の直書きも同じ。
この PR が塞いだ「型もビルドも通り、実機でだけ落ちる」がそのまま再発でき、5本は全部緑のまま。

- 結果: 対応済み（畳み込み済み）綴りの出現数と名前付き import の数を突き合わせる形に変え、IPC 名の直書きも禁じた

### R1-09 [MEDIUM] `GRANTS` が「許可1つ＝口1つ」と決めていて、実在する形を表せない（architecture）

`opener:default` は口を3つ解禁する集合で、`opener:allow-default-urls` や `deny-*` は口を持たない。
`tauri add opener` が既定で書くのは `opener:default` なので、その形に戻すと
`Record<string, string>` ではどちらに倒しても検査が嘘を言う。

- 結果: 対応済み（畳み込み済み）`GRANTS` を1対多に。集合（`opener:default`）と口を持たない許可を表せるようにした

### R1-10 [MEDIUM] `GRANTS` の doc の「落とす」が、同ファイル内で二義（comment）

`:25` の「ここに無い許可は落とす」は「検査が赤くなる」の意だが、`:120` の「落とす」は
「capability から削除する」の意。逃げ道を読み違える。

- 結果: 解消済み（畳み込み済み）R1-09 の直しで doc を「この検査は赤くなる」に書き換えたため、二義は残っていない

### R1-11 [MEDIUM] `openPath` を足すときの「3つ同時」制約がどこにも無い（comment）

いま `opener:allow-open-path` は許可されていないので、**先に許可を足すと「呼び出し元の無い許可」が落ち、
先に呼び出し元を足すと「許可がある」が落ちる**。どちらの順でも赤くなり、失敗文言は互いに逆を言う。

- 結果: 対応済み（畳み込み済み）`OPEN_PATH_CALLERS` の doc に「許可・呼び出し元・表の3つを1コミットで」を書いた

### R1-12 [MEDIUM] 空パスを `success: true` で返す契約が doc に無い（comment / robustness）

理由が書かれているのはテストの行コメントだけ。`shared/` の関数の契約が、特定画面のボタン事情
（`canOperate` で `disabled`）を根拠にテスト側にしか記録されていない。
robustness は「`{ success: false }` にして呼び出し元のバグとして扱う」を提案。

- 結果: 対応済み（畳み込み済み）契約を関数の doc に置いた。**`success: false` にする案は見送り**——押せないボタン由来の no-op で通知が出る側になる

### R1-13 [MEDIUM] 同じ失敗に3つの名前（comment）

コード「フォルダを開けませんでした」／spec の表「フォルダを見せられなかった」／
ADR-0004 の F-13「Finder で開けない」。どれが正か決まっていない。

- 結果: 対応済み（畳み込み済み）ボタンの文言が「開く」なので「開く」を正にし、spec を「フォルダを開けなかった」へ揃えた

### R1-14 [MEDIUM] `reveal` という局所名が notify の副作用を隠す（comment）

呼び出し側の2行を読んでも失敗が toast になることが分からない。import している
`revealInFileManager` と同じ動作を指す名前なので「薄い別名」に見える。

- 結果: 対応済み（畳み込み済み）`revealOrNotify` に改名

### R1-15 [MEDIUM] §0 の「消えるか」が実装と違う（robustness / oss-hygiene）

「段と見せ方による」と書いたが、消えるかを決めるのは `presentation === "toast" && autoDismiss` **だけ**で、
段は関与しない（`types.ts` が「見せ方は段からは独立している」と明記）。
他の8行が「いま実際に起きること」を書いているのに、この行だけ土台の能力を書いている。

- 結果: 対応済み（畳み込み済み）§0 の「消えるか」を「自分で消える」に。段は関与しない

### R1-16 [MEDIUM] F-13 の行が自分と矛盾（robustness）

「次の操作: 要らない」と「復帰導線: 本文のパスを自分で開く」が同じ行にある。
この列は ADR-0004 決定1 で段を決める根拠そのもの。

- 結果: 対応済み（畳み込み済み）「次の操作」を「要る（場所を確かめる）」に、復帰導線を失敗の場所ごとに書いた

### R1-17 [MEDIUM] CONTRIBUTING の逃げ道どおりにしても赤いまま（oss-hygiene / comment）

行の逃げ道は「許可を `default.json` に足す」だが、足すと `GRANTS` に無い識別子として
別のテストが落ちる。`ratchetIndex` の行が「表と `RUST_CHECKS` の両方に足すこと。片方だけだと落ちる」と
書いている先例がある。向きも実際は4つ（名前で import させる分が抜けている）。

- 結果: 対応済み（畳み込み済み）逃げ道に `GRANTS` への二重登録と「3つ同時」を足し、向きを5つに直した

### R1-18 [MEDIUM] `onRescan` だけがインライン関数で、`SetupGuide` の `useMemo` が一度も効いていない（react）

他の4つのハンドラは `useCallback` で安定しているのに `onRescan={() => void refresh()}` だけ毎レンダ変わる。
この差分は `onOpenAiRoot` / `onOpenEnginesDir` の同一性を整えたが、同じ依存配列に崩れが1つ残るので
**整えた側の効果がゼロ**。

- 結果: 対応済み（畳み込み済み）`onRescan` を `useCallback` にした

## 重複・矛盾した所見

- **R1-01 は4名が独立に挙げた**（深刻度は HIGH と MEDIUM に割れたが、根拠は同じ canonicalize）。
  この範囲で最も重い。
- **R1-05（理由をログに残す）と、コードのコメント「例外の本文は出さない」は矛盾しない。**
  出さないのは*画面*で、残すのは*ログ*。`Notice.tsx` の方針がそのとおり書いてある。
- **段（`info`）の是非は両論。** robustness は「本文が行動を要求するなら `info`＋自動消滅は
  ADR-0004 決定1 の定義（`info` = 利用者は何もしなくてよい）と食い違う」と言い、
  rust は「ADR-0004 の既決に従っているだけなので ADR 側の論点」と言う。
  **本 PR では ADR に従い `info` のまま**とし、本文から実行できない指示を落とすことで食い違いを縮める。
  段そのものの見直しは ADR の変更なので範囲外。
- **R1-12 は両論。** 空パスを失敗にすると、押せないボタン由来の no-op で通知が出うる。
  **契約を doc に書く**方を採り、`success` は変えない。理由は報告書のこの行に残す。

## 範囲外（この PR では直さない）

- `SetupGuide` が470行・props15個で `ScanState` を3〜5個にバラして受けている（react）
- リポジトリ直下の `obs-shogi-spec.md` / `shogi-home-spec.md` が現行を名乗って腐っている（oss-hygiene）
- `AGENTS.md` が `vp check` / `vp test` と書き、この repo の `npm run verify` を1つも書いていない（oss-hygiene）
- README / CONTRIBUTING の「Rust (stable)」が `rust-toolchain.toml` の 1.98.0 と食い違う。
  Linux の必要パッケージがどこにも無い（oss-hygiene）
- 配布バイナリに第三者ライセンスの帰属表示が無い（oss-hygiene）→ **既に #397**
- `openerCapability` を `dialog` / `fs` / `process` / `updater` へ広げる。
  `fs:default` と `dialog:allow-save` は呼び出し元が0件（architecture）

## 見ていない範囲

- **実機の挙動は誰も見ていない。** `reveal_item_in_dir` が macOS で親フォルダを開いて選択すること、
  存在しないパスで reject することは**全員がプラグインのソースからの判断**
- Windows / Linux での `reveal_item_in_dir` の実挙動
- `NotificationLayer` / `Notice` の描画（toast の重なり、6秒、読み上げ）。今回初めて本番の失敗が流れる
- SCSS とレイアウト（ui-reviewer は範囲に `.scss` が無いため走らせていない）
- `src-tauri/src/` の Rust コード（この差分は1行も触っていない）
- README のスクリーンショット3枚が現在の UI と一致するか

## lint / hook で強制できるもの

- R1-07 / R1-08 / R1-09 は**その検査自身の穴**なので、直しがそのまま強制になる
- R1-04（測定日の欠落）は、`failure-surfacing.md` の変更行が `（YYYY-MM-DD / ...）` を含むかで機械化できる。
  同じ表を走る `stateTransitionCells`（Rust）に置き場がある
- R1-03 は「`useNotify` の呼び出し元が1件以上あるのに `system-dialogs.md` に『1つも無い』の綴りが在る」で
  落とせる（`docsSourcePaths` と同じ走査基盤）
- R1-01 / R1-05 / R1-06 は機械で拾えない。R1-05 は `error` を読まないなら `boolean` を返すべきで、
  型で表現できる

## 修正計画（r1 → r2）

### 束（同じ根から出ている所見）

- **存在しないパス**: R1-01 → R1-02 → R1-13。R1-01 で `revealInFileManager` の doc と
  `AiLibraryTab` の本文を書き直すので、R1-02 が指す「起きない文字列」の在処と R1-13 の
  「3つの名前」は、R1-01 の後で**別物になる**。書き直してから取る
- **検査の穴**: R1-09 → R1-17 → R1-11。`GRANTS` を1対多にすると（R1-09）、
  CONTRIBUTING の逃げ道（R1-17）と「3つ同時」の記述（R1-11）が指す形が変わる
- **台帳**: R1-15 → R1-16 → R1-04。同じ2行を触るので、測定日（R1-04）は最後に付ける。
  先に付けると中身を直すたびに日付の意味が変わる

### このラウンドで直すもの

| 順  | 所見  | なぜこの順か                                                 | この直し方で壊しうるもの                                                                                                                                                                                         |
| --- | ----- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | R1-07 | 機械で強制する側。後から入れると同じ検査をもう一度触る       | `capabilities/` に JSON が1枚も無い環境で `readdirSync` が投げる。0件を見て緑になる形も同時に塞ぐ                                                                                                                |
| 2   | R1-08 | 同上。走査の取りこぼしはこの検査の存在意義そのもの           | `MODULE` の出現数と一致数を突き合わせるので、**コメントや文字列の中にモジュール名を書いた行が違反に数えられる**。`codeOf` を通す前提が崩れる                                                                     |
| 3   | R1-09 | 束の先頭。R1-17 / R1-11 の記述がこの後で別物になる           | `GRANTS` の値が配列になるので、「誰も呼んでいない許可」の判定が「解禁する口が1つも呼ばれていない」に変わる。口を持たない許可が対象外に落ちる                                                                     |
| 4   | R1-01 | 失敗経路の門番。修正が積み上がる前に入れる                   | `enginesDirOk` が false の間「engines/ を開く」が押せなくなる。**スキャン前（`data` が無い）は `enginesDirOk` も false なので、押せない時間が増える**                                                            |
| 5   | R1-05 | 失敗経路。R1-01 で本文を分けた後に、残す理由の置き場を決める | `console.error` が増える。テストの標準エラーに出るようになるが、`AiLibraryTab` を描くテストは無い                                                                                                                |
| 6   | R1-06 | 同じ通知の呼び出しを触るので R1-05 の直後                    | `dedupeKey` に path を混ぜるので、**別のフォルダの失敗は畳まれない**。同じフォルダを連打した回だけ1枚になる                                                                                                      |
| 7   | R1-02 | R1-01 で本文が変わった後でないと、直す先が動く               | fixture を io エラーに寄せると、`instanceof Error` の枝を通らない形になる。**両方の枝を残す**こと                                                                                                                |
| 8   | R1-12 | 契約の記録。コードは変えない                                 | 無し（doc のみ）。`success` を変えない判断を報告書に残しているので、次の reviewer が同じ所見を出しうる                                                                                                           |
| 9   | R1-14 | 改名。R1-05 / R1-06 で中身が固まった後                       | `reveal` を参照している箇所は同ファイル2つだけ。名前が長くなるので `useCallback` の依存の行が折り返す                                                                                                            |
| 10  | R1-13 | 文言の統一。コード側が固まってから spec を寄せる             | 「開く」を正にするので、`revealInFileManager` の doc の「見せる」と spec の「見せられなかった」を書き換える。**ADR-0004 の F-13 の語は変えない**（ADR は決定の記録）                                             |
| 11  | R1-10 | 検査の doc。R1-09 の後                                       | 無し（doc のみ）                                                                                                                                                                                                 |
| 12  | R1-11 | 同上                                                         | 無し（doc のみ）                                                                                                                                                                                                 |
| 13  | R1-17 | 表の行。検査の側が固まってから                               | CONTRIBUTING を触るので `ratchetIndex` が走る。名前の対応は変えないので落ちない                                                                                                                                  |
| 14  | R1-03 | spec。台帳より先に直す（台帳がこの spec を指していない側）   | `system-dialogs.md` は #277 を指しているので、**「1件だけ」に変えると #277 が閉じたように読めうる**。残りが手書きであることを残す                                                                                |
| 15  | R1-15 | 台帳の束の先頭                                               | §0 の行が「自分で消える」に変わる。banner / modal を通る失敗が出た日に**また書き換える必要がある**                                                                                                               |
| 16  | R1-16 | 同じ行を触るので R1-15 の直後                                | 「次の操作」を「要る」に変えると、§4「まだ出口が無いもの」の抽出条件（読み手0 / console のみ）には掛からないまま。列の意味だけが変わる                                                                           |
| 17  | R1-04 | 束の最後。中身が固まってから測定日を付ける                   | 無し。ブランチ名は `git branch --show-current` で確認する（台帳が名指しで求めている）                                                                                                                            |
| 18  | R1-18 | 範囲内の独立した既存問題。最後に別コミット                   | `onRescan` が `useCallback` になると `SetupGuide` の `useMemo` が初めて効く。**効き始めた結果、古い `nextAction` が残る経路**が出うる（依存は10個あり、`profiles` は毎回新しい配列なので実際には毎レンダ変わる） |

テストは R1-01 のコミットに含める（新しい分岐＝押せない条件と通知の本文）。
`src/features/settings/ui/tabs/__tests__/` に置き場が無いので新設する。

### 直さないもの

| 所見                                          | 行き先                    | 理由                                                                                   |
| --------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| 段（`info`）の是非                            | ADR-0004 の論点として別途 | ADR-0004 が F-13 に `info` を割り当てている。段の変更は ADR の変更なので #404 の範囲外 |
| R1-12 の「空パスを `success: false` に」      | 見送り（報告書に反論）    | 押せないボタン由来の no-op で通知が出る。契約を doc に書く側を採る                     |
| `SetupGuide` の470行・props15個               | `docs/IDEAS.md`           | 6週間以内に着手しない                                                                  |
| `openerCapability` を他プラグインへ広げる     | issue                     | `fs:default` / `dialog:allow-save` を落とすかの判断が要る。#404 の範囲を超える         |
| 直下の `obs-shogi-spec.md` 等が腐っている     | issue                     | この差分と無関係の既存問題                                                             |
| `AGENTS.md` が違う検証コマンドを書いている    | issue                     | 同上                                                                                   |
| README / CONTRIBUTING の Rust 版と Linux deps | issue                     | 同上                                                                                   |
| 第三者ライセンスの帰属表示                    | **既存の #397**           | 同上                                                                                   |

### 対象そのものを疑ったか

**18件中6件（R1-07 〜 R1-11、R1-17）が `openerCapability` に集まっている。** 足したばかりの機構に
所見が3分の1というのは、機構そのものを疑う合図。落とす案を検討した結果、**落とさない**。
理由は、この issue が要求している3点目（capability の scope と呼び出し元を突き合わせる検査）が
まさにこれで、**6件はどれも「走査の穴」であって「機構が不要」ではない**から。
ただし R1-08 の直しで走査の形を「名前を数える」から「取りこぼしを禁じる」へ変える——
穴を1つずつ塞ぐ形を続けると同じ所見が次のラウンドでも出る。

もう1つの集まりは `AiLibraryTab` の通知（R1-01 / R1-05 / R1-06 / R1-14 の4件）。
こちらは機構ではなく1つの新しい呼び出しに対する所見なので、個別に取る。

### 次ラウンドの焦点

次の `/review-round` の reviewer へ渡す。

1. **押せなくなった時間が増えていないか。** `enginesDirOk` はスキャン前も false。
   「engines/ を開く」が、作成済みでも押せない瞬間があるのではないか
2. **`dedupeKey` に path を混ぜたことで畳まれない組み合わせ**が実害になっていないか
3. **走査を「取りこぼしを禁じる」形に変えたことで、コメントや文字列中のモジュール名が
   違反に数えられていないか**（`codeOf` の通し忘れ）
4. **`GRANTS` を1対多にしたことで、「誰も呼んでいない許可」の判定が緩くなっていないか**
   （口を持たない許可が全部対象外に落ちていないか）
5. **`system-dialogs.md` の書き換えが #277 を閉じたように読めないか**
6. **台帳の §0 と §2 が、書き換えの後も互いに矛盾していないか**
7. `onRescan` を安定させたことで、`SetupGuide` の `nextAction` が古い値を返す経路が無いか

### 検証の見積り

18件 ＝ 18コミット。内訳は TS / spec / CONTRIBUTING が15件（`npm run verify`、
1回あたり実測 13〜35秒）、`docs/state-transitions/` を触る3件（R1-04 / R1-15 / R1-16）が
**`npm run verify:rust` まで走る**（実測 2分15秒）。合計でおよそ 15 分。

**次ラウンドへ送ったものは無い。** ただし `.claude/hooks/verify-gate.sh` は
**主ワークツリーを見る**（#394）ので、そちらの未コミット作業次第で無関係に赤くなる。
赤くなった内容がこの差分と無関係なら、このワークツリーで `npm run verify` /
`npm run verify:rust` を通した事実を報告書に残して進む。
