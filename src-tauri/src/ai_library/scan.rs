//! AI ルートの中身を1回で数え上げる。

use serde::Serialize;
use std::path::Path;

use super::dir::{kind_of, FsKind};
use super::engines::{EngineCandidate, ENGINES_DIR};
use super::profile::ProfileCandidate;
use super::{engines, profile};

#[derive(Debug, Clone, Serialize)]
pub struct AiRootIndex {
    pub ai_root: String,

    pub engines_dir: DirInfo,
    pub engines: Vec<EngineCandidate>,

    pub profiles: Vec<ProfileCandidate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirInfo {
    pub path: String,
    pub exists: bool,
    pub kind: FsKind,
}

pub fn index(ai_root: String) -> Result<AiRootIndex, String> {
    let root = Path::new(&ai_root);

    let engines_dir_path = root.join(ENGINES_DIR);
    let engines_dir_exists = engines_dir_path.exists();
    let engines_dir_kind = if engines_dir_exists {
        kind_of(&engines_dir_path)
    } else {
        FsKind::Unknown
    };

    let found = if engines_dir_exists && engines_dir_path.is_dir() {
        engines::read_all(&engines_dir_path)?
    } else {
        vec![]
    };

    let profiles = profile::read_all(root)?;

    Ok(AiRootIndex {
        ai_root,
        engines_dir: DirInfo {
            path: engines_dir_path.to_string_lossy().to_string(),
            exists: engines_dir_exists,
            kind: engines_dir_kind,
        },
        engines: found,
        profiles,
    })
}
