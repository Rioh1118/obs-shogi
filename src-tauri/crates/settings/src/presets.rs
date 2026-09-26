//! エンジンのプリセットの形と置き場、読み込み時の移行。
//!
//! 判定表は `docs/state-transitions/presets-file.md`（「読み込み」「保存」の節。記号 F0〜F5 もそこ）。
//! **判定の出典はこのファイル。** 画面の `writable` は操作を出さないための写しで、保存を断るのは
//! [`save_to`]。守っていること:
//!
//! 1. **読めなかったファイルを上書きしない。** 上書きする前に退避するか、書かない
//! 2. **知らない欄と読めない件を落とさない。** 1件の中（`analysis` の中も）の知らない欄、最上位の
//!    知らない欄、読めない件の生の値は、保存を通しても残る（値として。数の表記と欄の順は保たない）
//! 3. **古い版の原本は完全な形で1つは残る**（`.bak` を書けなければ移さない）
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

/// いま書く版。
///
/// **版を上げるとき**（欄の形を変えるとき）に触るのは3つ: この定数、[`upgrade`] に1段足すこと、
/// その段のテスト。古い版の原本は `engine_presets.v<元の版>.bak` に残る（[`back_up_original`]）。
/// v2 の欄の形は v1 と同じ（v1 → v2 は版の欄を付けるだけ）
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

    /// この版が知らない欄。**値として書き戻す**（先の版が足した欄を、戻した版の保存1回で消さない。
    /// `AppConfig::extra` と同じ理由）。数の表記（`2.0` → `2`、64ビットに収まらない整数の丸め）と
    /// 欄の順は保たない
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// 解析の既定。**知らない欄を持ち回る**（`EnginePreset::extra` と同じ理由。入れ子の中で
/// 先の版が足した欄も、戻した版の保存で消さない）
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AnalysisDefaults {
    pub time_seconds: Option<u32>,
    pub depth: Option<u32>,
    pub nodes: Option<u64>,
    pub mate_search: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// 読み込みの結果。**画面は `writable` が偽なら変更の操作を出さない**（断るのは [`save_to`]）
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
    pub load_notice: Option<PresetsLoadNotice>,
}

/// 読み込みで起きたこと。画面の文言は種類から組む
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PresetsLoadNotice {
    /// 古い版（`from`）を今の版に書き直した。原本は `backup` に残してある
    Migrated { from: u64, backup: String },
    /// 移す前に原本を残せなかったので、移していない（読み取り専用）
    BackupFailed { reason: String },
    /// 古い版を読めたが書き戻せなかった（読み取り専用）
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
    /// 書いてはいけないファイル（今の版でない・読めない）
    ReadOnly,
    /// 書き込みに失敗した
    Io,
    /// 渡された件が保存できない（`id` が空など）
    Invalid,
}

/// 保存を断ったこと。`message` はログ用（利用者の言葉ではない）
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

/// 置き場を引いて [`load_from`]
pub fn load(app: &AppHandle) -> Result<LoadedPresets, String> {
    Ok(load_from(&presets_dir(app)?, SystemTime::now()))
}

/// 置き場を引いて [`save_to`]
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

/// 版の欄の読み方。**版は形より先に見る**——先の版が `presets` の形を変えたファイルを
/// 「壊れた」と読むと、退避して空から始め、新しい版のデータを今の版で書き潰す
enum VersionField {
    /// 欄が無い（`null` も同じ）。版の欄を持たない最初の形（v1）
    Missing,
    Known(u64),
    /// 今の版より新しい（64ビットに収まらない数も含む）
    Newer(u64),
    /// 数でない・負・小数
    Invalid,
}

fn version_field(value: Option<&Value>) -> VersionField {
    let Some(value) = value else {
        return VersionField::Missing;
    };
    if value.is_null() {
        return VersionField::Missing;
    }
    let version = match (value.as_u64(), value.as_f64()) {
        (Some(v), _) => v,
        // `2.0` のような整数値の小数は受ける。手で編集すると付くことがある
        (None, Some(f)) if f.is_finite() && f >= 0.0 && f.fract() == 0.0 => {
            if f > u64::MAX as f64 {
                return VersionField::Newer(u64::MAX);
            }
            f as u64
        }
        _ => return VersionField::Invalid,
    };
    if version > CURRENT_VERSION {
        VersionField::Newer(version)
    } else {
        VersionField::Known(version)
    }
}

/// ファイルの形の判定
enum Parsed {
    /// 今の版か、それより古い版（`version` は元の版。欄が無ければ 1）
    Readable {
        version: u64,
        presets: Vec<EnginePreset>,
        /// 解けなかった件の生の値。保存のときに書き戻す
        unreadable: Vec<Value>,
        /// 最上位の知らない欄
        extra: Map<String, Value>,
    },
    /// 新しい版。`presets` は読めた範囲（形が違えば空）
    Newer {
        version: u64,
        presets: Vec<EnginePreset>,
    },
    /// JSON として読めない・最上位の形が違う
    Broken,
}

/// 古い版の最上位を、今の版の最上位へ移す。**版を上げるときはここに1段足す。**
///
/// v1 → v2 は欄の形が同じなので何もしない（版の欄は [`render`] が付ける）
fn upgrade(_from: u64, top: Map<String, Value>) -> Map<String, Value> {
    top
}

/// `presets` の各件を解く。**1件ずつ**（1件の欠けで全件を捨てない）
fn split_entries(entries: Vec<Value>) -> (Vec<EnginePreset>, Vec<Value>) {
    let mut presets = Vec::new();
    let mut unreadable = Vec::new();
    for entry in entries {
        match serde_json::from_value::<EnginePreset>(entry.clone()) {
            Ok(preset) if !preset.id.trim().is_empty() => presets.push(preset),
            _ => unreadable.push(entry),
        }
    }
    (presets, unreadable)
}

/// 判定順は「版 → 最上位の形 → 各件」（[`VersionField`]）。UTF-8 の BOM は読み飛ばす
fn parse(bytes: &[u8]) -> Parsed {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let Ok(Value::Object(mut top)) = serde_json::from_slice::<Value>(bytes) else {
        return Parsed::Broken;
    };
    let version = match version_field(top.get("version")) {
        VersionField::Invalid => return Parsed::Broken,
        VersionField::Newer(version) => {
            let presets = match top.remove("presets") {
                Some(Value::Array(entries)) => split_entries(entries).0,
                _ => Vec::new(),
            };
            return Parsed::Newer { version, presets };
        }
        VersionField::Missing => 1,
        VersionField::Known(version) => version,
    };
    top.remove("version");
    let mut top = upgrade(version, top);
    let entries = match top.remove("presets") {
        None => Vec::new(),
        Some(Value::Array(entries)) => entries,
        Some(_) => return Parsed::Broken,
    };
    let (presets, unreadable) = split_entries(entries);
    Parsed::Readable {
        version,
        presets,
        unreadable,
        extra: top,
    }
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
fn empty(
    revision: Option<String>,
    writable: bool,
    load_notice: Option<PresetsLoadNotice>,
) -> LoadedPresets {
    LoadedPresets {
        presets: Vec::new(),
        revision,
        writable,
        unreadable_count: 0,
        load_notice,
    }
}

/// 古い版の原本を `engine_presets.v<from>.bak` に残す。**既に同じ中身の `.bak` が在れば書かない**
/// （開き直すたびに増やさない）。中身が違えば上書きせず、後ろに時刻を足した名前にする
fn back_up_original(dir: &Path, from: u64, bytes: &[u8], now: SystemTime) -> io::Result<PathBuf> {
    let name = format!("engine_presets.v{from}.bak");
    let plain = dir.join(&name);
    let target = match fs::read(&plain) {
        Ok(existing) if existing == bytes => return Ok(plain),
        Ok(_) => unused_path(dir, &name, "", now),
        Err(e) if e.kind() == io::ErrorKind::NotFound => plain,
        Err(e) => return Err(e),
    };
    atomic_write(&target, bytes)?;
    Ok(target)
}

/// 置き場 `dir` のプリセットを読む。判定表は `docs/state-transitions/presets-file.md` の「読み込み」
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
                Some(PresetsLoadNotice::Unreadable {
                    reason: e.to_string(),
                }),
            )
        }
    };
    let revision = revision_of(&bytes);

    let (version, presets, unreadable, extra) = match parse(&bytes) {
        // F3: 移してから空で始める。移せなければ書かない（F3x）
        Parsed::Broken => {
            let destination = unused_path(dir, "engine_presets.unreadable", ".json", now);
            return match fs::rename(&path, &destination) {
                Ok(()) => empty(
                    None,
                    true,
                    Some(PresetsLoadNotice::Recovered {
                        destination: destination.to_string_lossy().into_owned(),
                    }),
                ),
                Err(e) => empty(
                    Some(revision),
                    false,
                    Some(PresetsLoadNotice::NotRecovered {
                        reason: e.to_string(),
                    }),
                ),
            };
        }
        // F4: 新しい版の欄を知らないまま書き戻さない
        Parsed::Newer { version, presets } => {
            return LoadedPresets {
                presets,
                revision: Some(revision),
                writable: false,
                unreadable_count: 0,
                load_notice: Some(PresetsLoadNotice::NewerVersion { version }),
            }
        }
        Parsed::Readable {
            version,
            presets,
            unreadable,
            extra,
        } => (version, presets, unreadable, extra),
    };
    let unreadable_count = unreadable.len();
    let loaded =
        |revision: String, writable: bool, load_notice: Option<PresetsLoadNotice>| LoadedPresets {
            presets: presets.clone(),
            revision: Some(revision),
            writable,
            unreadable_count,
            load_notice,
        };

    // F2
    if version == CURRENT_VERSION {
        return loaded(revision, true, None);
    }

    // F1: 原本を残してから書き戻す
    let backup = match back_up_original(dir, version, &bytes, now) {
        Ok(backup) => backup,
        Err(e) => {
            return loaded(
                revision,
                false,
                Some(PresetsLoadNotice::BackupFailed {
                    reason: e.to_string(),
                }),
            )
        }
    };
    let written = render(&presets, &unreadable, &extra).and_then(|next| {
        // **書く直前に読み直す。** 読んでから原本を残すまでの間に他が書いていたら、その変更は
        // `.bak` にも無いので、古い中身から作った今の版で上書きすると失う
        let still = fs::read(&path).map_err(|e| e.to_string())?;
        if still != bytes {
            return Err("the presets file changed while it was being migrated".to_string());
        }
        atomic_write(&path, &next).map_err(|e| e.to_string())?;
        Ok(next)
    });
    match written {
        Ok(next) => loaded(
            revision_of(&next),
            true,
            Some(PresetsLoadNotice::Migrated {
                from: version,
                backup: backup.to_string_lossy().into_owned(),
            }),
        ),
        Err(reason) => loaded(
            revision,
            false,
            Some(PresetsLoadNotice::MigrationFailed { reason }),
        ),
    }
}

/// 置き場 `dir` へ書く。判定表は `docs/state-transitions/presets-file.md` の「保存」。
///
/// **書く直前にディスクを読み直す**——`expected_revision` と違えば `Conflict`。一致しても、
/// ディスクが**今の版でなければ書かない**（`ReadOnly`）: 古い版は原本を残さずに上書きすることになり、
/// 新しい版は知らない欄を落とす。読めない件の生の値と最上位の知らない欄は、読み直したファイルから
/// 持ち回る。読み直しから書くまでの間に他が書いた分は見分けられない（ファイルの鍵は取らない）。
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

    let (unreadable, extra) = match current.as_deref().map(parse) {
        None => (Vec::new(), Map::new()),
        Some(Parsed::Readable {
            version: CURRENT_VERSION,
            unreadable,
            extra,
            ..
        }) => (unreadable, extra),
        Some(Parsed::Readable { version, .. }) => {
            return Err(SaveFailure::new(
                SaveFailureKind::ReadOnly,
                format!("the presets file is version {version} and has not been migrated"),
            ))
        }
        Some(Parsed::Newer { .. }) => {
            return Err(SaveFailure::new(
                SaveFailureKind::ReadOnly,
                "the presets file was written by a newer version",
            ))
        }
        Some(Parsed::Broken) => {
            return Err(SaveFailure::new(
                SaveFailureKind::ReadOnly,
                "the presets file is not readable JSON",
            ))
        }
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
        let Some(PresetsLoadNotice::Migrated { backup, .. }) = &loaded.load_notice else {
            panic!("移したことを伝えていない: {:?}", loaded.load_notice);
        };
        assert_eq!(
            fs::read(backup).unwrap(),
            V1.as_bytes(),
            "原本がそのまま残っていない"
        );
        assert_eq!(read_json(&file(&dir))["version"], CURRENT_VERSION);

        let again = load_from(&dir, at(200));
        assert_eq!(again.load_notice, None, "2回目も移している");
        assert_eq!(again.revision, loaded.revision);
        assert_eq!(again.presets[0].eval_file_path, "/ai/suisho/eval/nn.bin");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 同じ原本を2度移しても `.bak` を増やさない。中身が違えば上書きせず別の名前に残す
    #[test]
    fn a_different_v1_does_not_overwrite_the_earlier_backup() {
        let dir = dir("presets-v1-twice");
        fs::write(dir.join("engine_presets.v1.bak"), "older original").unwrap();
        fs::write(file(&dir), V1).unwrap();

        let loaded = load_from(&dir, at(100));
        let Some(PresetsLoadNotice::Migrated { backup, .. }) = &loaded.load_notice else {
            panic!("移していない: {:?}", loaded.load_notice);
        };
        assert_ne!(Path::new(backup), dir.join("engine_presets.v1.bak"));
        assert_eq!(
            fs::read(dir.join("engine_presets.v1.bak")).unwrap(),
            b"older original"
        );
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
            loaded.load_notice,
            Some(PresetsLoadNotice::NewerVersion { version: 3 })
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
        let Some(PresetsLoadNotice::Recovered { destination }) = &loaded.load_notice else {
            panic!("移していない: {:?}", loaded.load_notice);
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
                matches!(
                    loaded.load_notice,
                    Some(PresetsLoadNotice::Recovered { .. })
                ),
                "{body}: {:?}",
                loaded.load_notice
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
            (
                "Migrated",
                PresetsLoadNotice::Migrated {
                    from: 1,
                    backup: reason(),
                },
            ),
            (
                "BackupFailed",
                PresetsLoadNotice::BackupFailed { reason: reason() },
            ),
            (
                "MigrationFailed",
                PresetsLoadNotice::MigrationFailed { reason: reason() },
            ),
            (
                "Recovered",
                PresetsLoadNotice::Recovered {
                    destination: reason(),
                },
            ),
            (
                "NotRecovered",
                PresetsLoadNotice::NotRecovered { reason: reason() },
            ),
            (
                "NewerVersion",
                PresetsLoadNotice::NewerVersion { version: 3 },
            ),
            (
                "Unreadable",
                PresetsLoadNotice::Unreadable { reason: reason() },
            ),
        ];
        let declared_notices = declared("PresetsLoadNotice");
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

    /// 新しい版は、`presets` の形が違っても（先の版が形を変えた）壊れた扱いにしない。
    /// 64ビットに収まらない版も新しい版。どちらもファイルは1バイトも変わらない
    #[test]
    fn a_newer_version_is_decided_before_the_shape() {
        for body in [
            r#"{"version":3,"presets":{"a":{"id":"a"}}}"#,
            r#"{"version":1e30,"presets":[]}"#,
        ] {
            let dir = dir("presets-newer-shape");
            fs::write(file(&dir), body).unwrap();

            let loaded = load_from(&dir, at(1));
            assert!(!loaded.writable, "{body}");
            assert!(
                matches!(
                    loaded.load_notice,
                    Some(PresetsLoadNotice::NewerVersion { .. })
                ),
                "{body}: {:?}",
                loaded.load_notice
            );
            assert_eq!(fs::read(file(&dir)).unwrap(), body.as_bytes(), "{body}");
            let _ = fs::remove_dir_all(&dir);
        }
    }

    /// 手で編集すると付く形（BOM・`2.0`・`null`）は、壊れた扱いにせず読む
    #[test]
    fn hand_edited_forms_are_read_rather_than_moved_aside() {
        let cases: [(&[u8], bool); 3] = [
            (
                b"\xEF\xBB\xBF{\"version\":2,\"presets\":[{\"id\":\"a\"}]}",
                false,
            ),
            (b"{\"version\":2.0,\"presets\":[{\"id\":\"a\"}]}", false),
            // `null` は欄が無いのと同じ（v1）。移す
            (b"{\"version\":null,\"presets\":[{\"id\":\"a\"}]}", true),
        ];
        for (body, migrates) in cases {
            let dir = dir("presets-hand-edited");
            fs::write(file(&dir), body).unwrap();

            let loaded = load_from(&dir, at(1));
            assert!(loaded.writable);
            assert_eq!(
                loaded.presets.len(),
                1,
                "{:?}",
                String::from_utf8_lossy(body)
            );
            assert_eq!(
                matches!(loaded.load_notice, Some(PresetsLoadNotice::Migrated { .. })),
                migrates,
                "{:?}",
                loaded.load_notice
            );
            let _ = fs::remove_dir_all(&dir);
        }
    }

    /// 負の版は壊れた扱い（移してから空で始める）
    #[test]
    fn a_negative_version_counts_as_broken() {
        let dir = dir("presets-negative");
        fs::write(file(&dir), r#"{"version":-1,"presets":[]}"#).unwrap();
        let loaded = load_from(&dir, at(1));
        assert!(matches!(
            loaded.load_notice,
            Some(PresetsLoadNotice::Recovered { .. })
        ));
        let _ = fs::remove_dir_all(&dir);
    }

    /// **保存を断るのは Rust。** まだ移していない古い版は、読んだ印が合っていても書かない——
    /// 書くと原本を `.bak` に残さずに上書きする（原本を残せず読み取り専用で開いた回が、ここに来る）
    #[test]
    fn an_unmigrated_file_is_never_overwritten() {
        let dir = dir("presets-unmigrated");
        fs::write(file(&dir), V1).unwrap();

        let refused = save_to(&dir, Vec::new(), Some(&revision_of(V1.as_bytes())))
            .expect_err("古い版を原本を残さずに上書きしている");
        assert_eq!(refused.kind, SaveFailureKind::ReadOnly);
        assert_eq!(fs::read(file(&dir)).unwrap(), V1.as_bytes());
        let _ = fs::remove_dir_all(&dir);
    }

    /// `analysis` の中の知らない欄も保存を通して残る
    #[test]
    fn fields_it_does_not_know_inside_analysis_survive_a_save() {
        let dir = dir("presets-analysis-extra");
        fs::write(
            file(&dir),
            r#"{"version":2,"presets":[{"id":"a","analysis":{"depth":3,"multiPv":5}}]}"#,
        )
        .unwrap();

        let loaded = load_from(&dir, at(1));
        save_to(&dir, loaded.presets, loaded.revision.as_deref()).expect("書ける");

        let written = read_json(&file(&dir));
        assert_eq!(written["presets"][0]["analysis"]["multiPv"], 5);
        assert_eq!(written["presets"][0]["analysis"]["depth"], 3);
        let _ = fs::remove_dir_all(&dir);
    }

    /// 印は実行をまたいで同じ（読み込みと保存が別の実行でも比べられる）
    #[test]
    fn the_revision_depends_only_on_the_bytes() {
        assert_eq!(revision_of(b"abc"), revision_of(b"abc"));
        assert_ne!(revision_of(b"abc"), revision_of(b"abd"));
        assert_eq!(revision_of(b""), "cbf29ce484222325-0");
    }
}
