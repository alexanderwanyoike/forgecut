use forgecut_core::types::{Asset, AssetKind, ProbeResult, TimeUs};
use serde::Deserialize;
use std::path::Path;
use uuid::Uuid;

use crate::error::{RenderError, Result};

// ---------------------------------------------------------------------------
// ffprobe JSON output structures
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    streams: Vec<FfprobeStream>,
    format: FfprobeFormat,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: String,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    channels: Option<u32>,
    sample_rate: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Run ffprobe on a media file and parse the result into a `ProbeResult`.
pub fn probe_asset(path: impl AsRef<Path>) -> Result<ProbeResult> {
    let path = path.as_ref();
    if !path.exists() {
        return Err(RenderError::FileNotFound(path.to_path_buf()));
    }

    let output = std::process::Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .map_err(|e| RenderError::FfprobeExec(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(RenderError::FfprobeFailed(stderr.into_owned()));
    }

    let probe: FfprobeOutput = serde_json::from_slice(&output.stdout)?;
    parse_probe_output(&probe)
}

/// Import a media file: probe it and create an `Asset`.
pub fn import_asset(path: impl AsRef<Path>) -> Result<Asset> {
    let path = path.as_ref();
    let probe = probe_asset(path)?;

    let kind = detect_asset_kind(path, &probe);

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unknown".to_string());

    Ok(Asset {
        id: Uuid::new_v4(),
        name,
        path: path.to_path_buf(),
        kind,
        probe: Some(probe),
    })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn parse_probe_output(probe: &FfprobeOutput) -> Result<ProbeResult> {
    let video_stream = probe
        .streams
        .iter()
        .find(|s| s.codec_type == "video");
    let audio_stream = probe
        .streams
        .iter()
        .find(|s| s.codec_type == "audio");

    let duration_us = probe
        .format
        .duration
        .as_deref()
        .and_then(|d| d.parse::<f64>().ok())
        .map(TimeUs::from_seconds)
        .unwrap_or(TimeUs::ZERO);

    let width = video_stream.and_then(|s| s.width).unwrap_or(0);
    let height = video_stream.and_then(|s| s.height).unwrap_or(0);

    let fps = video_stream
        .and_then(|s| s.r_frame_rate.as_deref())
        .and_then(parse_frame_rate)
        .unwrap_or(0.0);

    let codec = video_stream
        .and_then(|s| s.codec_name.clone())
        .or_else(|| audio_stream.and_then(|s| s.codec_name.clone()))
        .unwrap_or_default();

    let audio_channels = audio_stream.and_then(|s| s.channels).unwrap_or(0);

    let audio_sample_rate = audio_stream
        .and_then(|s| s.sample_rate.as_deref())
        .and_then(|r| r.parse::<u32>().ok())
        .unwrap_or(0);

    Ok(ProbeResult {
        duration_us,
        width,
        height,
        fps,
        codec,
        audio_channels,
        audio_sample_rate,
    })
}

/// Parse ffprobe frame rate string like "30000/1001" or "30/1" into f64.
fn parse_frame_rate(rate: &str) -> Option<f64> {
    if let Some((num, den)) = rate.split_once('/') {
        let n: f64 = num.parse().ok()?;
        let d: f64 = den.parse().ok()?;
        if d == 0.0 {
            return None;
        }
        Some(n / d)
    } else {
        rate.parse().ok()
    }
}

/// Detect asset kind based on file extension and probe data.
fn detect_asset_kind(path: &Path, probe: &ProbeResult) -> AssetKind {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "tiff" | "svg" => AssetKind::Image,
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" => AssetKind::Audio,
        _ => {
            // If we have video dimensions, it's a video
            if probe.width > 0 && probe.height > 0 {
                AssetKind::Video
            } else if probe.audio_channels > 0 {
                AssetKind::Audio
            } else {
                AssetKind::Video // default fallback
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_frame_rate_fraction() {
        assert!((parse_frame_rate("30000/1001").unwrap() - 29.97).abs() < 0.01);
        assert!((parse_frame_rate("30/1").unwrap() - 30.0).abs() < f64::EPSILON);
        assert!((parse_frame_rate("24/1").unwrap() - 24.0).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_frame_rate_plain() {
        assert!((parse_frame_rate("29.97").unwrap() - 29.97).abs() < 0.01);
    }

    #[test]
    fn parse_frame_rate_zero_denominator() {
        assert!(parse_frame_rate("30/0").is_none());
    }

    #[test]
    fn detect_kind_by_extension() {
        let probe = ProbeResult {
            duration_us: TimeUs::ZERO,
            width: 0,
            height: 0,
            fps: 0.0,
            codec: String::new(),
            audio_channels: 0,
            audio_sample_rate: 0,
        };

        assert_eq!(
            detect_asset_kind(Path::new("photo.png"), &probe),
            AssetKind::Image
        );
        assert_eq!(
            detect_asset_kind(Path::new("song.mp3"), &probe),
            AssetKind::Audio
        );
        assert_eq!(
            detect_asset_kind(Path::new("PHOTO.JPG"), &probe),
            AssetKind::Image
        );
    }

    #[test]
    fn detect_kind_by_probe_data() {
        let video_probe = ProbeResult {
            duration_us: TimeUs::ZERO,
            width: 1920,
            height: 1080,
            fps: 30.0,
            codec: "h264".into(),
            audio_channels: 2,
            audio_sample_rate: 48000,
        };
        assert_eq!(
            detect_asset_kind(Path::new("clip.mkv"), &video_probe),
            AssetKind::Video
        );

        let audio_probe = ProbeResult {
            duration_us: TimeUs::ZERO,
            width: 0,
            height: 0,
            fps: 0.0,
            codec: "aac".into(),
            audio_channels: 2,
            audio_sample_rate: 44100,
        };
        assert_eq!(
            detect_asset_kind(Path::new("track.unknown"), &audio_probe),
            AssetKind::Audio
        );
    }

    #[test]
    fn parse_probe_output_video_and_audio() {
        let json = r#"{
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "r_frame_rate": "30/1"
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac",
                    "channels": 2,
                    "sample_rate": "48000"
                }
            ],
            "format": {
                "duration": "10.5"
            }
        }"#;
        let output: FfprobeOutput = serde_json::from_str(json).unwrap();
        let result = parse_probe_output(&output).unwrap();

        assert_eq!(result.width, 1920);
        assert_eq!(result.height, 1080);
        assert!((result.fps - 30.0).abs() < f64::EPSILON);
        assert_eq!(result.codec, "h264");
        assert_eq!(result.audio_channels, 2);
        assert_eq!(result.audio_sample_rate, 48000);
        assert_eq!(result.duration_us, TimeUs::from_seconds(10.5));
    }

    #[test]
    fn parse_probe_output_audio_only() {
        let json = r#"{
            "streams": [
                {
                    "codec_type": "audio",
                    "codec_name": "mp3",
                    "channels": 2,
                    "sample_rate": "44100"
                }
            ],
            "format": {
                "duration": "180.0"
            }
        }"#;
        let output: FfprobeOutput = serde_json::from_str(json).unwrap();
        let result = parse_probe_output(&output).unwrap();

        assert_eq!(result.width, 0);
        assert_eq!(result.height, 0);
        assert!((result.fps - 0.0).abs() < f64::EPSILON);
        assert_eq!(result.codec, "mp3");
        assert_eq!(result.audio_channels, 2);
        assert_eq!(result.audio_sample_rate, 44100);
    }

    #[test]
    fn parse_probe_output_missing_streams() {
        let json = r#"{
            "streams": [],
            "format": {}
        }"#;
        let output: FfprobeOutput = serde_json::from_str(json).unwrap();
        let result = parse_probe_output(&output).unwrap();

        assert_eq!(result.width, 0);
        assert_eq!(result.height, 0);
        assert_eq!(result.audio_channels, 0);
        assert_eq!(result.duration_us, TimeUs::ZERO);
    }

    #[test]
    fn probe_nonexistent_file_returns_error() {
        let result = probe_asset("/tmp/does_not_exist_forgecut_probe_test.mp4");
        assert!(result.is_err());
    }
}
