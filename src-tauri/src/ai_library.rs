use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FsKind {
    File,
    Dir,
    Symlink,
    Unknown,
}

fn validate_dir(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    let p = Path::new(value);
    if !p.exists() {
        return Err(format!("{label} does not exist: {value}"));
    }
    if !p.is_dir() {
        return Err(format!("{label} is not a directory: {value}"));
    }
    Ok(())
}

fn kind_of(path: &Path) -> FsKind {
    match fs::symlink_metadata(path) {
        Ok(md) => {
            let ft = md.file_type();
            if ft.is_symlink() {
                FsKind::Symlink
            } else if ft.is_dir() {
                FsKind::Dir
            } else if ft.is_file() {
                FsKind::File
            } else {
                FsKind::Unknown
            }
        }
        Err(_) => FsKind::Unknown,
    }
}

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

#[derive(Debug, Clone, Serialize)]
pub struct EngineCandidate {
    /// engines/
    pub entry: String,
    pub path: String,
    pub kind: FsKind,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileCandidate {
    /// ai_root
    pub name: String,
    pub path: String,

    pub has_eval_dir: bool,
    pub has_book_dir: bool,
    pub has_nn_bin: bool,
    pub book_db_files: Vec<String>,
}

#[command]
pub fn scan_ai_root(ai_root: String) -> Result<AiRootIndex, String> {
    validate_dir("ai_root", &ai_root)?;
    let root = PathBuf::from(&ai_root);

    let engines_dir_path = root.join("engines");
    let engines_dir_exists = engines_dir_path.exists();
    let engines_dir_kind = if engines_dir_exists {
        kind_of(&engines_dir_path)
    } else {
        FsKind::Unknown
    };

    let engines = if engines_dir_exists && engines_dir_path.is_dir() {
        read_engines(&engines_dir_path)?
    } else {
        vec![]
    };

    let profiles = read_profiles(&root)?;

    Ok(AiRootIndex {
        ai_root,
        engines_dir: DirInfo {
            path: engines_dir_path.to_string_lossy().to_string(),
            exists: engines_dir_exists,
            kind: engines_dir_kind,
        },
        engines,
        profiles,
    })
}

fn read_engines(engines_dir: &Path) -> Result<Vec<EngineCandidate>, String> {
    let mut out = vec![];

    for entry in fs::read_dir(engines_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.is_empty() {
            continue;
        }
        let path = entry.path();
        let kind = kind_of(&path);

        out.push(EngineCandidate {
            entry: file_name,
            path: path.to_string_lossy().to_string(),
            kind,
        });
    }

    out.sort_by(|a, b| a.entry.cmp(&b.entry));
    Ok(out)
}

fn read_profiles(ai_root: &Path) -> Result<Vec<ProfileCandidate>, String> {
    let mut out = vec![];

    for entry in fs::read_dir(ai_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() || name == "engines" {
            continue;
        }

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let eval_dir = path.join("eval");
        let book_dir = path.join("book");

        let has_eval_dir = eval_dir.exists() && eval_dir.is_dir();
        let has_book_dir = book_dir.exists() && book_dir.is_dir();
        let has_nn_bin = eval_dir.join("nn.bin").exists();

        // 候補として出す条件：eval/ または book/ があるディレクトリだけ
        if !(has_eval_dir || has_book_dir) {
            continue;
        }

        let book_db_files = if has_book_dir {
            list_db_files(&book_dir, 50)
        } else {
            vec![]
        };

        out.push(ProfileCandidate {
            name,
            path: path.to_string_lossy().to_string(),
            has_eval_dir,
            has_book_dir,
            has_nn_bin,
            book_db_files,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn list_db_files(dir: &Path, max: usize) -> Vec<String> {
    let mut out = vec![];

    let it = match fs::read_dir(dir) {
        Ok(it) => it,
        Err(_) => return out,
    };

    for entry in it.take(max) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
            if ext.eq_ignore_ascii_case("db") {
                out.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }

    out.sort();
    out
}

#[command]
pub fn ensure_engines_dir(ai_root: String) -> Result<String, String> {
    validate_dir("ai_root", &ai_root)?;
    let root = PathBuf::from(&ai_root);

    let engines_dir = root.join("engines");
    if engines_dir.exists() {
        if !engines_dir.is_dir() {
            return Err(format!(
                "engines exists but is not a directory: {}",
                engines_dir.display()
            ));
        }
        return Ok(engines_dir.to_string_lossy().to_string());
    }

    fs::create_dir_all(&engines_dir).map_err(|e| e.to_string())?;
    Ok(engines_dir.to_string_lossy().to_string())
}

#[derive(Debug, Clone, Deserialize)]
pub struct EngineSetupDraft {
    pub ai_root: Option<String>,
    pub engine_entry: Option<String>,
    pub profile_name: Option<String>,

    pub eval_dir_name: String,  // "eval"
    pub book_dir_name: String,  // "book"
    pub nn_file_name: String,   // "nn.bin"
    pub book_file_name: String, // "user_book1.db"

    pub work_dir_policy: WorkDirPolicy,
    pub custom_work_dir: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkDirPolicy {
    ProfileDir,
    EngineDir,
    Custom,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineSetupCheck {
    pub configured: bool,
    pub ok: bool,
    pub resolved: Option<ResolvedEnginePaths>,
    pub checks: Vec<PathCheck>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedEnginePaths {
    pub ai_root: String,
    pub engines_dir: String,
    pub engine_path: String,

    pub profile_dir: String,
    pub eval_dir: String,
    pub nn_path: String,

    pub book_dir: String,
    pub book_path: String,

    pub work_dir: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PathCheck {
    pub key: String,  // "ai_root" | "engine" | ...
    pub path: String, // 解決されたパス
    pub exists: bool,
    pub kind: FsKind, // exists=false の時は Unknown でOK
}

#[command]
pub fn check_engine_setup(draft: EngineSetupDraft) -> Result<EngineSetupCheck, String> {
    // configured 判定（フロントでやってもいいが、事実として返すのはOK）
    let Some(ai_root) = draft.ai_root.clone() else {
        return Ok(not_configured());
    };
    if ai_root.trim().is_empty() {
        return Err("ai_root must not be empty".into());
    }

    let Some(engine_entry) = draft.engine_entry.clone() else {
        return Ok(not_configured());
    };
    if engine_entry.trim().is_empty() {
        return Err("engine_entry must not be empty".into());
    }

    let Some(profile_name) = draft.profile_name.clone() else {
        return Ok(not_configured());
    };
    if profile_name.trim().is_empty() {
        return Err("profile_name must not be empty".into());
    }

    validate_dir("ai_root", &ai_root)?;
    let root = PathBuf::from(&ai_root);

    let engines_dir = root.join("engines");
    let engine_path = engines_dir.join(&engine_entry);

    let profile_dir = root.join(&profile_name);
    let eval_dir = profile_dir.join(&draft.eval_dir_name);
    let nn_path = eval_dir.join(&draft.nn_file_name);
    let book_dir = profile_dir.join(&draft.book_dir_name);
    let book_path = book_dir.join(&draft.book_file_name);

    let work_dir = resolve_work_dir(&draft, &engine_path, &engines_dir, &profile_dir);

    let mut checks: Vec<PathCheck> = vec![];
    push_check(&mut checks, "ai_root", &root);
    push_check(&mut checks, "engines_dir", &engines_dir);
    push_check(&mut checks, "engine_path", &engine_path);
    push_check(&mut checks, "profile_dir", &profile_dir);
    push_check(&mut checks, "eval_dir", &eval_dir);
    push_check(&mut checks, "nn_path", &nn_path);
    push_check(&mut checks, "book_dir", &book_dir);
    push_check(&mut checks, "book_path", &book_path);
    push_check(&mut checks, "work_dir", &work_dir);

    let ok = checks.iter().all(|c| c.exists);

    Ok(EngineSetupCheck {
        configured: true,
        ok,
        resolved: Some(ResolvedEnginePaths {
            ai_root: root.to_string_lossy().to_string(),
            engines_dir: engines_dir.to_string_lossy().to_string(),
            engine_path: engine_path.to_string_lossy().to_string(),
            profile_dir: profile_dir.to_string_lossy().to_string(),
            eval_dir: eval_dir.to_string_lossy().to_string(),
            nn_path: nn_path.to_string_lossy().to_string(),
            book_dir: book_dir.to_string_lossy().to_string(),
            book_path: book_path.to_string_lossy().to_string(),
            work_dir: work_dir.to_string_lossy().to_string(),
        }),
        checks,
    })
}

fn not_configured() -> EngineSetupCheck {
    EngineSetupCheck {
        configured: false,
        ok: false,
        resolved: None,
        checks: vec![],
    }
}

fn push_check(out: &mut Vec<PathCheck>, key: &str, path: &Path) {
    let exists = path.exists();
    let kind = if exists {
        kind_of(path)
    } else {
        FsKind::Unknown
    };
    out.push(PathCheck {
        key: key.to_string(),
        path: path.to_string_lossy().to_string(),
        exists,
        kind,
    });
}

fn resolve_work_dir(
    draft: &EngineSetupDraft,
    engine_path: &Path,
    engines_dir: &Path,
    profile_dir: &Path,
) -> PathBuf {
    match draft.work_dir_policy {
        WorkDirPolicy::ProfileDir => profile_dir.to_path_buf(),
        WorkDirPolicy::EngineDir => {
            if engine_path.is_dir() {
                engine_path.to_path_buf()
            } else {
                engine_path.parent().unwrap_or(engines_dir).to_path_buf()
            }
        }
        WorkDirPolicy::Custom => {
            if let Some(p) = draft.custom_work_dir.as_deref() {
                if !p.trim().is_empty() {
                    return PathBuf::from(p);
                }
            }
            PathBuf::new()
        }
    }
}
