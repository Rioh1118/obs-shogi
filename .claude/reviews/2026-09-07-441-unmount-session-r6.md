# レビュー 441-unmount-session ラウンド6

- 日付: 2026-09-07
- 範囲: `git diff main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene
- 対象コミット: `9c9b1f4c`
- 前ラウンド: [r1](2026-09-07-441-unmount-session-r1.md) ／ [r2](2026-09-07-441-unmount-session-r2.md) ／ [r3](2026-09-07-441-unmount-session-r3.md) ／ [r4](2026-09-07-441-unmount-session-r4.md) ／ [r5](2026-09-07-441-unmount-session-r5.md)

## 所見

### [HIGH] 1. 手動開始が世代を `await seat.releaseHeld()` の**後**で読む

reviewer: react（実測）

r4 で足した「席を握ったままなら ▶ で返してから始める」が、**本物の往復を
`seq` を読む前に挟む**。その窓で棋譜を閉じると世代が上がるが、後で読むので
`supersededSince` は最後まで false。閉じた棋譜のために同期待ちが上限まで回り、
断りを積む（あるいは席を握って「解析中」が1回 commit される）。
**r5-1 が直したはずの失敗が、別の入口から戻っている。**

### [HIGH] 2. `releaseHeldQuietly` が in-flight を見て黙って降りる

reviewer: react / robustness（2人が独立に実測）

r5-8 は「2本目を撃たない」ために降りる形にしたが、**降りた側が再挑戦する口を持っていない**。
■ の返却が飛んでいる最中に棋譜を閉じ、その返却が落ちると、席は握ったまま残り、
`no-position` の effect は依存が動かないので二度と走らない。
棋譜を閉じた画面には ▶ も ■ も無く、エンジンは閉じた局面を読み続ける。

### [HIGH] 3. ※14 の「棋譜を閉じても解析ペインは畳まれない」が逆

reviewer: robustness

畳まれないのは `AnalysisProvider` で、`AnalysisPane` は `hasKifu` の内側なので消える。
不変条件1・3 と F-7 が「画面が生きていれば ▶ で返し直せる」と案内しているが、
**その ▶ は棋譜を閉じた回には無い**。

### [HIGH] 4. `SeatReleasePoint` が「口を切り分ける」と名乗るのに、3つの口が `"stop"` に潰れている

reviewer: robustness / comment

自動再開の前始末・▶ の握り直し・■ が、Rust のログで同じ字面になる。
`by` の存在理由（「利用者が押した停止と区別できるのはログだけ」）が半分失われている。

### [BLOCK] 5. `releasingRef` の「なぜ」が、`bridge.rs` の分岐とも catch とも食い違う

reviewer: comment

「2本目が『知らない席』で断られ、その失敗でもう存在しない ID を握り直す」と書いたが、
Rust は席が空なら `Ok` を返す（`None if sessions.is_empty()`）し、
catch は `retiredRef` と一致する ID を握り直さない。**どちらの順でも起こせない。**

### [BLOCK] 6. `supersededSince` の doc が引き金を2つと数えている（3つある）

reviewer: comment

r5 で `no-position` が3つ目として入っている。手動開始の窓のコメントも
「この窓で動く口は畳まれることだけ」と排他で断定していた。

### [HIGH] 7. ※12 の列挙が、書き換えた後もコードで作れない（4ラウンド目）

reviewer: comment / robustness

### [HIGH] 8. E6 の列が「Rust の席は P1 のまま」と読める

reviewer: oss-hygiene

`shutdown_engine` を通った回は `stop_all_sessions` が先に走るので P0。
`app.md` の ※4 がこの表へ委譲しているのに、**委譲先の答えが逆**。

### [HIGH] 9. `(S0/P1, E10)` が `—`

reviewer: oss-hygiene

S0/P1 は自分で「開始の応答待ち」と定義しているのに、その開始が失敗する回を
「来ない」と書いている。`(S6/P1, E10)` も同じ。

### [HIGH] 10. 「S0/P1 に入る口は3つ」が、不変条件1（4つ）と食い違う

reviewer: oss-hygiene

## MEDIUM

11. **`releasingRef` の機構が、変異を当てても全部緑**（react / robustness）。
    r3-14 に続いて2回目。
12. **`state.error` の読み手が0なのに、コメント3箇所がそれを根拠にしている**（react）。
    r3-10・r4-12・r5-10 に続く4回目の「読み手0」。
13. **世代を上げる4行が2つの引き金に逐語で写されている**（react）。
14. **※1 の「以降 E1 は※11 に落ちる」が古い**（robustness）。
15. **「台帳」がこの PR で2つの別物を指すようになった**（robustness）。
    「項目」→「席」に寄せた当の PR で、新しい3行が `active_sessions` を「台帳」と呼んでいる。
16. **同期待ちの打ち切りのコメントが、いまの API では選べない判断を書いている**（robustness）。
17. **`analysis.md` だけ ✓ の規約を使っていない**（oss-hygiene）。
    README の読み方を当てると、テストが固定したセルも未検証に見える。

## 範囲外（`docs/IDEAS.md` へ送った）

oss-hygiene が挙げた4件——README のトップ画像が古い／PR テンプレートの検証条件が
CONTRIBUTING より狭い／Tauri の Linux 依存が CI の yml にしか無い／
`Cargo.toml` と `package.json` にライセンスの帰属表示が無い。
**どれも `main` から在り、#441 の変更とは無関係。** 範囲を広げると PR が読めなくなる。

## 重複・矛盾した所見

- 所見2 は react と robustness が独立に、同じ再現手順で実測した。
- 所見4・7 は comment と robustness が同じ結論。
- 矛盾は無し。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**6ラウンド続けて未見。**
- `features/engine-position-sync` の実装。**6ラウンド続けて未見。**
- 実プロセスを使った検証は誰もしていない。
- `analysis.md` の表のうち、名指ししていないセル。

## lint / hook で強制できるもの

- **`SeatReleasePoint` の各値が、実際に撃たれているか**（union の要素と `send(` の実引数の突き合わせ）。
- **`AnalysisState` の各欄に読み手が居るか**（所見12。4回目）。
- **`docs/state-transitions/*.md` の行見出しが `(S, P)` の対のとき、セルが P の変化を持つか**（所見8・9）。
- 所見1〜7・10・11・13〜17 は機械では止まらない。

## 修正計画

1. **所見1 → 世代を返却の前に読み、返却の後にも門を1枚**
2. **所見2 → 降りずに後ろへ並べる。** 落ちたときだけ撃ち直す
3. **所見11 → 相乗り・並び・握り直しの3つに変異を当てて落ちるテストを足す**
4. **所見13 → `supersedeRequests` に1本化**、**所見4 → `releaseHeld(at)`**
5. **所見5・6・12・16 → コメント**
6. **所見3・7・8・9・10・14・15・17 → doc**
7. 範囲外の4件 → `docs/IDEAS.md`

### 次ラウンドの焦点

- 所見1・2 で足した門と並びが、**3つの引き金（畳まれる・止める・局面が無くなる）で
  同じ形になっているか**
- `releasingRef` に並べた側が、**さらに重なったとき**（3本目）に取りこぼさないか
- doc の断定が、また実装とずれていないか（**6ラウンド続けて出ている**）

## 修正の結果

| 所見                              | 結果                                                          | コミット / 送り先                   |
| --------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| 1 / 2 / 4 / 5 / 11 / 13           | 直した。世代を先に読む／並べる／口の名前／`supersedeRequests` | `3bdede0a`（テスト3本、変異で確認） |
| 6 / 12 / 16                       | 直した                                                        | 直後のコメント修正コミット          |
| 3 / 7 / 8 / 9 / 10 / 14 / 15 / 17 | 直した                                                        | 直後の docs コミット                |
| 範囲外の4件                       | `docs/IDEAS.md` へ                                            | 同上                                |
