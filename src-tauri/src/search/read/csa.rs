//! CSA を読む。**整形してから読み直すのはこの形式だけ。**

use std::panic::{catch_unwind, AssertUnwindSafe};

use encoding_rs::{Encoding, SHIFT_JIS, UTF_8};
use shogi_kifu_converter_obsshogi::error::ParseError;
use shogi_kifu_converter_obsshogi::parser::parse_csa_str;

use crate::search::read::diagnosis::parse_failed;
use crate::search::read::encoding::read_portable_bytes;
use crate::search::read::outcome::{Jkf, KifuReadError};

/// CSA を読む。**パニックを捕まえるのはこの形式だけ。**
///
/// `shogi-kifu-converter` は CSA の本文を `csa` クレートに投げており、
/// そちらは `Cargo.lock` で 1.0.2 に固定されたまま入力由来の `unwrap` を残している。
///
/// | 入力 | どこで落ちるか |
/// | --- | --- |
/// | `$START_TIME:2004/02/30`（存在しない日付） | `csa-1.0.2/src/parser/time.rs:57` |
/// | 20桁の消費時間 `T99999999999999999999` | `csa-1.0.2/src/parser/game.rs:40` |
///
/// **他の3形式を包まないのは「安全だと分かっている」からではない。** 同じ形の
/// `unwrap` を `csa` にだけ実際に見つけた、というだけ。KIF / KI2 は `nom` を、
/// JKF は `serde_json` を通っており、どちらも
/// `shogi-kifu-converter` の `deny(clippy::unwrap_used)` の外側にある。
/// 同じ壊れ方が出たら上の表に行を足すこと。
///
/// 呼び口は `spawn_blocking` の中なのでプロセスは落ちないが、
/// 捕まえずに落ちると利用者に届くのが `spawn_blocking join error: task N panicked`
/// になり、**どこが悪いのかが消える**（ファイル名は `IndexWarnPayload` が
/// 別の欄で持つので残る）。
///
/// # 総当たりの外側で捕まえる
///
/// 候補ごとに包むと、パニックした候補だけを飛ばして次を試せる。そうしていないのは、
/// **パニックを起こす値が候補によって変わらない**から。落ちるのは `$START_TIME` の
/// 日付と `T` 行の桁数で、どちらも ASCII。
///
/// ASCII をそのまま通す候補は、クレートが試す2つ（[`CRATE_ENCODING_NAMES`]）と、
/// [`ENCODINGS_THE_CRATE_SKIPS`] のうち UTF-16 でない2つ（EUC-JP / ISO-2022-JP）、
/// [`LOSSY_DECODERS`] の2つ。**そのどれで復号しても同じ位置で落ちる**
/// （実測: ISO-2022-JP で書いた `2004/02/30` は UTF-8 / Shift_JIS /
/// EUC-JP / ISO-2022-JP のどれで復号してもパニックする）。
/// UTF-16 の2つは本文が CSA の形にならないので、パニックの手前で読めずに終わる。
pub(crate) fn parse_csa_portable(bytes: &[u8]) -> Result<Jkf, KifuReadError> {
    // `read_portable_bytes` はローカルに確保して返すだけで、パニックの向こうへ
    // 壊れた不変条件を持ち越す状態を持たない
    let attempt = AssertUnwindSafe(|| {
        read_portable_bytes(bytes, parse_csa_tidied, |s| parse_csa_str(&tidy_csa(s)))
    });
    match catch_unwind(attempt) {
        Ok(result) => result,
        // パニックの中身を捨てない。上の表は実測した2件だが、`csa` には
        // 他にも `unwrap` があり、原因を決め打ちすると**違う理由を名指しする**
        Err(payload) => {
            let what = payload
                .downcast_ref::<&'static str>()
                .copied()
                .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("理由不明");
            Err(parse_failed(format!(
                "CSA の値が規格外です。$START_TIME の日付と T 行の消費時間を\
                     確かめてください（内部の理由: {what}）"
            )))
        }
    }
}

/// CSA を、行の綴りを整えてから読む。
///
/// **画面に開くほうと読める範囲を揃えるため。** 棋譜を開く経路は `tsshogi` の
/// `importCSA` で、そちらは末尾の改行なし・空のコメント行を気にせず読み、
/// 行末の空白も**行の型によっては**気にしない。索引側だけが読めないと、
/// **開けば全部見えるのに「読めません」と言われる**ことになり、
/// 利用者に直しようが無い。どこまで揃えるかは [`tidy_csa`] の表にある。
///
/// クレートの `parse_csa_file` を通さず自分で読むのは、そちらが
/// ファイルを開いて復号まで済ませてしまい、間に整形を挟めないから。
/// バイト列で受けるのは、読み残しの検査と**同じものを見ていることを型で示す**ため。
/// 復号の順（UTF-8 → Shift_JIS）はクレートの `decode_kifu` と同じにしてある。
/// どちらでも誤りが出るなら [`ParseError::Decode`] を返し、
/// [`read_portable`] の総当たりへ渡す。
pub(crate) fn parse_csa_tidied(bytes: &[u8]) -> Result<Jkf, ParseError> {
    for enc in CRATE_CSA_DECODE_ORDER {
        let (text, _, had_errors) = enc.decode(bytes);
        if !had_errors {
            return parse_csa_str(&tidy_csa(&text));
        }
    }
    Err(ParseError::Decode)
}

/// CSA を復号する順。**クレートの `parse_csa_file` に合わせてある。**
///
/// 自分で復号する以上、順が違えば同じファイルが違う文字コードで読まれうる。
/// [`CRATE_ENCODING_NAMES`] とは並びが違うが、あちらは表示用で読ませる順ではない。
pub(crate) const CRATE_CSA_DECODE_ORDER: [&Encoding; 2] = [UTF_8, SHIFT_JIS];

/// 行の綴りを整える。**指し手や局面は足さない。**
///
/// # 揃える先は「もう一方の読み手が受ける範囲」
///
/// 棋譜を画面に開くのは `tsshogi` の `importCSA` で、そちらは行ごとに
/// 正規表現を当て、**どれにも当たらない行は読み飛ばす**。だから索引側は
/// 原理的につねに tsshogi 以下しか読めない。揃えられるのは
/// **tsshogi も受ける形に直せる行**だけで、それ以外を直すと
/// **索引だけが読めて画面では開けない**という逆向きのずれを作る。
///
/// | 行 | tsshogi の型 | 末尾の空白 | ここでの扱い |
/// | --- | --- | --- | --- |
/// | `P1`〜`P9` | `^P[1-9]( \* ?\|[-+][A-Z][A-Z]){9}$` | 最後の升のぶんだけ任意 | **最後の空升の空白だけ補う**（短い段・長い段は触らない） |
/// | `P+` / `P-` | `^P[-+]([0-9]{2}[A-Z]{2})*` | 末尾は見ない | 落とす |
/// | 指し手 / `%` / `T` / `V` / `N` / `$` / `'` | いずれも末尾を見ない、または値に含む | 受ける | 落とす |
/// | 手番行 `+` / `-` | `^[-+]$` | **受けない** | **触らない** |
/// | `PI…` | `^PI([1-9]{2}[A-Z]{2})*$` | **受けない** | **触らない** |
///
/// 下2つを触らないのは、直すと索引だけが先へ進むから。
/// tsshogi が断る形は索引でも断って、**両方で同じものが読めない**状態に保つ。
///
/// # 補うもの
///
/// 最後の行に改行が無いと、クレートは最後の指し手を取り込まない
/// （`terminated(move_record, line_sep)`）。全行に `'\n'` を付けるので、
/// 元から改行で終わるファイルでは空行が1つ増えるが、`line_sep` は `is_a` で
/// 連続を1つに畳むので読みには効かない。
///
/// # 落とすもの
///
/// アポストロフィだけの行は、クレートの `comment` が `'` の後ろに1文字以上を
/// 要求するのでそこで止まる（tsshogi も `^'(.+)$` に当たらず読み飛ばす）。
/// コメントは JKF に写らないので、落としても記録は変わらない。
///
/// `\r` を先に落とすのは、クレートの `line_sep` が受けないからではない
/// （`is_a("\r\n,")` は受ける）。**先に落とさないと末尾の空白の削りが
/// 行末に届かない**（CRLF のとき）。
///
/// **壊れた棋譜は救わない。** 指し手の形をしていない行はそのまま残るので、
/// クレートはそこで止まる。
pub(crate) fn tidy_csa(text: &str) -> String {
    /// 升は3文字（` * ` / `+OU`）× 9
    const RANK_CELLS_LEN: usize = 27;

    let mut out = String::with_capacity(text.len() + 1);
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let trimmed = line.trim_end_matches([' ', '\t']);

        if let Some(cells) = rank_cells(line) {
            out.push_str(line);
            // 最後の空升の空白だけが落ちた形を補う。エディタの trim がこれを作る。
            //
            // **補う条件は1つだけ。** 27文字に1つ足りず、末尾が空升（` *`）。
            // 27 = 3文字 × 9 升なので、この形は「9升のうち最後だけが2文字」に
            // 決まり、tsshogi の `( \* ?){9}` がちょうど受ける範囲と重なる。
            //
            // **短い段は補わない。** クレートの `grid_piece` は先頭が `+` / `-` で
            // なければ中身を見ずに3文字取る（`csa-1.0.2` の `game.rs`）ので、
            // 空白で埋めると**升が7つで切れた段が「空升9つ」に化けて通る**。
            // 補わなければクレートがそこで止まり、読めない旨が利用者に出る。
            //
            // **長い段も触らない。** 削って27文字にすると索引だけが読める。
            // tsshogi の段のパターンは `$` で閉じているので末尾に空白が1つでも
            // 余れば当たらず、その段を**黙って空段として描く**。
            // カンマで繋いだ盤面（CSA は `,` も行区切り）がここに落ちる
            if cells.len() == RANK_CELLS_LEN - 1 && cells.ends_with(" *") {
                out.push(' ');
            }
            out.push('\n');
            continue;
        }

        // tsshogi が末尾の空白を受けない行。**直さない**
        if trimmed == "+" || trimmed == "-" || trimmed.starts_with("PI") {
            out.push_str(line);
            out.push('\n');
            continue;
        }

        // 空のコメントは何も伝えない
        if trimmed == "'" {
            continue;
        }

        out.push_str(trimmed);
        out.push('\n');
    }
    out
}

/// 盤面の段（`P1`〜`P9`）なら、`P` と段番号を除いた升の部分を返す
pub(crate) fn rank_cells(line: &str) -> Option<&str> {
    let rest = line.strip_prefix('P')?;
    let rank = rest.chars().next()?;
    if !rank.is_ascii_digit() || rank == '0' {
        return None;
    }
    Some(&rest[1..])
}

/// CSA が途中で読むのをやめていたら、そのことを伝える文言を返す。
///
/// **断らない。** 読めたところまでの局面は索引に入れる価値があるので、
/// 記録は通して警告だけを出す。断ると**そのファイルの局面が1件も入らなくなり**
/// （`ParseFailed` は `build.rs` / `project_manager.rs` の両方で空の桶に落ちる）、
/// 誤検知したときに失うものが大きすぎる。数え方の判定が外れても、
/// この形なら余計な警告が1つ出るだけで済む。
///
/// **CSA には読み残しの番人が無い。** KIF / KI2 はクレートが読み残りを
/// `ParseError::Kif` / `Ki2` にし（`parser.rs` の `stopped_at`）、何も認識できなければ
/// `recognised_nothing` で断るが、**`parse_csa_str` はどちらも通らない** —
/// `csa` クレートの `parse_csa` が `game_record` の残り入力を `_` で捨てて `Ok` を返す。
///
/// [`tidy_csa`] が綴りの揺れを吸うので、ここに残るのは**整形で届かない切れ方**だけ。
/// 実測すると、CSA の形をしていない行が1本混ざるとそこで読むのをやめ、
/// **後ろの指し手が消えたまま `Ok`** になる。対局者名が無ければ
/// [`says_nothing`] も真になるが、**この文言は
/// [`KifuReadError::NothingToIndex`] の `warn` に載せて呼び手へ渡す**
/// （`read_path_inner` がこの検査を門より前に置いているのはそのため）。
///
/// **これが出たとき、画面で開けるかどうかは行の形で分かれる。**
///
/// - `ZZZZ …` のように**どの行パターンにも当たらない行**なら、`tsshogi` は
///   その行を読み飛ばす。飛ばした結果あとの手が局面に合えばそのまま開けて、
///   壊れているのは棋譜ではなく**索引側だけが読めない**状態になる。
///   ただし**飛ばした行が指し手だったなら、あとの手が合わなくなって
///   `tsshogi` も断る**（`PieceNotExistsError`）
/// - `-3334XX` のように**指し手の形で値が壊れている行**なら、`tsshogi` も
///   `Invalid piece name` で断る。[`is_csa_move_line`] は形しか見ないので
///   この行も数に入り、警告が出る。こちらは整形では消せない
///
/// 整形で指し手でない行まで捨てないのは、捨てると
/// **本当に指し手が欠けている棋譜まで黙って通る**から。
///
/// # 数え方は当てにいかない
///
/// この数え方は**クレートの文法を写していない**ので、外れることがある。
///
/// - `%MATTA` や `%CHUDAN` の後ろに指し手が続く記録では、`%` の行で数を打ち切るので
///   落ちた手を**数え落とす**（＝黙る）
/// - 終局行を持たない記録が2つ繋がっていると、2局目の指し手を**数えすぎる**
///   （＝余計な警告が出る）
///
/// どちらも索引の中身は変わらない。**外れる方向を選べないので、
/// 外れても害の無い出口（警告）にしてある。**
///
/// # バイト列で数える
///
/// 復号したあとの文字列ではなくファイルのバイト列を見るのは、**CSA の指し手行が
/// ASCII だから**。ASCII をそのまま通す候補（[`CRATE_ENCODING_NAMES`] の2つ、
/// [`ENCODINGS_THE_CRATE_SKIPS`] のうち UTF-16 でない2つ、[`LOSSY_DECODERS`] の2つ）は
/// どれも同じ数を出すので、どの候補で読めたかに関わらず結果が変わらない。
/// UTF-16 はバイト列に NUL が挟まって指し手行の形にならず0件と数える（＝黙る）。
///
/// # バイト列を受け取る
///
/// **パースしたのと同じバイト列であることを型で示すため。** `Path` を受けて
/// 自分で読み直す形だと、渡し間違いをコンパイラが止められない
/// （読み直しとパースの間に保存されると、数える側とパース側で中身が違う）。
/// [`read_path_inner`] が1度読んで、パースと検査の両方へ同じものを渡す。
///
pub(crate) fn warn_if_moves_were_dropped(bytes: &[u8], jkf: &Jkf) -> Option<String> {
    let read = jkf.moves.iter().filter(|m| m.move_.is_some()).count();
    let mut moves_seen = 0usize;
    for (line_no, line) in bytes.split(|b| *b == b'\n').enumerate() {
        // `%` の行から先は数えない。**終局とは限らない** — `%MATTA` や `%CHUDAN` の
        // 後ろにも指し手は続き、クレートはそれを読む。どこまでがこの記録かを
        // バイト列だけからは決められないので、最初の `%` で打ち切って
        // 数え落とす側（＝黙る側）に倒す。
        // クレートが `special` にしない終局理由（`%TIME_UP` など）もここで止まる
        if line.starts_with(b"%") {
            break;
        }
        if !is_csa_move_line(line) {
            continue;
        }
        moves_seen += 1;
        if moves_seen > read {
            // `enumerate` は0始まり。利用者が数えるのはファイルの行番号なので1を足す
            return Some(format!(
                "CSA を {read} 手までしか読めませんでした。\
                 ファイルの {} 行目（{moves_seen} 手目）から先の指し手は検索に出ません。\
                 その行と手前の行に、CSA の形をしていない行が\
                 混ざっていないか確かめてください",
                line_no + 1
            ));
        }
    }

    None
}

/// その行が CSA の指し手か。**`+7776FU` の形だけを数える。**
///
/// 手番だけの `+` / `-`、`P` で始まる盤面、`T` の消費時間、`%` の終局、
/// `'` のコメント、`$` や `N` のヘッダはどれも形が違うので数に入らない。
/// 終局（`%TORYO`）を数えないのは、`jkf` 側で `special` に入って
/// `move_` にならないため — 数える側と数えられる側を揃える。
pub(crate) fn is_csa_move_line(line: &[u8]) -> bool {
    // 行末の `\r` は落とす。CRLF のファイルで全行が外れる
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    line.len() >= 7
        && matches!(line[0], b'+' | b'-')
        && line[1..5].iter().all(u8::is_ascii_digit)
        && line[5..7].iter().all(u8::is_ascii_uppercase)
}
