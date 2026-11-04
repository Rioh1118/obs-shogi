//! 棋譜を綴る・正規化するコマンドの入口。

use serde::{Deserialize, Serialize};
use shogi_kifu_converter_obsshogi::jkf::JsonKifuFormat;
use std::path::Path;
use tauri::{command, AppHandle, Runtime};

use crate::kifu::convert::{convert_jkf_to_string_internal, write_kifu_file_internal};
use crate::workspace::guard::validate_under_root;
use ::fs::path::is_kifu_file;

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

// TODO(#215): この経路は FsError の外にあり、io::Error の生の英文がそのまま画面に出る。
// 整えた save_kifu_file の方は呼び出し元が1つも無い
#[command]
pub async fn write_kifu_to_file<R: Runtime>(
    app: AppHandle<R>,
    request: WriteKifuRequest,
) -> WriteKifuResponse {
    let jkf = request.jkf;
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

    match write_kifu_file_internal(&jkf, &request.file_path, &request.format) {
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
    use shogi_kifu_converter_obsshogi::jkf::PlaceFormat;
    use shogi_kifu_converter_obsshogi::parser::parse_kif_str;
    use tauri::async_runtime::block_on;
    use test_support::kifu::one_move_kif;

    fn one_move() -> JsonKifuFormat {
        parse_kif_str(&one_move_kif("平手")).expect("題材の KIF が読めること")
    }

    /// 変換は、綴った本文と正規化した JKF の両方を返す。
    #[test]
    fn conversion_returns_the_text_and_the_jkf() {
        let response = block_on(convert_jkf_to_format(ConvertKifuRequest {
            jkf: one_move(),
            format: "kif".to_string(),
        }));

        assert!(response.success, "{:?}", response.error);
        assert!(
            response.content.is_some_and(|text| text.contains("手合割")),
            "綴った本文を返していない"
        );
        assert!(response.normalized_jkf.is_some(), "JKF を返していない");
    }

    /// 正規化は、できれば JKF を返し、できなければ正規化の失敗だと名乗る。
    #[test]
    fn normalizing_returns_the_jkf_or_says_it_failed() {
        let normalized = block_on(normalize_jkf(one_move()));
        assert!(normalized.success, "{:?}", normalized.error);
        assert!(normalized.normalized_jkf.is_some(), "JKF を返していない");

        // 駒の無い升から動かす手は、局面を辿れないので正規化できない
        let mut broken = one_move();
        let mv = broken.moves[1].move_.as_mut().expect("指し手が無い");
        mv.from = Some(PlaceFormat { x: 5, y: 5 });

        let failed = block_on(normalize_jkf(broken));
        assert!(!failed.success, "正規化できない手を通した");
        assert!(
            failed
                .error
                .as_deref()
                .is_some_and(|e| e.starts_with("正規化エラー")),
            "{:?}",
            failed.error
        );
    }
}
