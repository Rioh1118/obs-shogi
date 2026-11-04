//! 研究局面の形と置き場。

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, Runtime};

use ::fs::write::atomic_write;

const STUDY_POSITIONS_FILE_NAME: &str = "study_positions.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StudyPositionState {
    Inbox,
    Active,
    Reference,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyPosition {
    pub id: String,
    pub sfen: String,
    pub label: String,
    pub description: String,
    pub state: StudyPositionState,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StudyPositionsFile {
    pub positions: Vec<StudyPosition>,
}

fn study_positions_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app_config_dir: {e}"))?;

    Ok(config_dir.join(STUDY_POSITIONS_FILE_NAME))
}

fn read_file_or_default(path: &Path) -> Result<StudyPositionsFile, String> {
    if !path.exists() {
        return Ok(StudyPositionsFile::default());
    }

    let text =
        fs::read_to_string(path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;

    if text.trim().is_empty() {
        return Ok(StudyPositionsFile::default());
    }

    serde_json::from_str::<StudyPositionsFile>(&text)
        .map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

fn write_file(path: &Path, input: &StudyPositionsFile) -> Result<(), String> {
    let text = serde_json::to_string_pretty(input)
        .map_err(|e| format!("failed to serialize study positions: {e}"))?;

    atomic_write(path, text.as_bytes())
        .map_err(|e| format!("failed to write {}: {e}", path.display()))
}

pub fn read_or_default<R: Runtime>(app: &AppHandle<R>) -> Result<StudyPositionsFile, String> {
    read_file_or_default(&study_positions_path(app)?)
}

pub fn write<R: Runtime>(app: &AppHandle<R>, input: &StudyPositionsFile) -> Result<(), String> {
    write_file(&study_positions_path(app)?, input)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(tag: &str) -> PathBuf {
        test_support::dir::temp_dir(tag)
    }

    fn position(id: &str) -> StudyPosition {
        StudyPosition {
            id: id.to_string(),
            sfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1".to_string(),
            label: "平手".to_string(),
            description: String::new(),
            state: StudyPositionState::Inbox,
            tags: vec!["序盤".to_string()],
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-02T00:00:00Z".to_string(),
        }
    }

    /// 無いファイルと、空白だけのファイルは0件として読む。空白だけを JSON として読むと
    /// parse に失敗し、画面は研究局面を1件も出せなくなる
    #[test]
    fn a_missing_or_blank_file_reads_as_empty() {
        let dir = dir("study-empty");
        let path = dir.join(STUDY_POSITIONS_FILE_NAME);
        assert!(read_file_or_default(&path).unwrap().positions.is_empty());

        fs::write(&path, " \n").unwrap();
        assert!(read_file_or_default(&path).unwrap().positions.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    /// 壊れたファイルは `Err` を返す。既定値で返すと、次の保存で壊れたファイルの中身を書き潰す
    #[test]
    fn a_broken_file_is_an_error() {
        let dir = dir("study-broken");
        let path = dir.join(STUDY_POSITIONS_FILE_NAME);
        fs::write(&path, r#"{"positions": ["#).unwrap();
        assert!(read_file_or_default(&path).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    /// 書いたものを読み直すと同じ件が出る。保存の形は camelCase の欄と小文字の状態で、
    /// TS の型（`src/entities/study-positions`）がこの綴りで読む
    #[test]
    fn a_written_file_reads_back_in_the_wire_spelling() {
        let dir = dir("study-round-trip");
        let path = dir.join(STUDY_POSITIONS_FILE_NAME);
        let input = StudyPositionsFile {
            positions: vec![position("a")],
        };

        write_file(&path, &input).unwrap();

        let written: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(written["positions"][0]["state"], "inbox");
        assert_eq!(written["positions"][0]["createdAt"], "2026-01-01T00:00:00Z");
        let read = read_file_or_default(&path).unwrap();
        assert_eq!(read.positions.len(), 1);
        assert_eq!(read.positions[0].updated_at, "2026-01-02T00:00:00Z");
        assert_eq!(read.positions[0].tags, ["序盤"]);
        let _ = fs::remove_dir_all(&dir);
    }
}
