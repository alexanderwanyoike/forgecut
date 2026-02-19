use std::path::Path;

use crate::error::{RenderError, Result};

/// Peak data for waveform display: pairs of (min, max) for each sample window.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WaveformData {
    pub peaks: Vec<(f32, f32)>,
    pub sample_rate: u32,
    pub samples_per_peak: u32,
}

/// Extract audio peaks from a media file using ffmpeg.
/// Outputs raw PCM, then computes min/max peaks in Rust.
pub fn extract_waveform(
    source_path: &Path,
    cache_dir: &Path,
    asset_id: &str,
    samples_per_peak: u32,
) -> Result<WaveformData> {
    let cache_path = cache_dir.join(format!("{asset_id}.json"));

    // Return cached if exists
    if cache_path.exists() {
        let data = std::fs::read_to_string(&cache_path).map_err(RenderError::Io)?;
        return serde_json::from_str(&data).map_err(RenderError::Json);
    }

    std::fs::create_dir_all(cache_dir).map_err(RenderError::Io)?;

    // Extract raw PCM s16le mono via ffmpeg
    let output = std::process::Command::new("ffmpeg")
        .args([
            "-i",
            &source_path.to_string_lossy(),
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            "8000",
            "-acodec",
            "pcm_s16le",
            "-",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .map_err(RenderError::Io)?;

    if !output.status.success() {
        return Err(RenderError::FfmpegFailed(
            "Waveform extraction failed".into(),
        ));
    }

    // Parse s16le samples
    let samples: Vec<i16> = output
        .stdout
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();

    let peaks = compute_peaks(&samples, samples_per_peak);

    let data = WaveformData {
        peaks,
        sample_rate: 8000,
        samples_per_peak,
    };

    // Cache
    let json = serde_json::to_string(&data).map_err(RenderError::Json)?;
    let _ = std::fs::write(&cache_path, json);

    Ok(data)
}

fn compute_peaks(samples: &[i16], samples_per_peak: u32) -> Vec<(f32, f32)> {
    samples
        .chunks(samples_per_peak as usize)
        .map(|chunk| {
            let min = chunk.iter().copied().min().unwrap_or(0) as f32 / 32768.0;
            let max = chunk.iter().copied().max().unwrap_or(0) as f32 / 32768.0;
            (min, max)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_peaks_from_samples() {
        let samples: Vec<i16> = vec![0, 100, -200, 300, -400, 500, -600, 700];
        let peaks = compute_peaks(&samples, 4);
        assert_eq!(peaks.len(), 2);
        // First chunk: [0, 100, -200, 300] -> min=-200, max=300
        assert!((peaks[0].0 - (-200.0 / 32768.0)).abs() < 1e-6);
        assert!((peaks[0].1 - (300.0 / 32768.0)).abs() < 1e-6);
        // Second chunk: [-400, 500, -600, 700] -> min=-600, max=700
        assert!((peaks[1].0 - (-600.0 / 32768.0)).abs() < 1e-6);
        assert!((peaks[1].1 - (700.0 / 32768.0)).abs() < 1e-6);
    }

    #[test]
    fn compute_peaks_empty() {
        let samples: Vec<i16> = vec![];
        let peaks = compute_peaks(&samples, 256);
        assert!(peaks.is_empty());
    }

    #[test]
    fn compute_peaks_partial_chunk() {
        let samples: Vec<i16> = vec![1000, -1000, 500];
        let peaks = compute_peaks(&samples, 4);
        assert_eq!(peaks.len(), 1);
        assert!((peaks[0].0 - (-1000.0 / 32768.0)).abs() < 1e-6);
        assert!((peaks[0].1 - (1000.0 / 32768.0)).abs() < 1e-6);
    }
}
