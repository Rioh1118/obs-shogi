# レビュー 502-engine-never-returns ラウンド5

- 日付: 2026-09-09
- 範囲: `fix/441-stop-analysis-on-unmount...HEAD`
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `424fa9a1`
- 前ラウンド: [r1](2026-09-08-502-engine-never-returns-r1.md) / [r2](2026-09-08-502-engine-never-returns-r2.md) / [r3](2026-09-08-502-engine-never-returns-r3.md) / [r4](2026-09-08-502-engine-never-returns-r4.md)

**r1〜r4 の所見は1件も再掲されなかった。**

## 対象そのものを疑う

**`entities/engine-presets` に手を入れるのを2回やって、2回とも別の BLOCK を作った。**

| ラウンド | 入れたもの                     | 作った欠陥                                                                     |
| -------- | ------------------------------ | ------------------------------------------------------------------------------ |
| r2       | 一覧と選択を同じ commit へ畳む | 保存が落ちた回が**完全な成功と見分けが付かない**（r3 で robustness が指摘）    |
| r3       | 巻き戻しを足す                 | **同時に成功した別の書き込みを捨てる**／赤帯が貼り付く（r4 で3人が指摘・再現） |
| r4       | 保存を先に撃つ                 | 窓が IPC 1往復へ広がり、**消える予定のカードが押せる**（r5 で2人が再現）       |

**3回とも根が同じ**——`await` を跨いで決定を凍らせ、後から適用している。しかも
プリセットの書き込みは**5本とも直列化されていない**ので、部分的な手当てでは閉じない。

**これは #502 が直すべきものではない。** #502 の受け入れ条件は「戻ってこないエンジンの
下で解析を回し続けない」で、`deletePreset` の窓はそれとは別の欠陥。私が触ったのは
「その窓が私の断ちを誤爆させる」からだが、**誤爆ではなかった**——その窓でエンジンは
本当に畳まれ、戻ってくるのは別のエンジンなので、**断つこと自体は正しい**（r4 で react が
そう結論している）。ずれているのは案内の文言だけ。

**したがって r5 では `entities/engine-presets` を base へ戻し、窓の全体を #518 に置いた。**
代わりに**窓が在ることを固定するテスト**を残す（塞いだら赤くなる）。

## 私が r4 で記録した「変異を当てて確かめた」が誤りだった

react が指摘した。r4 の報告書には「保存と state の順を元に戻すと2本が落ちる」と書いたが、
**その変異で落ちたのは別の2つの assert** で、私が名指ししていた
「`runtimeConfig` が null を通らない」の行は**一度も赤くなっていない**——
`act()` の非同期スコープの中で解決させていたので、中間の commit がまとめて畳まれ、
`seen` に1枚も現れなかったため。5ms のマクロタスクを挟む変異でも緑のままだった。

**#502 の受け入れ条件を、どのテストも見ていなかった。** 同じ形が engine のテストにもあり
（probe が連続する同値を畳むので、「`no-engine` を挟まない」の検査が挟まった1枚を吸う）、
そちらも三項を戻す変異で**一度も落ちていなかった**。

**運用として直す。** 変異を当てたときは「赤くなった」ではなく
**「名指しした assert が赤くなった」**まで確かめる。今回はどちらも直し、
名指しした assert が単独で落ちることを確認した。

## 所見

### BLOCK-1 保存を先に撃つ形が、`await` を跨いで凍らせた決定を後から適用する（react / robustness が独立に再現）

`next` と `replacing` / `fallback` は `await persist` の**前**に確定するのに、書き込むのは**後**。
`EngineTab` は保存中もボタンを無効にしないので、窓は IPC 1往復ぶん開いている。

再現（どちらも無傷のツリーで実行、`beef588b^` では再現しない）:

- `[a,b]` で選んでいない `b` を削除 → 保存が返る前に「追加」→ 削除の保存が返る
  → **画面 `["a"]` / 最後にディスクへ書かれたのは `["a","b",新規]`**
- `[a,b]` で選択中の `a` を削除 → 保存中に `b` のカードを押す（消える予定のカードがまだ在る）
  → 保存が返る → `replacing` は凍ったまま → **`presets:["a"]` / `selectedPresetId:"b"`（実在しない）
  / `runtimeConfig: null` のまま戻らない**

### HIGH-2 「`runtimeConfig` は null を通らない」の検査が `act()` の中で潰れていた（react）

上の「私が記録した確認が誤りだった」節に書いた。

### HIGH-3 `duplicatePreset` の doc が、同じ PR が足したテストと正反対を主張している（comment）

「選ぶのでエンジンは起こし直る」——複製の中身は元と同じなので `equalRuntime` が等値と見て
**起こし直らない**。`entities/engine/model/__tests__/provider.test.tsx` の
「同じ設定を入れ直しても起こし直さない」がまさにそれを固定している。

### HIGH-4 「`deletePreset` だけが保存を先に撃つ理由」が、`duplicatePreset` 自身に当てはまる（architecture / comment / robustness の3本）

「そこだけ選択も一緒に動く」——`duplicatePreset` も選択を動かす。本当の弁別条件は
「**選択中のものが一覧から消える**」。6本目を足す人がこの基準で判定すると必ず取り違える。

### MEDIUM-5 `commitSelection` の doc の「割る理由」が、いまの並びでも成り立たない（architecture / comment）

`selectPreset` は `commitSelection` を同期で撃つので、`deletePreset` から呼んでも
同じ commit に畳まれ、`setLastPresetId` の往復も現状と同じだけ背負う。
**r4 で直した文が、同じ主張を肯定形で言い直しただけだった**（4ラウンド目）。

### MEDIUM-6 名前の軸のラチェットが、規約の出典をどこにも持たない（architecture）

`_ON_START_MESSAGE` / `_WHILE_ANALYZING_MESSAGE` の要求は `docs/` にも `refusals.ts` にも無い。
落ちた人が CONTRIBUTING の索引を引くと、**別の規則と、当てはまらない逃げ道**に案内される。
`ratchetIndex` は名前の対応しか見ないので機械では止まらない。

### MEDIUM-7 `ENGINE_STARTING_ON_START_MESSAGE` の TSDoc が F-9（初期化失敗）を指したまま（comment）

改名で割った軸と食い違う。F-9 を指すのは隣の `ENGINE_FAILED_ON_START_MESSAGE`。

### MEDIUM-8 engine の probe の畳み込みが、その検査の対象を吸う（react）

上の節に書いた。`no-engine` を挟む変異を当てても、直前が `no-engine` なら畳まれて出てこない。

### MEDIUM-9 不変条件2 の2つ目の項に、降りる門が1つも書かれていない（oss-hygiene）

F-39 が根拠として指している先が、F-39 と F-38 の違い（降りる門）を書いていない。
**r4 の HIGH-5 で直したのは台帳と spec だけで、両者が指す側に残っていた。**
`analysis.md` から F-38 / F-39 へ戻る参照も無い。

### MEDIUM-10 「段」が同じ表で3つの意味に使われている（oss-hygiene）

§3 が「段は ADR-0004 の4つ」と定義しているのに、F-19 は**ログの重大度**、
F-28 は **`Phase`** の意味で使っている。r4 で凡例を絶対形にしたぶん衝突が効くようになった。

### MEDIUM-11 r4 の所見が、同じラウンドで訂正された r3 の文を現在形で引用している（oss-hygiene）

次の reviewer が「所見が捏造」か「訂正済み」かを判別できない。

### MEDIUM-12 「`runtimeConfig` は null を通らない」は代替が未設定なら成り立たない（robustness）

`fallback` が「要設定」のプリセットなら、同じ commit で動かしても null になる。

### MEDIUM-13 テストの doc ブロックが mock の const に付いている（comment）

`@packageDocumentation` の位置ではないので、下に mock を1つ足すと doc が別のものに付き替わる。

### MEDIUM-14 r4 の反論が、`sliceBarrels` の禁止範囲より広く読んでいる（architecture）

ラチェットが禁じるのは「**barrel が実際に公開しているモジュール**」への deep import だけ。
`analysis` は既に `engine/api/tauri` と `engine/api/events` を deep import している（合法）。
つまり「barrel に載せない置き場」は選択肢として残っている。

### MEDIUM-15 ADR-0004 決定3 の F-5 行「変更が全て楽観的更新」（architecture）

r4 の保存先行で偽になっていた。**r5 の revert で真に戻る。**

## 重複・矛盾した所見

- **BLOCK-1 / HIGH-4 / MEDIUM-5 / MEDIUM-12 / MEDIUM-15 は全て `entities/engine-presets`**。
  base へ戻すことで指摘箇所ごと消える
- **HIGH-3 と HIGH-4 は同じ doc ブロック**
- react と robustness が**同じ2つの筋道を独立に再現**した（片方は `git archive` で
  無傷のツリーを作って実行）。並走している別の reviewer が変異を注入している最中だったため

## 見ていない範囲

- `perf` / `ui` / `rust` reviewer は5ラウンドとも走らせていない
- **実プロセスでの確認は5ラウンドを通して1件も無い**
- レビュー中、**並走する reviewer がワークツリーを一時的に書き換えていた**
  （architecture と oss-hygiene がそれを未コミットの変更として報告した）。
  **コミット済みのツリーには入っていない**——`git status` と `FORCE` の grep で確認した
- 基底ブランチ側でも `analysis.md` が動いている。マージ時の衝突は見ていない

## 修正の結果（`/review-fix`）

| 所見                                                         | 結果                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLOCK-1 / HIGH-3 / HIGH-4 / MEDIUM-5 / MEDIUM-12 / MEDIUM-15 | `1cb0f10a`。**`entities/engine-presets` を base へ戻し、窓の全体を #518 へ**。窓が在ることを固定するテストを残した **`1cb0f10a` は `5e2c4a08`（`duplicatePreset` の doc）も巻き戻している**——`EngineTab` のコメント削除だけが残る。複製の事実は `settings.md` に置き直した（→ r8） |
| HIGH-2 / MEDIUM-8 / MEDIUM-13                                | `b330ac46`。畳み込みをやめ、`act` の外で解決させ、doc ブロックを `@packageDocumentation` に                                                                                                                                                                                        |
| MEDIUM-6 / MEDIUM-7                                          | `b330ac46`。規約を `refusals.ts` の冒頭と CONTRIBUTING の索引へ。F-9 の指し先を落とした                                                                                                                                                                                            |
| MEDIUM-9 / MEDIUM-10 / MEDIUM-11                             | `b330ac46`                                                                                                                                                                                                                                                                         |
| MEDIUM-14                                                    | **r4 の反論の文言を狭める**（下）                                                                                                                                                                                                                                                  |

**変異を当てて確かめたもの**——今回は**名指しした assert が単独で赤くなること**まで見た。

- `deletePreset` の順を保存先行に変えると、`engine-presets` の
  「保存の往復のあいだ null を通る」が落ちる（他の assert を外しても `seen` の行だけで落ちる）
- 三項を r2 以前に戻すと、engine の「起動の設定を組み立てられない間だけ no-engine」が落ちる
  （**畳み込みを外す前は落ちなかった**）

### MEDIUM-14 について（r4 の反論の訂正）

r4 では「barrel を境界にすると決めたことの帰結」と一般化して書いたが、**言い過ぎだった**。
ラチェットが禁じるのは barrel が公開しているモジュールへの deep import だけで、
`engine/api/*` のように**barrel に載せない置き場**は現に許されている。
`isRecoverableNotReady` をそちらへ動かす案は残っている——判断は
`docs/IDEAS.md` の「`entities/engine` の公開面をまとめて決める」へ寄せたまま。

## 次ラウンドの焦点

1. **`entities/engine-presets` を base へ戻したことで、#502 の断ちが誤爆しないか。**
   プリセットを消した回に解析が1回切れるのは**仕様として受け入れた**（※5 に書いた）が、
   それ以外の窓が開いていないか
2. **残したテストが「窓が在ること」を固定できているか。** 塞いだときに赤くなるか
3. **畳み込みを外した engine のテストが、他の検査を弱めていないか**
4. **doc の4箇所（不変条件2 / ※5 / spec / F-38・F-39）が、降りる門で書き分けられているか**
