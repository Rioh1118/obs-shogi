//! JKF を各形式の文字列へ綴る。**正規化するかどうかで2本ある。**

use shogi_kifu_converter_obsshogi::{
    converter::{ToCsa, ToKi2, ToKif},
    jkf::JsonKifuFormat,
};
use std::path::Path;

use ::fs::write::atomic_write;

/// JKF を指定の形式でファイルへ書き出す。
///
/// **`jkf` を書き換えない**（`&` で受けているのがその印）。
/// `normalize()` を呼ぶ `convert_jkf_to_string_internal` との違いはそこにある（#322）。
pub fn write_kifu_file_internal<P: AsRef<Path>>(
    jkf: &JsonKifuFormat,
    file_path: P,
    format: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let content = match format.to_lowercase().as_str() {
        "kif" => jkf.try_to_kif_owned()?,
        "ki2" => jkf.try_to_ki2_owned()?,
        "csa" => jkf.try_to_csa_owned()?,
        "jkf" | "json" => serde_json::to_string_pretty(jkf)?,
        _ => return Err(format!("未対応の形式: {}", format).into()),
    };

    atomic_write(file_path.as_ref(), content.as_bytes())?;
    Ok(())
}

/// JsonKifuFormatを指定された形式の文字列に変換
pub fn convert_jkf_to_string_internal(
    jkf: &mut JsonKifuFormat,
    format: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    // ここに来る JKF はパーサではなく webview 側が組んだもの。
    // **呼び直しかどうかは確かめていない。** 外すと書き出しがどう変わるかも
    // 測っていないので外さない。どちらへ揃えるかは #322。
    //
    // 呼んでも `promote` は守られない。`normalize()` は `same` を局面から
    // 復元するが、`promote` は復元せず `Some(false)` を書く（#331）。
    jkf.normalize().map_err(|e| format!("正規化エラー: {e}"))?;

    let content = match format.to_lowercase().as_str() {
        "kif" => jkf.try_to_kif_owned()?,
        "ki2" => jkf.try_to_ki2_owned()?,
        "csa" => jkf.try_to_csa_owned()?,
        "jkf" | "json" => serde_json::to_string_pretty(jkf)?,
        _ => return Err(format!("未対応の形式: {}", format).into()),
    };

    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_dir;
    use shogi_kifu_converter_obsshogi::error::ParseError;
    use shogi_kifu_converter_obsshogi::jkf::Color;
    use shogi_kifu_converter_obsshogi::parser::{
        parse_csa_str, parse_jkf_str, parse_ki2_str, parse_kif_str,
    };

    /// 後手番の任意局面。`手合割：その他` + 盤面 + 「後手番」で手番が決まる。
    ///
    /// 駒を取る手にしてあるのは、`normalize()` が `capture` を埋めるため。
    /// 埋まる欄が無いと「正規化していない JKF」を作れない
    const GOTE_START_KIF: &str = "\
後手の持駒：なし
  ９ ８ ７ ６ ５ ４ ３ ２ １
+---------------------------+
| ・ ・ ・ ・ ・ ・ ・ ・v玉|一
| ・ ・ ・ ・ ・ ・ ・ ・ ・|二
| ・ ・ ・ ・v歩 ・ ・ ・ ・|三
| ・ ・ ・ ・ 歩 ・ ・ ・ ・|四
| ・ ・ ・ ・ ・ ・ ・ ・ ・|五
| ・ ・ ・ ・ ・ ・ ・ ・ ・|六
| ・ ・ ・ ・ ・ ・ ・ ・ ・|七
| ・ ・ ・ ・ ・ ・ ・ ・ ・|八
| 玉 ・ ・ ・ ・ ・ ・ ・ ・|九
+---------------------------+
先手の持駒：なし
後手番
手数----指手---------消費時間--
   1 ５四歩(53)   ( 0:01/00:00:01)
";

    /// 成る手を含む平手の棋譜
    const PROMOTION_KIF: &str = "\
手合割：平手
手数----指手---------消費時間--
   1 ７六歩(77)   ( 0:01/00:00:01)
   2 ３四歩(33)   ( 0:01/00:00:02)
   3 ２二角成(88)   ( 0:01/00:00:03)
   4 同　銀(31)   ( 0:01/00:00:04)
";

    fn initial_color(jkf: &JsonKifuFormat) -> Option<Color> {
        jkf.initial.as_ref()?.data.as_ref().map(|d| d.color)
    }

    /// 「後手番」を書くのはクレートの仕事で、こちらは足さない。
    ///
    /// 2行になると **KI2 は指し手行が読めなくなり**、保存したファイルが開けなくなる
    /// （KIF は2行でも読めてしまうので、KIF だけでは気付けない）。
    /// 行数を数えるのは、こちら側で足す実装が入ったときにここで止めるため。
    #[test]
    fn gote_start_is_written_once_and_survives_a_round_trip() {
        let source = parse_kif_str(GOTE_START_KIF).expect("後手番の KIF が読めること");
        assert_eq!(initial_color(&source), Some(Color::White));
        let moves = source.moves.len();

        type Reparse = fn(&str) -> Result<JsonKifuFormat, ParseError>;
        for (format, reparse) in [
            ("kif", parse_kif_str as Reparse),
            ("ki2", parse_ki2_str as Reparse),
        ] {
            let mut jkf = source.clone();
            let out = convert_jkf_to_string_internal(&mut jkf, format)
                .unwrap_or_else(|e| panic!("{format} への変換: {e}"));

            assert_eq!(
                out.matches("後手番").count(),
                1,
                "{format} の「後手番」が1行でない:\n{out}"
            );

            let back = reparse(&out).unwrap_or_else(|e| panic!("{format} の読み戻し: {e}"));
            assert_eq!(initial_color(&back), Some(Color::White), "{format} の手番");
            assert_eq!(back.moves.len(), moves, "{format} の指し手が落ちた");
        }
    }

    /// ディスクへ書く経路は正規化しない。書いたものにそれが出る。
    ///
    /// `write_kifu_file_internal` は `convert_jkf_to_string_internal` と違って
    /// `normalize()` を呼ばない（#322）。
    ///
    /// **欄によって、落としたときの見え方が違う。**
    ///
    /// | 欄 | KIF | KI2 | CSA |
    /// | --- | --- | --- | --- |
    /// | `same` | 変わる（`同　` が座標に戻る） | 変わる | 変わらない（座標しか書かない） |
    /// | `promote` | 変わる（`成` が消える＝**別の手**） | 変わる | 変わる（`UM` が `KA` に） |
    /// | `capture` | 変わらない（どの形式も読まない） | 変わらない | 変わらない |
    /// | `relative` | 変わらない（書かない） | **局面を失うと変わる**（下） | 変わらない（書かない） |
    ///
    /// KI2 の `relative` は普段は局面から作り直されるが、**局面を組めない棋譜や、
    /// 不正な手より後ろでは欄をそのまま読む**（クレートの `converter/ki2.rs`。
    /// 不正な手を記録した棋譜は R-RULE-002 で正当な入力）。そこで `relative` が
    /// 欠けていると `△４二銀左` が `△４二銀` になり、**読み戻せない KI2** が書かれる（#331）。
    ///
    /// ここで見るのは `capture`。**どの形式も読まない**ので、
    /// 落としたことが出るのは `jkf` 形式だけ（受け取った JKF をそのまま JSON にする）。
    /// `promote` を落とした場合は
    /// `a_dropped_promotion_changes_the_move_that_is_written` が見る。
    #[test]
    fn the_write_path_does_not_normalize_and_the_json_shows_it() {
        let dir = temp_dir("write");

        let source = parse_kif_str(GOTE_START_KIF).expect("後手番の KIF が読めること");
        // webview が組む形に戻す。`normalize()` が局面から計算し直す欄を落とす
        let mut stripped = source.clone();
        let mut dropped = 0;
        for mf in stripped.moves.iter_mut().skip(1) {
            if let Some(mv) = &mut mf.move_ {
                dropped += usize::from(mv.capture.is_some());
                mv.same = None;
                mv.promote = None;
                mv.capture = None;
                mv.relative = None;
            }
        }
        assert!(dropped > 0, "落とす欄が1つも埋まっていない");

        // 書かない側: 落としたまま出る
        let path = dir.join("gote.jkf");
        write_kifu_file_internal(&stripped, &path, "jkf").expect("書き出し");
        let on_disk = std::fs::read_to_string(&path).expect("読み取り");
        // 「無いこと」だけを見ると、**空ファイルが一番簡単にそれを満たす**。
        // 中身があることを対で見る
        assert!(
            on_disk.contains("\"moves\""),
            "JSON に中身が無い:\n{on_disk}"
        );
        assert!(
            !on_disk.contains("capture"),
            "書き込み経路が正規化している:\n{on_disk}"
        );

        // 呼ぶ側: 埋め直される。両者が同じなら、この非対称は消えている
        let mut converted = stripped.clone();
        let via_convert = convert_jkf_to_string_internal(&mut converted, "jkf").expect("変換");
        assert!(
            via_convert.contains("capture"),
            "正規化する側が埋め直していない:\n{via_convert}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// `promote` が欠けた JKF を渡すと、**書かれる手が変わる**。
    ///
    /// KIF / KI2 / CSA の書き出しは `promote` を局面から作り直さず、
    /// JKF の欄をそのまま読む。落ちていれば `成` を書かない。
    /// **`normalize()` を呼んでも直らない。** 実測すると `normalize()` は
    /// `same` は局面から復元するが、`promote` は復元せず `Some(false)` を書く。
    /// つまり書き込み経路（呼ばない）でも変換経路（呼ぶ）でも、
    /// 欠けた成りは黙って不成として確定する（#331）。
    ///
    /// 届く JKF に `promote` が入っているかは webview 側しだいで、まだ測っていない。
    /// ここは欠けた場合に何が起きるかを固定する。
    #[test]
    fn a_dropped_promotion_changes_the_move_that_is_written() {
        let dir = temp_dir("dropped-promotion");

        let source = parse_kif_str(PROMOTION_KIF).expect("成る手のある KIF が読めること");
        let promoted = source
            .moves
            .iter()
            .filter(|mf| mf.move_.is_some_and(|mv| mv.promote == Some(true)))
            .count();
        assert!(promoted > 0, "成る手が題材に入っていない");

        let mut stripped = source.clone();
        for mf in stripped.moves.iter_mut().skip(1) {
            if let Some(mv) = &mut mf.move_ {
                mv.promote = None;
            }
        }

        let path = dir.join("kept.kif");
        write_kifu_file_internal(&source, &path, "kif").expect("書き出し");
        let kept = std::fs::read_to_string(&path).expect("読み取り");
        assert!(kept.contains('成'), "元の棋譜に成が無い:\n{kept}");

        let path = dir.join("dropped.kif");
        write_kifu_file_internal(&stripped, &path, "kif").expect("書き出し");
        let dropped = std::fs::read_to_string(&path).expect("読み取り");
        assert!(
            !dropped.contains('成'),
            "promote を落としても成が残った。書き出しが局面から作り直すようになったので、\
             このテストと doc の表を見直すこと:\n{dropped}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// ディスクへ書いたものが読み戻せる。
    ///
    /// `atomic_write` に届くバイト列を見ているのはこのテストだけ。
    #[test]
    fn what_the_write_path_puts_on_disk_can_be_read_back() {
        let dir = temp_dir("write-roundtrip");
        let source = parse_kif_str(GOTE_START_KIF).expect("後手番の KIF が読めること");
        let moves = source.moves.len();

        type Reparse = fn(&str) -> Result<JsonKifuFormat, ParseError>;
        // 4形式とも見る。1つでも抜くと、その形式の綴り手を取り違える変更が
        // 素通りする（`.csa` に KIF を書いても気付けない）
        for (format, reparse) in [
            ("kif", parse_kif_str as Reparse),
            ("ki2", parse_ki2_str as Reparse),
            ("csa", parse_csa_str as Reparse),
            ("jkf", parse_jkf_str as Reparse),
        ] {
            let path = dir.join(format!("gote.{format}"));
            write_kifu_file_internal(&source, &path, format)
                .unwrap_or_else(|e| panic!("{format} の書き出し: {e}"));

            let written = std::fs::read_to_string(&path).expect("読み取り");
            let back = reparse(&written).unwrap_or_else(|e| panic!("{format} の読み戻し: {e}"));
            assert_eq!(initial_color(&back), Some(Color::White), "{format} の手番");
            assert_eq!(back.moves.len(), moves, "{format} の指し手が落ちた");
        }

        // 知らない形式は書かずに失敗する。書いてしまうと中身の無いファイルが残る
        let path = dir.join("gote.xxx");
        write_kifu_file_internal(&source, &path, "xxx").expect_err("未対応の形式は失敗すること");
        assert!(!path.exists(), "失敗したのにファイルができている");

        std::fs::remove_dir_all(&dir).ok();
    }
}
