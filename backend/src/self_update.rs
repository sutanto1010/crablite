use std::io::stdin;
use std::path::{Path, PathBuf};

const REPO: &str = "sutanto1010/crablite";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const SKIP_DOCKER_ENV: &str = "CRAVLITE_SKIP_DOCKER_CHECK";

#[derive(Debug, Clone)]
pub struct ReleaseAsset {
    pub name: String,
    pub download_url: String,
}

#[derive(Debug, Clone)]
pub struct ReleaseInfo {
    pub tag: String,
    pub version: String,
    pub assets: Vec<ReleaseAsset>,
}

fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |s: &str| {
        s.trim()
            .trim_start_matches('v')
            .split('.')
            .map(|p| {
                p.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse::<u64>()
                    .unwrap_or(0)
            })
            .collect::<Vec<_>>()
    };
    let av = parse(a);
    let bv = parse(b);
    let len = av.len().max(bv.len());
    for i in 0..len {
        let x = *av.get(i).unwrap_or(&0);
        let y = *bv.get(i).unwrap_or(&0);
        match x.cmp(&y) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    compare_versions(latest, current) == std::cmp::Ordering::Greater
}

pub fn in_docker() -> bool {
    if std::env::var_os(SKIP_DOCKER_ENV).is_some() {
        return false;
    }
    if Path::new("/.dockerenv").exists() {
        return true;
    }
    if let Ok(cgroup) = std::fs::read_to_string("/proc/1/cgroup") {
        if cgroup.contains("docker") || cgroup.contains("kubepods") {
            return true;
        }
    }
    false
}

/// Pick the release asset matching this OS/arch.
/// Release assets look like `crablite-v<VERSION>-<TARGET>.tar.gz|.zip`.
pub fn pick_asset(assets: &[ReleaseAsset]) -> Option<ReleaseAsset> {
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;

    let candidates: Vec<String> = match (os, arch) {
        ("linux", "x86_64") => vec!["x86_64-unknown-linux-musl".into()],
        ("linux", "aarch64") => vec!["aarch64-unknown-linux-musl".into()],
        ("windows", "x86_64") => vec!["x86_64-pc-windows-gnu".into()],
        ("windows", "aarch64") => vec!["aarch64-pc-windows-gnullvm".into()],
        ("macos", "aarch64") => vec!["aarch64-apple-darwin".into()],
        ("macos", "x86_64") => vec!["x86_64-apple-darwin".into()],
        _ => vec![format!("{arch}-{os}"), arch.to_string()],
    };

    for needle in &candidates {
        if let Some(a) = assets.iter().find(|a| a.name.contains(needle.as_str())) {
            return Some(a.clone());
        }
    }
    assets.iter().find(|a| a.name.contains(arch)).cloned()
}

pub async fn fetch_latest_release(client: &reqwest::Client) -> Result<ReleaseInfo, String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let resp: serde_json::Value = client
        .get(&url)
        .header("User-Agent", format!("crablite/{CURRENT_VERSION}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let tag = resp
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let version = tag.trim_start_matches('v').to_string();
    let mut assets = Vec::new();
    if let Some(list) = resp.get("assets").and_then(|v| v.as_array()) {
        for a in list {
            let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let download_url = a
                .get("browser_download_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !name.is_empty() && !download_url.is_empty() {
                assets.push(ReleaseAsset { name, download_url });
            }
        }
    }
    Ok(ReleaseInfo { tag, version, assets })
}

async fn download_asset(
    client: &reqwest::Client,
    asset: &ReleaseAsset,
    dest: &Path,
) -> Result<(), String> {
    let bytes = client
        .get(&asset.download_url)
        .header("User-Agent", format!("crablite/{CURRENT_VERSION}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    std::fs::write(dest, &bytes).map_err(|e| e.to_string())
}

fn find_package_root(dir: &Path) -> PathBuf {
    // Archives contain a top-level `crablite-v<V>-<TARGET>/` dir with binary + dist/.
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let has_dist = p.join("dist").exists();
                let has_bin = p.join("crablite").exists() || p.join("crablite.exe").exists();
                if has_dist || has_bin {
                    return p;
                }
            }
        }
    }
    dir.to_path_buf()
}

fn extract_archive(archive: &Path, dest: &Path) -> Result<(), String> {
    let name = archive.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut ar = tar::Archive::new(gz);
        ar.unpack(dest).map_err(|e| e.to_string())?;
        Ok(())
    } else if name.ends_with(".zip") {
        let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        zip.extract(dest).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("unsupported archive format: {name}"))
    }
}

#[cfg(unix)]
fn make_executable(p: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(p).map_err(|e| e.to_string())?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(p, perms).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn make_executable(_p: &Path) -> Result<(), String> {
    Ok(())
}

pub struct UpdateOptions {
    pub yes: bool,
    pub check_only: bool,
}

pub async fn run_update(opts: UpdateOptions) -> i32 {
    if in_docker() {
        eprintln!("--update refused inside Docker: run `docker pull` / redeploy instead.");
        eprintln!("(override for testing: {SKIP_DOCKER_ENV}=1)");
        return 2;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    println!("Current version: {CURRENT_VERSION}");
    println!("Checking for updates at github.com/{REPO} ...");
    let release = match fetch_latest_release(&client).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Update check failed: {e}");
            return 1;
        }
    };

    if release.version.is_empty() {
        eprintln!("Update check failed: empty version in release response");
        return 1;
    }
    println!("Latest version: {} ({})", release.version, release.tag);

    if !is_newer(&release.version, CURRENT_VERSION) {
        println!("Already up to date.");
        return 0;
    }

    let asset = match pick_asset(&release.assets) {
        Some(a) => a,
        None => {
            eprintln!(
                "No compatible asset found for {}-{} among {} assets:",
                std::env::consts::OS,
                std::env::consts::ARCH,
                release.assets.len()
            );
            for a in &release.assets {
                eprintln!("  - {}", a.name);
            }
            return 1;
        }
    };
    println!("Found asset: {}", asset.name);

    if opts.check_only {
        println!("Update available: {} -> {}", CURRENT_VERSION, release.version);
        return 10;
    }

    if !opts.yes {
        println!("Proceed with update {} -> {}? [y/N]", CURRENT_VERSION, release.version);
        let mut line = String::new();
        if stdin().read_line(&mut line).is_err() {
            eprintln!("Failed to read stdin; re-run with --yes for non-interactive use.");
            return 1;
        }
        let ok = matches!(line.trim().to_lowercase().as_str(), "y" | "yes");
        if !ok {
            println!("Aborted.");
            return 0;
        }
    }

    if let Err(e) = apply_update(&client, &asset).await {
        eprintln!("Update failed: {e}");
        return 1;
    }

    println!("Updated to {}. Please restart crablite (old binary saved as .bak).", release.version);
    0
}

async fn apply_update(client: &reqwest::Client, asset: &ReleaseAsset) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "cannot determine binary directory".to_string())?
        .to_path_buf();
    let exe_name = exe
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(if cfg!(windows) { "crablite.exe" } else { "crablite" });

    let work = std::env::temp_dir().join(format!(
        "crablite-update-{}-{}",
        std::process::id(),
        stamp()
    ));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let archive_path = work.join(&asset.name);
    println!("Downloading {} ...", asset.name);
    download_asset(client, asset, &archive_path).await?;

    let extract_dir = work.join("extracted");
    std::fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;
    println!("Extracting ...");
    extract_archive(&archive_path, &extract_dir)?;

    let pkg_root = find_package_root(&extract_dir);
    let new_bin_candidates = [
        pkg_root.join(exe_name),
        pkg_root.join("crablite"),
        pkg_root.join("crablite.exe"),
    ];
    let new_bin = new_bin_candidates
        .iter()
        .find(|p| p.exists())
        .ok_or_else(|| {
            format!("extracted package has no binary (looked in {})", pkg_root.display())
        })?
        .clone();
    let new_dist = pkg_root.join("dist");
    if !new_dist.exists() {
        return Err(format!(
            "extracted package has no dist/ directory (looked in {})",
            pkg_root.display()
        ));
    }

    let current_bin = if exe_dir.join(exe_name).exists() {
        exe_dir.join(exe_name)
    } else {
        exe.clone()
    };
    let backup_bin = append_bak(&current_bin);
    println!("Installing binary to {} ...", current_bin.display());
    #[cfg(windows)]
    {
        let _ = std::fs::remove_file(&backup_bin);
        std::fs::rename(&current_bin, &backup_bin)
            .map_err(|e| format!("cannot move running binary aside ({}): {e}", current_bin.display()))?;
        std::fs::copy(&new_bin, &current_bin).map_err(|e| format!("cannot install new binary: {e}"))?;
    }
    #[cfg(not(windows))]
    {
        let _ = std::fs::remove_file(&backup_bin);
        if current_bin.exists() {
            std::fs::copy(&current_bin, &backup_bin).map_err(|e| e.to_string())?;
        }
        std::fs::copy(&new_bin, &current_bin).map_err(|e| e.to_string())?;
        make_executable(&current_bin)?;
    }

    let current_dist = exe_dir.join("dist");
    let backup_dist = exe_dir.join("dist.bak");
    println!("Installing WebUI to {} ...", current_dist.display());
    if current_dist.exists() {
        let _ = std::fs::remove_dir_all(&backup_dist);
        std::fs::rename(&current_dist, &backup_dist).map_err(|e| e.to_string())?;
    }
    copy_dir_all(&new_dist, &current_dist).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&backup_dist);
    let _ = std::fs::remove_dir_all(&work);

    Ok(())
}

fn append_bak(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(".bak");
    PathBuf::from(s)
}

fn stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dst_path = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &dst_path)?;
        } else {
            std::fs::copy(entry.path(), &dst_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_ordering() {
        assert!(is_newer("26.11.14", "26.11.13"));
        assert!(!is_newer("26.11.13", "26.11.13"));
        assert!(!is_newer("26.11.12", "26.11.13"));
        assert!(is_newer("v26.11.14", "26.11.13"));
    }

    #[test]
    fn picks_arch_asset() {
        let assets = vec![
            ReleaseAsset {
                name: "crablite-v1-x86_64-unknown-linux-musl.tar.gz".into(),
                download_url: "u1".into(),
            },
            ReleaseAsset {
                name: "crablite-v1-aarch64-unknown-linux-musl.tar.gz".into(),
                download_url: "u2".into(),
            },
        ];
        let picked = pick_asset(&assets);
        assert!(picked.is_some());
        assert!(picked.unwrap().name.contains(std::env::consts::ARCH));
    }
}
