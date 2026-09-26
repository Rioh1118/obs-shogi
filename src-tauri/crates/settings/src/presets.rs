//! エンジンのプリセットの形と置き場、読み込み時の移行。
//!
//! 判定表は `.claude/plans/presets-migration.plan.md` の §3（読み込み）と §4（書き込み）。
//! 守っていること:
//!
//! 1. **読めなかったファイルを上書きしない。** 上書きする前に退避するか、書かない
//! 2. **知らない欄と読めない件を落とさない。** 1件の中の未知の欄、最上位の未知の欄、
//!    読めない件の生の値は、保存を通しても残る
//! 3. **v1 の原本は完全な形で1つは残る**（`.bak` を書けなければ移行しない）
//! 4. **別の書き手の変更を黙って上書きしない**（`revision`）

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

use ::fs::write::atomic_write;

const PRESETS_FILE: &str = "engine_presets.json";

/// v1 の原本を残す名前。既に在って中身が違えば後ろに時刻を足す
const V1_BACKUP: &str = "engine_presets.v1.bak";

/// いま書く版。**欄の形は v1 と同じ**で、版の欄が付いただけ。
/// 形を変えるときは版を上げ、[`load_from`] に移し方を足す
pub const CURRENT_VERSION: u64 = 2;

/// プリセット1件。**必須は `id` だけ。** 欠けた欄は既定値で読む——1つの欄が欠けただけで
/// ファイル全体が読めなくなり、その状態で保存すると全件が消える。
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EnginePreset {
    pub id: String,
    pub label: String,

    pub ai_name: String,

    // 実体（絶対パス）
    pub engine_path: String,
    pub eval_file_path: String,

    // book は任意
    pub book_enabled: bool,
    pub book_file_path: Option<String>,

    pub options: HashMap<String, String>,
    pub analysis: Option<AnalysisDefaults>,

    /// この版が知らない欄。**読んだままの形で書き戻す**（先の版が足した欄を、戻した版の
    /// 保存1回で消さない。`AppConfig::extra` と同じ理由）
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisDefaults {
    pub time_seconds: Option<u32>,
    pub depth: Option<u32>,
    pub nodes: Option<u64>,
    pub mate_search: Option<bool>,
}

/// 読み込みの結果。**画面は `writable` が偽なら変更の操作を出さない。**
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPresets {
    pub presets: Vec<EnginePreset>,
    /// 読んだファイルの中身の印。保存に渡す（別の書き手の変更を見分ける）。ファイルが無ければ `None`
    pub revision: Option<String>,
    pub writable: bool,
    /// 読めなかった件の数。ファイルには残してあり、保存しても消えない
    pub unreadable_count: usize,
    /// 利用者に1回伝えること。無ければ `None`
    pub notice: Option<PresetsNotice>,
}

/// 読み込みで起きたこと。画面の文言は種類から組む
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PresetsNotice {
    /// v1 を v2 に書き直した。原本は `backup` に残してある
    Migrated { backup: String },
    /// 移す前に原本を残せなかったので、移していない（読み取り専用）
    BackupFailed { reason: String },
    /// v1 を読めたが書き戻せなかった（読み取り専用）
    MigrationFailed { reason: String },
    /// JSON として読めなかったので `destination` へ移し、空から始めた
    Recovered { destination: String },
    /// JSON として読めず、移すこともできなかった（読み取り専用）
    NotRecovered { reason: String },
    /// この版より新しい版で書かれたファイル（読み取り専用）
    NewerVersion { version: u64 },
    /// ファイルを読めなかった（権限・入出力。読み取り専用）
    Unreadable { reason: String },
}

/// 保存を断った理由の種類
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SaveFailureKind {
    /// 読んだ後にファイルが変わっていた（別のウィンドウ・手で編集した、など）
    Conflict,
    /// 書いてはいけないファイル（新しい版・読めない）
    ReadOnly,
    /// 書き込みに失敗した
    Io,
    /// 渡された件が保存できない（`id` が空など）
    Invalid,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveFailure {
    pub kind: SaveFailureKind,
    pub message: String,
}

impl SaveFailure {
    fn new(kind: SaveFailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

fn presets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

pub fn load(app: &AppHandle) -> Result<LoadedPresets, String> {
    Ok(load_from(&presets_dir(app)?, SystemTime::now()))
}

pub fn save(
    app: &AppHandle,
    presets: Vec<EnginePreset>,
    expected_revision: Option<&str>,
) -> Result<String, SaveFailure> {
    let dir = presets_dir(app).map_err(|e| SaveFailure::new(SaveFailureKind::Io, e))?;
    save_to(&dir, presets, expected_revision)
}

/// 中身の印。**変わったかを見分けるためだけ**に使う（改ざんの検出ではない）。
/// 実行をまたいで同じ値になるよう、既定のハッシャ（種が実行ごとに変わる）を使わない
fn revision_of(bytes: &[u8]) -> String {
    // FNV-1a 64
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}-{}", bytes.len())
}

fn timestamp(now: SystemTime) -> u64 {
    now.duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 既に在る名前を避けた置き場。`<stem>-<時刻>[-n]<suffix>`
fn unused_path(dir: &Path, stem: &str, suffix: &str, now: SystemTime) -> PathBuf {
    let base = format!("{stem}-{}", timestamp(now));
    let mut candidate = dir.join(format!("{base}{suffix}"));
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{base}-{n}{suffix}"));
        n += 1;
    }
    candidate
}

/// 最上位の形。**`presets` は1件ずつ解く**（1件の欠けで全件を捨てない）
struct Parsed {
    version: Option<u64>,
    presets: Vec<EnginePreset>,
    /// 解けなかった件の生の値。保存のときに書き戻す
    unreadable: Vec<Value>,
    /// 最上位の知らない欄
    extra: Map<String, Value>,
}

/// 最上位を解く。**JSON として読めない・欄の型が違う**ものは `None`（壊れたファイル）
fn parse(bytes: &[u8]) -> Option<Parsed> {
    let Value::Object(mut top) = serde_json::from_slice::<Value>(bytes).ok()? else {
        return None;
    };
    let version = match top.remove("version") {
        None => None,
        Some(v) => Some(v.as_u64()?),
    };
    let entries = match top.remove("presets") {
        None => Vec::new(),
        Some(Value::Array(entries)) => entries,
        Some(_) => return None,
    };

    let mut presets = Vec::new();
    let mut unreadable = Vec::new();
    for entry in entries {
        match serde_json::from_value::<EnginePreset>(entry.clone()) {
            Ok(preset) if !preset.id.trim().is_empty() => presets.push(preset),
            _ => unreadable.push(entry),
        }
    }
    Some(Parsed {
        version,
        presets,
        unreadable,
        extra: top,
    })
}

/// 書く形。読めない件は末尾に、最上位の知らない欄はそのまま
fn render(
    presets: &[EnginePreset],
    unreadable: &[Value],
    extra: &Map<String, Value>,
) -> Result<Vec<u8>, String> {
    let mut top = extra.clone();
    top.insert("version".to_string(), Value::from(CURRENT_VERSION));
    let mut entries = Vec::with_capacity(presets.len() + unreadable.len());
    for preset in presets {
        entries.push(serde_json::to_value(preset).map_err(|e| e.to_string())?);
    }
    entries.extend(unreadable.iter().cloned());
    top.insert("presets".to_string(), Value::Array(entries));
    serde_json::to_vec_pretty(&Value::Object(top)).map_err(|e| e.to_string())
}

/// 空で始める結果
fn empty(revision: Option<String>, writable: bool, notice: Option<PresetsNotice>) -> LoadedPresets {
    LoadedPresets {
        presets: Vec::new(),
        revision,
        writable,
        unreadable_count: 0,
        notice,
    }
}

/// v1 の原本を残す。**既に同じ中身の `.bak` が在れば書かない**（開き直すたびに増やさない）
fn back_up_v1(dir: &Path, bytes: &[u8], now: SystemTime) -> io::Result<PathBuf> {
    let plain = dir.join(V1_BACKUP);
    let target = match fs::read(&plain) {
        Ok(existing) if existing == bytes => return Ok(plain),
        Ok(_) => unused_path(dir, V1_BACKUP, "", now),
        Err(e) if e.kind() == io::ErrorKind::NotFound => plain,
        Err(e) => return Err(e),
    };
    atomic_write(&target, bytes)?;
    Ok(target)
}

/// 置き場 `dir` のプリセットを読む。判定表は `presets-migration.plan.md` §3
pub fn load_from(dir: &Path, now: SystemTime) -> LoadedPresets {
    let path = dir.join(PRESETS_FILE);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        // F0
        Err(e) if e.kind() == io::ErrorKind::NotFound => return empty(None, true, None),
        // F5: 読めないものを「無い」と扱うと、次の保存で上書きする
        Err(e) => {
            return empty(
                None,
                false,
                Some(PresetsNotice::Unreadable {
                    reason: e.to_string(),
                }),
            )
        }
    };
    let revision = revision_of(&bytes);

    let Some(parsed) = parse(&bytes) else {
        // F3: 移してから空で始める。移せなければ書かない（F3x）
        let destination = unused_path(dir, "engine_presets.unreadable", ".json", now);
        return match fs::rename(&path, &destination) {
            Ok(()) => empty(
                None,
                true,
                Some(PresetsNotice::Recovered {
                    destination: destination.to_string_lossy().into_owned(),
                }),
            ),
            Err(e) => empty(
                Some(revision),
                false,
                Some(PresetsNotice::NotRecovered {
                    reason: e.to_string(),
                }),
            ),
        };
    };
    let unreadable_count = parsed.unreadable.len();
    let loaded = |revision: String, writable: bool, notice: Option<PresetsNotice>| LoadedPresets {
        presets: parsed.presets.clone(),
        revision: Some(revision),
        writable,
        unreadable_count,
        notice,
    };

    match parsed.version {
        // F4: 新しい版の欄を知らないまま書き戻さない
        Some(version) if version > CURRENT_VERSION => loaded(
            revision,
            false,
            Some(PresetsNotice::NewerVersion { version }),
        ),
        // F2
        Some(CURRENT_VERSION) => loaded(revision, true, None),
        // F1: 原本を残してから書き戻す
        _ => {
            let backup = match back_up_v1(dir, &bytes, now) {
                Ok(backup) => backup,
                Err(e) => {
                    return loaded(
                        revision,
                        false,
                        Some(PresetsNotice::BackupFailed {
                            reason: e.to_string(),
                        }),
                    )
                }
            };
            let written =
                render(&parsed.presets, &parsed.unreadable, &parsed.extra).and_then(|next| {
                    atomic_write(&path, &next).map_err(|e| e.to_string())?;
                    Ok(next)
                });
            match written {
                Ok(next) => loaded(
                    revision_of(&next),
                    true,
                    Some(PresetsNotice::Migrated {
                        backup: backup.to_string_lossy().into_owned(),
                    }),
                ),
                Err(reason) => loaded(
                    revision,
                    false,
                    Some(PresetsNotice::MigrationFailed { reason }),
                ),
            }
        }
    }
}

/// 置き場 `dir` へ書く。**書く直前にディスクを読み直す**——`expected_revision` と違えば書かない。
/// 読めない件の生の値と最上位の知らない欄は、読み直したファイルから持ち回る。
///
/// 読み直しから書くまでの間に他が書いた分は見分けられない（ファイルの鍵は取らない）。
pub fn save_to(
    dir: &Path,
    presets: Vec<EnginePreset>,
    expected_revision: Option<&str>,
) -> Result<String, SaveFailure> {
    if let Some(bad) = presets.iter().find(|p| p.id.trim().is_empty()) {
        return Err(SaveFailure::new(
            SaveFailureKind::Invalid,
            format!("a preset has an empty id (label: {:?})", bad.label),
        ));
    }

    let path = dir.join(PRESETS_FILE);
    let current = match fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(SaveFailure::new(SaveFailureKind::ReadOnly, e.to_string())),
    };
    let current_revision = current.as_deref().map(revision_of);
    if current_revision.as_deref() != expected_revision {
        return Err(SaveFailure::new(
            SaveFailureKind::Conflict,
            "the presets file changed after it was read",
        ));
    }

    let (unreadable, extra) = match current.as_deref() {
        None => (Vec::new(), Map::new()),
        Some(bytes) => match parse(bytes) {
            Some(parsed) if parsed.version.is_some_and(|v| v > CURRENT_VERSION) => {
                return Err(SaveFailure::new(
                    SaveFailureKind::ReadOnly,
                    "the presets file was written by a newer version",
                ))
            }
            Some(parsed) => (parsed.unreadable, parsed.extra),
            None => {
                return Err(SaveFailure::new(
                    SaveFailureKind::ReadOnly,
                    "the presets file is not readable JSON",
                ))
            }
        },
    };

    let next = render(&presets, &unreadable, &extra)
        .map_err(|e| SaveFailure::new(SaveFailureKind::Io, e))?;
    atomic_write(&path, &next).map_err(|e| SaveFailure::new(SaveFailureKind::Io, e.to_string()))?;
    Ok(revision_of(&next))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const V1: &str = r#"{
  "presets": [
    {
      "id": "a",
      "label": "水匠",
      "aiName": "suisho",
      "enginePath": "/ai/engines/YaneuraOu",
      "evalFilePath": "/ai/suisho/eval/nn.bin",
      "bookEnabled": false,
      "bookFilePath": null,
      "options": { "Threads": "4" },
      "analysis": null
    }
  ]
}"#;

    fn at(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    fn dir(tag: &str) -> PathBuf {
        test_support::dir::temp_dir(tag)
    }

    fn file(dir: &Path) -> PathBuf {
        dir.join(PRESETS_FILE)
    }

    fn read_json(path: &Path) -> Value {
        serde_json::from_slice(&fs::read(path).expect("読める")).expect("JSON")
    }

    /// F1: v1 を読むと、原本がそのままのバイト列で残り、ファイルは v2 になり、
    /// 読み直しても同じ件が出る
    #[test]
    fn a_v1_file_is_kept_as_is_and_rewritten_as_v2() {
        let dir = dir("presets-v1");
        fs::write(file(&dir), V1).unwrap();

        let loaded = load_from(&dir, at(100));
        assert!(loaded.writable);
        assert_eq!(loaded.presets.len(), 1);
        assert_eq!(loaded.presets[0].label, "水匠");
        let Some(PresetsNotice::Migrated { backup }) = &loaded.notice else {
            panic!("移したことを伝えていない: {:?}", loaded.notice);
        };
        assert_eq!(
            fs::read(backup).unwrap(),
            V1.as_bytes(),
            "原本がそのまま残っていない"
        );
        assert_eq!(read_json(&file(&dir))["version"], CURRENT_VERSION);

        let again = load_from(&dir, at(200));
        assert_eq!(again.notice, None, "2回目も移している");
        assert_eq!(again.revision, loaded.revision);
        assert_eq!(again.presets[0].eval_file_path, "/ai/suisho/eval/nn.bin");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 同じ原本を2度移しても `.bak` を増やさない。中身が違えば上書きせず別の名前に残す
    #[test]
    fn a_different_v1_does_not_overwrite_the_earlier_backup() {
        let dir = dir("presets-v1-twice");
        fs::write(dir.join(V1_BACKUP), "older original").unwrap();
        fs::write(file(&dir), V1).unwrap();

        let loaded = load_from(&dir, at(100));
        let Some(PresetsNotice::Migrated { backup }) = &loaded.notice else {
            panic!("移していない: {:?}", loaded.notice);
        };
        assert_ne!(Path::new(backup), dir.join(V1_BACKUP));
        assert_eq!(fs::read(dir.join(V1_BACKUP)).unwrap(), b"older original");
        assert_eq!(fs::read(backup).unwrap(), V1.as_bytes());
        let _ = fs::remove_dir_all(&dir);
    }

    /// 1件の欄が欠けても他の件を巻き込まない。`id` の無い件は読めない件として残り、
    /// 保存しても消えない
    #[test]
    fn one_broken_entry_does_not_take_the_others_down() {
        let dir = dir("presets-partial");
        fs::write(
            file(&dir),
            r#"{"version":2,"presets":[
                {"id":"a","label":"欄が欠けた件"},
                {"label":"id の無い件","enginePath":"/x"},
                {"id":"c","label":"普通の件","enginePath":"/e","evalFilePath":"/v","bookEnabled":false,"options":{}}
            ]}"#,
        )
        .unwrap();

        let loaded = load_from(&dir, at(1));
        assert!(loaded.writable);
        assert_eq!(loaded.unreadable_count, 1);
        let labels: Vec<_> = loaded.presets.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(labels, ["欄が欠けた件", "普通の件"]);

        let kept: Vec<_> = loaded.presets.into_iter().take(1).collect();
        save_to(&dir, kept, loaded.revision.as_deref()).expect("書ける");
        let written = read_json(&file(&dir));
        let entries = written["presets"].as_array().unwrap();
        assert_eq!(entries.len(), 2, "読めない件が保存で消えた: {written}");
        assert_eq!(entries[1]["label"], "id の無い件");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 知らない欄（1件の中・最上位）は保存を通して残る
    #[test]
    fn fields_it_does_not_know_survive_a_save() {
        let dir = dir("presets-extra");
        fs::write(
            file(&dir),
            r#"{"version":2,"theme":"dark","presets":[{"id":"a","label":"x","futureField":{"n":1}}]}"#,
        )
        .unwrap();

        let loaded = load_from(&dir, at(1));
        save_to(&dir, loaded.presets, loaded.revision.as_deref()).expect("書ける");

        let written = read_json(&file(&dir));
        assert_eq!(written["theme"], "dark", "最上位の知らない欄が消えた");
        assert_eq!(
            written["presets"][0]["futureField"]["n"], 1,
            "1件の知らない欄が消えた"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// F4: 新しい版は読めた件を見せるが、書かない。ファイルは1バイトも変わらない
    #[test]
    fn a_newer_version_is_read_but_never_written() {
        let dir = dir("presets-newer");
        let newer = r#"{"version":3,"presets":[{"id":"a","label":"x","values":{"Threads":"8"}}]}"#;
        fs::write(file(&dir), newer).unwrap();

        let loaded = load_from(&dir, at(1));
        assert!(!loaded.writable);
        assert_eq!(
            loaded.notice,
            Some(PresetsNotice::NewerVersion { version: 3 })
        );
        assert_eq!(loaded.presets.len(), 1);

        let refused = save_to(&dir, loaded.presets, loaded.revision.as_deref())
            .expect_err("新しい版を書き潰している");
        assert_eq!(refused.kind, SaveFailureKind::ReadOnly);
        assert_eq!(fs::read(file(&dir)).unwrap(), newer.as_bytes());
        let _ = fs::remove_dir_all(&dir);
    }

    /// F3: JSON として読めないファイルは、中身ごと別の名前へ移してから空で始める
    #[test]
    fn a_broken_file_is_moved_aside_before_starting_empty() {
        let dir = dir("presets-broken");
        let broken = br#"{"presets": [ {"id": "a", "#;
        fs::write(file(&dir), broken).unwrap();

        let loaded = load_from(&dir, at(42));
        assert!(loaded.writable);
        assert!(loaded.presets.is_empty());
        let Some(PresetsNotice::Recovered { destination }) = &loaded.notice else {
            panic!("移していない: {:?}", loaded.notice);
        };
        assert_eq!(fs::read(destination).unwrap(), broken);
        assert!(
            !file(&dir).exists(),
            "元の場所に残っている（次の保存で上書きされる）"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 欄の型が違う最上位も壊れたファイルとして扱う（`presets` が配列でない、`version` が数でない）
    #[test]
    fn a_top_level_of_the_wrong_shape_counts_as_broken() {
        for body in [r#"{"presets":{}}"#, r#"{"version":"2","presets":[]}"#, "[]"] {
            let dir = dir("presets-shape");
            fs::write(file(&dir), body).unwrap();
            let loaded = load_from(&dir, at(1));
            assert!(
                matches!(loaded.notice, Some(PresetsNotice::Recovered { .. })),
                "{body}: {:?}",
                loaded.notice
            );
            let _ = fs::remove_dir_all(&dir);
        }
    }

    /// 読んだ後にファイルが変わっていたら書かない
    #[test]
    fn a_save_after_someone_else_wrote_is_refused() {
        let dir = dir("presets-conflict");
        fs::write(
            file(&dir),
            r#"{"version":2,"presets":[{"id":"a","label":"x"}]}"#,
        )
        .unwrap();
        let loaded = load_from(&dir, at(1));

        let elsewhere = r#"{"version":2,"presets":[{"id":"b","label":"他で足した"}]}"#;
        fs::write(file(&dir), elsewhere).unwrap();

        let refused = save_to(&dir, loaded.presets, loaded.revision.as_deref())
            .expect_err("他の変更を上書きしている");
        assert_eq!(refused.kind, SaveFailureKind::Conflict);
        assert_eq!(fs::read(file(&dir)).unwrap(), elsewhere.as_bytes());
        let _ = fs::remove_dir_all(&dir);
    }

    /// ファイルが無い状態から書ける。返した印で続けて書ける
    #[test]
    fn a_first_save_creates_the_file_and_the_revision_chains() {
        let dir = dir("presets-fresh");
        let loaded = load_from(&dir, at(1));
        assert!(loaded.writable);
        assert_eq!(loaded.revision, None);

        let preset = EnginePreset {
            id: "a".to_string(),
            ..EnginePreset::default()
        };
        let first = save_to(&dir, vec![preset.clone()], None).expect("作れる");
        save_to(&dir, vec![preset], Some(&first)).expect("続けて書ける");
        assert_eq!(read_json(&file(&dir))["version"], CURRENT_VERSION);
        let _ = fs::remove_dir_all(&dir);
    }

    /// 空の `id` は書かない（読み込みで読めない件になり、画面から消える）
    #[test]
    fn an_empty_id_is_refused() {
        let dir = dir("presets-empty-id");
        let refused = save_to(&dir, vec![EnginePreset::default()], None).expect_err("通している");
        assert_eq!(refused.kind, SaveFailureKind::Invalid);
        assert!(!file(&dir).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// 種類が**宣言の綴りを camelCase にした形**で線に出ること。写しとの突き合わせは TS 側
    /// （`src/__tests__/presetsWire.test.ts`）が宣言の綴りから引くので、その写像が本物の serde と
    /// 一致していることをここで保証する。見本は宣言と数で突き合わせる（足し忘れを見る）
    #[test]
    fn every_kind_goes_on_the_wire_as_camel_case() {
        fn declared(name: &str) -> Vec<String> {
            let source = include_str!("presets.rs");
            let body = source
                .split_once(&format!("pub enum {name} {{"))
                .expect("宣言が見つからない")
                .1;
            body.lines()
                .take_while(|line| *line != "}")
                .map(str::trim)
                .filter(|line| line.starts_with(char::is_uppercase))
                .map(|line| {
                    line.split([' ', ',', '{'])
                        .next()
                        .unwrap_or_default()
                        .to_string()
                })
                .collect()
        }
        fn camel(name: &str) -> String {
            let mut chars = name.chars();
            chars
                .next()
                .map(|first| first.to_lowercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        }
        let reason = || "x".to_string();
        let notices = [
            ("Migrated", PresetsNotice::Migrated { backup: reason() }),
            (
                "BackupFailed",
                PresetsNotice::BackupFailed { reason: reason() },
            ),
            (
                "MigrationFailed",
                PresetsNotice::MigrationFailed { reason: reason() },
            ),
            (
                "Recovered",
                PresetsNotice::Recovered {
                    destination: reason(),
                },
            ),
            (
                "NotRecovered",
                PresetsNotice::NotRecovered { reason: reason() },
            ),
            ("NewerVersion", PresetsNotice::NewerVersion { version: 3 }),
            ("Unreadable", PresetsNotice::Unreadable { reason: reason() }),
        ];
        let declared_notices = declared("PresetsNotice");
        assert!(declared_notices.len() > 4, "{declared_notices:?}");
        assert_eq!(
            declared_notices.len(),
            notices.len(),
            "見本に無い種類がある: {declared_notices:?}"
        );
        for (name, notice) in &notices {
            assert!(
                declared_notices.iter().any(|d| d == name),
                "{name} が宣言に無い"
            );
            let wire = serde_json::to_value(notice).expect("直列化できる");
            assert_eq!(wire["kind"], camel(name), "{name} の線の綴りが違う");
        }

        let kinds = [
            ("Conflict", SaveFailureKind::Conflict),
            ("ReadOnly", SaveFailureKind::ReadOnly),
            ("Io", SaveFailureKind::Io),
            ("Invalid", SaveFailureKind::Invalid),
        ];
        let declared_kinds = declared("SaveFailureKind");
        assert_eq!(
            declared_kinds.len(),
            kinds.len(),
            "見本に無い種類がある: {declared_kinds:?}"
        );
        for (name, kind) in &kinds {
            assert_eq!(
                serde_json::to_value(kind).expect("直列化できる"),
                camel(name),
                "{name} の線の綴りが違う"
            );
        }
    }

    /// 印は実行をまたいで同じ（読み込みと保存が別の実行でも比べられる）
    #[test]
    fn the_revision_depends_only_on_the_bytes() {
        assert_eq!(revision_of(b"abc"), revision_of(b"abc"));
        assert_ne!(revision_of(b"abc"), revision_of(b"abd"));
        assert_eq!(revision_of(b""), "cbf29ce484222325-0");
    }
}
