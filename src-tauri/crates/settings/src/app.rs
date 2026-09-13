//! `app.json` の形と置き場。

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

use ::fs::write::atomic_write;

pub const CONFIG_FILE: &str = "app.json";

/// **`#[serde(default)]` を外さない。** 外すと、フィールドを1つ足した時点で
/// 既存利用者の `app.json` が parse に失敗し、パスを受ける全コマンドが落ちる
/// （関門が `app.json` を読むため）。
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppConfig {
    pub root_dir: Option<String>,
    pub ai_root: Option<String>,
    pub last_preset_id: Option<String>,

    /// ドックに出すタブの綴りを、出す順に並べたもの。`None` は「まだ選んでいない」。
    ///
    /// **綴りを enum にしない。** ここに書ける名前はフロントの名簿
    /// （`src/entities/dock/model/views.ts`）が決めるので、Rust 側で型にすると
    /// 名簿へ1枚足すたびに両側を直すことになり、**片方だけ古い版の設定ファイルは
    /// parse ごと落ちる**。濾すのは読んだ側
    /// （`resolveDockTabs`。`src/entities/dock/lib/tabs.ts`）。
    pub dock_tabs: Option<Vec<String>>,
    /// 起動時に開くタブ。**`None` は「前回のもの」**（`dock_last_tab` を使う）
    pub dock_startup_tab: Option<String>,
    /// 前回開いていたタブ
    pub dock_last_tab: Option<String>,
    /// 解析の評価値バーを出すか。**`None` は出さない**（ADR-0010 決定4）
    pub show_evaluation_bar: Option<bool>,
    /// 解析ビューの候補手の見せ方。**`None` は既定**。
    ///
    /// 綴りを enum にしない理由は [`AppConfig::dock_tabs`] と同じ。
    pub analysis_display_mode: Option<String>,

    /// この版が知らない欄。**読んだままの形で書き戻す。**
    ///
    /// [`write`] はファイルごと置き換えるので、これが無いと**知らない欄は
    /// 書き戻しで消える**。更新した版で設定を書いたあと古い版へ戻す経路があり、
    /// そこで1回でも保存すれば（ドックのタブを押すだけでも通る）新しい版の設定は
    /// 永久に失われる。parse で落ちないだけでは足りない。
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(CONFIG_FILE))
}

pub fn read_or_default(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app)?;
    if path.exists() {
        let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())
    } else {
        Ok(AppConfig::default())
    }
}

pub fn write(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    atomic_write(&path, data.as_bytes()).map_err(|e| e.to_string())
}

/// 読めなかった `app.json` を退避する。**上書きの前に呼ぶ。**
///
/// [`write`] はファイルごと置き換えるので、読めなかった設定に対して
/// 呼び出し元が組み立てた値を書くと、読めていない欄が `null` として
/// 書き潰される。壊れた JSON でも、中の文字列は利用者が選んだ場所そのもの。
/// **捨てる前に取っておく。**
///
/// 退避先を返す。無ければ `None`
pub fn back_up_broken(app: &AppHandle) -> Result<Option<String>, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    // 上書きされないように、既にある退避先は避ける
    let mut backup = path.with_extension("json.broken");
    for n in 1..100 {
        if !backup.exists() {
            break;
        }
        backup = path.with_extension(format!("json.broken.{n}"));
    }

    fs::rename(&path, &backup).map_err(|e| e.to_string())?;
    Ok(Some(backup.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::AppConfig;

    /// 前の版が書いた `app.json` が読めること。
    ///
    /// 落ちるのは、`Option` でない欄を `#[serde(default)]` 無しで足したとき。
    /// そのとき既存利用者の設定は parse に失敗し、パスを受ける全コマンドが
    /// 落ちる（関門が `app.json` を読むため）。
    ///
    /// **`Option` の欄だけを足しても落ちない。** serde は `Option` を
    /// 「欠けていれば `None`」として読むので、いまの欄を消してもこの検査は緑になる。
    /// 守っているのは属性の綴りではなく、**古い設定が読めること**そのもの。
    #[test]
    fn reads_a_config_that_predates_the_display_fields() {
        let old = r#"{"root_dir":"/kifu","ai_root":null,"last_preset_id":"p1"}"#;

        let config: AppConfig = serde_json::from_str(old).expect("古い app.json を読めていない");

        assert_eq!(config.root_dir.as_deref(), Some("/kifu"));
        assert_eq!(config.last_preset_id.as_deref(), Some("p1"));
        assert_eq!(config.dock_tabs, None);
        assert_eq!(config.dock_startup_tab, None);
        assert_eq!(config.dock_last_tab, None);
        assert_eq!(config.show_evaluation_bar, None);
        assert_eq!(config.analysis_display_mode, None);
        assert!(config.extra.is_empty());
    }

    /// 先の版が書いた `app.json` を読めて、**書き戻しても消えない**こと。
    ///
    /// 更新した版で設定を書いたあと古い版へ戻す経路がある。parse で落ちないだけでは
    /// 足りない —— [`write`] はファイルごと置き換えるので、知らない欄を持ち回らないと
    /// 戻した先で1回保存した時点（ドックのタブを押すだけでも通る）で消える。
    #[test]
    fn keeps_fields_it_does_not_know() {
        let newer = r#"{"root_dir":"/kifu","dock_tabs":["analysis"],"dock_footer_items":["nps"]}"#;

        let config: AppConfig = serde_json::from_str(newer).expect("知らない欄で落ちている");

        assert_eq!(config.root_dir.as_deref(), Some("/kifu"));
        assert_eq!(
            config.dock_tabs.as_deref(),
            Some(["analysis".to_string()].as_slice())
        );

        let written = serde_json::to_string(&config).expect("書き戻せない");
        assert!(
            written.contains("dock_footer_items"),
            "知らない欄が書き戻しで消えている: {written}"
        );
    }
}
