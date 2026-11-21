//! Follows EFT's Logs folder and streams raw text to the UI, which parses it
//! (src/shared/logStream.ts). On start it replays every folder's notifications log so
//! quest state can be rebuilt, then tails the newest folder every 2 seconds.

use crate::paths::log_folder_timestamp;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LogChunk {
    pub file: String,
    pub kind: &'static str,
    pub text: String,
    pub replay: bool,
    pub reset: bool,
}

pub fn kind_of(name: &str) -> Option<&'static str> {
    let n = name.to_ascii_lowercase();
    if n.ends_with("application.log") || n.ends_with("application_000.log") {
        Some("application")
    } else if n.ends_with("notifications.log") || n.ends_with("notifications_000.log") {
        Some("notifications")
    } else {
        None
    }
}

fn folders(root: &Path) -> Vec<PathBuf> {
    let mut v: Vec<_> = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let ts = log_folder_timestamp(&e.file_name().to_string_lossy())?;
            e.path().is_dir().then(|| (ts, e.path()))
        })
        .collect();
    v.sort();
    v.into_iter().map(|(_, p)| p).collect()
}

fn log_files(folder: &Path) -> Vec<(PathBuf, &'static str)> {
    std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| Some((e.path(), kind_of(&e.file_name().to_string_lossy())?)))
        .collect()
}

/// Reads complete lines from `offset`; returns the text and the new offset.
/// Stops at the last newline so a half-written line (or UTF-8 character) is never split.
fn read_from(path: &Path, offset: u64) -> std::io::Result<(String, u64)> {
    let mut f = File::open(path)?;
    let len = f.metadata()?.len();
    if len <= offset {
        return Ok((String::new(), offset));
    }
    f.seek(SeekFrom::Start(offset))?;
    let mut buf = Vec::with_capacity((len - offset) as usize);
    f.take(len - offset).read_to_end(&mut buf)?;
    let end = match buf.iter().rposition(|&b| b == b'\n') {
        Some(i) => i + 1,
        None => return Ok((String::new(), offset)),
    };
    buf.truncate(end);
    Ok((String::from_utf8_lossy(&buf).into_owned(), offset + end as u64))
}

/// The tailing state machine, separate from threads and Tauri so it can be tested.
pub struct Tailer {
    root: PathBuf,
    current: Option<PathBuf>,
    offsets: HashMap<PathBuf, u64>,
}

impl Tailer {
    pub fn new(root: PathBuf) -> Self {
        Self { root, current: None, offsets: HashMap::new() }
    }

    /// Start following the newest folder. Quest history comes from `history::load`, so
    /// existing notifications are skipped; the application log is read for raid/mode state.
    pub fn start(&mut self, emit: &mut impl FnMut(LogChunk)) {
        if let Some(latest) = folders(&self.root).pop() {
            self.follow(latest, true, emit);
        }
    }

    /// The application log is read from the start (raid state); on the initial folder
    /// notifications are skipped to the end because history already covers them.
    fn follow(&mut self, folder: PathBuf, initial: bool, emit: &mut impl FnMut(LogChunk)) {
        self.current = Some(folder.clone());
        self.offsets.clear();
        for (path, kind) in log_files(&folder) {
            self.add(path, kind, initial, emit);
        }
    }

    fn add(&mut self, path: PathBuf, kind: &'static str, initial: bool, emit: &mut impl FnMut(LogChunk)) {
        if initial && kind == "notifications" {
            let len = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            // Remember the offset at the last complete line.
            let off = read_from(&path, 0).map(|(_, o)| o).unwrap_or(len);
            self.offsets.insert(path, off);
            return;
        }
        self.offsets.insert(path.clone(), 0);
        self.read(&path, kind, initial, true, emit);
    }

    fn read(&mut self, path: &Path, kind: &'static str, replay: bool, mut reset: bool, emit: &mut impl FnMut(LogChunk)) {
        let mut offset = self.offsets.get(path).copied().unwrap_or(0);
        let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if len < offset {
            offset = 0; // truncated or rotated
            reset = true;
        }
        if let Ok((text, next)) = read_from(path, offset) {
            self.offsets.insert(path.to_path_buf(), next);
            if !text.is_empty() {
                emit(LogChunk { file: path.to_string_lossy().into(), kind, text, replay, reset });
            }
        }
    }

    /// One polling step: switch to a newer folder, pick up new files, read new lines.
    pub fn poll(&mut self, emit: &mut impl FnMut(LogChunk)) {
        let latest = folders(&self.root).pop();
        if latest.is_some() && latest != self.current {
            self.follow(latest.unwrap(), false, emit);
            return;
        }
        let Some(folder) = self.current.clone() else { return };
        for (path, kind) in log_files(&folder) {
            if self.offsets.contains_key(&path) {
                self.read(&path, kind, false, false, emit);
            } else {
                self.add(path, kind, false, emit);
            }
        }
    }
}

/// Keeps polling an already-started tailer on a background thread until `generation`
/// moves on (the user picked another Logs folder).
pub fn spawn(mut tailer: Tailer, generation: Arc<AtomicU64>, mut emit: impl FnMut(LogChunk) + Send + 'static) {
    let mine = generation.load(Ordering::SeqCst);
    std::thread::spawn(move || {
        while generation.load(Ordering::SeqCst) == mine {
            std::thread::sleep(Duration::from_secs(2));
            if generation.load(Ordering::SeqCst) != mine {
                break;
            }
            tailer.poll(&mut emit);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, OpenOptions};
    use std::io::Write;

    fn quest(time: &str, id: &str) -> String {
        format!("{time}|1.0|Info|push-notifications|Got notification | ChatMessageReceived\n{{\n  \"message\": {{ \"type\": 10, \"templateId\": \"{id} x\" }}\n}}\n")
    }

    #[test]
    fn follows_newest_session_and_tails_new_lines() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("log_2026.11.19_10-00-00_1.0.0.0");
        let cur = dir.path().join("log_2026.11.20_10-00-00_1.0.0.0");
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&cur).unwrap();
        fs::write(old.join("x notifications_000.log"), quest("2026-11-19 10:00:00.000", "taskA")).unwrap();
        let notif = cur.join("x notifications_000.log");
        let app = cur.join("x application_000.log");
        fs::write(&notif, quest("2026-11-20 10:00:00.000", "taskB")).unwrap();
        fs::write(&app, "2026-11-20 10:01:00.000|1.0|Debug|application|GameStarted\npartial line without newline").unwrap();

        let mut got = Vec::new();
        let mut t = Tailer::new(dir.path().to_path_buf());
        t.start(&mut |c| got.push(c));

        // Only the newest session's application log is read (complete lines); existing
        // notifications are history and are skipped.
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].kind, "application");
        assert!(got[0].replay);
        assert_eq!(got[0].text, "2026-11-20 10:01:00.000|1.0|Debug|application|GameStarted\n");

        got.clear();
        OpenOptions::new().append(true).open(&notif).unwrap().write_all(quest("2026-11-20 10:30:00.000", "taskC").as_bytes()).unwrap();
        OpenOptions::new().append(true).open(&app).unwrap().write_all(b" finished\n").unwrap();
        t.poll(&mut |c| got.push(c));
        assert_eq!(got.len(), 2);
        let n = got.iter().find(|c| c.kind == "notifications").unwrap();
        assert!(n.text.contains("taskC") && !n.text.contains("taskB") && !n.replay);
        let a = got.iter().find(|c| c.kind == "application").unwrap();
        assert_eq!(a.text, "partial line without newline finished\n");
    }

    #[test]
    fn switches_to_a_new_session_folder() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("log_2026.11.20_10-00-00_1.0.0.0");
        fs::create_dir_all(&first).unwrap();
        let mut t = Tailer::new(dir.path().to_path_buf());
        t.start(&mut |_| {});

        let second = dir.path().join("log_2026.11.20_12-00-00_1.0.0.0");
        fs::create_dir_all(&second).unwrap();
        fs::write(second.join("y application_000.log"), "2026-11-20 12:00:01.000|1.0|Info|application|GameStarted\n").unwrap();
        let mut got = Vec::new();
        t.poll(&mut |c| got.push(c));
        assert_eq!(got.len(), 1);
        assert!(got[0].reset && !got[0].replay);
    }

    #[test]
    fn restarts_a_truncated_file() {
        let dir = tempfile::tempdir().unwrap();
        let cur = dir.path().join("log_2026.11.20_10-00-00_1.0.0.0");
        fs::create_dir_all(&cur).unwrap();
        let app = cur.join("z application.log");
        fs::write(&app, "2026-11-20 10:00:00.000|a|one\n2026-11-20 10:00:01.000|a|two\n").unwrap();
        let mut t = Tailer::new(dir.path().to_path_buf());
        t.start(&mut |_| {});
        fs::write(&app, "2026-11-20 11:00:00.000|a|new\n").unwrap();
        let mut got = Vec::new();
        t.poll(&mut |c| got.push(c));
        assert_eq!(got.len(), 1);
        assert!(got[0].reset);
        assert_eq!(got[0].text, "2026-11-20 11:00:00.000|a|new\n");
    }
}
