//! Quest history from all of EFT's log folders, tagged with the game mode it happened in.
//!
//! PvP, PvP Season and PvE are separate profiles with separate quest progress, and one Logs
//! folder holds sessions of all of them. Each session's application log states its mode
//! ("Session mode: Regular | PvpSeason | Pve"); quest events in the notifications log take the
//! mode in effect at their timestamp. Only quest events leave this module, not the raw
//! logs (which reach 100+ MB), and finished sessions are cached in an index so each one is read once.

use crate::logs::kind_of;
use crate::paths::log_folder_timestamp;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestEvent {
    pub task_id: String,
    pub status: String, // started | finished | failed
    pub time: String,   // same format the UI parser produces: 2026-11-20T10:00:00.000(+01:00)
    pub mode: String,   // regular | season | pve
}

/// A prestige: the profile of `mode` starts over at `time`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prestige {
    pub time: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderScan {
    pub events: Vec<QuestEvent>,
    pub last_mode: Option<String>,
    #[serde(default)]
    pub prestiges: Vec<Prestige>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestHistory {
    pub events: Vec<QuestEvent>,
    pub prestiges: Vec<Prestige>,
    /// Mode of the most recent session: what the player is on now.
    pub current_mode: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct Index {
    version: u32,
    folders: BTreeMap<String, FolderScan>,
}
const INDEX_VERSION: u32 = 2; // 2: prestiges

pub fn normalize_mode(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "pve" => "pve",
        "pvpseason" | "seasonal" | "szn" => "season",
        _ => "regular", // "Regular", "PVP"
    }
}

/// "2026-11-20 10:00:00.000 +01:00|..." -> ("2026-11-20 10:00:00.000", "2026-11-20T10:00:00.000+01:00")
fn line_time(line: &str) -> Option<(&str, String)> {
    let stamp = line.get(..23)?;
    let b = stamp.as_bytes();
    if !(b[4] == b'-' && b[10] == b' ' && b[13] == b':' && b[19] == b'.' && b[0].is_ascii_digit()) {
        return None;
    }
    let rest = &line[23..];
    let tz = rest.split('|').next().unwrap_or("").trim();
    Some((stamp, format!("{}T{}{}", &stamp[..10], &stamp[11..], tz)))
}

fn mode_changes(app_log: &str) -> Vec<(String, &'static str)> {
    const MARK: &str = "|application|Session mode: ";
    app_log
        .lines()
        .filter_map(|l| {
            let at = l.find(MARK)?;
            let (sort_key, _) = line_time(l)?;
            let raw = l[at + MARK.len()..].split(['|', ' ']).next().unwrap_or("");
            Some((sort_key.to_string(), normalize_mode(raw)))
        })
        .collect()
}

/// Which profile a prestige line is for: the PvE server says PvE; otherwise the PvP mode in effect.
fn prestige_mode(line: &str, modes: &[(String, &'static str)], key: &str, carry: Option<&str>) -> &'static str {
    if line.contains("://gw-pve.") {
        return "pve";
    }
    let m = modes.iter().rev().find(|(t, _)| t.as_str() <= key).map(|(_, m)| *m).or_else(|| carry.map(normalize_mode));
    match m {
        Some("season") => "season",
        _ => "regular",
    }
}

/// Quest events (type 10/11/12 chat notifications) with their sortable time.
fn quest_events(notifications: &str) -> Vec<(String, String, String, String)> {
    let mut out = Vec::new();
    let mut lines = notifications.lines().peekable();
    while let Some(line) = lines.next() {
        if !line.contains("Got notification | ChatMessageReceived") {
            continue;
        }
        let Some((sort_key, iso)) = line_time(line) else { continue };
        if !lines.peek().is_some_and(|l| l.starts_with('{')) {
            continue;
        }
        let mut json = String::new();
        for l in lines.by_ref() {
            json.push_str(l);
            json.push('\n');
            if l == "}" {
                break;
            }
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) else { continue };
        let status = match v["message"]["type"].as_i64() {
            Some(10) => "started",
            Some(11) => "failed",
            Some(12) => "finished",
            _ => continue,
        };
        let Some(task_id) = v["message"]["templateId"].as_str().and_then(|t| t.split(' ').next()) else { continue };
        if !task_id.is_empty() {
            out.push((sort_key.to_string(), iso, task_id.to_string(), status.to_string()));
        }
    }
    out
}

fn read_all(folder: &Path, kind: &str) -> String {
    let mut files: Vec<PathBuf> = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| kind_of(&e.file_name().to_string_lossy()) == Some(kind))
        .map(|e| e.path())
        .collect();
    files.sort();
    files.iter().filter_map(|f| std::fs::read(f).ok()).map(|b| String::from_utf8_lossy(&b).into_owned()).collect()
}

/// One game session (log folder). `carry_mode` is the previous session's last mode, used if
/// this one never states its own.
pub fn scan_folder(folder: &Path, carry_mode: Option<&str>) -> FolderScan {
    let modes = mode_changes(&read_all(folder, "application"));
    let events = quest_events(&read_all(folder, "notifications"))
        .into_iter()
        .map(|(key, time, task_id, status)| {
            let mode = modes
                .iter()
                .rev()
                .find(|(t, _)| t.as_str() <= key.as_str())
                .map(|(_, m)| *m)
                .or_else(|| modes.first().map(|(_, m)| *m)) // event logged before the mode line
                .or(carry_mode)
                .unwrap_or("regular");
            QuestEvent { task_id, status, time, mode: mode.to_string() }
        })
        .collect();
    let last_mode = modes.last().map(|(_, m)| m.to_string()).or(carry_mode.map(str::to_string));
    let prestiges = crate::logs::prestige_lines(&read_all(folder, "backend"))
        .lines()
        .filter_map(|l| {
            let (key, time) = line_time(l)?;
            Some(Prestige { mode: prestige_mode(l, &modes, key, carry_mode).to_string(), time })
        })
        .collect();
    FolderScan { events, last_mode, prestiges }
}

/// Scans every session, reusing `index_file` for sessions already read. The newest session
/// is always re-read because the game may still be writing to it.
pub fn load(logs_root: &Path, index_file: &Path) -> QuestHistory {
    let mut index: Index = std::fs::read_to_string(index_file)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .filter(|i: &Index| i.version == INDEX_VERSION)
        .unwrap_or_default();

    let mut folders: Vec<(_, String, PathBuf)> = std::fs::read_dir(logs_root)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let ts = log_folder_timestamp(&name)?;
            e.path().is_dir().then(|| (ts, name, e.path()))
        })
        .collect();
    folders.sort();

    let mut events = Vec::new();
    let mut prestiges = Vec::new();
    let mut carry: Option<String> = None;
    let mut changed = false;
    let last = folders.len().saturating_sub(1);
    for (i, (_, name, path)) in folders.iter().enumerate() {
        let scan = match index.folders.get(name) {
            Some(s) if i != last => s.clone(),
            _ => {
                let s = scan_folder(path, carry.as_deref());
                if i != last {
                    index.folders.insert(name.clone(), s.clone());
                    changed = true;
                }
                s
            }
        };
        carry = scan.last_mode.clone().or(carry);
        events.extend(scan.events);
        prestiges.extend(scan.prestiges);
    }
    // Forget sessions EFT has deleted.
    let before = index.folders.len();
    index.folders.retain(|name, _| folders.iter().any(|(_, n, _)| n == name));
    if changed || index.folders.len() != before {
        index.version = INDEX_VERSION;
        if let Ok(text) = serde_json::to_string(&index) {
            let _ = std::fs::write(index_file, text);
        }
    }
    QuestHistory { events, prestiges, current_mode: carry }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn quest(time: &str, ty: u8, id: &str) -> String {
        format!("{time} +01:00|1.0|Info|push-notifications|Got notification | ChatMessageReceived\n{{\n  \"message\": {{ \"type\": {ty}, \"templateId\": \"{id} description\" }}\n}}\n")
    }
    fn mode(time: &str, m: &str) -> String {
        format!("{time} +01:00|1.0|Info|application|Session mode: {m}\n")
    }

    #[test]
    fn tags_events_with_the_session_mode_in_effect() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("log_2026.11.20_10-00-00_1.0");
        fs::create_dir_all(&f).unwrap();
        fs::write(f.join("a application_000.log"), mode("2026-11-20 10:00:01.000", "Regular") + &mode("2026-11-20 11:00:00.000", "Pve")).unwrap();
        fs::write(
            f.join("a notifications_000.log"),
            quest("2026-11-20 10:30:00.000", 10, "pvpQuest")
                + &quest("2026-11-20 11:30:00.000", 12, "pveQuest")
                + "2026-11-20 11:31:00.000 +01:00|1.0|Info|x|Got notification | ChatMessageReceived\n{\n  \"message\": { \"type\": 1, \"text\": \"player chat\" }\n}\n",
        )
        .unwrap();
        let s = scan_folder(&f, None);
        assert_eq!(
            s.events,
            vec![
                QuestEvent { task_id: "pvpQuest".into(), status: "started".into(), time: "2026-11-20T10:30:00.000+01:00".into(), mode: "regular".into() },
                QuestEvent { task_id: "pveQuest".into(), status: "finished".into(), time: "2026-11-20T11:30:00.000+01:00".into(), mode: "pve".into() },
            ]
        );
        assert_eq!(s.last_mode.as_deref(), Some("pve"));
    }

    #[test]
    fn finds_prestiges_and_their_profile() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("log_2026.10.07_19-43-47_1.2");
        fs::create_dir_all(&f).unwrap();
        fs::write(f.join("a application_000.log"), mode("2026-10-07 19:44:00.000", "PvpSeason")).unwrap();
        let line = |t: &str, host: &str, dir: &str| format!("{t}|1.2|Info|backend|{dir} HTTPS, id [96]: URL: https://{host}.escapefromtarkov.com/client/prestige/obtain, x\n");
        fs::write(
            f.join("a backend_000.log"),
            line("2026-10-07 19:48:24.479", "gw-pve", "--->") // the request alone doesn't count
                + &line("2026-10-07 19:48:25.021", "gw-pve", "<--- Response")
                + &line("2026-10-07 20:10:00.000", "gw-pvp", "<--- Response")
                + "2026-10-07 20:11:00.000|1.2|Info|backend|<--- Response HTTPS, id [97]: URL: https://gw-pvp.escapefromtarkov.com/client/prestige/list, x\n",
        )
        .unwrap();
        let s = scan_folder(&f, None);
        assert_eq!(
            s.prestiges,
            vec![
                Prestige { time: "2026-10-07T19:48:25.021".into(), mode: "pve".into() },
                Prestige { time: "2026-10-07T20:10:00.000".into(), mode: "season".into() },
            ]
        );
    }

    #[test]
    fn indexes_finished_sessions_and_rereads_the_newest() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("Logs");
        let old = logs.join("log_2026.11.19_10-00-00_1.0");
        let cur = logs.join("log_2026.11.20_10-00-00_1.0");
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&cur).unwrap();
        fs::write(old.join("application.log"), mode("2026-11-19 10:00:00.000", "PvpSeason")).unwrap();
        fs::write(old.join("notifications.log"), quest("2026-11-19 10:05:00.000", 12, "a")).unwrap();
        // The newest session never states a mode: it carries over from the previous one.
        fs::write(cur.join("notifications.log"), quest("2026-11-20 10:05:00.000", 10, "b")).unwrap();
        let index = dir.path().join("index.json");

        let h = load(&logs, &index);
        assert_eq!(h.current_mode.as_deref(), Some("season"));
        assert_eq!(h.events.iter().map(|e| (e.task_id.as_str(), e.mode.as_str())).collect::<Vec<_>>(), vec![("a", "season"), ("b", "season")]);
        assert!(index.exists());

        // Old session comes from the index now (deleting it proves it isn't re-read)…
        fs::remove_file(old.join("notifications.log")).unwrap();
        // …while the newest is re-read and picks up new lines.
        fs::write(cur.join("notifications.log"), quest("2026-11-20 10:05:00.000", 10, "b") + &quest("2026-11-20 10:06:00.000", 12, "b")).unwrap();
        let h2 = load(&logs, &index);
        assert_eq!(h2.events.len(), 3);
        assert_eq!(h2.events[0].task_id, "a");
    }

    #[test]
    fn maps_mode_names() {
        assert_eq!(normalize_mode("Regular"), "regular");
        assert_eq!(normalize_mode("PVP"), "regular");
        assert_eq!(normalize_mode("Pve"), "pve");
        assert_eq!(normalize_mode("PvpSeason"), "season");
    }
}

/// Opt-in check against a real Logs folder: TQO_REAL_LOGS=<path> cargo test real_logs -- --ignored --nocapture
#[cfg(test)]
#[test]
#[ignore]
fn real_logs() {
    let Some(root) = std::env::var_os("TQO_REAL_LOGS") else { return };
    let dir = tempfile::tempdir().unwrap();
    let index = dir.path().join("index.json");
    for pass in ["first scan", "cached"] {
        let t = std::time::Instant::now();
        let h = load(Path::new(&root), &index);
        let mut by_mode: BTreeMap<&str, usize> = BTreeMap::new();
        for e in &h.events {
            *by_mode.entry(e.mode.as_str()).or_default() += 1;
        }
        println!("{pass}: {:?} · {} events {:?} · current mode {:?}", t.elapsed(), h.events.len(), by_mode, h.current_mode);
        if let Some(out) = std::env::var_os("TQO_HISTORY_OUT") {
            std::fs::write(out, serde_json::to_string(&h).unwrap()).unwrap();
        }
    }
}
