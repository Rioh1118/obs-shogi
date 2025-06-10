use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

/// USIエンジンオプションの種類
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum OptionType {
    /// チェックボックス型（true/false）
    Check { default: bool },
    /// 数値型（スピン）
    Spin { default: i32, min: i32, max: i32 },
    /// 選択肢型（コンボボックス）
    Combo {
        default: String,
        options: Vec<String>,
    },
    /// ボタン型（アクション実行）
    Button,
    /// 文字列型
    String { default: String },
}

/// USIエンジンオプション定義
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineOption {
    /// オプション名
    pub name: String,
    /// オプション種類
    #[serde(flatten)]
    pub option_type: OptionType,
    /// 現在の値
    pub current_value: OptionValue,
}

/// オプションの値
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(untagged)]
pub enum OptionValue {
    Bool(bool),
    Int(i32),
    String(String),
    #[default]
    None, // Button型用
}

impl fmt::Display for OptionValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OptionValue::Bool(b) => write!(f, "{}", b),
            OptionValue::Int(i) => write!(f, "{}", i),
            OptionValue::String(s) => write!(f, "{}", s),
            OptionValue::None => write!(f, ""),
        }
    }
}

impl OptionValue {
    /// 文字列から値を解析
    pub fn from_string(s: &str, option_type: &OptionType) -> Result<OptionValue, String> {
        match option_type {
            OptionType::Check { .. } => match s.to_lowercase().as_str() {
                "true" => Ok(OptionValue::Bool(true)),
                "false" => Ok(OptionValue::Bool(false)),
                _ => Err(format!("Invalid boolean value: {}", s)),
            },
            OptionType::Spin { min, max, .. } => {
                let val = s
                    .parse::<i32>()
                    .map_err(|_| format!("Invalid integer value: {}", s))?;
                if val < *min || val > *max {
                    return Err(format!("Value {} out of range [{}, {}]", val, min, max));
                }
                Ok(OptionValue::Int(val))
            }
            OptionType::Combo { options, .. } => {
                if options.contains(&s.to_string()) {
                    Ok(OptionValue::String(s.to_string()))
                } else {
                    Err(format!("Invalid combo option: {}", s))
                }
            }
            OptionType::String { .. } => Ok(OptionValue::String(s.to_string())),
            OptionType::Button => Ok(OptionValue::None),
        }
    }
}

/// エンジンオプション管理器
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EngineOptions {
    options: HashMap<String, EngineOption>,
}

impl EngineOptions {
    /// 新しいオプション管理器を作成
    pub fn new() -> Self {
        Self {
            options: HashMap::new(),
        }
    }

    /// USIオプション行を解析してオプションを追加
    pub fn parse_option_line(&mut self, line: &str) -> Result<String, String> {
        // "option name <name> type <type> [additional parameters]"の形式を解析
        let parts: Vec<&str> = line.split_whitespace().collect();

        if parts.len() < 4 || parts[0] != "option" || parts[1] != "name" {
            return Err("Invalid option line format".to_string());
        }

        // オプション名を取得
        let name_end = parts
            .iter()
            .position(|&p| p == "type")
            .ok_or("Missing 'type' keyword")?;

        if name_end <= 2 {
            return Err("Missing option name".to_string());
        }

        let name = parts[2..name_end].join(" ");
        let type_index = name_end + 1;

        if type_index >= parts.len() {
            return Err("Missing option type".to_string());
        }

        let option_type_str = parts[type_index];
        let remaining_parts = &parts[type_index + 1..];

        // オプション種類を解析
        let option_type = match option_type_str {
            "check" => {
                let default = self.parse_default_bool(remaining_parts)?;
                OptionType::Check { default }
            }
            "spin" => {
                let (default, min, max) = self.parse_spin_params(remaining_parts)?;
                OptionType::Spin { default, min, max }
            }
            "combo" => {
                let (default, options) = self.parse_combo_params(remaining_parts)?;
                OptionType::Combo { default, options }
            }
            "button" => OptionType::Button,
            "string" => {
                let default = self.parse_default_string(remaining_parts)?;
                OptionType::String { default }
            }
            _ => return Err(format!("Unknown option type: {}", option_type_str)),
        };

        // 現在値をデフォルト値で初期化
        let current_value = match &option_type {
            OptionType::Check { default } => OptionValue::Bool(*default),
            OptionType::Spin { default, .. } => OptionValue::Int(*default),
            OptionType::Combo { default, .. } => OptionValue::String(default.clone()),
            OptionType::String { default } => OptionValue::String(default.clone()),
            OptionType::Button => OptionValue::None,
        };

        let option = EngineOption {
            name: name.clone(),
            option_type,
            current_value,
        };

        self.options.insert(name.clone(), option);
        Ok(name)
    }

    /// チェック型のデフォルト値を解析
    fn parse_default_bool(&self, parts: &[&str]) -> Result<bool, String> {
        for i in 0..parts.len() {
            if parts[i] == "default" && i + 1 < parts.len() {
                return match parts[i + 1].to_lowercase().as_str() {
                    "true" => Ok(true),
                    "false" => Ok(false),
                    _ => Err("Invalid default boolean value".to_string()),
                };
            }
        }
        Ok(false) // デフォルトはfalse
    }

    /// スピン型のパラメータを解析
    fn parse_spin_params(&self, parts: &[&str]) -> Result<(i32, i32, i32), String> {
        let mut default = 0;
        let mut min = 0;
        let mut max = 100;

        let mut i = 0;
        while i < parts.len() {
            match parts[i] {
                "default" if i + 1 < parts.len() => {
                    default = parts[i + 1]
                        .parse()
                        .map_err(|_| "Invalid default integer")?;
                    i += 2;
                }
                "min" if i + 1 < parts.len() => {
                    min = parts[i + 1].parse().map_err(|_| "Invalid min integer")?;
                    i += 2;
                }
                "max" if i + 1 < parts.len() => {
                    max = parts[i + 1].parse().map_err(|_| "Invalid max integer")?;
                    i += 2;
                }
                _ => i += 1,
            }
        }

        Ok((default, min, max))
    }

    /// コンボ型のパラメータを解析
    fn parse_combo_params(&self, parts: &[&str]) -> Result<(String, Vec<String>), String> {
        let mut default = String::new();
        let mut options = Vec::new();

        let mut i = 0;
        while i < parts.len() {
            match parts[i] {
                "default" if i + 1 < parts.len() => {
                    default = parts[i + 1].to_string();
                    i += 2;
                }
                "var" if i + 1 < parts.len() => {
                    options.push(parts[i + 1].to_string());
                    i += 2;
                }
                _ => i += 1,
            }
        }

        Ok((default, options))
    }

    /// 文字列型のデフォルト値を解析
    fn parse_default_string(&self, parts: &[&str]) -> Result<String, String> {
        for i in 0..parts.len() {
            if parts[i] == "default" && i + 1 < parts.len() {
                return Ok(parts[i + 1].to_string());
            }
        }
        Ok(String::new()) // デフォルトは空文字列
    }

    /// オプション値を設定
    pub fn set_option(&mut self, name: &str, value: &str) -> Result<(), String> {
        let option = self
            .options
            .get_mut(name)
            .ok_or_else(|| format!("Option '{}' not found", name))?;

        let new_value = OptionValue::from_string(value, &option.option_type)?;
        option.current_value = new_value;
        Ok(())
    }

    /// オプション値を取得
    pub fn get_option(&self, name: &str) -> Option<&OptionValue> {
        self.options.get(name).map(|opt| &opt.current_value)
    }

    /// オプション定義を取得
    pub fn get_option_definition(&self, name: &str) -> Option<&EngineOption> {
        self.options.get(name)
    }

    /// 全オプションを取得
    pub fn get_all_options(&self) -> &HashMap<String, EngineOption> {
        &self.options
    }

    /// オプション名一覧を取得
    pub fn get_option_names(&self) -> Vec<String> {
        self.options.keys().cloned().collect()
    }

    /// USIコマンド形式でオプション設定を生成
    pub fn generate_set_option_command(&self, name: &str, value: &str) -> Result<String, String> {
        if !self.options.contains_key(name) {
            return Err(format!("Option '{}' not found", name));
        }

        // ボタン型の場合は値なし
        let option = &self.options[name];
        match option.option_type {
            OptionType::Button => Ok(format!("setoption name {}", name)),
            _ => Ok(format!("setoption name {} value {}", name, value)),
        }
    }

    /// デフォルト値にリセット
    pub fn reset_to_defaults(&mut self) {
        for option in self.options.values_mut() {
            option.current_value = match &option.option_type {
                OptionType::Check { default } => OptionValue::Bool(*default),
                OptionType::Spin { default, .. } => OptionValue::Int(*default),
                OptionType::Combo { default, .. } => OptionValue::String(default.clone()),
                OptionType::String { default } => OptionValue::String(default.clone()),
                OptionType::Button => OptionValue::None,
            };
        }
    }

    /// オプションをクリア
    pub fn clear(&mut self) {
        self.options.clear();
    }

    /// オプション数を取得
    pub fn len(&self) -> usize {
        self.options.len()
    }

    /// オプションが空かチェック
    pub fn is_empty(&self) -> bool {
        self.options.is_empty()
    }
}
