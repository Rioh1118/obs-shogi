use serde::{Deserialize, Serialize};
use shogi_kifu_converter_obsshogi::{
    converter::{ToCsa, ToKi2, ToKif},
    jkf::JsonKifuFormat,
};
use std::path::Path;
use tauri::{command, AppHandle, Runtime};

use crate::file_system::utils::{atomic_write, is_kifu_file, validate_under_root};
use crate::file_system::{is_initial_gote, patch_gote_start};

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
    let is_gote = is_initial_gote(jkf);
    let content = match format.to_lowercase().as_str() {
        "kif" => patch_gote_start(jkf.to_kif_owned(), is_gote),
        "ki2" => patch_gote_start(jkf.to_ki2_owned(), is_gote),
        "csa" => jkf.to_csa_owned(),
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

    let is_gote = is_initial_gote(jkf);
    let content = match format.to_lowercase().as_str() {
        "kif" => patch_gote_start(jkf.to_kif_owned(), is_gote),
        "ki2" => patch_gote_start(jkf.to_ki2_owned(), is_gote),
        "csa" => jkf.to_csa_owned(),
        "jkf" | "json" => serde_json::to_string_pretty(jkf)?,
        _ => return Err(format!("未対応の形式: {}", format).into()),
    };

    Ok(content)
}

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
