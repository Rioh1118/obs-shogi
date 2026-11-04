//! `app.json` の形と置き場。

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

use ::fs::write::atomic_write;

/// 置き場。`app_config_dir` の下。`validate_under_root` もこの名前で読む
pub const CONFIG_FILE: &str = "app.json";

/// `app.json` の中身。欠けた欄は `None` で読む
///
/// `#[serde(default)]` を外さない。外したうえで `Option` でない欄を足すと、その欄を持たない
/// 既存利用者の `app.json` が parse に失敗し、パスを受ける全コマンドが落ちる
/// （`validate_under_root` が `app.json` を読むため）。
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppConfig {
    /// ワークスペースの根。パスを受けるコマンドは、この下のパスだけを扱う（`validate_under_root`）
    pub root_dir: Option<String>,
    /// AI ライブラリのフォルダ
    pub ai_root: Option<String>,
    /// 最後に選んだプリセットの `id`
    pub last_preset_id: Option<String>,

    /// ドックに出すタブの綴りを、出す順に並べたもの。`None` は「まだ選んでいない」。
    ///
    /// 綴りを enum にしない。ここに書ける名前はフロントの名簿
    /// （`src/entities/dock/model/views.ts`）が決める。Rust 側で型にすると、名簿へ1枚足すたびに
    /// 両側を直すことになり、**片方だけ古い版で読んだ設定ファイルは parse ごと落ちる**。
    /// 知らない綴りを濾すのは読んだ側（`src/entities/dock/lib/tabs.ts` の `resolveDockTabs`）。
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
    /// 最近開いた定跡のパス。新しいものが先頭。
    ///
    /// Rust は中身も本数も見ず、読んだまま書き戻す。並べ方と本数は
    /// `src/entities/book/lib/recents.ts` が決め、本数を切るのも綴りを落とすのも
    /// 書く側（`rememberBook`）と読む側（`readRecentBooks`）の**両方が掛ける**。
    /// 片方だけにしない理由は `readRecentBooks` の doc にある。手で書かれた `app.json` の
    /// 100 件が、そのままボタンの数になる。
    ///
    /// 消えたファイルのパスは残る。開けなかったことは `open_book` が `NotFound` で返す。
    pub book_recent_paths: Option<Vec<String>>,

    /// この版が知らない欄。読んだままの値で書き戻す。
    ///
    /// [`write()`] はファイルごと置き換えるので、これが無いと**知らない欄は書き戻しで消える**。
    /// 更新した版で設定を書いたあと古い版へ戻す経路があり、戻した版で1回でも保存すると
    /// （ドックのタブを押すだけでも保存する）、新しい版の設定は失われる。parse で落ちない
    /// だけでは足りない。
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// `app.json` のパス。`app_config_dir` を引けなければ `Err`
pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(CONFIG_FILE))
}

/// `app.json` を読む。無ければ既定値。読めないか JSON として壊れていれば `Err` で、
/// 呼び手は書き直す前に [`back_up_broken`] で退避する
pub fn read_or_default(app: &AppHandle) -> Result<AppConfig, String> {
    read_file_or_default(&config_path(app)?)
}

fn read_file_or_default(path: &Path) -> Result<AppConfig, String> {
    if path.exists() {
        let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())
    } else {
        Ok(AppConfig::default())
    }
}

/// `app.json` をファイルごと原子的に置き換える
pub fn write(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    write_file(&config_path(app)?, config)
}

fn write_file(path: &Path, config: &AppConfig) -> Result<(), String> {
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    atomic_write(path, data.as_bytes()).map_err(|e| e.to_string())
}

/// 読めなかった `app.json` を `app.json.broken` へ移し、移した先を返す。ファイルが無ければ `None`。
///
/// 読めなかった設定を上書きする前に呼ぶ。[`write()`] はファイルごと置き換えるので、
/// 呼び手が組み立てた値を書くと、読めていない欄は `null` で書き潰される。壊れた JSON でも、
/// 中の文字列は利用者が選んだ場所そのものなので、**捨てる前に取っておく**。
pub fn back_up_broken(app: &AppHandle) -> Result<Option<String>, String> {
    back_up_file(&config_path(app)?)
}

fn back_up_file(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }

    // 前に退避したものを上書きしないよう、在る名前には番号を足して避ける。
    // 番号が `.broken.99` まで進むと、それが在るかは見ずに使う
    let mut backup = path.with_extension("json.broken");
    for n in 1..100 {
        if !backup.exists() {
            break;
        }
        backup = path.with_extension(format!("json.broken.{n}"));
    }

    fs::rename(path, &backup).map_err(|e| e.to_string())?;
    Ok(Some(backup.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::AppConfig;

    /// 前の版が書いた `app.json` が読めること。
    ///
    /// 落ちるのは、`Option` でない欄を `#[serde(default)]` 無しで足したとき。
    /// そのとき既存利用者の設定は parse に失敗し、パスを受ける全コマンドが
    /// 落ちる（`validate_under_root` が `app.json` を読むため）。
    ///
    /// `Option` の欄だけなら落ちない。serde は `Option` を「欠けていれば `None`」として読むので、
    /// いまの属性を消してもこの検査は緑になる。守っているのは属性の綴りではなく、
    /// **古い設定が読めること**そのもの。
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
