use crate::file_system::{
    error::{FsError, FsErrorCode},
    utils::{
        atomic_write, ensure_not_exists, is_project_root, validate_basename, validate_under_root,
    },
};
use std::io::Write;

use super::utils::{get_file_extension, is_kifu_file};
use shogi_kifu_converter_obsshogi::{
    converter::{ToCsa, ToKi2, ToKif},
    error::ConvertError,
    jkf::JsonKifuFormat,
};
use std::{fs::OpenOptions, path::PathBuf};
use tauri::{command, AppHandle, Runtime};

use encoding_rs::SHIFT_JIS;
use std::{fs, path::Path};

fn write_new_file(path: &Path, content: &str) -> Result<(), FsError> {
    ensure_not_exists(path)?;

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(FsError::from)?;

    file.write_all(content.as_bytes()).map_err(FsError::from)
}

fn read_text_portable(path: &Path) -> Result<String, FsError> {
    let bytes = fs::read(path).map_err(FsError::from)?;
    let bytes = strip_utf8_bom(&bytes);

    // 1) UTF-8
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok(s.to_string());
    }

    // 2) Shift_JIS
    {
        let (cow, _, _had_errors) = SHIFT_JIS.decode(bytes);
        Ok(cow.into_owned())
    }
}

fn strip_utf8_bom(bytes: &[u8]) -> &[u8] {
    const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
    if bytes.starts_with(&BOM) {
        &bytes[3..]
    } else {
        bytes
    }
}

#[command]
pub fn read_file<R: Runtime>(app: AppHandle<R>, file_path: String) -> Result<String, FsError> {
    let path = PathBuf::from(&file_path);
    validate_under_root(&app, &path)?;

    if !path.exists() {
        return Err(FsError::new(FsErrorCode::NotFound, "file does not exist").with_path(file_path));
    }

    if !path.is_file() {
        return Err(FsError::new(FsErrorCode::InvalidType, "path is not a file")
            .with_path(path.to_string_lossy().to_string()));
    }

    // 棋譜ファイルのみ読み込み許可
    if !is_kifu_file(&path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file")
                .with_path(path.to_string_lossy().to_string()),
        );
    }

    read_text_portable(&path)
}

/// JKF を、拡張子が指す形式の文字列に綴る。
///
/// **`kifu.rs` の `convert_jkf_to_format` とは別物。** あちらは Tauri コマンドで、
/// 形式名を文字列で受け取り `normalize()` を呼ぶ。同じ名前にしていると、
/// #322（どの経路が正規化するか）のコメントがどちらを指すか決められない。
fn spell_for_extension(jkf_data: &JsonKifuFormat, file_path: &Path) -> Result<String, FsError> {
    // `ConvertError` の Display は綴れなかったものを名指しする（書き分けられない手、
    // 綴りの無い枚数、盤面の無い手合割）。何手目かは言わない — ply を持つのは
    // `Normalize` だけで、KIF / KI2 / CSA の書き出しはそれを作らない。
    // ここで文言を潰すと、利用者に出るのは「変換に失敗」だけになる
    let to_fs_error = |r: Result<String, ConvertError>| {
        r.map_err(|e| FsError::new(FsErrorCode::KifuConversionFailed, e.to_string()))
    };

    let text = match get_file_extension(file_path).as_deref() {
        Some("kif") => to_fs_error(jkf_data.try_to_kif_owned()),
        Some("ki2") => to_fs_error(jkf_data.try_to_ki2_owned()),
        Some("csa") => to_fs_error(jkf_data.try_to_csa_owned()),
        Some("jkf") => serde_json::to_string_pretty(jkf_data)
            .map_err(|e| FsError::new(FsErrorCode::KifuConversionFailed, e.to_string())),
        _ => Err(
            FsError::new(FsErrorCode::InvalidExtension, "unsupported kifu format")
                .with_path(file_path.to_string_lossy().to_string()),
        ),
    }?;

    // **0バイトのファイルを置かせない。**
    // `try_to_ki2_owned` は「平手・ヘッダ空・0手」の JKF を空文字列に綴る。
    // 新規作成フォームはファイル名以外すべて任意なので、`.ki2` を選ぶと
    // 既定の操作でこれに当たる。書いてしまうと `Ok` が返って作成は成功に見えるが、
    // 次に開くと「空の棋譜です。」で行き止まりになり、
    // アプリの中で中身を入れる手段が無い（削除して作り直すしかない）。
    // 索引側は中身の無い記録を黙って通すので、警告もどこにも出ない
    if text.is_empty() {
        return Err(FsError::new(
            FsErrorCode::KifuConversionFailed,
            "この形式では書き出す中身がありません。対局者名か手合割を入れてください",
        )
        .with_path(file_path.to_string_lossy().to_string()));
    }

    Ok(text)
}

#[command]
pub fn create_kifu_file<R: Runtime>(
    app: AppHandle<R>,
    parent_dir: String,
    file_name: String,
    mut jkf_data: JsonKifuFormat,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);
    validate_under_root(&app, &parent_path)?;

    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "parent directory does not exist")
                .with_path(parent_dir),
        );
    }

    let file_name = validate_basename(&file_name)?;

    let file_path = parent_path.join(&file_name);

    if !is_kifu_file(&file_path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file extension")
                .with_path(file_path.to_string_lossy().to_string()),
        );
    }

    validate_under_root(&app, &file_path)?;

    // ここに来る JKF は webview 側が組んだもので、パーサ由来ではない。
    // `parse_*` の戻り値なら正規化済みだが、この経路はそうではないので呼ぶ。
    // なお `import_kifu_file` と `write_kifu_to_file` は呼ばない（#322）
    jkf_data.normalize().map_err(|e| {
        FsError::new(
            FsErrorCode::KifuConversionFailed,
            format!("normalize failed: {e}"),
        )
    })?;

    let content = spell_for_extension(&jkf_data, &file_path)?;

    write_new_file(&file_path, &content)?;

    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub fn import_kifu_file<R: Runtime>(
    app: AppHandle<R>,
    parent_dir: String,
    file_name: String,
    jkf_data: JsonKifuFormat,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);
    validate_under_root(&app, &parent_path)?;

    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "parent directory does not exist")
                .with_path(parent_dir),
        );
    }

    let file_name = validate_basename(&file_name)?;

    let file_path = parent_path.join(&file_name);

    if !is_kifu_file(&file_path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file extension")
                .with_path(file_path.to_string_lossy().to_string()),
        );
    }

    validate_under_root(&app, &file_path)?;

    let content = spell_for_extension(&jkf_data, &file_path)?;

    write_new_file(&file_path, &content)?;

    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub fn save_kifu_file<R: Runtime>(
    app: AppHandle<R>,
    parent_dir: String,
    file_name: String,
    content: String,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);
    validate_under_root(&app, &parent_path)?;

    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "parent directory does not exist")
                .with_path(parent_dir),
        );
    }

    // パスは検証を通した名前から組む。生の名前で先に組むと、検証した文字列と
    // 実際に書き込む先が別のものになる
    let file_name = validate_basename(&file_name)?;
    let file_path = parent_path.join(&file_name);

    if !is_kifu_file(&file_path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file extension")
                .with_path(file_path.to_string_lossy().to_string()),
        );
    }

    validate_under_root(&app, &file_path)?;

    // ファイル保存（atomic write でクラッシュ時の半端な状態を避ける）
    atomic_write(&file_path, content.as_bytes()).map_err(FsError::from)?;

    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub fn create_directory<R: Runtime>(
    app: AppHandle<R>,
    parent_dir: String,
    dir_name: String,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);
    validate_under_root(&app, &parent_path)?;

    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "parent directory does not exist")
                .with_path(parent_dir),
        );
    }

    let dir_name = validate_basename(&dir_name)?;

    let new_dir_path = parent_path.join(&dir_name);
    validate_under_root(&app, &new_dir_path)?;
    ensure_not_exists(&new_dir_path)?;

    fs::create_dir(&new_dir_path).map_err(FsError::from)?;

    Ok(new_dir_path.to_string_lossy().to_string())
}

#[command]
pub fn delete_file<R: Runtime>(app: AppHandle<R>, file_path: String) -> Result<(), FsError> {
    let path = PathBuf::from(&file_path);
    validate_under_root(&app, &path)?;

    if !path.exists() {
        return Err(FsError::new(FsErrorCode::NotFound, "file does not exist").with_path(file_path));
    }

    if !path.is_file() {
        return Err(FsError::new(FsErrorCode::InvalidType, "path is not a file")
            .with_path(path.to_string_lossy().to_string()));
    }

    // 棋譜ファイルのみ削除許可
    if !is_kifu_file(&path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file")
                .with_path(path.to_string_lossy().to_string()),
        );
    }

    fs::remove_file(path).map_err(FsError::from)
}

#[command]
pub fn delete_directory<R: Runtime>(app: AppHandle<R>, dir_path: String) -> Result<(), FsError> {
    let path = PathBuf::from(&dir_path);
    validate_under_root(&app, &path)?;

    // ワークスペースそのものは消させない。`remove_dir_all` は中身ごと消し、
    // 取り消す手段が無い。UI 側にも判定はあるが、**取り消せない操作を UI の判定だけに
    // 預けない**。webview から直に invoke されても、UI の判定を消す変更が入っても
    // 壊れない層に置く
    if is_project_root(&app, &path)? {
        return Err(FsError::new(
            FsErrorCode::RootNotDeletable,
            "cannot delete the project root",
        )
        .with_path(dir_path));
    }

    if !path.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "directory does not exist").with_path(dir_path),
        );
    }

    if !path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidType, "path is not a directory")
                .with_path(path.to_string_lossy().to_string()),
        );
    }

    fs::remove_dir_all(path).map_err(FsError::from)
}

/// [`spell_for_extension`] をテストから呼ぶための口。
///
/// **綴った結果を読み手（`search::kifu_reader`）に通すテストが要る。**
/// 書き手と読み手を別々に見ていると、このアプリが作ったファイルを
/// このアプリが読めない、という組み合わせを誰も見ない。
#[cfg(test)]
pub fn spell_for_extension_for_test(
    jkf_data: &JsonKifuFormat,
    file_path: &Path,
) -> Result<String, FsError> {
    spell_for_extension(jkf_data, file_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::test_kifu::one_move_kif;
    use shogi_kifu_converter_obsshogi::{
        jkf::{Initial, Preset},
        parser::{parse_csa_str, parse_jkf_str, parse_ki2_str, parse_kif_str},
    };

    /// 拡張子が指す形式で書く。
    ///
    /// `create_kifu_file` / `import_kifu_file` は webview から直に呼べる口で、
    /// ここが唯一の「どの形式で綴るか」の判断。**取り違えると `a.kif` に
    /// CSA が入る** — 索引は KIF として読んで失敗し、画面でも開けない。
    /// 型検査は落ちない（どの綴り手も `Result<String, ConvertError>` を返す）。
    #[test]
    fn the_extension_decides_which_format_is_written() {
        type Reparse =
            fn(&str) -> Result<JsonKifuFormat, shogi_kifu_converter_obsshogi::error::ParseError>;
        let source = parse_kif_str(&one_move_kif("平手")).expect("題材の KIF が読めること");

        for (format, reparse) in [
            ("kif", parse_kif_str as Reparse),
            ("ki2", parse_ki2_str as Reparse),
            ("csa", parse_csa_str as Reparse),
            ("jkf", parse_jkf_str as Reparse),
        ] {
            let written = spell_for_extension(&source, Path::new(&format!("a.{format}")))
                .unwrap_or_else(|e| panic!("{format} に綴れない: {}", e.message));

            // 他の形式のパーサでも読めてしまう綴りがあるので、
            // 「その形式で読める」だけでは取り違えを捕まえられない。
            // 書いたものが元の指し手を保つことまで見る
            let back = reparse(&written)
                .unwrap_or_else(|e| panic!("{format} として読み戻せない: {e}\n{written}"));
            assert_eq!(back.moves.len(), source.moves.len(), "{format} の指し手");
        }

        let err = spell_for_extension(&source, Path::new("a.xxx"))
            .expect_err("知らない拡張子は失敗すること");
        assert!(
            matches!(err.code, FsErrorCode::InvalidExtension),
            "{:?}",
            err.code
        );
    }

    /// 0バイトのファイルを作らない。
    ///
    /// `try_to_ki2_owned` は「平手・ヘッダ空・0手」の JKF を空文字列に綴る。
    /// 新規作成フォームはファイル名以外すべて任意なので、`.ki2` を選ぶと
    /// **既定の操作でこれに当たる**（他の3形式は骨組みを書くので当たらない）。
    ///
    /// 書いてしまうと `Ok` が返って作成は成功に見えるのに、次に開くと
    /// 「空の棋譜です。」で行き止まりになる。そのダイアログは再読み込みも出さないので、
    /// **アプリの中で中身を入れる手段が無い**（削除して作り直すしかない）。
    /// 索引側は中身の無い記録を黙って通すので、警告もどこにも出ない。
    #[test]
    fn an_empty_spelling_is_refused_instead_of_written() {
        let blank = JsonKifuFormat {
            initial: Some(Initial {
                preset: Preset::PresetHirate,
                data: None,
            }),
            moves: vec![shogi_kifu_converter_obsshogi::jkf::MoveFormat::default()],
            ..JsonKifuFormat::default()
        };

        let err = spell_for_extension(&blank, Path::new("新規.ki2"))
            .expect_err("空に綴れる形式は断ること");
        assert!(
            matches!(err.code, FsErrorCode::KifuConversionFailed),
            "{:?}",
            err.code
        );

        // 他の3形式は骨組みを書くので通る。**通る側も0バイトでないことを見る**
        for ext in ["kif", "csa", "jkf"] {
            let text = spell_for_extension(&blank, Path::new(&format!("新規.{ext}")))
                .unwrap_or_else(|e| panic!("{ext} を綴れない: {}", e.message));
            assert!(!text.is_empty(), "{ext} が空になっている");
        }

        // 対局者名が1つでもあれば `.ki2` も中身を持つ
        let mut named = blank;
        named.header.insert("先手".to_owned(), "山田".to_owned());
        let text = spell_for_extension(&named, Path::new("新規.ki2")).expect("綴れること");
        assert!(!text.is_empty());
    }

    /// 綴れなかったときに、クレートが名指ししたものを消さない。
    ///
    /// `ConvertError` は書き分けられない手・綴りの無い枚数・盤面の無い手合割を
    /// 名指しする。固定の文言に潰すと、利用者に出るのは「変換に失敗」だけになり、
    /// **どの棋譜のどこが悪いのかを知る手段が無くなる**。
    #[test]
    fn what_could_not_be_written_is_named_in_the_message() {
        let mut jkf = parse_kif_str(&one_move_kif("平手")).expect("題材の KIF が読めること");
        // 盤面を伴わない `PresetOther` は、どの形式でも綴れない
        jkf.initial = Some(Initial {
            preset: Preset::PresetOther,
            data: None,
        });

        let err = spell_for_extension(&jkf, Path::new("a.kif"))
            .expect_err("盤面の無い手合割は綴れないこと");
        assert!(
            matches!(err.code, FsErrorCode::KifuConversionFailed),
            "{:?}",
            err.code
        );
        assert!(
            err.message.contains("PresetOther") || err.message.contains("initial"),
            "クレートの名指しが消えている: {}",
            err.message
        );
    }
}
