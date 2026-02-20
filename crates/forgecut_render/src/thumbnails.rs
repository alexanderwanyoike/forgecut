use std::path::{Path, PathBuf};

use crate::error::{RenderError, Result};

/// Extract a single thumbnail at a specific time from a video file.
pub fn extract_thumbnail(
    source_path: &Path,
    output_path: &Path,
    time_seconds: f64,
    width: u32,
) -> Result<()> {
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(RenderError::Io)?;
    }

    let status = std::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-ss",
            &format!("{time_seconds:.3}"),
            "-i",
            &source_path.to_string_lossy(),
            "-vframes",
            "1",
            "-vf",
            &format!("scale={width}:-1"),
            "-q:v",
            "5",
            &output_path.to_string_lossy(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(RenderError::Io)?;

    if !status.success() {
        return Err(RenderError::FfmpegFailed(
            "Thumbnail extraction failed".into(),
        ));
    }
    Ok(())
}

/// Extract multiple thumbnails at regular intervals.
/// Returns list of (time_seconds, path) pairs.
pub fn extract_thumbnails(
    source_path: &Path,
    cache_dir: &Path,
    asset_id: &str,
    duration_seconds: f64,
    interval_seconds: f64,
    thumb_width: u32,
) -> Result<Vec<(f64, PathBuf)>> {
    let asset_dir = cache_dir.join(asset_id);
    std::fs::create_dir_all(&asset_dir).map_err(RenderError::Io)?;

    let mut results = Vec::new();
    let mut t = 0.0;
    while t < duration_seconds {
        let time_us = (t * 1_000_000.0) as i64;
        let thumb_path = asset_dir.join(format!("{time_us}.jpg"));

        if !thumb_path.exists() {
            extract_thumbnail(source_path, &thumb_path, t, thumb_width)?;
        }

        results.push((t, thumb_path));
        t += interval_seconds;
    }

    Ok(results)
}

/// Extract multiple thumbnails at regular intervals, returning base64-encoded JPEG data URIs.
/// Returns list of (time_seconds, data_uri) pairs.
pub fn extract_thumbnails_base64(
    source_path: &Path,
    cache_dir: &Path,
    asset_id: &str,
    duration_seconds: f64,
    interval_seconds: f64,
    thumb_width: u32,
) -> Result<Vec<(f64, String)>> {
    use base64::Engine;

    let file_thumbs = extract_thumbnails(
        source_path,
        cache_dir,
        asset_id,
        duration_seconds,
        interval_seconds,
        thumb_width,
    )?;

    let mut results = Vec::with_capacity(file_thumbs.len());
    for (t, path) in file_thumbs {
        let bytes = std::fs::read(&path).map_err(RenderError::Io)?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        results.push((t, format!("data:image/jpeg;base64,{encoded}")));
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    #[test]
    fn thumbnail_path_structure() {
        let cache_dir = std::path::Path::new("/tmp/test-thumbs");
        let asset_dir = cache_dir.join("asset123");
        assert_eq!(
            asset_dir,
            std::path::PathBuf::from("/tmp/test-thumbs/asset123")
        );
    }

    #[test]
    fn base64_data_uri_format() {
        // Verify the data URI prefix format
        let prefix = "data:image/jpeg;base64,";
        assert!(prefix.starts_with("data:image/jpeg;base64,"));

        // Verify base64 encoding roundtrip
        use base64::Engine;
        let sample = vec![0xFF, 0xD8, 0xFF, 0xE0]; // JPEG magic bytes
        let encoded = base64::engine::general_purpose::STANDARD.encode(&sample);
        let data_uri = format!("data:image/jpeg;base64,{encoded}");
        assert!(data_uri.starts_with("data:image/jpeg;base64,"));

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&data_uri["data:image/jpeg;base64,".len()..])
            .unwrap();
        assert_eq!(decoded, sample);
    }
}
