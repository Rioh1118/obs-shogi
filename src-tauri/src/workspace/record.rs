//! ワークスペースの中の棋譜ファイルを読み、拡張子が指す形式で綴る。

use std::fs;
use std::io::Write;
use std::path::Path;

use shogi_kifu_converter_obsshogi::{
    converter::{ToCsa, ToKi2, ToKif},
    error::ConvertError,
    jkf::JsonKifuFormat,
};

use ::fs::error::{FsError, FsErrorCode};
use ::fs::path::{ensure_not_exists, get_file_extension};
use kifu_text::decode_kifu;

pub fn write_new_file(path: &Path, content: &str) -> Result<(), FsError> {
    ensure_not_exists(path)?;

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(FsError::from)?;

    file.write_all(content.as_bytes()).map_err(FsError::from)
}

/// 棋譜を画面に開くために読む。
///
/// **文字コードの判断は [`crate::kifu_text`] が持つ。** ここで別に決めると、
/// 索引（`search::read::kifu_reader`）と**同じファイルについて違う文字列を見る**。
///
/// # 化けた文字列を返さない
///
/// 誤りを無視して復号すると、返るのは化けた文字列でも `Ok`。それを webview へ渡すと
/// `tsshogi` のインポータは **`Error` ではなく0手の棋譜**を返す
/// （`entities/kifu/api/parse.ts` の doc が明記している）ので、
/// 利用者には「開いたのに中身が無い」としか見えず、原因に辿り着けない。
/// 読めないなら読めないと言う。
pub fn read_text_portable(path: &Path) -> Result<String, FsError> {
    let bytes = fs::read(path).map_err(FsError::from)?;

    // BOM は復号のあとに落とす。落としてから渡すと、
    // `declared_encoding` が BOM を見られなくなって UTF-16 を名乗れない
    match decode_kifu(&bytes) {
        Some(decoded) => Ok(strip_utf8_bom_str(&decoded.text).to_owned()),
        None => Err(FsError::new(
            FsErrorCode::KifuParseFailed,
            "no candidate encoding decodes this file without errors",
        )
        .with_path(path.to_string_lossy().to_string())),
    }
}

/// 復号後の文字列の先頭に残る BOM（`U+FEFF`）を落とす。
///
/// `encoding_rs` は UTF-16 の BOM を消費するが、**UTF-8 の BOM は文字として残す**。
/// 残したまま `tsshogi` に渡すと1行目がどの行パターンにも当たらない
fn strip_utf8_bom_str(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

/// JKF を、拡張子が指す形式の文字列に綴る。
///
/// **`kifu.rs` の `convert_jkf_to_format` とは別物。** あちらは Tauri コマンドで、
/// 形式名を文字列で受け取り `normalize()` を呼ぶ。同じ名前にしていると、
/// #322（どの経路が正規化するか）のコメントがどちらを指すか決められない。
///
/// **0バイトにはならない。** 綴りは4形式とも開始局面を名乗る
/// （KIF / KI2 は `手合割`、CSA は `PI`、JKF は JSON の器）ので、
/// ヘッダも指し手も無い JKF でも骨組みが残る。
/// 空を書かせない番人は要らない — 空が作れない。
/// 固定するのは `no_format_spells_a_blank_record_as_nothing`。
pub fn spell_for_extension(jkf_data: &JsonKifuFormat, file_path: &Path) -> Result<String, FsError> {
    // `ConvertError` の Display は綴れなかったものを名指しする（書き分けられない手、
    // 綴りの無い枚数、盤面の無い手合割）。何手目かは言わない — ply を持つのは
    // `Normalize` だけで、KIF / KI2 / CSA の書き出しはそれを作らない。
    // ここで文言を潰すと、利用者に出るのは「変換に失敗」だけになる
    let to_fs_error = |r: Result<String, ConvertError>| {
        r.map_err(|e| FsError::new(FsErrorCode::KifuConversionFailed, e.to_string()))
    };

    match get_file_extension(file_path).as_deref() {
        Some("kif") => to_fs_error(jkf_data.try_to_kif_owned()),
        Some("ki2") => to_fs_error(jkf_data.try_to_ki2_owned()),
        Some("csa") => to_fs_error(jkf_data.try_to_csa_owned()),
        Some("jkf") => serde_json::to_string_pretty(jkf_data)
            .map_err(|e| FsError::new(FsErrorCode::KifuConversionFailed, e.to_string())),
        _ => Err(
            FsError::new(FsErrorCode::InvalidExtension, "unsupported kifu format")
                .with_path(file_path.to_string_lossy().to_string()),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shogi_kifu_converter_obsshogi::{
        jkf::{Initial, Preset},
        parser::{parse_csa_str, parse_jkf_str, parse_ki2_str, parse_kif_str},
    };
    use test_support::kifu::one_move_kif;

    /// **画面に開く経路が、化けた文字列を返さない。**
    ///
    /// 誤りを無視して復号すると、返るのは化けた文字列でも `Ok`。webview へ渡すと
    /// `tsshogi` は `Error` ではなく0手の棋譜を返すので、利用者には
    /// 「開いたのに中身が無い」としか見えない。索引には入っているので、
    /// **検索から辿った先が行き止まりになる**。
    ///
    /// EUC-JP を題材にするのは、`山田太郎` が Shift_JIS としても誤り無く
    /// 復号できるから（半角カナの羅列になる）。UTF-8 → Shift_JIS の順で
    /// 決め打つと、ここが黙って `ｻｳﾅﾄﾂﾀﾏｺ` になる。
    #[test]
    fn opening_a_kifu_never_returns_mojibake() {
        use encoding_rs::{EUC_JP, UTF_8};

        let dir = std::env::temp_dir().join(format!("obs-shogi-read-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("作業場所");

        let kifu = "V2.2\nN+山田太郎\nPI\n+\n+7776FU\n%TORYO\n";

        for enc in [UTF_8, EUC_JP] {
            let path = dir.join(format!("{}.csa", enc.name()));
            fs::write(&path, enc.encode(kifu).0.as_ref()).expect("書き出し");

            let text = read_text_portable(&path)
                .unwrap_or_else(|e| panic!("{}: 読めない: {}", enc.name(), e.message));
            assert_eq!(text, kifu, "{} の棋譜が化けた", enc.name());
        }

        // どの候補でも誤りが出るバイト列は、読めたことにしない
        let broken = dir.join("broken.csa");
        fs::write(&broken, [0x81u8, 0xFF, 0xFE, 0x81, 0xFF]).expect("書き出し");
        let err = read_text_portable(&broken).expect_err("化けた文字列を返した");
        assert!(
            matches!(err.code, FsErrorCode::KifuParseFailed),
            "読めなかった理由が違う: {:?}",
            err.code
        );

        fs::remove_dir_all(&dir).ok();
    }

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
    /// 新規作成フォームはファイル名以外すべて任意なので、何も入れずに作ると
    /// 「平手・ヘッダ空・0手」の JKF が来る。**既定の操作でここに当たる。**
    ///
    /// 0バイトで書いてしまうと `Ok` が返って作成は成功に見えるのに、次に開くと
    /// 「空の棋譜です。」で行き止まりになる。そのダイアログは再読み込みも出さないので、
    /// **アプリの中で中身を入れる手段が無い**（削除して作り直すしかない）。
    /// 索引側は中身の無い記録を黙って通すので、警告もどこにも出ない。
    ///
    /// **どの形式も開始局面を名乗る**ので、4形式とも骨組みを書く。
    /// KI2 が `手合割：平手` を書くのはそのため。
    #[test]
    fn no_format_spells_a_blank_record_as_nothing() {
        let blank = JsonKifuFormat {
            initial: Some(Initial {
                preset: Preset::PresetHirate,
                data: None,
            }),
            moves: vec![shogi_kifu_converter_obsshogi::jkf::MoveFormat::default()],
            ..JsonKifuFormat::default()
        };

        for ext in ["kif", "ki2", "csa", "jkf"] {
            let text = spell_for_extension(&blank, Path::new(&format!("新規.{ext}")))
                .unwrap_or_else(|e| panic!("{ext} を綴れない: {}", e.message));
            assert!(!text.is_empty(), "{ext} が空になっている");
        }

        // KI2 が名乗るのは手合割。4形式のうち書くものがいちばん少ないので、
        // ここが空でなければ他の3つも空にならない
        let ki2 = spell_for_extension(&blank, Path::new("新規.ki2")).expect("綴れること");
        assert!(
            ki2.contains("手合割"),
            "KI2 が開始局面を名乗っていない: {ki2:?}"
        );
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
