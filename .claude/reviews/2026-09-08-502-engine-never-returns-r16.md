# レビュー 502-engine-never-returns ラウンド16

- 日付: 2026-09-09
- 範囲: `fix/441-stop-analysis-on-unmount...HEAD`
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `3c2238e3`
- 前ラウンド: [r1](2026-09-08-502-engine-never-returns-r1.md) 〜 [r15](2026-09-08-502-engine-never-returns-r15.md)

**規約の本文をプロンプトへ直接入れた最初のラウンド**（r15 で「skill は主チェックアウトから
読まれるので枝に入れても届かない」が分かったため）。

## 前ラウンドからの持ち越し

- 解析側の `advance()` は実時計のまま。robustness は今回も4回＋6回で再現せず、**「直った」とは書けない**
- **実プロセスでの確認は16ラウンドを通して1件も無い**
- 描画中の ref 代入（`entities/engine` の `desiredRuntimeRef`）は未修正（r15 architecture）

## このラウンドで分かった一番大きなこと

**振る舞いの欠陥は0件。** 出た HIGH は4件とも「この差分の外」か「記述の誤り」だった。

一方、**枠組みを問い直す指摘が2つ**出た。

### 断りは利用者に1文字も届かない（architecture）

`state.error` を読む行は `src/` に**0**。この PR が磨いた15本の文言と ※15 の枝は、
**利用者から見た差分に現れない**——見えるのは「解析中の丸が止まる」だけ。
これは `#277` / ADR-0004 決定6 が持つ既知の状態で、**この PR が作ったものではない**
（台帳も仕様も「読み手は0」と書いている）。ただし**16ラウンドのうち相当量を
そこへ費やした**のは事実で、1ラウンド目に grep 1回で分かることだった。

### ハーネスは、この枝が育てているものとは別の版が動いている（architecture）

`.claude/` は主チェックアウトから読まれ、いまそこは別ブランチに居る。
動いている `verify-gate.sh` は101行で `gate_in_project` を持たない（枝の版は604行）。
**`npm run test:hooks` の緑は、動いている版に1本も当たっていない。**
——ただし**この PR の差分に `.claude/` の変更は無い**（入っているのは報告書15本だけ）ので、
これは基底ブランチ側の話。

## 所見

### HIGH-1 断りの置き場が ADR-0004 の決定と食い違う（architecture。差分の外／既知）

→ 上。#277 の仕事として据え置く。

### HIGH-2 ハーネスの版がずれている（architecture。差分の外）

→ 上。`.claude/**` を触っているのは基底側。

### HIGH-3 `crates/*` のテストが `verify:rust` でも CI でも走らない（oss-hygiene。`main` から在る）

`--workspace` が無いので選ばれるのは `app` だけ。`crates/fs` は**コンパイルすら通らない**のに、
本数ラチェットの床には10本が数えられている。→ **#528**

### HIGH-4 `engine.md` の「埋まっていないセル」が、同じスライスのテストと食い違う（comment）

`phase` は見ていないと書いてあるが `startGate.test.tsx` が1本見ている。
`equalRuntime` の欄は「見ていない」列に居るのに、既に埋まっている。

### MEDIUM-5 〜 MEDIUM-14

- 入口の門の位置の根拠が、**名指しした引き金がその隙間に着地できない**（robustness。入れ替えても緑）
- 入口の門が「握れなかった回」の4本目なのに `dropPendingForLostSeat()` を通らず、
  網羅を名乗る doc が偽になっていた（robustness）
- `supersedeRequests()` の理由が門に奪われ、**いま効いている掃除**が書かれていない（robustness）
- `runRestartRef` が描画スコープの `isReady` / `syncedSfen` を読み、入口の門と1コミットずれる（react）
- 入口の門のコメントが、閉じている2つの窓のうち1つしか名指ししていない（comment）
- `advance` の「偽タイマーは使えない」が事実と repo 自身の記録の両方に反する（comment）
- 長生きする doc に「この PR」とブランチのスタンプが残る（comment）
- F-9 に足した一文が同じ表の F-5 と食い違う（oss-hygiene）
- `IDEAS` が「件数を書かない」の直後に内訳を書き、その内訳が既に外れている（oss-hygiene）
- `engine.md` の在庫が「数を書かない」の7行下で在庫を数えている（oss-hygiene）
- 設定モーダルに **`evel`** と出ている（oss-hygiene）
- ADR-0007 が指すソースの場所が2つとも存在しない（oss-hygiene。`main` から在る）
- 席の生死の判定が2モジュールに割れた／自動再開の機構が provider に残る（architecture / react。次の PR）

## 修正の結果（`/review-fix`）

| 所見                           | 結果                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| HIGH-3                         | **#528**（`main` から在る）                                                |
| HIGH-4 / MEDIUM-9 〜 MEDIUM-13 | `67a1c6f0`。在庫と `advance` の理由、F-9、`IDEAS`、`evel` を現物へ         |
| MEDIUM-5 / -6 / -7             | `67a1c6f0`。門の後始末を揃え、根拠を**観測できる差**へ。掃除の理由を書いた |
| MEDIUM-8                       | `67a1c6f0`。`runRestartRef` は鏡から読む                                   |
| MEDIUM-4（architecture）       | `08b9fc0c`。散文の義務（世代の門）をコードにした                           |
| ADR-0007 のパス                | `docs/IDEAS.md` へ（`main` から在る）                                      |
| HIGH-1 / HIGH-2                | **据え置き**（差分の外。#277 と基底側）                                    |

## 訂正

- architecture は `--base main` を前提に「PR の単位が241コミット」と書いたが、
  **この PR の基底は `fix/441-stop-analysis-on-unmount`**（ユーザーの指示）。
  差分は51コミット / 40ファイルで、レビューが見た範囲と一致する

## 見ていない範囲

- `perf` / `ui` / `rust` reviewer は16ラウンドとも走らせていない
- **実プロセスでの確認は1件も無い**
- 基底の `main..fix/441` の191コミットはレビューしていない
