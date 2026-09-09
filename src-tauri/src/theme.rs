//! Reads the active Omarchy theme so the UI matches the rest of the desktop.

use std::{collections::HashMap, fs, path::PathBuf};

use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct Theme {
    pub name: String,
    pub mode: String,
    pub colors: HashMap<String, String>,
    pub font: String,
    pub font_size: u32,
    /// `[keys]` from the config file: action name to one or more chords ("Ctrl+Shift+Backspace").
    /// The frontend owns the defaults and the matching; only overrides travel here.
    pub keys: HashMap<String, Vec<String>>,
}

pub fn state_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".local/state/omarchy/current")
}

#[derive(Default)]
pub struct Config {
    pub notes_dir: Option<PathBuf>,
    pub font: Option<String>,
    pub font_size: Option<u32>,
    pub keys: HashMap<String, Vec<String>>,
}

pub fn config_path() -> PathBuf {
    dirs::config_dir().unwrap_or_default().join("karatasi/config.toml")
}

/// Optional ~/.config/karatasi/config.toml: notes_dir, font, font_size and a `[keys]` table.
pub fn config() -> Config {
    let Ok(text) = fs::read_to_string(config_path()) else { return Config::default() };
    let Ok(table) = text.parse::<toml::Table>() else { return Config::default() };
    Config {
        notes_dir: table
            .get("notes_dir")
            .and_then(|v| v.as_str())
            .map(expand_home),
        font: table.get("font").and_then(|v| v.as_str()).map(String::from),
        font_size: table
            .get("font_size")
            .and_then(|v| v.as_integer())
            .map(|n| n as u32),
        keys: table
            .get("keys")
            .and_then(|v| v.as_table())
            .map(|keys| {
                keys.iter()
                    .filter_map(|(name, v)| chords_of(v).map(|c| (name.clone(), c)))
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// A chord setting is a string or an array of strings; anything else is ignored.
fn chords_of(v: &toml::Value) -> Option<Vec<String>> {
    let list: Vec<String> = match v {
        toml::Value::String(s) => vec![s.clone()],
        toml::Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        _ => return None,
    };
    let list: Vec<String> = list.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    (!list.is_empty()).then_some(list)
}

fn expand_home(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        dirs::home_dir().unwrap_or_default().join(rest)
    } else {
        PathBuf::from(p)
    }
}

fn read_trimmed(path: PathBuf) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn load() -> Theme {
    let state = state_dir();
    let name = read_trimmed(state.join("theme.name")).unwrap_or_default();
    let home = dirs::home_dir().unwrap_or_default();
    let candidates = [
        state.join("theme/colors.toml"),
        home.join(format!(".config/omarchy/themes/{name}/colors.toml")),
        PathBuf::from(format!("/usr/share/omarchy/themes/{name}/colors.toml")),
    ];
    let mut colors = HashMap::new();
    let mut mode = "dark".to_string();
    for path in candidates {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(table) = text.parse::<toml::Table>() else { continue };
        for (k, v) in table.iter() {
            if let Some(s) = v.as_str() {
                if k == "mode" {
                    mode = s.to_string();
                } else {
                    colors.insert(k.clone(), s.to_string());
                }
            }
        }
        break;
    }
    let cfg = config();
    let font = cfg
        .font
        .or_else(|| read_trimmed(state.join("font.name")))
        .unwrap_or_else(|| "JetBrainsMono Nerd Font".to_string());
    Theme {
        name,
        mode,
        colors,
        font,
        font_size: cfg.font_size.unwrap_or(16),
        keys: cfg.keys,
    }
}
