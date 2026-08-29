# to_book_key の失敗経路

`src-tauri/src/book/sfen.rs` の `to_book_key` は、コマンド境界（`lookup_book_moves`）と
定跡ファイル（#91 の reader → `to_book_key_in_file`）の両方から呼ばれる、book の唯一の入口。

純関数だが表を作る。**同じ場所で「テストが通っていると思っていた枝を1つも通っていない」が
R9 から R12 まで毎ラウンド出た**（N-07 / O-04 / P-01 / Q-02）。原因は枝そのものではなく、
**先に置いた検査が後ろの枝を覆い隠していること**で、それは1件ずつ潰す形では見えない。

## 検査（状態）

上から順に評価される。最初に当たったものが結果になる。

| 記号 | 判定条件（式） | 返るもの |
| ---- | -------------- | -------- |
| G0 | `input.chars().count() > MAX_INPUT_CHARS`（256） | `InvalidSfen`「局面として長すぎる」 |
| G1 | `startpos` の次のトークンが存在する | `InvalidSfen`（`moves` / 余分なトークン） |
| G2 | board トークンが無い | `InvalidSfen`「局面が空」 |
| G3 | side トークンが無い | `InvalidSfen`「手番が無い」 |
| G4 | hands トークンが無い | `InvalidSfen`「持駒が無い」 |
| G5 | `side != "b" && side != "w"` | `InvalidSfen`「手番が b でも w でもない」 |
| G6 | 手数の位置が `"moves"` | `InvalidSfen`（指し手列） |
| G7 | `ply.parse::<u32>().is_err()` | `InvalidSfen`「手数が数値でない: {ply}」 |
| G8 | 手数の後ろにトークンが残る | `InvalidSfen`（`moves` / 余分なトークン） |
| G9 | `normalize_board` が `Err` | `InvalidSfen`（段数 / 列数 / 駒でない文字 / `+` の後ろ / 成れない駒） |
| G10 | `normalize_hands` が `Err` | `InvalidSfen`（枚数が範囲外 / 駒が続かない / 持駒にできない文字） |
| G11 | `PieceCounts::validate` が `Err` | `InvalidSfen`（枚数超過 / 同じ側に玉2枚） |
| OK | 上のどれにも当たらない | `Ok(BookKey)` |

## 入力の形（イベント）

| 記号 | 入力の形 |
| ---- | -------- |
| A | 正しい局面（`sfen` / `position sfen` / 前置き無し / `startpos`） |
| B | トークンが足りない |
| C | トークンの**値**が不正（手番 / 盤面 / 持駒の綴り） |
| D | トークンが**余る**（`moves` / 余分なトークン） |
| E | 駒数が駒箱を超える |
| F | **1トークンが長い**（断片が理由文に埋まる形） |
| G | **入力全体が長い**（256 字超） |

## 表

セルは「到達する検査」。`✓` はそのセルを踏むテストが存在する。

| 入力の形 | 全体 ≤ 256 字 | 全体 > 256 字 |
| -------- | ------------- | ------------- |
| A 正しい局面 | OK ✓（`drops_the_move_number` ほか） | **到達不能**（合法な局面は 256 字を超えない。下の不変条件 1） |
| B トークン不足 | G2 / G3 / G4 ✓（`rejects_input_that_is_not_a_position`。理由文まで見て3枝を区別する） | G0（B の理由文は出ない） |
| C 値が不正 | G5 ✓ / G9 ✓（`rejects_a_broken_board`）/ G10 ✓（`rejects_a_broken_hand_field`） | G0 |
| D トークンが余る | G1 ✓ / G6 ✓（`rejects_a_position_with_moves`）/ G8 ✓（`rejects_trailing_tokens_after_the_position`） | G0 |
| E 駒数超過 | G11 ✓（`rejects_more_pieces_than_the_set_holds`） | G0 |
| F 1トークンが長い | G7 / G8 / G10（枚数が範囲外 / 駒が続かない の2枝）に断片が入る ✓（`a_long_token_is_truncated_in_the_reason`） | G0 ✓ |
| G 全体が長い | — | G0 ✓（`a_position_that_is_too_long_is_rejected_before_building_the_reason`） |

### 埋まっていたセル（この表を作って見つけたもの）

**(F, ≤256) が空だった。** 理由文に入力の断片（`{extra}` / `{ply}` / `{digits}`）を埋める枝は
G7 / G8 と G10 の2枝（枚数が範囲外 / 駒が続かない）で計4つあるが、そこを通るテストが1本も無かった。

R11 で足した `a_long_input_is_truncated_in_the_message` は 100,000 字の入力を5通り並べていたが、
**5件とも G0 に落ちる**ので、断片を埋める枝には一度も入っていなかった。
表にすると、5件が全て右列の同じセルに重なっていることが一目で分かる。
1件ずつ潰す形では3ラウンド見えなかった。

埋めた: `a_long_token_is_truncated_in_the_reason`。全体を 256 字以下に保ったまま、
1トークンだけを 150 字にして G7 / G8 / G10 を通す。

## 不変条件

どのセルでも破ってはいけないもの。セルごとの期待挙動より寿命が長い。

1. **合法な局面は必ず OK に着く。** 盤面は成駒（`+X` = 2字）と畳んでいない空きマス（`1` の並び）で
   最長 123 字。金は成れないので持駒へ移しても盤面は縮まず、持駒の字数が上乗せされる。
   `position sfen ` の前置きと10桁の手数まで足した最長は
   `a_maximally_spelled_board_is_accepted` が実測している。
   `MAX_INPUT_CHARS` はこれを下回ってはならない
2. **失敗の `message` は、入力の長さに比例して伸びない。** `logged` 経由でログ（200KB / KeepOne）へ
   流れるので、失敗1件で以前の記録が消えてはならない
3. **成功と「未収録」を取り違えさせない。** 壊れた入力が `Ok` になると、`lookup` の
   「未収録は空の `Vec`」と区別が付かなくなる（R1 F-04 の根）

## 照合

- 不変条件 1: `a_maximally_spelled_board_is_accepted` ✓。盤面123字（成れる駒を `+X`、
  空きマスを `1` の並びで書く）に、成れない金4枚を持駒へ、手数を10桁にした形を通す。
  **変異で確認: `MAX_INPUT_CHARS` を 160 に詰めると落ちる**
- 不変条件 2: `a_long_token_is_truncated_in_the_reason` ✓。
  長さだけを見ると理由文と引用のどちらか一方を打ち切っただけでも通るので、
  打ち切りの跡（`…`）の数で両方に効いていることを見る。
  **変異で確認: 理由文側の打ち切りを外すと落ちる**
- 不変条件 3: G9 / G10 / G11 のテストが担っている ✓
