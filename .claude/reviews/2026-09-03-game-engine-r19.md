# 対局エンジン レビュー ラウンド19

- 日付: 2026-09-03
- 範囲: ラウンド18と同じ。**ラウンド18で入れた変更を最優先で疑わせた**
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（#371）
- 観点: robustness / rust / comment の3本を並列

---

## doc・コメント

### R19-H1 `SEARCH_GRACE` の doc が、存在しない締切の式を断言している

`session.rs:132` が「締切は**その手に使い切れる持ち時間 ＋ これ**」と書いているが、
`stalled_turn` で `budget` に足されるのは `HARD_TURN_LIMIT` のほう。
`SEARCH_GRACE` は `since.elapsed()` と `silent_for` の**両方に掛かるだけ**で、
持ち時間には一度も足されない。`grep` しても `budget + SEARCH_GRACE` の式は0件。

筋道: これを「持ち時間に足す猶予」と読んだ人が値を短くすると、実際は
**手番開始からその秒数**で沈黙判定が走る。`info` を秒単位でしか出さないエンジンが
正常に読んでいる最中に `EngineFailure` で負ける。

`SETTLE_TIMEOUT` の doc（`:258-259`）も「`Running` の枝は同じ関数が
**持ち時間＋`SEARCH_GRACE`** で見る」と書いていて、その式はコードに無い。
`game-session.md` の ※12 は現物と合っているので、**Rust の doc だけが古い。**

### R19-H2 ※3 の「書き込む口がこの関数だけ」が、同じ doc の不変条件6 と矛盾する

`game-session.md:159-160`（ラウンド18で自分が足した文）が「書き込む口が
この関数だけ」「3箇所目を増やすなら」と書いているのに、同じ文書の `:36` と
不変条件6 は「`start` と `accept_continue` の2箇所だけ」。
**1つの節の中で「1箇所」「2箇所」「3箇所目」が並んでいる。**

「この関数だけ」を信じた人は `initial_moves` 側の検証を消しても安全だと判断する。
消すと、検証されていない手が積まれた状態で `position` が組まれ、
`accept_continue` の接頭辞照合はそれを通す。

### R19-H3 `scanning/mod.rs` の「3つの検査が同じ前提で括弧を数える」が現物と合わない

`mod scanning;` を書いているのは `production_unwrap` と `root_guard` の**2つ**。
3つ目の `serde_naming` は `enum_carries_data` で**自前に数えていて**、
コメントを `split("//")` で落とすだけ——`'{'` の文字リテラル（mod.rs 自身が
「実在する形」として挙げているもの）や `"http://..."` で深さがずれる。

doc を読んだ人は「3つとも寄っている」と信じてこの穴を探さない。

### R19-M1 ADR-0008「決めたのは次の3つ」の下に箇条書きが4つある

4つ目（`engine/mod.rs` は `pub mod` を並べるだけ）は検査2本が強制している
立派な決定なのに、補足に見える。

### R19-M2 `EngineRegistry::spawn` の doc に、要約の一文が段落の途中へ挿し込まれた

`registry.rs:88-96`。「…最低限のガード。**エンジンを起こす。**」と1段落に連結され、
セキュリティ上のガードの説明が要約文で終わったように読める。
**ラウンド18で直した R18-H1 と同じ形が、同じラウンドの別の場所で再発している。**

### R19-M3 F-19 が `turnChanged` の欠落を `over` と同じ結末だと書いている

`turnChanged` が落ちても `Phase` は `Thinking` のままなので、`clockUpdated` は
500ms ごとに届き続ける。人間の手番なら持ち時間が尽きた時点で
`over { reason: "timeout" }` が飛ぶ——**エンジンが指したのに人間が負ける**。
「何も起きない」「00:00 まで描いてから静止」は `over` の欠落にしか当てはまらない。

### R19-M4 `MAX_WIRE_FIELD` の doc が「件数も長さも無制限の `setoption`」と現在形で書いている

6行下で件数を（`MAX_OPTIONS`）、同じ定数で長さを縛っているのに。
読み手が二重にガードを足すか、「無制限なら `MAX_OPTIONS` は何のためか」で止まる。

### R19-M5 「段を素直に足すと2体ぶんで5分を超える」が3箇所に散っている

`session.rs:76` / `:2124` / `engine_timeouts.rs:78`。
**`engine_timeouts.rs` の module doc が自分で「散文で書かない」と禁じている形。**
`READY_TIMEOUT` を60秒に下げると合計200秒で偽になるが、3箇所とも黙って古くなる。

### R19-M6 `TimeLimit` の「弾かれる形」の一覧を、TS の写しが持っている

`types.rs:176-177` が「**数も一覧もここには書かない**（`if` を1つ足すたびに、
離れたところが嘘になる）」と決めているのに、`rust-types.ts:87-92` がその一覧を持つ。
`the_typescript_copy_has_every_field` は欄の綴りしか見ないので、`if` を1本足しても緑。
「24時間」は `MAX_TIME_MS` の導出値でもある。

### R19-M7 `GameSettings` の上限が TS 側にどこにも書かれていない

`MAX_PLIES` / `MAX_OPTIONS` / `MAX_WIRE_FIELD` はラウンド18で足した入口の検算だが、
TS の写しにも `startGame` / `continueGame` の doc にも1行も無い。
`TimeLimit` の弾かれ方は4件も列挙されているのに。

相入玉の長手数の棋譜から途中局面で始める——この機能で実際に起きる操作——が該当し、
踏むと英文の `Err` が返るだけ。

---

## 失敗経路（robustness）

**変異を実際に当てて確かめた所見。**

### R19-H4 `production_unwrap` が doc コメントの中の `#[cfg(test)]` に反応し、本番の宣言を黙って食う

`strip_test_modules` の `rest.find("#[cfg(test)]")` は**生のソース**に掛かるので、
コメント中の綴りも item の開始として扱う。

実測: `lib.rs:50` の doc コメントに
「（モジュールを跨ぐ関係なので、`#[cfg(test)] mod tests` からは見られない）」があるため、
そこから `pub const CLOSE_TIMEOUT: Duration = Duration::from_secs(4);` までが**丸ごと落ちている**。
`production_code("src/lib.rs")` に `CLOSE_TIMEOUT` の宣言は無い。そこに `.unwrap()` を
書いても緑。`the_scanner_still_sees_production_code` が名指しするのは3ファイルだけで
`lib.rs` を見ておらず、総文字数の下限も5行では動かない。

**ラウンド18で書いた「見つからないことを黙って通さない」は、`item_end` が `None` を
返す壊れ方しか押さえていない。** この壊れ方は `None` を返さず、`item_end` は
正常に働いたうえで**間違った範囲**を返す。

一般化すると、`src/` のどこかの doc コメントに `#[cfg(test)]` と書いた瞬間、
その直後の item 1つが走査から消える。

### R19-H5 `the_typescript_copy_has_every_field` が `GamePhaseView` の3バリアントのうち1つしか見ていない

`wire_samples` の `GamePhaseView` は `sample_snapshot().phase`（`AwaitingRuling` 固定）1件。
`PlayerSpec` は Human と Engine の2件を並べているのに。

実測: TS の `| { phase: "over"; result: GameResult }` から `result` を落としても**緑**。
対照として `GameSnapshot.clocks` を落とすと落ちる（検査自体は効いている）。

`GamePhaseView` は `getGameState` の戻り値の中心なので、
**取りこぼし後の突き合わせ**——この口の唯一の用途——がそこで壊れる。

### R19-M8 `typescript_fields` がコメント行も欄として数える

実測: `GameSnapshot` から `clocks: ClocksView;` を消し、同じ interface の中に
`/** いずれ clocks: ClocksView を足す */` を置くと**緑で通る**。

型ごとに分けたことで「別の型のコメント」は塞がったが、**「同じ型の中のコメント」は
塞がっていない**。この写しは日本語の doc が本体より長いファイルなので踏みやすい。

### R19-M9 `engine_layering` の `mod` 入れ子カウンタが、コメント中の `}` を数えて既に狂っている

実測: `types.rs` の `mod tests` は464行で開いてファイル末尾（1036）まで続くのに、
カウンタは**737行で0に戻る**。原因はコメント中の `}` と `'{'` / `'}'` の文字リテラル。
他の `engine/**` は今のところ一致している。

いま緑なのは、737行より後ろに `use` が1本も無いから**だけ**。
`mod tests` の下に `use super::...` を1本足すと1段浅く解決される。
段に無い行き先を報告するようにしたので黙って通ることは無くなったが、
代わりに**無関係な `use` を足しただけで検査が落ちる**。

### R19-M10 `prepare_engine` が `left` を1回しか読まないので、`usiok` の待ちが締切の外に出る

`info_timeout` は**spawn 段に入る前の残り**で決まる。`registry::spawn` は
`spawn_timeout` を使い切ってから `get_engine_info(info_timeout)` に入るので、
2段の合計は `min(SPAWN, left) + min(USI_OK, left)`。`left` が10〜30秒の帯にあると
合計は `left + 10秒`——**`START_TIMEOUT` を最大 `SPAWN_TIMEOUT` ぶん超える。**

doc が挙げている超過の内訳は `setoption` 1件と後始末だけで、この10秒が抜けている。
同じ文言が `tauri.ts` に写されているので、**待ち UI は「90秒＋数秒」を見積もる**。

### R19-M11 `close` の窓を埋めたのは `close_game` だけ

`closing` を見るのは `close` だけで、`get` と `ids` は `sessions` しか見ない。
`take_and_close` が `Arc::try_unwrap` に失敗して `abort_within_budget()` を待つ
最大6秒のあいだ:

- `get_game_state` → `unknown game`。**取りこぼし後の再同期がエラーで返る**
- `list_games` → その ID が消える。「閉じ忘れを拾う」口から、閉じ損ねている当の対局が消える
- `abort_game` / `submit_game_move` → `unknown game`

**「閉じられなかった」と「その間ずっと存在しないことになっていた」が同時に起きる。**
`game-session.md` の ※4 には `closing` も窓も一言も無い。

### R19-M12 手数が `MAX_PLIES` に達した対局は、裁定が必ず断られて「アプリが裁定を返さなかった」に化ける

`self.moves.len()` が `MAX_PLIES` に達した瞬間、次の裁定は `MAX_PLIES + 1` になり
**必ず**断られる。フロントは一意に固定された列しか返せないので、やり直しても同じ `Err`。
30秒後に `Aborted { detail: "no ruling came back from the app" }`。

`initial_moves = 1999` で始めれば1手指した直後にこの状態に入る。
**ラウンド18の `>=` が直したのは1手目だけ**で、上限そのものに当たったときの
畳まれ方（`Aborted` ＋アプリのせいという `detail`）は変わっていない。

### R19-M13 `GameSession::close` の警告コメントが、起こり得ない経路を説明している

`deadline` は `abort_within_budget()` が**返った後**に取り直されるので、
最初の反復の `left` は必ず `CLOSE_IDLE_TIMEOUT` に等しく、0になりようがない。
「`abort` が上限を使い切ると1度も尋ねずに抜ける」は起きない。

この warn を追う人は、実際には常に「畳まれなかった」であるものを
「尋ねられなかっただけかも」と読み、`CLOSE_ABORT_TIMEOUT` 側を疑って外す。

---

## Rust

**ラウンド18で入れた走査に変異を4つ当て、3つが緑のまま通った。**

### R19-B1 `root_guard::without_comments` が文字列の中の `/*` でファイルの残り全部を捨てる

`None => break` なので、閉じない `/*` を見つけると**以降のソースを丸ごと捨てる**。

変異で確認: `commands/game.rs` の末尾に `const GLOB_HINT: &str = "パターンは /* を含められる";`
と、生パスを受けて `read_to_string` するコマンドを足すと **13件すべて緑**。
webview から任意のパスで叩ける状態で通る。`all >= 30` の下限は効かない
（現物のコマンドは50件あるので、20件消えるまで鳴らない）。

`type_graph` も同じ関数を通るので、`STRUCT_CARRIED_PATH` の載せ忘れ検査も同時に盲になる。

doc は「いまソースに `/*` を含む文字列は無い」と書いていて今日は事実だが、
**それを機械で留めているものが無い。**

### R19-H6 `signature_of` が `fn` の直後の最初の `(` を署名だと決める

変異で確認: `pub async fn probe_open<F: Fn() -> String>(_app, make: F, file_path: String)` を
足すと、`chunk.find('(')` が拾うのは `Fn()` の括弧なので `signature_of` は空文字列を返す。
`takes_a_path` は false、`parameter_types` も空集合。**13件すべて緑。**

`only_signatures_that_carry_a_path_are_checked` は `Channel<()>` を跨ぐ形は固定しているが、
**`(` が署名より前に来る形**は1件も無い。

### R19-H7 `engine_layering` の `mod` 数えが括弧を素で数え、コメント1行で段の検査が丸ごと無効になる

変異で確認: `protocol.rs` の先頭に `// 置き場の例: \`mod tests {\` のような形`と`use super::registry::EngineId;`を足すと **9件すべて緑**。
コメント行が`mod `と`{`を持つので幻の module が積まれ、閉じないので`modules`が1で固定。
以降すべての`use super::`が1段ずれて`Ordering::Less` に落ち、**辺が1本も立たない。**

対照: 同じ `use` をコメント無しで足すと2件が正しく落ちる。**コメント1行が検査を殺している。**
`the_scanner_actually_walks_the_engine` が名指しする3辺はどれも影響を受けない。

### R19-M14 `closing` に外す保証が無い

`insert` と `remove` の間で future が drop されるか panic すると、ID は集合に残り続ける。
以後の `close_game` は `the game is being closed` を返し、`close_all` も `close` を通るので
拾えない。エンジンを落とす口は終了時の `shutdown_all` だけになる。

このコードベースは待ちを `timeout` で包む習慣なので、`close_game` 側に1つ包みが増えた
時点で本番の穴になる。**いま `closing` を外す責任がどこにも型として置かれていない。**

### R19-M15 `scanning` の「`None` は故障」という契約と、`root_guard` の3箇所が割れている

`production_unwrap` は `panic!` で従っているが、`root_guard` は3箇所とも
`?` / `else { continue }` で「パスを受けていない」「関門を呼んでいない」
「その型は欄を持たない」に写す——**全部緩む向き**。

### R19-M16 「数える場所を1つにした」が現物と合わない。括弧を数える走査はまだ5つある

`scanning` を使っているのは2ファイル。独立に数えているのは
`engine_layering`（穴を実証）/ `root_guard::without_comments`（穴を実証）/
`serde_naming::enum_carries_data` / `types.rs::typescript_fields`（穴を実証）。

**「同じ穴が3つできる」を防ぐために作ったモジュールが、その3つのうち2つに繋がっていない。**

---

## 修正計画

**所見28件（重複を除くと21件）。数は 39 → 27 → 21 と減っているが、
同じ**種類**が3ラウンド続いている。**

種類は1つ。**テストの走査を手書きの字句解析でやっていて、そのたびに同じ穴が開く。**
r18 で「1つに寄せた」と書いたが、寄せたのは2つだけで、残り3つがそのまま穴を持っていた。
今回はそのうち3つで変異が通っている。

`/implement` の「対象を疑う」に照らすと、疑うべきは個々の走査ではなく
**「走査を1つに寄せる」を人の注意で担保していること**。機械で留める。

### 順

1. **字句解析を1本にし、使っていないものを全部載せる**（R19-B1 / H4 / H6 / H7 / M8 / M14…）。
   併せて**手書きの括弧数えを新しく書けなくする検査**を足す——これが無いと同じことが起きる
2. `None` を握り潰さない（R19-M15）。契約かコードのどちらかに揃える
3. **対局が壊れる**（R19-M10 / M11 / M12 / H5）
4. **doc**（R19-H1 / H2 / H3 / M1〜M7 / M9 / M13 / M16）

---

## 修正計画

（3本が揃ってから書く）

## 結果

（`/review-fix` で書き戻す）
