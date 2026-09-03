use serde::Serialize;
use std::io;

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub enum FsErrorCode {
    AlreadyExists,
    NotFound,
    /// 名前が空。何を直せばよいかが code から決まるように、原因ごとに分けてある
    InvalidNameEmpty,
    /// `.` と `..`
    InvalidNameReserved,
    /// `/` と `\`
    InvalidNameSeparator,
    /// NUL。OS によっては別のパスに化ける
    InvalidNameControl,
    /// **その場所を扱えない。** 入るのは3つ。
    ///
    /// - root の外（`validate_under_root`）
    /// - 親や名前を解決できない（`mv.rs`）
    /// - 設定そのものを読めない（`load_root_dir`）
    ///
    /// 「**無い**」は入れない。それは `NotFound`。無いをここへ載せると tier が
    /// `danger` になって「再読み込み」の導線が消える。ツリーが古いだけなのに、
    /// 追いつくための操作が画面から消える
    InvalidPath,
    /// ファイルとディレクトリの取り違え。`is_file()` / `is_dir()` の判定にだけ使う
    InvalidType,
    InvalidExtension,
    InvalidDestination,
    /// ワークスペースそのものを消そうとした。中身ごと消えて取り消せないので、
    /// UI の判定に頼らずここで止める
    RootNotDeletable,
    /// 棋譜を保存する形へ直せなかった。正規化と直列化の失敗をここへ載せる。
    /// InvalidType に載せると「ファイルとフォルダを取り違えています」と表示される
    KifuConversionFailed,
    /// 棋譜を読めなかった。**いまはどの文字コードでも復号できなかったとき**
    /// （ の `read_text_portable`）。
    /// TS 側は同じ code を自分でも作る（tsshogi が断ったとき）
    KifuParseFailed,
    PermissionDenied,
    Io,
    Unknown,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsError {
    pub code: FsErrorCode,
    pub message: String,
    pub path: Option<String>,
    pub existing_path: Option<String>,
}

impl FsError {
    pub fn new(code: FsErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
            existing_path: None,
        }
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn with_existing_path(mut self, path: impl Into<String>) -> Self {
        self.existing_path = Some(path.into());
        self
    }
}

impl From<io::Error> for FsError {
    fn from(value: io::Error) -> Self {
        let code = match value.kind() {
            io::ErrorKind::AlreadyExists => FsErrorCode::AlreadyExists,
            io::ErrorKind::NotFound => FsErrorCode::NotFound,
            io::ErrorKind::PermissionDenied => FsErrorCode::PermissionDenied,
            _ => FsErrorCode::Io,
        };

        FsError::new(code, value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 変種から作られる名前。**網羅 match なので、変種を増やすとここが
    /// コンパイルエラーになる。** 増やしたら下の一覧にも並べること
    fn serialized_name(code: &FsErrorCode) -> &'static str {
        match code {
            FsErrorCode::AlreadyExists => "already_exists",
            FsErrorCode::NotFound => "not_found",
            FsErrorCode::InvalidNameEmpty => "invalid_name_empty",
            FsErrorCode::InvalidNameReserved => "invalid_name_reserved",
            FsErrorCode::InvalidNameSeparator => "invalid_name_separator",
            FsErrorCode::InvalidNameControl => "invalid_name_control",
            FsErrorCode::InvalidPath => "invalid_path",
            FsErrorCode::InvalidType => "invalid_type",
            FsErrorCode::InvalidExtension => "invalid_extension",
            FsErrorCode::InvalidDestination => "invalid_destination",
            FsErrorCode::RootNotDeletable => "root_not_deletable",
            FsErrorCode::KifuConversionFailed => "kifu_conversion_failed",
            FsErrorCode::KifuParseFailed => "kifu_parse_failed",
            FsErrorCode::PermissionDenied => "permission_denied",
            FsErrorCode::Io => "io",
            FsErrorCode::Unknown => "unknown",
        }
    }

    /// TS 側は `FsErrorCode` を文字列で受ける。ここがずれると `asFsError` の
    /// `isFsErrorCode` を通らず、全部 `unknown` に落ちて path も message も消える。
    ///
    /// 名前の一覧そのものは `src/__tests__/fsErrorCodes.test.ts` が
    /// TS の union と突き合わせる。ここが見るのは **serde が実際に出す文字列が
    /// 変種名の snake_case と同じか**（向こうはそれを前提に名前を作っている）
    #[test]
    fn serde_emits_snake_case_variant_names() {
        let all = [
            FsErrorCode::AlreadyExists,
            FsErrorCode::NotFound,
            FsErrorCode::InvalidNameEmpty,
            FsErrorCode::InvalidNameReserved,
            FsErrorCode::InvalidNameSeparator,
            FsErrorCode::InvalidNameControl,
            FsErrorCode::InvalidPath,
            FsErrorCode::InvalidType,
            FsErrorCode::InvalidExtension,
            FsErrorCode::InvalidDestination,
            FsErrorCode::RootNotDeletable,
            FsErrorCode::KifuConversionFailed,
            FsErrorCode::KifuParseFailed,
            FsErrorCode::PermissionDenied,
            FsErrorCode::Io,
            FsErrorCode::Unknown,
        ];

        for code in &all {
            let expected = format!("\"{}\"", serialized_name(code));
            assert_eq!(serde_json::to_string(code).unwrap(), expected);
        }
    }
}
