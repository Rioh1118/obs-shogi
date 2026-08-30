use serde::{Deserialize, Serialize};
use shogi_kifu_converter_obsshogi::{
    converter::{ToCsa, ToKi2, ToKif},
    jkf::JsonKifuFormat,
};
use std::path::Path;
use tauri::{command, AppHandle, Runtime};

use crate::file_system::utils::{atomic_write, is_kifu_file, validate_under_root};

#[derive(Serialize, Deserialize)]
pub struct WriteKifuRequest {
    pub jkf: JsonKifuFormat,
    pub file_path: String,
    pub format: String,
}

#[derive(Serialize, Deserialize)]
pub struct WriteKifuResponse {
    pub success: bool,
    pub file_path: Option<String>,
    pub normalized_jkf: Option<JsonKifuFormat>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ConvertKifuRequest {
    pub jkf: JsonKifuFormat,
    pub format: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ConvertKifuResponse {
    pub success: bool,
    pub content: Option<String>,
    pub normalized_jkf: Option<JsonKifuFormat>,
    pub error: Option<String>,
}

fn write_kifu_file_internal<P: AsRef<Path>>(
    jkf: &mut JsonKifuFormat,
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
fn convert_jkf_to_string_internal(
    jkf: &mut JsonKifuFormat,
    format: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    // ここに来る JKF はパーサではなく webview 側が組んだもの。
    // **呼び直しかどうかは確かめていない** — `JKFPlayer` が指し手を足すときに
    // json-kifu-format の正規化が走り、`same` / `promote` / `capture` / `relative` を
    // 埋めると TS 側の `applyMoveWithBranch` は書いている。
    // だとすればこの呼び出しは二重だが、外すと**書き出しがどう変わるかを
    // 測っていない**ので外さない。どちらへ揃えるかは #322。
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

// TODO(#215): この経路は FsError の外にあり、io::Error の生の英文がそのまま画面に出る。
// 整えた save_kifu_file の方は呼び出し元が1つも無い
#[command]
pub async fn write_kifu_to_file<R: Runtime>(
    app: AppHandle<R>,
    request: WriteKifuRequest,
) -> WriteKifuResponse {
    let mut jkf = request.jkf;
    let target = Path::new(&request.file_path);

    // 棋譜ファイル拡張子に限定
    if !is_kifu_file(target) {
        return WriteKifuResponse {
            success: false,
            file_path: None,
            normalized_jkf: None,
            error: Some("棋譜ファイルではありません".to_string()),
        };
    }
    // root_dir 配下にあるか
    if let Err(e) = validate_under_root(&app, target) {
        return WriteKifuResponse {
            success: false,
            file_path: None,
            normalized_jkf: None,
            error: Some(e.message),
        };
    }

    match write_kifu_file_internal(&mut jkf, &request.file_path, &request.format) {
        Ok(_) => WriteKifuResponse {
            success: true,
            file_path: Some(request.file_path),
            normalized_jkf: Some(jkf),
            error: None,
        },
        Err(error) => WriteKifuResponse {
            success: false,
            file_path: None,
            normalized_jkf: None,
            error: Some(error.to_string()),
        },
    }
}

#[command]
pub async fn convert_jkf_to_format(request: ConvertKifuRequest) -> ConvertKifuResponse {
    let mut jkf = request.jkf;

    match convert_jkf_to_string_internal(&mut jkf, &request.format) {
        Ok(content) => ConvertKifuResponse {
            success: true,
            content: Some(content),
            normalized_jkf: Some(jkf),
            error: None,
        },
        Err(error) => ConvertKifuResponse {
            success: false,
            content: None,
            normalized_jkf: None,
            error: Some(error.to_string()),
        },
    }
}

/// JKFデータのみを正規化する関数
#[command]
pub async fn normalize_jkf(mut jkf: JsonKifuFormat) -> ConvertKifuResponse {
    match jkf.normalize() {
        Ok(_) => ConvertKifuResponse {
            success: true,
            content: None,
            normalized_jkf: Some(jkf),
            error: None,
        },
        Err(error) => ConvertKifuResponse {
            success: false,
            content: None,
            normalized_jkf: None,
            error: Some(format!("正規化エラー: {error}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_dir;
    use shogi_kifu_converter_obsshogi::error::ParseError;
    use shogi_kifu_converter_obsshogi::jkf::Color;
    use shogi_kifu_converter_obsshogi::parser::{parse_ki2_str, parse_kif_str};

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
    /// | 欄 | KIF / KI2 / CSA の本文 |
    /// | --- | --- |
    /// | `same` | 変わる（`同　` が座標に戻る） |
    /// | `promote` | 変わる（`成` が消える＝**別の手になる**） |
    /// | `capture` | 変わらない（書き出しが読まない） |
    /// | `relative` | 変わらない（書き出しが局面から作り直す） |
    ///
    /// ここで見るのは `capture` を落とした場合。**本文が変わらない欄なので、
    /// 正規化の有無が出るのは `jkf` 形式だけ**（受け取った JKF をそのまま
    /// JSON にする）。`same` / `promote` を落とした場合は
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
        let mut written_jkf = stripped.clone();
        let path = dir.join("gote.jkf");
        write_kifu_file_internal(&mut written_jkf, &path, "jkf").expect("書き出し");
        let on_disk = std::fs::read_to_string(&path).expect("読み取り");
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
    /// `write_kifu_file_internal` は `normalize()` を呼ばないので、
    /// **欠けたまま届けばそのままディスクに出る**。
    ///
    /// 実際にそうなるかは webview が何を送るかで決まる。TS 側の
    /// `applyMoveWithBranch` は「正規化が `promote` を書き加える」と書いているので、
    /// 埋まった状態で届く前提。ここはその前提が崩れたときに何が起きるかを固定する。
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
        write_kifu_file_internal(&mut source.clone(), &path, "kif").expect("書き出し");
        let kept = std::fs::read_to_string(&path).expect("読み取り");
        assert!(kept.contains('成'), "元の棋譜に成が無い:\n{kept}");

        let path = dir.join("dropped.kif");
        write_kifu_file_internal(&mut stripped.clone(), &path, "kif").expect("書き出し");
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
        for (format, reparse) in [
            ("kif", parse_kif_str as Reparse),
            ("ki2", parse_ki2_str as Reparse),
        ] {
            let mut jkf = source.clone();
            let path = dir.join(format!("gote.{format}"));
            write_kifu_file_internal(&mut jkf, &path, format)
                .unwrap_or_else(|e| panic!("{format} の書き出し: {e}"));

            let written = std::fs::read_to_string(&path).expect("読み取り");
            let back = reparse(&written).unwrap_or_else(|e| panic!("{format} の読み戻し: {e}"));
            assert_eq!(initial_color(&back), Some(Color::White), "{format} の手番");
            assert_eq!(back.moves.len(), moves, "{format} の指し手が落ちた");
        }

        std::fs::remove_dir_all(&dir).ok();
    }
}
