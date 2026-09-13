# レビュー 441-unmount-session ラウンド31

- 日付: 2026-09-09
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / **rust**（4人）
- 対象コミット: `a8e985f9`
- 前ラウンド: [r29](2026-09-07-441-unmount-session-r29.md) / [r30](2026-09-07-441-unmount-session-r30.md)

**rust reviewer を初めて走らせた。** 31ラウンド回して `src-tauri/src/engine/` の中身は
誰も見ていなかった（architecture が `bridge.rs` の差分を1度読んだだけ）。
architecture は今回外した——r30 の所見が機械の綴りに寄っており、Rust 側の未見のほうが重い。

## このラウンドでいちばん重いもの

**Rust を初めて見たら、利用者に見える欠陥が2つ出た。** どちらも
**この画面のどの断りも案内している復帰操作**（設定でオプションを変えて保存）の上に在る。

## 所見

### [HIGH] 1. 起こし直しが毎回きっかり3秒固まり、直後に事実でない warn が出る

reviewer: rust / robustness（**独立に同じ根を実測**）

`wait_until_settled` は `infinite_settled` を `clone()` で読むだけで空けない。
`infinite_listener` は `take()` しているのに、こちらだけ非対称。

```
--- 利用者が押した停止:                    1.615084ms ---
--- 設定を保存したときの shutdown_engine:  3.30938325s ---
```

1本目の無限解析を畳んだ後の停止は、鳴る当てのない `Notify` を
`ANALYSIS_STOP_GRACE` いっぱい待つ。**`shutdown_engine` は必ずこの経路を通る。**

利用者に起きること——オプションを保存してダイアログが閉じた後、**3秒以上なにも
起きない**。進捗も出ない（engine の `phase` / `error` は読み手0 → #523）。
`onEngineGone` も3秒遅れるので、その間の自動再開は死にかけのエンジンへ飛ぶ。

開発者に起きること——`by=` 付きのログ（**このブランチが「席が在ったのかを後から
言えるのはこれだけ」と書いて足したもの**）の真隣に、探索していないのに
「まだ探索中かもしれない」と言う行が出る。

### [HIGH] 2. `by` が、フロントから来た任意の文字列のままログへ出る

reviewer: rust（実測）

**`by` はこのブランチが足した欄。** TS 側の型は閉じた8値だが、IPC の境界は素の文字列で、
長さも中身も検査が無い。

```
--- lines containing a newline: 3 ---
"stop_all_sessions: start by=unmount\n2026-09-09 [ERROR] forged: engine crashed"
--- total bytes logged for one stop_analysis call: 900154 ---
--- LOG_FILE_BUDGET: 200000 ---
```

`invoke` 1回で予算の**4.5周**——`KeepOne` の履歴が丸ごと消える。
**`by` を足した目的そのものを壊す**（#441 の再発を追う唯一の記録が、その1本で流れる）。
行の偽造も同じ1本でできる。

この repo は既に同じ規約を持っている（`utils.rs` の `shown` と
`registry.rs` の `the_registry_lines_cannot_rotate_the_log_or_forge_a_line`）。
`by` はその関門を1つも通っていない。

### [HIGH] 3. 席を返している最中に起こし直されると、自動再開が「本物の失敗」に化ける

reviewer: react（実測）

札（`beginTake`）を取るのは席を返した**後**なので、返却の往復の最中に起こし直されると
**進んだ後の世代が札に焼き付く**——世代差は 0 のまま、開始だけが Rust に断られる。

```
[P2] error "解析を再開できませんでした。… 設定でエンジンのオプションを変えて保存すると起こし直せます。"
[P2] after engine back: startCore 0        ← エンジンが戻っても再開しない
```

**利用者がいま済ませた操作をもう一度やれと案内する。** ▶ の口にも同じ穴がある。

### [BLOCK] 4. 「席を指さない停止は `sweepOnUnmount` だけ」が3箇所で偽（**こちらの退行**）

reviewer: comment

r30 で `keepOrForget` にも撃ち直しを足したので、綴りの所在を数え上げた3箇所が偽になった。
`"unmount"` を撃つ口を足す人が「`sweepOnUnmount` を直せば全部」と読む。

### [HIGH] 5. doc ブロックの取り残しが**3回目**（`SHELL_COMMENT`）

reviewer: comment

`761807df` が定数を抽出したとき、`stripShellComments` の doc が上に残った。
**呼び出し順の制約**（「文字列を先に潰してから来ること」）が、呼ばれない定数の doc として
読まれる状態。r30 の `armForMount` と同じ形が、同じコミット群で再発している。

### [HIGH] 6. `CONTRIBUTING.md` の `seatSlotShape` が機械より狭い規約を名乗る（**4枚目の写し**）

reviewer: comment

r29 で `useEngineSeat` とラチェットのヘッダを直したときに、`CONTRIBUTING.md` にも
同じ文が在ることを見落とした。**これを読んだ人は `useResultFlush` を違反と読み、
逆方向に壊す。**

### [MEDIUM] 7. `settingsTabNames` の src 側が候補0件で無条件に緑（**こちらの退行**）

reviewer: comment

`5bcd9dfe` で型に寄せた結果、`tab: "リテラル"` の形が本番から1つも残っていない。
doc は「綴りで止める」と現在形で言い続けているが、その保証はいま存在しない。

### [MEDIUM] 8. r30 で足したフックのテストが、名前で約束した「返し直す」を見ていない

reviewer: react（実測）

判定が席の欄だけなので、**撃たずに欄を空ける変異が素通り**する。

### [MEDIUM] 9. `initialize_engine_impl` の契約が `///` に無く、コメントの順序も逆

reviewer: rust / robustness（独立に）

drain は `analyzer.initialize_engine` の**前**なので、その間だけ
「席は空・古いエンジンはまだ読んでいる」窓が開く。コメントは「もう死んでいる」と書いていた。

### [MEDIUM] 10. `AnalysisProvider` が902行、自動再開の8本の ref が同居

reviewer: react（再掲。#489）

## 確かめて問題が無かったもの

- **Rust の drain は、正常な起こし直しで走っている解析を巻き添えにしない**
  （rust / robustness が独立に辿った。`shutdown_engine` が先に席を空ける）
- **`WorkspaceTab` の口を塞がない判断は妥当**（robustness。リロード後は必ず
  `initialize_engine` を投げるので、そこで落ちる）
- **席が Rust に残る筋は r30 の3筋のまま**（robustness。4本目は見つからなかった）
- **`take_session` / `release_session` / `stop_all_sessions` に割れる窓は無い**（rust。
  検査と登録は同じ `write()` 区間。`engine/` に `std::sync` のロックは無く、
  `MutexGuard` を `await` 越しに持つ箇所も無い）
- **emit していないイベントの記述は正しい**（rust。`analysis-complete` / `engine-error` の
  綴りは Rust に1文字も無い）
- **r30 で足した Rust のテスト3本は全部効いている**（rust が4通りの変異で確認）
- **`useOpenSettings` は再描画も同一性も変えていない**（react）
- **撃ち直しは回り続けない**（react が全部落ちる状態で実測）
- `npm audit` は 0 件

## 見ていない範囲

- `protocol.rs` の書き込みの列と `game/` の状態機械。**31ラウンド続けて未見。**
- 実プロセス（本物のやねうら王）での検証。rust は自作の偽エンジンで測った。

## 修正計画

1. **所見1 → `take()` にする**（`infinite_listener` と揃える）。プロセス不要のテスト1本
2. **所見2 → 入口で `shown()` を1度通す。** `registry` と同じ形のテスト1本
3. **所見3 → 世代差だけでなく、いまエンジンが使えるかも見る。** 再現をテストに置く
4. **所見4・5・6・9 → doc**
5. **所見7・8 → 空振りを止める**
6. **所見10 → #489**

**壊しうるもの。** 1 は停止の待ち方そのものを変えるので、**2回目が即座に返ることを
先に固定**してから動かす。3 は断りの分類を変えるので、既存の断りのテストが全部通ること。

### 次ラウンドの焦点

- 1 の `take()` が、**1本の解析の中で2回停止を撃つ回**（■ の後に畳む等）を壊さないか
- 2 の `shown()` が、**診断として読める長さ**を残しているか
- 3 の後、`ENGINE_RESTARTED_MESSAGE` を出す回が消えていないか

## 修正の結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| 1 | 直した。`take()` にし、プロセス不要のテストを1本 | `c6037979`（`clone()` に戻すと赤） |
| 2 | 直した。入口で `shown()` を1度。`registry` と同じ形のテスト | `c6037979`（潰さない形に戻すと赤） |
| 3 | 直した。世代差と readiness の両方を見る | `96b0dd0d`（直す前の木で赤くなることを確認） |
| 4 / 5 / 6 / 9 | 直した。数え上げをやめ、doc を宣言へ戻し、写しを出典へ寄せた | `96b0dd0d` / `c6037979` |
| 7 / 8 | 直した。口が1つに寄っていることを見る段と、撃った本数を見る assertion | `96b0dd0d` |
| 10 | **#489**（機構は動かさない） | — |

### 所見1・2 について——31ラウンド目に Rust を見た

**この2つは30ラウンド誰も見ていない場所に在った。** どちらも利用者に見える
（3秒の無反応、診断の記録が消える）。**`by` は このブランチが足した欄**なので、
足した回に Rust 側の規約（`shown` を通す）を確かめていれば入らなかった。

**触った層は、その層の規約で1度読むこと。** TS 側の型が閉じていることを
根拠に、IPC の向こうを素通しにしていた。

### doc ブロックの取り残しについて——3回目なので機械にした

r30（`armForMount`）、r31（`SHELL_COMMENT`）と同じ形が続いたので、
**宣言を挟まずに `/** … */` が2枚続く形**を落とす検査を足した（`96b0dd0d`）。
足した時点で、このブランチの外から2件（`modalOverlayTitlebar` / `aiLibrary`）拾った。
