//! Finding the EFT install's Logs folder.

use std::path::{Path, PathBuf};

/// "log_2026.11.20_21-44-48_1.0.0.0" -> sortable (y, m, d, h, min, s).
pub fn log_folder_timestamp(name: &str) -> Option<(u32, u32, u32, u32, u32, u32)> {
    let rest = &name[name.find("log_")? + 4..];
    let (date, time) = rest.split_once('_')?;
    let mut d = date.split('.').map(|p| p.parse::<u32>().ok());
    let (y, mo, da) = (d.next()??, d.next()??, d.next()??);
    let time = time.split('_').next()?;
    let mut t = time.split('-').map(|p| p.parse::<u32>().ok());
    let (h, mi, s) = (t.next()??, t.next()??, t.next()??);
    Some((y, mo, da, h, mi, s))
}

/// Paths listed in Steam's libraryfolders.vdf ("path"  "D:\\SteamLibrary").
pub fn parse_library_folders(vdf: &str) -> Vec<PathBuf> {
    vdf.lines()
        .filter_map(|line| {
            let line = line.trim();
            let rest = line.strip_prefix("\"path\"")?.trim();
            let value = rest.strip_prefix('"')?.strip_suffix('"')?;
            Some(PathBuf::from(value.replace("\\\\", "\\")))
        })
        .collect()
}

fn logs_in(install: &Path) -> Option<PathBuf> {
    [install.join("Logs"), install.join("build").join("Logs")]
        .into_iter()
        .find(|p| p.is_dir())
}

#[cfg(windows)]
fn install_candidates() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let read = |root, key: &str, value: &str| -> Option<String> {
        RegKey::predef(root).open_subkey(key).ok()?.get_value::<String, _>(value).ok()
    };
    let mut out = Vec::new();
    for key in [
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\EscapeFromTarkov",
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\EscapeFromTarkov",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 3932890",
    ] {
        if let Some(loc) = read(HKEY_LOCAL_MACHINE, key, "InstallLocation") {
            out.push(PathBuf::from(loc));
        }
    }
    let steam = read(HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath")
        .or_else(|| read(HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"));
    if let Some(steam) = steam {
        let steam = PathBuf::from(steam);
        let mut libs = std::fs::read_to_string(steam.join("steamapps").join("libraryfolders.vdf"))
            .map(|v| parse_library_folders(&v))
            .unwrap_or_default();
        if libs.is_empty() {
            libs.push(steam);
        }
        for lib in libs {
            out.push(lib.join("steamapps").join("common").join("Escape from Tarkov"));
        }
    }
    out
}

#[cfg(not(windows))]
fn install_candidates() -> Vec<PathBuf> {
    Vec::new()
}

/// Best-effort search for "<EFT install>/Logs".
pub fn find_logs_folder() -> Option<PathBuf> {
    let mut candidates = install_candidates();
    candidates.push(PathBuf::from(r"C:\Battlestate Games\Escape from Tarkov"));
    candidates.push(PathBuf::from(r"C:\Battlestate Games\EFT"));
    candidates.iter().find_map(|c| logs_in(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_folder_names() {
        assert_eq!(log_folder_timestamp("log_2026.11.20_21-44-48_1.0.0.0"), Some((2026, 11, 20, 21, 44, 48)));
        assert_eq!(log_folder_timestamp("log_2026.11.20_9-05-01_1.0"), Some((2026, 11, 20, 9, 5, 1)));
        assert!(log_folder_timestamp("log_2026.11.20_9-05-01_1.0") < log_folder_timestamp("log_2026.11.20_21-44-48_1.0"));
        assert_eq!(log_folder_timestamp("random"), None);
    }

    #[test]
    fn parses_steam_library_folders() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}";
        assert_eq!(
            parse_library_folders(vdf),
            vec![PathBuf::from(r"C:\Program Files (x86)\Steam"), PathBuf::from(r"D:\SteamLibrary")]
        );
    }
}
