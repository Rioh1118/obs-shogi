# 対局エンジン レビュー ラウンド21

- 日付: 2026-09-03
- 範囲: ラウンド20と同じ
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（#371）
- 観点: rust / robustness / comment の3本を並列

---

## doc・コメント

### R21-H1 ラウンド20で足したテストが、それを「踏んだことが無い」と書いている表に届いていない

`game-session.md` の `(G1, E15)` は表のテスト列が `✗`、「埋まっていないセル」にも
「**踏んだことが無い**」と書いてある。現物の
`a_ruling_that_never_comes_back_aborts_the_game` は自分から `（表の `(G1, E15)`）` と
指しているのに、指された先が古い。

**次にこの表を根拠に「E15 を先に固定しよう」と着手した人は、既にあるテストを二重に書く。**
逆に「未検証だから壊れても落ちない」と読んで `on_tick` を触ると判断がずれる。

### R21-H2 同じく `E13`（`info`）のテスト列が `✗` のまま

`info_from_the_side_that_is_only_pondering_is_not_shown` と
`info_from_a_stopped_search_is_not_shown` の2本で `(G0, E13)` は踏めている。

しかも ※8 は「**この1行がいま守っている唯一のもの**。冗長と読んで消すと〜」と
書いていて、**消されないための歯止めがテストであることを表が隠している。**
`is_to_move` を消す変更をレビューする人が「テストが無い＝落ちない」と読む。

### R21-H3 新テストの doc が指す注（※5）が、そのテストと無関係

`session.rs` の `taking_a_ruling_stops_the_clock_until_the_search_starts` が
`（表の ※5）` と書いているが、※5 は「`G1` に入る側は `A0`」の話で
`turn_clock` にも時計にも触れていない。固定しているのは「時計」節の 3 と ※2。

**ラウンド20で追加した3本のうちの1本で、追加時点から誤っている。**

### R21-M1 ※10 の中に `△` の定義が2つあり、内容が食い違う

「`G0` 列だけ固定している」と「その行のうち人間で踏める列だけ」。
E7 / E7' / E8 / E12 は `Runner` を直に組んで踏んでいるので、後者だと嘘になる。
表の冒頭にも3つ目の定義がある。**同じ記号に3つの読み方があると、未検証のセルを数えられない。**

### R21-M2 「※6 の順序」を2箇所が指しているが、※6 に順序は書かれていない

※6 は「`gameover` を送る口は2つ」だけで、`Over` の emit と `send_gameover` の
前後関係を一言も書いていない。根拠は `session.rs` のコメントにしかない。
#377 で継ぎ目を足したときに何を表明すべきかが、表からは読めない。

### R21-M3 `ClosingGuard` の doc が、既にある `timeout` の包みを「将来の話」として書いている

「`close_game` 側に包みが1つ増えた時点で本番の穴になる」と書いてあるが、
`lib.rs` の終了フックが `close_all` を包んでいて、`close_all` は `close` を呼ぶ。
**ラウンド20のコミットメッセージ自身が「もう `lib.rs` にある」と書いたのに、doc は直っていない。**

### R21-M4 `comment_identifiers` の「`src-tauri/src` に `/*` は1つも無い」が偽

`types.rs` の `strip_ts_comment` が `trimmed.starts_with("/*")` を持つ。
「書かれ始めたらここを直す」という条件を確かめた人は当たりを引くのに、実装は直っていない。
**免除の根拠が偽なので、この検査がどれだけ緩いかの見積もりが狂う。**

### R21-M5 `counting_by_hand` の doc が「述語」と言うが、メソッド名は依然として一覧

doc は4つ、コードは5つ（`rfind` が doc に無い）。より重いのは、
**`contains('{')` / `trim_matches('"')` / `position(|c| c == '{')` で書けば素通りする**こと。
module doc は「**形は一覧でなく述語で見る。** 一覧は必ず漏れる」と断言しているので、
次に走査を書く人は「どう書いても止められる」と読む。
**「免除を置かない」を掲げている検査なので、この過信の代償が直接そこに出る。**

### R21-M6 `root_guard::commands` の doc に、要約行が2つ並んでいる

**ラウンド20が「3ラウンド連続で出ている」と名指しした「挿入で既存の doc を
引き剥がす」形が、その R20 のコミット自身で1件増えている。**
`cargo doc` では「rustfmt が〜終端に使う 属性から〜切り出す」という文になる。

### R21-M7 同じ数と同じ列挙が doc とコードの両方にある

「規則の式は3箇所」が `clock.rs` と `game-session.md` に、
「`running` が `null` になるのは4つ」が Rust の doc・表・TS の写しの3箇所に、
本文ごと重複している。**ADR-0008 決定3 が名指ししている形そのもの。**

### R21-M8 コメントに変更の経緯が残っている（4箇所）

`engine_layering.rs` の「段を全順序にしていたころは」は**存在しない過去の設計**を
説明しているので、読んだ人は `LAYERS` に順序があると思って探す。
`production_unwrap.rs` の2件と `scanning/mod.rs` の1件も過去形。
`commentHistory` は「していたころは」「そうなっていた」「漏れていた」を持っていない。

### R21-M9 `impl GameEvent` が `GameEvent` の宣言より70行手前にある

`GamePhaseView` の閉じ括弧の直後に空行も無く続くので、`GamePhaseView` の `impl` に見える。
`kind` / `is_frequent` / `is_terminal` は「バリアントを足したら数え直させる」ことが
目的なのに、**足す人が触る宣言と、数え直させたい `match` が同じ画面に無い。**

### R21-M10 `stop_then_start` の doc が、到達しない腕の振る舞いを契約として書いている

「`Unresponsive` — 何もできない。呼び出し側が終局させること」と書いてあるが、
`hand_turn_to` は `Unusable` へ振り分けて `stop_then_start` を呼ばないので**この腕には来ない**。
契約の向きが逆。`Unusable` を消して倒す変更をした人は「終局は呼び出し側の責務」と読み、
`log::error!` だけ残して終局を書かない——**対局は無音で止まり、`Settling` にもならないので
`SETTLE_TIMEOUT` も掛からない。**

---

## Rust

### R21-B1 ラウンド20の BLOCK 修正が `EXTRA_GUARDS` に入っておらず、文字列の綴りが「関門を呼んだ」と数えられたまま

主検査だけが文字列を潰した写しを見て、`EXTRA_GUARDS` は文字列を残した写しを見ていた。

実証: `delete_directory` から `is_project_root`——**ワークスペースそのものを
消させない唯一の関門**——を消して `log::debug!("... is_project_root is checked by the
caller")` を1行置くと **16件すべて緑**。`fs::remove_dir_all` で取り消し不能に消す口。

### R21-B2 `blank_out` がバイト長を保たず、2つの写しに打った添字がずれる

多バイト文字を1バイトの空白に潰すので、**日本語の文字列リテラルが1本あるだけで**
`code_only[start..end]` が別の関数を指す。

実証: 日本語の文字列を1本足して `save_kifu_file` から関門を消すと、
**関門を消したものが名指しされず、正しく持つ4つが濡れ衣を着た。**
`&code_only[start..]` は `start > len` で panic もする。

### R21-H3 ラウンド20の修正は1語で戻せて、それを落とすテストが無い

テストは `commands()` が写しを**作れている**ことしか見ておらず、
**使っているか**を見ていない。`code.contains(GUARD)` を `body.contains(GUARD)` に
戻す変異で **16件すべて緑**。

### R21-H4 `counting_by_hand` は「述語」ではなくメソッド名の一覧

実測で **20通り中17通りが素通り**。`contains` / `position` / `as_bytes()[i]` は
もちろん、**一覧に載っているメソッドでも rustfmt が引数を折れば**通った。

### R21-H5 「免除を置かない」が成り立っていない

判定がコメントだけ潰した写しに掛かっていたので、`let _ = "mod scanning;";` の1行で
免除を取れる。**`scanning/mod.rs` 自身が5件の違反を抱えたまま自己免除していた。**

### R21-M14 `signature_of` のジェネリクス飛ばしが `->` の `>` で切れる

`matching` が `<` / `>` を素で数えるので、`fn f<F: FnMut() -> (String, u32)>(dir_path: String)`
だと署名が `String, u32` になり、生パスを受けるコマンドが走査から消える。

### R21-M15 `GameManager` の閉じる経路にテストが1本も無い

`close` / `take_and_close` / `close_all` / `ClosingGuard` は一度も通らない。
変異3つ（`close_all` の戻りを空に、台帳へ戻すのをやめる、`closing.insert` を消す）
すべて生き残った。

### R21-M16 `EngineRegistry::spawn` の関門を見ているものが無い

`is_file` を丸ごと消しても落ちない。**`start_game` を root の関門から免除する理由が、
この関門の存在に依っている**のに、誰も突き合わせていない。

### R21-M17 ラウンド20の `production_unwrap` / `serde_naming` の修正が、戻しても落ちない

現物にその形（`//` を含む文字列の右の `.unwrap()`、折られた `#[derive`）が
今は無いので、現物を食わせるテストでは差が出ない。
**「直した」が、次に同じ形を書いた人には何も返さない状態。**

---

## 失敗経路（robustness）

**baseline 差分で変異を当てた所見。**

### R21-H6〜H12 実プロセス無しで踏める枝が8つ、変異で生き残った

`SearchOutcome::Move` の `is_to_move` / `searches_idle` の `Stopping` /
`timeout_enforced` の**既定（偽）側**（2箇所）/ `Handover::Unusable` の `finish` /
`accept_continue` の `is_over()` ガード / `stop_then_start` と `finish` の
`cancel` と `restart` / `ponderhit` の当たり外れ。

**表の「実機が要る」という前置きが誤り。** `Handover::PonderHit` の送信は
`protocol(side)` が `None` のとき `Ok(())` に落ちるので、`engine: None` の
`Runner` でも成功側が走る。

`the_longest_startable_game_can_still_take_a_move` も名前どおりのものを見ておらず、
`>` を `>=` に変えても通った。

### R21-M11 / M12 / M18 `manager` の `closing`、`finish` の再入、E1/E4 の `is_engine`

どれも実プロセス不要なのに未検証。

### R21-M19 並行レビューで、他エージェントの当てっぱなしの変異が結果を汚染した

`stalled_turn` の2引数が入れ替わった状態が working tree に残っていて、
最初の測定は **20件中20件が「killed」という偽の結果**になった。
baseline 差分で取り直している。**他の報告書の「killed」判定も、
baseline を引いているかを確認してから読むこと。**

---

## 結果

31件（重複を除くと26件）すべてを処理した。

### 走査と関門

| 所見        | どう直したか                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| R21-B1 / H3 | タプルをやめて `Command { name, body, code }`。**`calls()` だけを公開**——`body` を関門判定に使う書き方が書けない |
| R21-B2      | `blank_out` が `" ".repeat(ch.len_utf8())` でバイト長を保つ                                                      |
| R21-H4      | メソッド名の一覧をやめ、`(` / `,` の直後の引数の形で見る。文字リテラルとの `==` も                               |
| R21-H5      | 免除の判定を文字列も潰した側で。`tests/scanning/` はパスで明示的に除く                                           |
| R21-M14     | `matching_angle` を置き、`->` と `=>` を1つの記号として読み飛ばす                                                |

### 踏めるのに踏んでいなかった枝

R21-H6〜H12 の8つ、R21-M11 / M12 / M18 の4つを埋めた。
**隣り合う2つの真偽は `IsEngine` / `HasSpoken` の型で分けた**——
裸の `bool` だと入れ替えてもコンパイルが通り、実際このラウンド中にそれが起きた。

### doc

R21-H1〜H3 / M1〜M10 を現物と突き合わせた。
**「挿入で doc を引き剥がす」は4回目なのでラチェットにした**
（`no_doc_block_repeats_a_line`。拾えるのは同じ要約を書き足した形だけ、と限界も書いた）。
`CLAUDE.md` の「Rust 側は `#[test]` が数個しかない」も現物と合っていなかった。

### テストが無かったもの

R21-M15（`GameManager` の閉じる経路）、M16（`EngineRegistry::spawn` の関門——
**`start_game` を免除する理由がこの関門なのに誰も突き合わせていなかった**）、
M17（ラウンド20の走査の直しが戻しても落ちない）を埋めた。

M17 は形として重い。**現物だけを食わせていると、いまその形が無いだけの穴を
「直した」と読んでしまう。** 合成を純関数に切り出して直に食わせる。

### 変異で確かめたもの

reviewer の変異（`EXTRA_GUARDS` / バイト長 / 判定の口 / 門番の抜け道4つ /
実装の枝14個）と、走査の直しを戻す変異3つ、関門を消す変異、台帳の変異2つ、
すべてで対応するテストが落ちることを確認した。

### 検証

`npm run verify`（660 tests）/ `npm run verify:rust` ともに green。
