# 機能要件: USI オプションと解析モード

追跡: #83 / #107 / #110 / #85 / #101
main にあるか: **無い**

## いまどうなっているか

| できること                                           | できないこと                        |
| ---------------------------------------------------- | ----------------------------------- |
| MultiPV / Threads / USI_Hash を編集する              | それ以外の USI オプションを編集する |
| 解析の既定値（時間・深さ・ノード・詰）を**入力する** | 入力した値で解析する                |
| 無限解析を始める・止める                             | 有限モードで解析する                |

プリセットは `analysis: { timeSeconds?, depth?, nodes?, mateSearch }` を
保存できるが、**解析の実行はこれを読まない。** 常に `start_infinite_analysis` に落ちる。

`analyze_with_time` / `analyze_with_depth` は Tauri コマンドとしても
`entities/engine/api/tauri.ts` の関数としても存在するが、
**それを呼ぶ画面が1つも無い**（`src/` を grep して 0 件）。
この2本には古い探索の応答を採る経路が5つある → #371

`DEFAULT_USI_OPTIONS`（`entities/engine-presets/model/defaultOptions.ts`）が
決め打ちで持っているのは7つ:
`USI_Hash` / `Threads` / `MultiPV` / `NetworkDelay` / `NetworkDelay2` /
`MinimumThinkingTime` / `SlowMover`。

## 要件

### 1. USI オプションを全部編集できること（#83）

- エンジンが申告した全オプションを**型別**に編集する
  （`check` / `spin` / `combo` / `string` / `filename`）
- `spin` は min/max でクランプする
- `filename` は Tauri のファイルピッカーを開く
- `button` 型は preset に保存する値を持たないので**表示しない**
- 既定値が分かり、既定と違う値は目立つ
- **シンプル表示では現状と同じ3つだけ**が見え、詳細トグルで全部出る
- 一覧を `enginePath` ごとにキャッシュする（毎回プローブ起動しない）
- 保存した値が `apply_engine_settings` から `setoption` として実際に流れる

`ImportantOptionsSection` を廃して `UsiOptionsSection` に一本化する
（設計は #83 のコメント欄と `.claude/plans/issue-83-usi-options-gui.md`）。

### 2. 解析モードが実行まで届くこと（#107）

- `AnalysisMode`（`infinite` / `time` / `depth` / `nodes` / `mate`）を preset に持つ
- 選んだモードに対応する `go` が実際に送られる
- preset を切り替えると次の解析から新しいモードになる
- **モードを持たない古い preset JSON が読める**（migration）
- **MultiPV は USI `setoption` 経由に統一する**（`AnalysisConfig` に持たない）

優先順位は `mate > time > depth > nodes > infinite`。

### 3. `go` が本当に送られること（#110）

#107 の在庫は有限モードを**近似で凌いでいる。**

| 指定          | 実際に送っているもの                               |
| ------------- | -------------------------------------------------- |
| 時間          | `byoyomi <ms>`                                     |
| 深さ / ノード | `byoyomi 24h` を天井に、`info` を見て閾値で `stop` |

`byoyomi` はエンジン側で「持ち時間に対する加算秒」として扱われるので、
`go movetime` とは厳密には等価でない。深さ・ノードに至っては
**GUI 側で打ち切っているだけで、エンジンは指定を知らない。**

**エンジンの比較実験をするなら、送ったコマンドと測りたい条件が一致していないと意味が無い。**

塞がっている理由: `usi` crate 0.6.2 の `ThinkParams` に
`movetime` / `depth` / `nodes` が無く、`UsiEngineHandler` が raw な
stdin 書き込み経路を公開していない。

### 4. 切替に進捗が出ること（#85）

- 「初期化中」「setoption 中」「isready 待ち」が画面から見える
- **同じ preset を選んでも再初期化しない**
- 初期化に失敗したことが分かる

## 実装の在庫

**どちらも main に無い。着手前に rebase のコストを見積もること。**

| ブランチ                       | 中身                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| `feature/phase-0-engine-ux`    | #107 の実装（PR #109 をマージ済み）。4コミット・18ファイル・+746/−458 |
| `archive/issue-83-usi-options` | #83 の未完成（24ファイル946行）。土台は上のブランチ                   |

`feature/phase-0-engine-ux` は **main から67コミット遅れ**ており、
#120 の FSD 再配置を丸ごと被る。**救出コストが新規実装を上回る可能性がある**
（`docs/PREMISES.md` P-007）。

`AnalysisMode` は main に grep して**0件**。

## 触ることになる画面

| 画面                                                 | 何が変わるか                               |
| ---------------------------------------------------- | ------------------------------------------ |
| [プリセット編集](../screens/engine-preset-dialog.md) | オプションの節が全面的に置き換わる         |
| [設定 / エンジン管理](../screens/settings.md)        | カードに出す要約が変わる。切替に進捗が出る |
| [解析ペイン](../screens/analysis-pane.md)            | いまどのモードで読んでいるかが要る         |

## 着手順

**#107 → #83。** #83 の在庫は #107 の上に積まれている。
#110 は #107 の近似を本物に置き換えるので、#107 の後ならいつでもよい。

## 判断の軸

`docs/PREMISES.md` P-007 —— 「エンジン UX 系は AI 開発者にとって中核の装置」。
**研究家向けの『あると良い』ではない。**
ただし未確認部分として「救出コストが新規実装を上回る可能性」が明記されている。
