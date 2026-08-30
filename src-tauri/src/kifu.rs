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
    jkf.normalize()
        .map_err(|e| format!("正規化エラー: {:?}", e))?;

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
            error: Some(format!("正規化エラー: {:?}", error)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shogi_kifu_converter_obsshogi::error::ParseError;
    use shogi_kifu_converter_obsshogi::jkf::Color;
    use shogi_kifu_converter_obsshogi::parser::{parse_ki2_str, parse_kif_str};

    /// 後手番の任意局面。`手合割：その他` + 盤面 + 「後手番」で手番が決まる
    const GOTE_START_KIF: &str = "\
後手の持駒：なし
  ９ ８ ７ ６ ５ ４ ３ ２ １
+---------------------------+
| ・ ・ ・ ・ ・ ・ ・ ・ ・|一
| ・ ・ ・ ・ ・ ・ ・ ・ ・|二
| ・ ・ ・ ・v歩 ・ ・ ・ ・|三
| ・ ・ ・ ・v玉 ・ ・ ・ ・|四
| ・ ・ ・ ・ ・ ・ ・ ・ ・|五
| ・ ・ ・ ・ 歩 ・ ・ ・ ・|六
| ・ ・ ・ ・ ・ ・ ・ ・ ・|七
| ・ ・ ・ ・ ・ ・ ・ ・ ・|八
| ・ ・ ・ ・ 玉 ・ ・ ・ ・|九
+---------------------------+
先手の持駒：なし
後手番
手数----指手---------消費時間--
   1 ５五玉(54)   ( 0:01/00:00:01)
";

    fn initial_color(jkf: &JsonKifuFormat) -> Option<Color> {
        jkf.initial.as_ref()?.data.as_ref().map(|d| d.color)
    }

    /// 「後手番」を書くのはクレートの仕事で、こちらは足さない。
    ///
    /// 足すと2行になる。KIF は2行でも読めてしまうが、**KI2 は指し手行が
    /// 読めなくなる**ので、保存したファイルが開けなくなる。
    /// 1回であることを数えるのは、補正が戻ってきたらここで気付くため。
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
}
