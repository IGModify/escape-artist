//! settings.json in the app data folder. Stored as loose JSON so the UI owns the schema;
//! the native side only reads the window-related keys.

use serde_json::{json, Map, Value};
use std::path::PathBuf;

pub fn defaults() -> Value {
    json!({
        "mode": "overlay",
        "clickThrough": false,
        "opacity": 0.92,
        "logsPath": null,
        "screenshotsPath": null,
        "faction": "pmc",
        "routeToExtract": true,
        "questPhotos": true,
        "deleteScreenshots": true,
        "markerColors": {},
        "manualQuests": {},
        "gameMode": "auto",
        "questResetAt": {},
        "hiddenQuests": [],
        "showStory": false,
        "storyDone": {},
        "storyStarted": {},
        "objectivesDone": {}
    })
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub struct Settings {
    file: PathBuf,
    pub value: Value,
}

impl Settings {
    pub fn load(file: PathBuf) -> Self {
        let mut value = defaults();
        if let Ok(text) = std::fs::read_to_string(&file) {
            if let Ok(Value::Object(saved)) = serde_json::from_str::<Value>(&text) {
                merge(&mut value, Value::Object(saved));
            }
        }
        Self { file, value }
    }

    pub fn save(&self) {
        if let Some(dir) = self.file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&self.file, serde_json::to_string_pretty(&self.value).unwrap_or_default());
    }

    pub fn patch(&mut self, patch: Value) {
        merge(&mut self.value, patch);
    }

    pub fn overlay(&self) -> bool {
        self.value["mode"] != "windowed"
    }

    pub fn click_through(&self) -> bool {
        self.overlay() && self.value["clickThrough"] == true
    }

    fn bounds_key(&self) -> &'static str {
        if self.overlay() { "overlayBounds" } else { "windowedBounds" }
    }

    pub fn bounds(&self) -> Option<Bounds> {
        let b = &self.value[self.bounds_key()];
        Some(Bounds {
            x: b["x"].as_f64()?,
            y: b["y"].as_f64()?,
            width: b["width"].as_f64()?,
            height: b["height"].as_f64()?,
        })
    }

    pub fn set_bounds(&mut self, b: Bounds) {
        let key = self.bounds_key();
        self.value[key] = json!({ "x": b.x, "y": b.y, "width": b.width, "height": b.height });
    }
}

/// Shallow merge of top-level keys (nested objects such as manualQuests are replaced whole).
fn merge(target: &mut Value, patch: Value) {
    if let (Value::Object(t), Value::Object(p)) = (target, patch) {
        let t: &mut Map<String, Value> = t;
        for (k, v) in p {
            t.insert(k, v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_defaults_merges_and_keeps_bounds_per_mode() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Settings::load(dir.path().join("settings.json"));
        assert!(s.overlay());
        s.set_bounds(Bounds { x: 1.0, y: 2.0, width: 420.0, height: 640.0 });
        s.patch(json!({ "mode": "windowed", "clickThrough": true }));
        assert!(!s.click_through(), "click-through only applies to the overlay");
        assert_eq!(s.bounds(), None);
        s.save();

        let s2 = Settings::load(dir.path().join("settings.json"));
        assert_eq!(s2.value["mode"], "windowed");
        assert_eq!(s2.value["faction"], "pmc");
        assert_eq!(s2.value["overlayBounds"]["width"], 420.0);
    }
}
