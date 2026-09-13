# レビュー 441-unmount-session ラウンド30

- 日付: 2026-09-09
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / architecture（4人。**oss-hygiene は外した**）
- 対象コミット: `654327eb`
- 前ラウンド: [r28](2026-09-07-441-unmount-session-r28.md) / [r29](2026-09-07-441-unmount-session-r29.md)

**oss-hygiene を外した理由。** r29 の10件のうち9件が `main` から在る公開の体裁の話で、
r6 で同じものを `docs/IDEAS.md` へ送る判断をしている。**この変更の周りを見る人が
1人減るより、同じ範囲外の指摘が毎ラウンド出るほうが costly** と判断した。
体裁の再点検は IDEAS の項目を着手するときにまとめて回す。

## 前ラウンドからの持ち越し

- **#489**（自動再開の8本の ref）/ **#523**（断りの案内先）/ **#524**（席を取る口が3つ）→ open
- **差の出ない門**（r29 の所見12）→ `docs/IDEAS.md`。r30 で react がさらに2つ見つけた

## このラウンドでいちばん重いもの

**席が画面より長生きする口が、もう1つ見つかった**（robustness）——しかも
**フックの外**。ワークスペースの切り替えは webview をリロードするので、
React の cleanup が1つも走らない。

そして**r29 の直しが2つとも誤っていた**——「撃ち直しは1回だけ」の門は
防ぐと名乗った事象を防げず、実際には2本目の書き戻しを落としていた（react）。
台帳に書いた「`unmount` も撃ち直す」も嘘だった（comment / robustness）。

## 所見

### [HIGH] 1. ワークスペースを変えると、後始末が1つも走らないまま席が残る

reviewer: robustness（実測）

```ts
// WorkspaceTab.tsx:70-76
const picked = await chooseRootDir({ force: true });
if (!picked) return;
window.location.reload();
```

席を返す口は `AnalysisProvider` の cleanup ただ1つで、`src/` に `beforeunload` は
**1つも無い**。`initialize_engine_impl` は `active_sessions` に触らないので、
リロード後に張り直したエンジンでも古い席が残る。

**解析を走らせたまま 設定 → ワークスペース → 変更 を踏むと、以後どの ▶ も断られる。**
断りは `START_REFUSED_MESSAGE` に落ちるが読み手が0（#277）なので、
利用者に見えるのは「押しても何も起きない」だけ。

### [HIGH] 2. 「撃ち直しは1回だけ」の門が逆だった（**こちらの退行**）

reviewer: react（フックの口を直に並べて実測）

防ぐと名乗っていた「書き戻しと撃ち直しが回り続ける」は**起こり得ない**
——撃ち直しは席を指さない停止なので、落ちても `keepOrForget` は先頭の
`sessionId === undefined` で降りる。**印を倒すことで実際にしていたのは、
2本目以降の書き戻しを落とすこと。**

```
現物:      after landing2: [..., ["S2","late-restart"]]  isHeld=true  ← S2 は誰も返さない
1行消すと: after landing2: [..., ["S2","late-restart"], [null,"unmount"]]  isHeld=false
```

**この門は1本のテストも支えていなかった**（消して 76 全緑）。

### [BLOCK] 3. 台帳とコードが「畳まれた後の停止」を正反対に説明し、どちらも半分嘘

reviewer: comment / robustness（独立に実測）

`sweepOnUnmount` は `shootQuietly("unmount", undefined)` を撃つので、落ちても
`keepOrForget` は先頭で降りる（書き戻しも撃ち直しも無い）。撃ち直しが効くのは
席を指した `late-*` だけ。

- コード（`useEngineSeat.ts:386` / `:417`）「`unmount` と `late-*` は誰も返せない」→ **`late-*` について嘘**
- 台帳（F-7 / 不変条件5）「`unmount` と `late-*` も1度だけ撃ち直す」→ **`unmount` について嘘**

**正しい説明がどこにも無い。**

### [BLOCK] 4. `armForMount` を doc と宣言の間に差し込んだ（**こちらの退行**）

reviewer: architecture / comment / robustness（3人が独立に）

TS は直前のブロックだけを結び付けるので、**`sweepOnUnmount` が公開面から doc を失い**、
印を戻すだけの `armForMount` に「席を指さずに撃つ」「落ちた回は誰も返せない」が乗った。
**このフックで最も危険な口**の説明が、それをしない関数に付いている。

### [HIGH] 5. `NODE_SCAN` に逃げ道が3本

reviewer: architecture（実測）

`from` に縛っていたので `child_process`（外部プロセスで歩く）・`await import(...)`・
`createRequire` が素通り。**同じファイルの上の検査が動的 import を塞いでいるのに、
こちらだけ片側が開いていた。**

### [MEDIUM] 6. `commentsOf` のシェル枝が綴りを二重に持ち、空を返しても全部緑

reviewer: comment / architecture（独立に）

`stripShellComments` と同じ正規表現が手で2回書かれている。しかも
`describe("commentsOf")` にシェルの筋が1本も無く、**枝を丸ごと空にしても
32 全緑**（`.md` の取り分だけで下限を越えるため）。

### [MEDIUM] 7. `settingsTabNames` が `modal:` を伴わない `updateParams({ tab })` を見ない

reviewer: architecture（実測）

設定モーダルが既に開いた状態でタブを切り替える普通の綴りがこれ
（`SettingsPanel` の `goTab` が現にそう）。いま安全なのは `goTab` の引数が
`TabKey` に型付いているという偶然だけ。

### [MEDIUM] 8. 自前で歩く検査を2本足したのに、`CONTRIBUTING.md` の例外表に行が無い

reviewer: architecture

表は「増えたら行を足してください」と書いてあるが、それを見る機械は無い。
加えて `srcCommentIdentifiers` の hooks の歩き方は flat、corpus 側は再帰で、
**同じディレクトリを2通りに数えている。**

### [MEDIUM] 9. 検査の doc に「無かった」が残り、走査範囲の記述が現物より狭い

reviewer: comment

### [MEDIUM] 10. 解析セッションの IPC が `entities/engine` に在るが、語彙は解析のもの

reviewer: architecture

`SeatReleasePoint` の値は全部 React のライフサイクルと局面同期の語。
**その同期漏れを捕まえるためだけに `_EveryPointIsAssigned` が要っている**
——仕掛けの存在自体が置き場のずれの症状。

## 確かめて問題が無かったもの

- **`TEST_SCALE=2` で全件緑**（react。`35bf0fa8` の狙いどおり）
- **`armForMount` は畳んだ後に呼ばれない**（react が effect の依存を辿って確認）
- **既に枠へ並んだ sweep を `armForMount` は取り消さない**（robustness が実測）
- **`6476b8c0` の後、席が残るのは3筋だけ**（robustness が辿った）
- **provider 経由では三つ巴の窓を組めない**（react。組めるのはフックの口を直に並べたときだけ）
- **断りが案内する操作は #523 の2本以外は空振りしない**（robustness が全部辿った）
- **`settingsTabNames` が `create-file` の `tab` を誤って赤くする筋は無い**（architecture）

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓。**30ラウンド続けて未見。**
- 実プロセスでの検証。誰もしていない。

## 修正計画

1. **所見1 → Rust 側で塞ぐ。** フロントの口を1つずつ塞ぐ形にしない（クラッシュでも同じ）
2. **所見2 → 印を倒すのをやめ、フックの口を直に並べたテストで固定する**
3. **所見3・4 → 事実を1箇所に置き、doc を宣言に戻す**
4. **所見5・6・8・9 → 機械と doc**
5. **所見7 → 型で閉じる**（綴りの網を広げ続けない）
6. **所見10 → `docs/IDEAS.md`**（#524 と同じ回に決める）

**壊しうるもの。** 1 は Rust の起動経路に触るので `verify:rust` が要る。
2 は r29 で足したばかりの門を外すので、**外した後に2本目が返ることを先に固定**してから動かす。

### 次ラウンドの焦点

- 1 の「起こし直しで席を捨てる」が、**正常な起こし直し**（設定でオプションを変えた回）で
  走っている解析を巻き添えにしないか
- 2 の後、撃ち直しが**本当に回り続けないか**（`keepOrForget` の先頭の門だけが根拠）
- 7 の型が、`create-file` の `tab` を壊していないか

## 修正の結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| 1 | 直した。`initialize_engine_impl` の先頭で席を捨てる。Rust のテストを1本 | `27d96d1e`（変異で確認） |
| 2 | 直した。印を倒さない。フックの口を直に並べたテストを1本 | `27d96d1e`（変異で確認） |
| 3 / 4 | 直した。事実を不変条件5 に置き、3箇所からそこを指す。doc を宣言へ戻した | `27d96d1e` |
| 5 / 6 / 8 / 9 | 直した。3形とも赤くなることを確認。綴りを定数1つに寄せ、シェルの筋を2本置いた | `761807df`（変異で確認） |
| 7 | 直した。`useOpenSettings(tab: TabKey)` に寄せ、3つの呼び手を通した | `5bcd9dfe`（tsc が落とすことを確認） |
| 10 | **`docs/IDEAS.md` へ**（#524 と同じ回に決める） | — |

### 所見2・3・4 について——r29 の直しが3つとも傷を持っていた

r29 で入れた3つの変更が、それぞれ別の形で誤っていた。

- **所見2**: 門の理由が誤り（防ぐと名乗った事象が起こり得ない）。しかも**実害の向きが逆**だった
- **所見3**: その門の説明を台帳へ写したので、**嘘が2箇所に増えた**
- **所見4**: 口を1つ足すときに、隣の doc を動かし忘れた

**共通しているのは「足した門の理由を、現物で確かめずに書いた」こと。**
r29 の時点で `keepOrForget` の先頭の門を読んでいれば、3つとも書く前に気づけた。
**門を足すときは、その門が無い場合に何が起きるかを実際に走らせて確かめること。**

### 所見1 について——フックの外にも口が在った

29ラウンド、席の漏れをフックと provider の中だけで探していた。
**畳まれずに消える口**（リロード）は、その探し方では見つからない。
Rust 側で塞ぐ形にしたので、クラッシュでも同じように閉じる。
