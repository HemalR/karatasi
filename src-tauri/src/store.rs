//! Markdown-file note store with an in-memory index and fuzzy search.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use nucleo_matcher::{
    pattern::{CaseMatching, Normalization, Pattern},
    Config, Matcher, Utf32Str,
};
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub modified: u64,
    pub created: u64,
}

#[derive(Clone, Serialize)]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub modified: u64,
}

#[derive(Clone, Serialize)]
pub struct Hit {
    pub id: String,
    pub title: String,
    pub snippet: String,
    pub modified: u64,
}

pub struct Store {
    pub dir: PathBuf,
    notes: HashMap<String, Note>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn to_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn title_of(content: &str) -> String {
    let line = content
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let t = line.trim_start_matches('#').trim();
    if t.is_empty() {
        "Untitled".to_string()
    } else {
        t.to_string()
    }
}

fn preview_of(content: &str) -> String {
    let mut lines = content.lines().map(str::trim).filter(|l| !l.is_empty());
    lines.next(); // title line
    let body = lines
        .next()
        .unwrap_or("")
        .trim_start_matches(|c: char| matches!(c, '#' | '-' | '*' | '>' | '[' | ']' | 'x' | ' '));
    truncate(body, 120)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{cut}…")
    }
}

pub fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.chars().flat_map(|c| c.to_lowercase()) {
        if c.is_alphanumeric() {
            out.push(c);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
        if out.chars().count() >= 60 {
            break;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "untitled".to_string()
    } else {
        out
    }
}

impl Store {
    pub fn open(dir: PathBuf) -> Store {
        let _ = fs::create_dir_all(&dir);
        let mut store = Store {
            dir,
            notes: HashMap::new(),
        };
        store.reload_all();
        store
    }

    pub fn path_of(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.md"))
    }

    fn is_note_path(&self, path: &Path) -> bool {
        path.parent() == Some(self.dir.as_path())
            && path.extension().map(|e| e == "md").unwrap_or(false)
            && !path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with('.'))
                .unwrap_or(true)
    }

    pub fn reload_all(&mut self) {
        self.notes.clear();
        let Ok(entries) = fs::read_dir(&self.dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if self.is_note_path(&path) {
                if let Some(note) = load_path(&path) {
                    self.notes.insert(note.id.clone(), note);
                }
            }
        }
    }

    /// Re-read one file after an external change. Returns the note id touched.
    pub fn reload_one(&mut self, path: &Path) -> Option<String> {
        if !self.is_note_path(path) {
            return None;
        }
        let id = path.file_stem()?.to_str()?.to_string();
        match load_path(path) {
            Some(note) => {
                self.notes.insert(id.clone(), note);
            }
            None => {
                self.notes.remove(&id);
            }
        }
        Some(id)
    }

    pub fn list(&self) -> Vec<NoteMeta> {
        let mut v: Vec<NoteMeta> = self
            .notes
            .values()
            .map(|n| NoteMeta {
                id: n.id.clone(),
                title: n.title.clone(),
                preview: preview_of(&n.content),
                modified: n.modified,
            })
            .collect();
        v.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.title.cmp(&b.title)));
        v
    }

    pub fn get(&self, id: &str) -> Option<Note> {
        self.notes.get(id).cloned()
    }

    fn unique_id(&self, base: &str, keep: Option<&str>) -> String {
        let taken = |id: &str| self.path_of(id).exists() && Some(id) != keep;
        if !taken(base) {
            return base.to_string();
        }
        (2..)
            .map(|n| format!("{base}-{n}"))
            .find(|c| !taken(c))
            .unwrap()
    }

    pub fn create(&mut self, title: Option<&str>) -> Result<Note, String> {
        let title = title.map(str::trim).filter(|t| !t.is_empty());
        let content = match title {
            Some(t) => format!("# {t}\n\n"),
            None => String::new(),
        };
        let id = self.unique_id(&slug(title.unwrap_or("untitled")), None);
        let path = self.path_of(&id);
        fs::write(&path, &content).map_err(|e| e.to_string())?;
        let note = load_path(&path).ok_or("could not read new note")?;
        self.notes.insert(id, note.clone());
        Ok(note)
    }

    /// Write content; rename the file when the title's slug changed. Returns the (possibly new) note.
    pub fn save(&mut self, id: &str, content: &str) -> Result<Note, String> {
        let path = self.path_of(id);
        fs::write(&path, content).map_err(|e| e.to_string())?;
        let title = title_of(content);
        let wanted = slug(&title);
        let mut final_path = path.clone();
        let mut final_id = id.to_string();
        // Only rename when the note has a real title and the slug drifted from the filename.
        if title != "Untitled" && !id_matches(id, &wanted) {
            let new_id = self.unique_id(&wanted, Some(id));
            let new_path = self.path_of(&new_id);
            if new_id != id && fs::rename(&path, &new_path).is_ok() {
                self.notes.remove(id);
                final_path = new_path;
                final_id = new_id;
            }
        }
        let note = load_path(&final_path).ok_or("could not re-read note")?;
        self.notes.insert(final_id, note.clone());
        Ok(note)
    }

    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        let path = self.path_of(id);
        let trash = self.dir.join(".trash");
        fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
        let target = trash.join(format!("{id}-{}.md", now_ms()));
        fs::rename(&path, &target).map_err(|e| e.to_string())?;
        self.notes.remove(id);
        Ok(())
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<Hit> {
        let query = query.trim();
        if query.is_empty() {
            return self
                .list()
                .into_iter()
                .take(limit)
                .map(|m| Hit {
                    id: m.id,
                    title: m.title,
                    snippet: m.preview,
                    modified: m.modified,
                })
                .collect();
        }
        let mut matcher = Matcher::new(Config::DEFAULT);
        let pattern = Pattern::parse(query, CaseMatching::Ignore, Normalization::Smart);
        let terms: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
        let mut buf = Vec::new();
        let mut scored: Vec<(i64, Hit)> = Vec::new();
        for note in self.notes.values() {
            let title_score = pattern.score(Utf32Str::new(&note.title, &mut buf), &mut matcher);
            let lower = note.content.to_lowercase();
            let content_hit = terms.iter().all(|t| lower.contains(t.as_str()));
            if title_score.is_none() && !content_hit {
                continue;
            }
            let mut score = title_score.map(|s| s as i64 * 4).unwrap_or(0);
            let snippet = if content_hit {
                score += 100 + (lower.matches(terms[0].as_str()).count().min(20) as i64) * 3;
                snippet_for(&note.content, &terms[0])
            } else {
                preview_of(&note.content)
            };
            scored.push((
                score,
                Hit {
                    id: note.id.clone(),
                    title: note.title.clone(),
                    snippet,
                    modified: note.modified,
                },
            ));
        }
        scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.modified.cmp(&a.1.modified)));
        scored.into_iter().take(limit).map(|(_, h)| h).collect()
    }
}

fn id_matches(id: &str, wanted: &str) -> bool {
    id == wanted
        || id
            .strip_prefix(wanted)
            .map(|rest| rest.starts_with('-') && rest[1..].chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false)
}

fn load_path(path: &Path) -> Option<Note> {
    let content = fs::read_to_string(path).ok()?;
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().map(to_ms).unwrap_or_else(|_| now_ms());
    let created = meta.created().map(to_ms).unwrap_or(modified);
    Some(Note {
        id: path.file_stem()?.to_str()?.to_string(),
        title: title_of(&content),
        content,
        modified,
        created,
    })
}

/// A ~110 char window of the first body line containing `term` (case-insensitive).
fn snippet_for(content: &str, term: &str) -> String {
    let mut lines = content.lines().map(str::trim).filter(|l| !l.is_empty());
    let title_line = lines.next().unwrap_or("");
    let line = lines
        .find(|l| l.to_lowercase().contains(term))
        .or_else(|| title_line.to_lowercase().contains(term).then_some(title_line))
        .unwrap_or("");
    let line = line.trim_start_matches(|c: char| matches!(c, '#' | '-' | '*' | '>' | ' '));
    let lower = line.to_lowercase();
    let pos = lower.find(term).unwrap_or(0);
    let chars: Vec<char> = line.chars().collect();
    let char_pos = line[..pos].chars().count();
    let start = char_pos.saturating_sub(40);
    let end = (start + 110).min(chars.len());
    let mut s: String = chars[start..end].iter().collect();
    if start > 0 {
        s = format!("…{s}");
    }
    if end < chars.len() {
        s.push('…');
    }
    s
}
