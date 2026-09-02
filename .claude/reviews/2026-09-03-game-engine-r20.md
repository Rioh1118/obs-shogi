# 対局エンジン レビュー ラウンド20

- 日付: 2026-09-03
- 範囲: ラウンド19と同じ。**実挙動に重心を移し、走査は門番自身の穴を疑わせた**
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（#371）
- 観点: rust / robustness / comment の3本を並列

---

## doc・コメント

**所見の半分が、ラウンド19で入れた1つの変更（`MAX_PLIES` 超過で終局する）の
波及を doc に届けていないこと。** 振る舞いを変えたのに、その振る舞いを
説明している型の doc を直していない。

### R20-H1 `GameOverReason::Rule` の doc が「フロントが判定する」と断言しているのに、Rust が自分で作る

`types.rs:232-238` / `:250` / `:267` が「**将棋のルールで決まるものを Rust は判定しない**」
「フロントの呼び出しから入るのは `Rule` / `Resign` / `Aborted` の3つ」
「`Rule` のときの文言はフロントが持つ」と書いている。

`accept_continue` は `MAX_PLIES` 超過で `GameOverReason::Rule` を**英文の `detail` 付きで**
自分で作る。`continueGame` に 2001 手を渡すと、フロントは `endGameByRule` を呼んで
いないのに `over { reason: "rule" }` を受け取る。

doc を信じた受け手は `rule` を「自分が投げた終局のこだま」として扱う実装を書く
（自分の裁定要求と突き合わせて捨てる、`detail` を自分の文言で上書きする）。
`index.ts` の「#354 が入るまでルールによる終局には辿り着かない」も現時点で偽。

### R20-H2 ※3 が、もう存在しない「5つ目の検算」を数え、結末も逆に書いている

`game-session.md:149` は「検算は5つ」。`Err` を返す検算は4つで、`MAX_PLIES` 超過は
`Err` ではなく `finish(Rule)` して `Ok(())`。

「5つ」を数え直した人は、上限の枝を `Err` に戻すのが表と整合すると読む。
戻すと**ラウンド19で直したばかりの退行が戻る**。
表の E2 の G1 セルにも `→ G2` が無いので、この表を根拠にすると
「`continueGame` が解決したら必ず次の手番」という前提でフロントを書く。

### R20-H3 F-28 が「手数が `MAX_PLIES` を超えた」を断り文句として数えている

`failure-surfacing.md:100`。実際は `Ok(())` なので `log_rejection` にも入らず
**`warn` が1行も出ない**。この表は「直したのに行が古いままなら台帳として嘘をつく」を
自分の契約に掲げている。読んだ人はログを探して見つからず、原因を別の場所に探す。

### R20-H4 `takes_a_path` の doc が `signature_of` に付いたままになっている

`root_guard.rs:161-169`。先頭2行（「署名がパスらしきものを受け取っているか」）は
真偽判定の説明で、`signature_of` は丸括弧の**中身**を返す。`takes_a_path` 本体には
`///` が1行も無い。

**ラウンド19で `registry::spawn` に見つけたのと同じ形が、別ファイルに残っている。**
読んだ人は `takes_a_path` の `name.ends_with("root")` を重複だと思って消しうる。

### R20-H5 `strip_test_modules` の doc が、`scanning` へ寄せる前の性質を説明している

`production_unwrap.rs:51-53` が「波括弧を数えるだけなので、文字列リテラルの中の
括弧までは見ていない」「崩れたら別の検査が先に落ちる」と書いているが、現物は
`scanning` の字句解析を通し、釣り合わなければ `panic` する。

`scanning/mod.rs` の module doc は正反対のことを書いている。この doc を信じた人は
`production_unwrap` 側に自前の回避を足す——**`no_test_counts_delimiters_by_hand` が
塞ごうとしている当の形。**

### R20-M1 `MAX_PLIES` の doc とテストのコメントが、文の途中で切れている

`session.rs:113` と `:2270` の「——返しているのに」が結論を持たないまま次の段落へ。
同じ趣旨の文は `:866` と `:2065` では完結している。

### R20-M2 同じ判断が4箇所、`RULING_TIMEOUT` の値が散文で7箇所

上限を断らない理由: `session.rs` の定数 doc / `accept_continue` の中 /
テストのコメント / `tauri.ts`。
「30秒」: `session.rs` に4箇所、`commands/game.rs`、`failure-surfacing.md` に2箇所。

**ADR-0008 の決定3（同じ判断を2箇所に書かない）と決定4（秒数を散文に書かない）の
両方に当たる。** どれも機械が見ていない。

### R20-M3 「1体で160秒、2体で5分」が、その式を持たないテストの doc に残っている

`engine_timeouts.rs:78` は `starting_a_game_is_bounded_below_the_slowest_step` の doc だが、
和の式を持つのは `the_steps_alone_would_overrun_the_start_budget` のほう。
`READY_TIMEOUT` を60秒にすると数は偽になるが**どちらのテストも緑**。
ラウンド19の意図（数を書くのは式を持つテストの doc だけ）と置き場が逆。

### R20-M4 「中断は通した」と「中断できておらず」が別の文書で正反対

`manager.rs:70-72` は「中断は通したが」、`failure-surfacing.md:96` は
「`CLOSE_ABORT_TIMEOUT` を超えた場合は**中断できておらず**」。
`abort_within_budget` は上限超過を warn で飲んで返るので、後者が正しい。

`busy` を受けた側は「中断は通った＝時計は止まった」と読み、再試行を後回しにできると判断する。

### R20-M5 `comment_identifiers` の `EXEMPT` の doc が、干し草を広げた後も古い

「**この検査が見るのは `src-tauri/src` だけ**」と書いてあるが、干し草には
`tests/` も入っている。読んだ人は `tests/` にしかない綴りも免除が要ると判断して
`EXEMPT` に足す——足しても `the_exempt_list_is_not_dead` は落ちないので、
**効いていない免除が静かに増える。**

### R20-M6 Rust 側の `continue_game` の公開面に、上限で終局することが書かれていない

`commands/game.rs` / `session.rs` の3つの入口 doc は「次の手番を始める」のまま。
`Ok(())` の意味が「次の手番が始まった**か、終局した**」に変わったのに。
TS 側（`tauri.ts`）には書けている。

### R20-M7 `EngineRegistry` の公開面が裸で、`GameManager` と逆の判断を無記名でしている

`EngineRegistry::ids` は `starting`（`usiok` 待ち）を含めない。`GameManager::ids` は
まったく同じ「途中の集合を含めるか」を**逆に決めて理由を書いている**。
`registry.rs` 自身が「`starting` に居ないと終了時の掃除から見えない」と書いているのに。

`get` / `ids` / `new` / `EngineProcess::protocol` に `///` が1行も無い。

---

## Rust

**すべて変異で確かめた所見。**

### R20-B1 文字列リテラルの中の `validate_under_root` が「関門を呼んだ」として数えられる

`root_guard.rs` の `body.contains(GUARD)` は `blank_out_comments`（**文字列は残す**）を
通した本体に掛かるので、コード上の呼び出しと文字列の中の綴りを区別できない。
`a_comment_mentioning_the_guard_does_not_count_as_calling_it` が塞いだのはコメントだけ。

実証: `file_system/operations.rs` の `validate_under_root(&app, &path)?;` を消し、
代わりに `log::debug!("read_file: validate_under_root is handled by the caller");` を
1行置くと **15件すべて緑**。その `read_file` は webview から渡された任意のパスを
そのまま読む。「なぜ関門を掛けないか」をログに書く習慣は現にこの repo にあるので、
踏み方も現実的。

**検査の穴ではなく root ガードそのものの穴。**

### R20-H6 `strip_line_comments` が文字列の中の `//` で行を切り、後ろの `.unwrap()` が消える

`production_unwrap.rs` だけが `scanning` を持ちながら手で `//` を探している。

実証: `search.rs` に `let doc = "https://example.org/usi";` と、その後ろに `.unwrap()` を
足すと **緑**。URL・`"//"` を含む書式文字列・`format!("{a}//{b}")` はどれも本番に
書きうる形で、そこから右の `.unwrap()` が全部見えなくなる。

### R20-H7 入れ子のブロックコメントで、走査がコメントの中から走り出す

`skip_literal_or_comment` は最初の `*/` で切り上げる。Rust のブロックコメントは
**入れ子になる**ので、外側のコメントの残りがコードとして走査される。

実測: `skip_literal_or_comment("/* /* */ mod x { */")` → `Some(8)`（正しくは 19）。

実証: ブロックを丸ごとコメントアウトした中に `#[cfg(test)]` があると、
`find_in_code` が内側の `*/` の後ろから再開してそれを item の始まりとみなし、
**続く `fn outcome_of { .. }` を1つの item として落とす**。その中の `.unwrap()` は緑。
`item_end` は `Some` を返すので `panic!` にも掛からない。

同じ入れ子は `root_guard::commands` の切り出しと `engine_layering` の `mod` 数えも狂わせる。

### R20-H8 `no_test_counts_delimiters_by_hand` を素通りする書き方が3つある

**「免除を置かない」と doc に書いた門番に、実際には免除が3つ開いている。**

1. **コメントが免除になる。** 生のソースへの `contains("mod scanning;")` なので、
   `// 数えるのは \`mod scanning;\` に寄せたいが、まだ移していない` の1行で
ファイル全体が対象外になる。**`blank_out_comments` を持つファイル自身が使っていない\*\*
2. **サブディレクトリを歩かない。** `read_dir` は再帰しない。`tests/support/mod.rs` に
   置いても緑——**共有ヘルパの既定の置き場が丸ごと死角**（`scanning` 自身がそこにある）
3. **一覧が `find("//")` を落としている。** 上の R20-H6 で実際に穴が開いている当の形。
   門番が一覧方式である限り、次の形も同じように漏れる

### R20-H9 rustfmt に折られた `#[derive(...)]` の型が ADR-0007 の検査から丸ごと消える

`serde_naming.rs` は1行に `#[derive` と `Serialize` の**両方**を要求する。
rustfmt は100桁を超える derive を1トレイト1行に折るので、その型は `all_types()` に
一度も現れない。

実証: 長い derive を持つ `#[serde(tag = "type")]` の enum を足して `cargo fmt` に
折らせると **9件すべて緑**。その型は `{"type":"beta","some_field":42}` で線に出る——
`rename_all_fields` の忘れは、まさに ADR-0007 が書かれた原因。
`enum_field_renames_are_never_forgotten_when_tagged` はラチェットではなく
**0でなければ落ちる規則**として置かれているのに、折るだけで無効になる。

### R20-M8 `br"..."`（ハッシュ無しの raw バイト列）を普通の文字列として読む

`rest.starts_with('r')` を要求するので `br"` は raw 側へ行かず、`\` を
エスケープとして食って閉じ引用符を見失う。**そこから先の文字列とコードの区別が反転する。**

実測: `matching("{ let p = br\"C:\\\"; let q = \"}\"; }", '{', '}')` が
文字列の中の `}` で塊を閉じる。いま `br"` は現物に無いが、Windows パスを書いた瞬間に踏む。
`br#"..."#` は正しく扱えるので、この非対称は読んで気付けない。

### R20-M9 手数上限が指し手列の照合より前にあり、無関係な長い列で生きている対局が終局する

断らない理由としてコメントが挙げているのは「フロントが返せる列は接頭辞と長さで
**一意に固定されている**」だが、その論拠は**接頭辞の検査を通った列にしか
当てはまらない**のに、判定はその前にある。

筋道: 対局を2つ開いていて `game_id` を取り違え、対局A（2500手）の列を対局B（10手目）へ
送ると、対局Bが `Over { Rule, "the game reached the 2000 ply limit" }` になる。
**棋譜に嘘の終局理由が残り、`Err` は返らないので食い違いに気付く経路が無い。**

いまのテストは写しが3手の runner に接頭辞の合わない列を渡して「終局すること」を
期待しており、**この順序を仕様として固定してしまっている。**

### R20-M10 `closing` に残った ID を消す口が無い

`ClosingGuard::drop` は `try_lock` の best-effort で、失敗したらその ID を
`closing` から取り除く経路が**コード上どこにも無い**。`close` は入口で先に `Err` を
返すので `remove` に到達せず、`close_all` も `close` を通り、`shutdown_all` は触らない。

`ClosingGuard` の doc が「`close_game` 側に包みが1つ増えた時点で本番の穴になる」と
名指ししている `timeout` の包みは、**もう `lib.rs` にある**（`close_all` は `close` を
順に呼ぶので、締切が切れた瞬間にどれかの future が途中で落ちる）。
しかも `try_lock` の失敗は**静かに諦めている**。

---

## 失敗経路（robustness）

### R20-H10 `usiok` の予算が 0 になり、起動を諦めた理由が「エンジンが応答しない」にすり替わる

**ラウンド19で自分が入れた退行。** `for_spawn` が残りを丸ごと取るので、
残りが `SPAWN_TIMEOUT`（10秒）以下になった瞬間 `for_usiok` は**ちょうど 0** になる。

実測:

```
left=11s  for_spawn=10s          for_usiok=999.999833ms
left=10s  for_spawn=9.999999958s for_usiok=0ns
left=3s   for_spawn=2.999999958s for_usiok=0ns
near-deadline err="engine did not return usiok in time" elapsed=24ms
```

筋道: 先手が評価関数の読み込みに82秒（`START_TIMEOUT` は90秒）→ 後手の番で残り8秒 →
**後手のプロセスは実際に fork/exec され**、`get_engine_info(0)` が1回 poll しただけで
打ち切られて殺される。フロントに返るのは
`failed to start <後手>: engine did not return usiok in time`。

利用者は後手のパスと評価関数を疑う（F-27 の復帰導線がまさにそれ）が、
**後手には1ナノ秒も与えられていない。** `for_spawn` は fork/exec だけで普通は
数ミリ秒しか使わないのに残り全部を取り、いちばん時間の要る段に 0 を渡している。

### R20-H11 `startGame` が返る前に出る `over` を、フロントは自分の対局のものだと判定できない

`GameSession::start` は `GameSession` を返す**前**に `TurnChanged` を emit し
`start_search` を回す。`gameId` は `startGame` の解決でしか手に入らないので、
**解決前に届いたイベントはどの対局のものか判定できない。**

筋道: 評価関数のパスを1文字間違えたエンジン → `usiok` / `readyok` までは応じるので
起動段は通過 → 最初の `position` / `go` の書き込みが落ちて `finish(EngineFailure)` →
`Over` が emit される。素直な実装（`if (e.gameId !== myGameId) return;`）はそれを捨て、
その後 `startGame` が `Ok` で解決して盤が出る。`Phase::Over` の `on_tick` は即 return
なので**中断も時計も来ない**——F-19 が「`over` が落ちると何も起きない」と書いた画面が、
emit の失敗なしに起きる。

doc は「購読は呼ぶ前に張ること」としか書いておらず、それは必要だが**十分ではない**。

### R20-M11 上限が接頭辞の検算より先にあるので、指し手列の食い違いが「上限に当たった」として棋譜に残る

（rust 側の R20-M9 と同じ。**既存テストがこの順序を仕様として固定してしまっている**——
写しが3手の runner に、写しと1手も一致しない 2001 手を渡して「終局すること」を期待している）

筋道: `gameId` は合っているがタブ／分岐を取り違えて別の対局の列を渡す → その列が
2001手以上 → Rust は食い違いを検出せず、両者の時計を締めて `Over { rule }` を流す →
**4手で終わった対局が「最大手数で終局」として棋譜に残る。**

### R20-M12 `continue_is_refused_when_the_move_count_does_not_match_the_next_side` が、名前の分岐に一度も届いていない

`self.moves` が空の対局に4手の列を渡すので、接頭辞の検算で先に落ちる。
**変異で確認: 偶奇の `if` ブロックを丸ごと削除しても 71/71 緑。**

その `if` のコメントは「接頭辞まで見た後なので冗長。**残す。** 手番の導出が壊れたときに
ここが先に落ちる」と、この行を `derive_side_after` の番人として位置づけている。
**その番人自体に検査が1つも無く、名前でそう見えるテストは別の `if` を見ている。**

### R20-M13 実プロセス無しで踏めるのに固定されていない分岐が11ある（変異が全部生き残る）

変異を1件ずつ当てて、`cargo test --lib engine::game` を素通りしたもの:

`on_search_info` の `is_to_move` / `accept_continue` の `turn_clock = Settling` /
`hand_turn_to` の `A1` → `StopThenStart` / `ponderhit` の送信失敗の枝 /
`SearchOutcome::Move` の `is_to_move` ガード / `searches_idle` が `Stopping` を
「走っている」と数えること / `finish` の `idle_sides` への `send_gameover` /
`on_tick` の `RULING_TIMEOUT` / `hand_turn_to` の後の `is_over()` ガード /
`manager` の `closing` 事前チェック / `ClosingGuard::drop`

**表の「埋まっていないセル」は「実プロセスを要するものは1つも固定できていない」と
書いているが、この11件はどれも実プロセスを要さない。** とくに:

1. **`on_search_info` の `is_to_move`。** 表の ※8 が「**この1行がいま守っている唯一のもの**。
   冗長と読んで消すと、相手の手番中の先読みが画面に出る」と名指しした行に検査が無い。
   既存テストが見ているのは世代（`req`）だけ
2. **`accept_continue` の `turn_clock = Settling`。** `Settling` を書く**本番の唯一の口**。
   消えると `turn_clock` は前の手番の `Running(t0)` のまま残り、手番を受け取った
   エンジンが**相手の長考ぶんを丸ごと請求される**
3. **`RULING_TIMEOUT`。** ラウンド19で上限を「断らずに終局」に変えた**根拠そのもの**が
   「断ると30秒後に `Aborted` で畳まれる」なのに、その番人に検査が1つも無い

---

## 修正計画

**所見31件（重複を除くと24件）。数は 39 → 27 → 21 → 24 で下げ止まった。**

`/implement` の「3回続いたら対象を疑う」に照らして形を見る。今回の内訳:

- **自分がラウンド19で作った退行**が3件（R20-H10 / M9・M11 / R20-H1 系の doc）
- **走査の穴**が6件（R20-B1 / H6〜H9 / M8）
- **テストが無いだけ**が2件（R20-M12 / M13）
- doc の追随が残り

走査の穴が減らないのは、**穴の種類ではなく「一覧で守っている」という形**が原因。
`no_test_counts_delimiters_by_hand` を一覧から述語に変え、干し草を広げる。

**R20-M13 がこのラウンドで最も重い。** 「実プロセスが要るから固定できない」という
前置きが、実プロセスを要さない11件を「仕方ない側」に寄せて見せていた。

### 順

1. **ラウンド19の退行**（R20-H10 / M9 / M11）——直近で自分が入れたもの
2. **root ガードの穴**（R20-B1）——BLOCK
3. **走査の穴と門番の穴**（R20-H6〜H9 / M8）
4. **踏めるのに踏んでいない分岐**（R20-M13 の3本、R20-M12）
5. **doc**（R20-H1〜H5 / M1〜M7 / M14）

---

## 修正計画

（3本が揃ってから書く）

## 結果

（`/review-fix` で書き戻す）
