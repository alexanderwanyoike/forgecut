use std::path::{Path, PathBuf};

use crate::error::{RenderError, Result};

/// Generate a 720p H.264 proxy for a video asset.
/// Proxy stored at `<proxy_dir>/<asset_id>.mp4`.
pub fn generate_proxy(source_path: &Path, proxy_dir: &Path, asset_id: &str) -> Result<PathBuf> {
    std::fs::create_dir_all(proxy_dir).map_err(RenderError::Io)?;
    let output = proxy_dir.join(format!("{asset_id}.mp4"));

    let status = std::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &source_path.to_string_lossy(),
            "-vf",
            "scale=-2:720",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "28",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            &output.to_string_lossy(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(RenderError::Io)?;

    if !status.success() {
        return Err(RenderError::FfmpegFailed(
            "Proxy generation failed".into(),
        ));
    }

    Ok(output)
}

/// Check if a proxy exists for the given asset.
pub fn proxy_path(proxy_dir: &Path, asset_id: &str) -> Option<PathBuf> {
    let path = proxy_dir.join(format!("{asset_id}.mp4"));
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn proxy_path_returns_none_for_nonexistent() {
        let dir = PathBuf::from("/tmp/forgecut-test-proxies-nonexistent");
        assert!(proxy_path(&dir, "no-such-asset").is_none());
    }

    #[test]
    fn generate_proxy_with_valid_input() {
        // Skip if ffmpeg is not available
        let ffmpeg_available = std::process::Command::new("ffmpeg")
            .arg("-version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if !ffmpeg_available {
            eprintln!("Skipping generate_proxy test: ffmpeg not available");
            return;
        }

        let temp_dir = std::env::temp_dir().join("forgecut-test-proxy-gen");
        let _ = std::fs::remove_dir_all(&temp_dir);

        // Create a minimal test video with ffmpeg
        let test_source = temp_dir.join("test_input.mp4");
        std::fs::create_dir_all(&temp_dir).unwrap();
        let gen = std::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=1920x1080:d=1",
                "-c:v",
                "libx264",
                "-t",
                "1",
                &test_source.to_string_lossy(),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        if gen.is_err() || !gen.unwrap().success() {
            eprintln!("Skipping generate_proxy test: could not create test video");
            let _ = std::fs::remove_dir_all(&temp_dir);
            return;
        }

        let proxy_dir = temp_dir.join("proxies");
        let result = generate_proxy(&test_source, &proxy_dir, "test-asset");
        assert!(result.is_ok(), "generate_proxy failed: {:?}", result.err());

        let proxy = result.unwrap();
        assert!(proxy.exists());
        assert!(proxy_path(&proxy_dir, "test-asset").is_some());

        // Cleanup
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
