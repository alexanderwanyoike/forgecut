use crate::error::{RenderError, Result};
use forgecut_core::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// A compiled render plan ready for ffmpeg execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderPlan {
    pub inputs: Vec<RenderInput>,
    pub filter_graph: String,
    pub output_args: Vec<String>,
    pub output_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderInput {
    pub path: PathBuf,
    pub index: usize,
}

/// Progress update during rendering.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RenderProgress {
    pub percent: f64,
    pub frame: u64,
    pub fps: f64,
    pub speed: String,
    pub eta_seconds: Option<f64>,
}

/// Build PiP overlay filter chains for video clips on non-primary tracks.
///
/// Each PiP clip is trimmed, scaled to 25% of the project size, and overlaid
/// in the bottom-right corner of the base video.  Returns the filter string
/// and the final output video label.
fn compile_pip_overlays(
    project: &Project,
    path_to_index: &HashMap<PathBuf, usize>,
    base_label: &str,
    out_label: &str,
    pip_clips: &[&Item],
) -> (String, String) {
    let proj_w = project.settings.width;
    let proj_h = project.settings.height;

    // PiP defaults: 25% size, bottom-right corner with 20px margin
    let pip_w = proj_w / 4;
    let pip_h = proj_h / 4;
    let pip_x = proj_w - pip_w - 20;
    let pip_y = proj_h - pip_h - 20;

    let mut filters: Vec<String> = Vec::new();
    let mut current_label = base_label.to_string();

    for (i, clip) in pip_clips.iter().enumerate() {
        let (asset_id, source_in_us, source_out_us, timeline_start_us) = match clip {
            Item::VideoClip {
                asset_id,
                source_in_us,
                source_out_us,
                timeline_start_us,
                ..
            } => (*asset_id, *source_in_us, *source_out_us, *timeline_start_us),
            _ => continue,
        };

        let asset = project.assets.iter().find(|a| a.id == asset_id).unwrap();
        let input_idx = path_to_index[&asset.path];

        let start_s = source_in_us.as_seconds();
        let end_s = source_out_us.as_seconds();
        let tl_start_s = timeline_start_us.as_seconds();
        let clip_duration = end_s - start_s;
        let tl_end_s = tl_start_s + clip_duration;

        let scaled_label = format!("pip_scaled_{i}");
        let next_label = if i == pip_clips.len() - 1 {
            out_label.to_string()
        } else {
            format!("pip_{i}")
        };

        // Trim and scale the PiP input
        filters.push(format!(
            "[{input_idx}:v]trim=start={start_s}:end={end_s},setpts=PTS-STARTPTS,scale={pip_w}:{pip_h}[{scaled_label}]"
        ));

        // Overlay on base video with time-scoped enable
        filters.push(format!(
            "[{current_label}][{scaled_label}]overlay=x={pip_x}:y={pip_y}:enable='between(t,{tl_start_s},{tl_end_s})'[{next_label}]"
        ));

        current_label = next_label.clone();
    }

    (filters.join(";"), current_label)
}

/// Compile a project into an ffmpeg render plan.
///
/// For v0.1: concatenate video clips with trim/setpts/atrim/asetpts/concat filters.
/// PiP: additional video tracks overlay on the primary video track.
pub fn compile(project: &Project) -> Result<RenderPlan> {
    // Find the primary (first) video track
    let video_tracks: Vec<&Track> = project
        .timeline
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Video)
        .collect();

    let primary_track = video_tracks.first().ok_or(RenderError::NoClips)?;
    // Collect video clips from the primary track only
    let mut video_clips: Vec<&Item> = primary_track
        .items
        .iter()
        .filter(|item| matches!(item, Item::VideoClip { .. }))
        .collect();

    if video_clips.is_empty() {
        return Err(RenderError::NoClips);
    }

    video_clips.sort_by_key(|item| item.timeline_start_us());

    // Collect PiP clips from non-primary video tracks
    let pip_clips: Vec<&Item> = video_tracks
        .iter()
        .skip(1)
        .flat_map(|t| t.items.iter())
        .filter(|item| matches!(item, Item::VideoClip { .. }))
        .collect();

    // Collect image overlays
    let mut image_overlays: Vec<&Item> = project
        .timeline
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::OverlayImage)
        .flat_map(|t| t.items.iter())
        .filter(|item| matches!(item, Item::ImageOverlay { .. }))
        .collect();
    image_overlays.sort_by_key(|item| item.timeline_start_us());

    // Deduplicate inputs by asset path
    let mut path_to_index: HashMap<PathBuf, usize> = HashMap::new();
    let mut inputs: Vec<RenderInput> = Vec::new();

    for clip in &video_clips {
        let asset_id = clip.asset_id().unwrap();
        let asset = project
            .assets
            .iter()
            .find(|a| a.id == asset_id)
            .ok_or(RenderError::AssetNotFound(asset_id))?;

        if !path_to_index.contains_key(&asset.path) {
            let idx = inputs.len();
            path_to_index.insert(asset.path.clone(), idx);
            inputs.push(RenderInput {
                path: asset.path.clone(),
                index: idx,
            });
        }
    }

    // Also add image overlay assets as inputs
    for overlay in &image_overlays {
        let asset_id = overlay.asset_id().unwrap();
        let asset = project
            .assets
            .iter()
            .find(|a| a.id == asset_id)
            .ok_or(RenderError::AssetNotFound(asset_id))?;

        if !path_to_index.contains_key(&asset.path) {
            let idx = inputs.len();
            path_to_index.insert(asset.path.clone(), idx);
            inputs.push(RenderInput {
                path: asset.path.clone(),
                index: idx,
            });
        }
    }

    // Also add PiP clip assets as inputs
    for clip in &pip_clips {
        let asset_id = clip.asset_id().unwrap();
        let asset = project
            .assets
            .iter()
            .find(|a| a.id == asset_id)
            .ok_or(RenderError::AssetNotFound(asset_id))?;

        if !path_to_index.contains_key(&asset.path) {
            let idx = inputs.len();
            path_to_index.insert(asset.path.clone(), idx);
            inputs.push(RenderInput {
                path: asset.path.clone(),
                index: idx,
            });
        }
    }

    // Build filter graph
    let mut filters: Vec<String> = Vec::new();
    let clip_count = video_clips.len();

    let proj_w = project.settings.width;
    let proj_h = project.settings.height;

    for (i, clip) in video_clips.iter().enumerate() {
        let (asset_id, source_in_us, source_out_us) = match clip {
            Item::VideoClip {
                asset_id,
                source_in_us,
                source_out_us,
                ..
            } => (*asset_id, *source_in_us, *source_out_us),
            _ => unreachable!(),
        };

        let asset = project.assets.iter().find(|a| a.id == asset_id).unwrap();
        let input_idx = path_to_index[&asset.path];
        let start_s = source_in_us.as_seconds();
        let end_s = source_out_us.as_seconds();

        // Check if source dimensions differ from project dimensions
        let needs_scale = asset
            .probe
            .as_ref()
            .map(|p| p.width != proj_w || p.height != proj_h)
            .unwrap_or(false);

        let scale_filter = if needs_scale {
            format!(
                ",scale={proj_w}:{proj_h}:force_original_aspect_ratio=decrease,pad={proj_w}:{proj_h}:(ow-iw)/2:(oh-ih)/2"
            )
        } else {
            String::new()
        };

        filters.push(format!(
            "[{input_idx}:v]trim=start={start_s}:end={end_s},setpts=PTS-STARTPTS{scale_filter}[v{i}]"
        ));
        filters.push(format!(
            "[{input_idx}:a]atrim=start={start_s}:end={end_s},asetpts=PTS-STARTPTS[a{i}]"
        ));
    }

    // Collect audio clips from audio tracks
    let mut audio_clips: Vec<&Item> = project
        .timeline
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Audio)
        .flat_map(|t| t.items.iter())
        .filter(|item| matches!(item, Item::AudioClip { .. }))
        .collect();

    audio_clips.sort_by_key(|item| item.timeline_start_us());

    // Register audio clip assets as inputs
    for clip in &audio_clips {
        let asset_id = clip.asset_id().unwrap();
        let asset = project
            .assets
            .iter()
            .find(|a| a.id == asset_id)
            .ok_or(RenderError::AssetNotFound(asset_id))?;

        if !path_to_index.contains_key(&asset.path) {
            let idx = inputs.len();
            path_to_index.insert(asset.path.clone(), idx);
            inputs.push(RenderInput {
                path: asset.path.clone(),
                index: idx,
            });
        }
    }

    // Build concat filter
    let mut concat_inputs = String::new();
    for i in 0..clip_count {
        concat_inputs.push_str(&format!("[v{i}][a{i}]"));
    }

    let has_audio_overlay = !audio_clips.is_empty();
    let has_image_overlay = !image_overlays.is_empty();
    let has_pip = !pip_clips.is_empty();
    let video_audio_out = if has_audio_overlay { "concat_a" } else { "outa" };

    // Determine concat video output label based on downstream stages
    let concat_video_label = if has_pip {
        "concatv"
    } else if has_image_overlay {
        "basev"
    } else {
        "outv"
    };

    filters.push(format!(
        "{concat_inputs}concat=n={clip_count}:v=1:a=1[{concat_video_label}][{video_audio_out}]"
    ));

    // Apply PiP overlay filters
    if has_pip {
        let pip_out_label = if has_image_overlay { "basev" } else { "outv" };
        let (pip_filters, _final_label) = compile_pip_overlays(
            project,
            &path_to_index,
            concat_video_label,
            pip_out_label,
            &pip_clips,
        );
        filters.push(pip_filters);
    }

    // Process audio overlay clips
    if has_audio_overlay {
        for (i, clip) in audio_clips.iter().enumerate() {
            let (asset_id, source_in_us, source_out_us, volume) = match clip {
                Item::AudioClip {
                    asset_id,
                    source_in_us,
                    source_out_us,
                    volume,
                    ..
                } => (*asset_id, *source_in_us, *source_out_us, *volume),
                _ => unreachable!(),
            };

            let asset = project.assets.iter().find(|a| a.id == asset_id).unwrap();
            let input_idx = path_to_index[&asset.path];
            let start_s = source_in_us.as_seconds();
            let end_s = source_out_us.as_seconds();
            let duration_s = end_s - start_s;
            let delay_ms = clip.timeline_start_us().0 / 1000;

            // Trim, adjust volume, apply short fades, and delay to timeline position
            let fade_out_start = (duration_s - 0.1).max(0.0);
            filters.push(format!(
                "[{input_idx}:a]atrim=start={start_s}:end={end_s},asetpts=PTS-STARTPTS,volume={volume},afade=t=in:d=0.1,afade=t=out:st={fade_out_start}:d=0.1,adelay={delay_ms}|{delay_ms}[ovla{i}]"
            ));
        }

        // Mix all audio overlay clips with the video audio using amix
        let audio_overlay_count = audio_clips.len();
        let mut amix_inputs = format!("[{video_audio_out}]");
        for i in 0..audio_overlay_count {
            amix_inputs.push_str(&format!("[ovla{i}]"));
        }
        let total_inputs = audio_overlay_count + 1;
        filters.push(format!(
            "{amix_inputs}amix=inputs={total_inputs}:duration=longest:dropout_transition=0[outa]"
        ));
    }

    // Apply image overlay filters
    if has_image_overlay {
        let mut current_video_label = "basev".to_string();
        for (i, overlay) in image_overlays.iter().enumerate() {
            if let Item::ImageOverlay {
                asset_id,
                timeline_start_us,
                duration_us,
                x,
                y,
                width,
                height,
                opacity,
                ..
            } = overlay
            {
                let asset = project
                    .assets
                    .iter()
                    .find(|a| a.id == *asset_id)
                    .unwrap();
                let input_idx = path_to_index[&asset.path];

                let start_s = timeline_start_us.as_seconds();
                let end_s = (TimeUs(timeline_start_us.0 + duration_us.0)).as_seconds();

                let scaled_label = format!("img_scaled_{i}");
                let alpha_label = format!("img_alpha_{i}");

                // Scale the image input
                filters.push(format!(
                    "[{input_idx}:v]scale={width}:{height}[{scaled_label}]"
                ));

                // Apply opacity via format + colorchannelmixer
                filters.push(format!(
                    "[{scaled_label}]format=rgba,colorchannelmixer=aa={opacity}[{alpha_label}]"
                ));

                // Overlay with time-scoped enable
                let next_label = if i == image_overlays.len() - 1 {
                    "outv".to_string()
                } else {
                    format!("ov_{i}")
                };

                filters.push(format!(
                    "[{current_video_label}][{alpha_label}]overlay=x={x}:y={y}:enable='between(t,{start_s},{end_s})'[{next_label}]"
                ));

                current_video_label = next_label;
            }
        }
    }

    // Collect text overlays from overlay text tracks
    let text_overlays: Vec<&Item> = project
        .timeline
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::OverlayText)
        .flat_map(|t| t.items.iter())
        .filter(|item| matches!(item, Item::TextOverlay { .. }))
        .collect();

    // Apply drawtext filters for text overlays
    if !text_overlays.is_empty() {
        let mut drawtext_filters = Vec::new();
        for overlay in &text_overlays {
            if let Item::TextOverlay {
                text,
                font_size,
                color,
                x,
                y,
                timeline_start_us,
                duration_us,
                ..
            } = overlay
            {
                let start_s = timeline_start_us.as_seconds();
                let end_s = (TimeUs(timeline_start_us.0 + duration_us.0)).as_seconds();
                // Escape single quotes in text for ffmpeg
                let escaped_text = text.replace('\'', "'\\''");
                // Strip leading '#' from color for ffmpeg
                let ffmpeg_color = color.strip_prefix('#').unwrap_or(color);
                drawtext_filters.push(format!(
                    "drawtext=text='{escaped_text}':fontsize={font_size}:fontcolor=0x{ffmpeg_color}:x={x}:y={y}:enable='between(t,{start_s},{end_s})'"
                ));
            }
        }
        let drawtext_chain = drawtext_filters.join(",");
        filters.push(format!("[outv]{drawtext_chain}[outv_txt]"));
    }

    let final_video_label = if !text_overlays.is_empty() {
        "outv_txt"
    } else {
        "outv"
    };

    let filter_graph = filters.join(";");

    // Build output args
    let fps = project.settings.fps;
    let output_args = vec![
        "-map".to_string(),
        format!("[{final_video_label}]"),
        "-map".to_string(),
        "[outa]".to_string(),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-crf".to_string(),
        "23".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        "-ar".to_string(),
        "48000".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-vsync".to_string(),
        "cfr".to_string(),
        "-r".to_string(),
        format!("{fps}"),
    ];

    Ok(RenderPlan {
        inputs,
        filter_graph,
        output_args,
        output_path: PathBuf::from("output.mp4"),
    })
}

/// Build ffmpeg args from a render plan.
pub fn build_ffmpeg_args(plan: &RenderPlan) -> Vec<String> {
    let mut args = vec!["-y".to_string()];

    for input in &plan.inputs {
        args.push("-i".to_string());
        args.push(input.path.to_string_lossy().to_string());
    }

    args.push("-filter_complex".to_string());
    args.push(plan.filter_graph.clone());

    args.extend(plan.output_args.clone());

    args.push(plan.output_path.to_string_lossy().to_string());

    args
}

/// Execute a render plan by spawning ffmpeg.
/// Sends progress updates via the channel.
pub async fn execute(
    plan: &RenderPlan,
    progress_tx: tokio::sync::watch::Sender<RenderProgress>,
    total_duration_us: TimeUs,
) -> Result<()> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;


    let args = build_ffmpeg_args(plan);

    let mut child = Command::new("ffmpeg")
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                RenderError::FfmpegNotFound
            } else {
                RenderError::Io(e)
            }
        })?;

    let stderr = child.stderr.take().unwrap();
    let mut reader = BufReader::new(stderr);

    let total_secs = total_duration_us.as_seconds();

    let mut buf = Vec::new();
    loop {
        buf.clear();
        let n = reader
            .read_until(b'\r', &mut buf)
            .await
            .map_err(RenderError::Io)?;
        if n == 0 {
            break;
        }
        let chunk = String::from_utf8_lossy(&buf);
        for segment in chunk.split(['\r', '\n']) {
            if let Some(progress) = parse_progress(segment.trim(), total_secs) {
                let _ = progress_tx.send(progress);
            }
        }
    }

    let status = child.wait().await.map_err(RenderError::Io)?;
    if !status.success() {
        return Err(RenderError::FfmpegFailed(format!(
            "ffmpeg exited with {status}"
        )));
    }

    Ok(())
}

/// Parse an ffmpeg stderr progress line.
///
/// Example line: `frame=  123 fps= 60 ... time=00:01:02.05 speed=1.50x`
pub fn parse_progress(line: &str, total_secs: f64) -> Option<RenderProgress> {
    if !line.contains("time=") {
        return None;
    }

    let frame = extract_value(line, "frame=")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

    let fps = extract_value(line, "fps=")
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0);

    let speed_str = extract_value(line, "speed=").unwrap_or_default();

    let time_secs = extract_value(line, "time=")
        .and_then(|v| parse_time_str(&v))
        .unwrap_or(0.0);

    let percent = if total_secs > 0.0 {
        (time_secs / total_secs * 100.0).min(100.0)
    } else {
        0.0
    };

    let speed_factor = speed_str
        .trim_end_matches('x')
        .parse::<f64>()
        .unwrap_or(0.0);

    let eta_seconds = if speed_factor > 0.0 && total_secs > time_secs {
        Some((total_secs - time_secs) / speed_factor)
    } else {
        None
    };

    Some(RenderProgress {
        percent,
        frame,
        fps,
        speed: speed_str,
        eta_seconds,
    })
}

/// Extract a value from an ffmpeg key=value progress line.
fn extract_value(line: &str, key: &str) -> Option<String> {
    let start = line.find(key)? + key.len();
    let rest = &line[start..];
    let trimmed = rest.trim_start();
    let end = trimmed
        .find(|c: char| c.is_whitespace())
        .unwrap_or(trimmed.len());
    let val = trimmed[..end].to_string();
    if val.is_empty() {
        None
    } else {
        Some(val)
    }
}

/// Parse an ffmpeg time string like "00:01:02.05" into seconds.
fn parse_time_str(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let mins: f64 = parts[1].parse().ok()?;
    let secs: f64 = parts[2].parse().ok()?;
    Some(hours * 3600.0 + mins * 60.0 + secs)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_asset(id: Uuid, path: &str) -> Asset {
        Asset {
            id,
            name: path.to_string(),
            path: PathBuf::from(path),
            kind: AssetKind::Video,
            probe: Some(ProbeResult {
                duration_us: TimeUs::from_seconds(30.0),
                width: 1920,
                height: 1080,
                fps: 30.0,
                codec: "h264".to_string(),
                audio_channels: 2,
                audio_sample_rate: 48000,
            }),
        }
    }

    fn make_project_with_clips(clips: Vec<Item>, assets: Vec<Asset>) -> Project {
        Project {
            id: Uuid::new_v4(),
            name: "Test".to_string(),
            settings: ProjectSettings {
                width: 1920,
                height: 1080,
                fps: 30.0,
                sample_rate: 48000,
            },
            assets,
            timeline: Timeline {
                tracks: vec![Track {
                    id: Uuid::new_v4(),
                    kind: TrackKind::Video,
                    items: clips,
                }],
                markers: vec![],
            },
        }
    }

    #[test]
    fn compile_empty_project_returns_no_clips() {
        let project = Project {
            id: Uuid::new_v4(),
            name: "Empty".to_string(),
            settings: ProjectSettings {
                width: 1920,
                height: 1080,
                fps: 30.0,
                sample_rate: 48000,
            },
            assets: vec![],
            timeline: Timeline {
                tracks: vec![],
                markers: vec![],
            },
        };
        let result = compile(&project);
        assert!(result.is_err());
        assert!(
            matches!(result.unwrap_err(), RenderError::NoClips),
            "expected NoClips error"
        );
    }

    #[test]
    fn compile_one_clip_produces_valid_filter_graph() {
        let asset_id = Uuid::new_v4();
        let asset = make_asset(asset_id, "/tmp/clip.mp4");

        let clip = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id,
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs::from_seconds(1.0),
            source_out_us: TimeUs::from_seconds(5.0),
        };

        let project = make_project_with_clips(vec![clip], vec![asset]);
        let plan = compile(&project).unwrap();

        assert_eq!(plan.inputs.len(), 1);
        assert_eq!(plan.inputs[0].path, PathBuf::from("/tmp/clip.mp4"));

        // Filter graph should contain trim, setpts, atrim, asetpts, and concat
        assert!(plan.filter_graph.contains("trim=start=1:end=5"));
        assert!(plan.filter_graph.contains("setpts=PTS-STARTPTS"));
        assert!(plan.filter_graph.contains("atrim=start=1:end=5"));
        assert!(plan.filter_graph.contains("asetpts=PTS-STARTPTS"));
        assert!(plan.filter_graph.contains("concat=n=1:v=1:a=1[outv][outa]"));
    }

    #[test]
    fn compile_two_clips_produces_correct_concat_count() {
        let asset_id_1 = Uuid::new_v4();
        let asset_id_2 = Uuid::new_v4();
        let asset1 = make_asset(asset_id_1, "/tmp/clip1.mp4");
        let asset2 = make_asset(asset_id_2, "/tmp/clip2.mp4");

        let clip1 = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id: asset_id_1,
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs::from_seconds(0.0),
            source_out_us: TimeUs::from_seconds(3.0),
        };

        let clip2 = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id: asset_id_2,
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs::from_seconds(3.0),
            source_in_us: TimeUs::from_seconds(2.0),
            source_out_us: TimeUs::from_seconds(7.0),
        };

        let project = make_project_with_clips(vec![clip1, clip2], vec![asset1, asset2]);
        let plan = compile(&project).unwrap();

        assert_eq!(plan.inputs.len(), 2);
        assert!(plan.filter_graph.contains("concat=n=2:v=1:a=1[outv][outa]"));
        assert!(plan.filter_graph.contains("[v0][a0][v1][a1]"));
    }

    #[test]
    fn compile_preserves_trim_ranges() {
        let asset_id = Uuid::new_v4();
        let asset = make_asset(asset_id, "/tmp/clip.mp4");

        let clip = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id,
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs::from_seconds(2.5),
            source_out_us: TimeUs::from_seconds(8.75),
        };

        let project = make_project_with_clips(vec![clip], vec![asset]);
        let plan = compile(&project).unwrap();

        assert!(plan.filter_graph.contains("trim=start=2.5:end=8.75"));
        assert!(plan.filter_graph.contains("atrim=start=2.5:end=8.75"));
    }

    #[test]
    fn compile_deduplicates_same_asset() {
        let asset_id = Uuid::new_v4();
        let asset = make_asset(asset_id, "/tmp/clip.mp4");

        let clip1 = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id,
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs::from_seconds(0.0),
            source_out_us: TimeUs::from_seconds(3.0),
        };

        let clip2 = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id,
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs::from_seconds(3.0),
            source_in_us: TimeUs::from_seconds(5.0),
            source_out_us: TimeUs::from_seconds(8.0),
        };

        let project = make_project_with_clips(vec![clip1, clip2], vec![asset]);
        let plan = compile(&project).unwrap();

        // Same asset used twice, but only one input
        assert_eq!(plan.inputs.len(), 1);
        assert!(plan.filter_graph.contains("concat=n=2:v=1:a=1"));
    }

    #[test]
    fn compile_adds_scale_filter_when_dimensions_differ() {
        let asset_id = Uuid::new_v4();
        // Asset is 1280x720, project is 1920x1080
        let asset = Asset {
            id: asset_id,
            name: "720p.mp4".to_string(),
            path: PathBuf::from("/tmp/720p.mp4"),
            kind: AssetKind::Video,
            probe: Some(ProbeResult {
                duration_us: TimeUs::from_seconds(30.0),
                width: 1280,
                height: 720,
                fps: 30.0,
                codec: "h264".to_string(),
                audio_channels: 2,
                audio_sample_rate: 48000,
            }),
        };

        let clip = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id,
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs::from_seconds(0.0),
            source_out_us: TimeUs::from_seconds(5.0),
        };

        let project = make_project_with_clips(vec![clip], vec![asset]);
        let plan = compile(&project).unwrap();

        assert!(plan.filter_graph.contains(
            "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2"
        ));
    }

    #[test]
    fn compile_no_scale_filter_when_dimensions_match() {
        let asset_id = Uuid::new_v4();
        let asset = make_asset(asset_id, "/tmp/clip.mp4");

        let clip = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id,
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs::from_seconds(0.0),
            source_out_us: TimeUs::from_seconds(5.0),
        };

        let project = make_project_with_clips(vec![clip], vec![asset]);
        let plan = compile(&project).unwrap();

        assert!(!plan.filter_graph.contains("scale="));
        assert!(!plan.filter_graph.contains("pad="));
    }

    #[test]
    fn compile_scale_filter_for_4k_project() {
        let asset_id = Uuid::new_v4();
        // Asset is 1920x1080, project is 4K
        let asset = make_asset(asset_id, "/tmp/1080p.mp4");

        let clip = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id,
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs::from_seconds(0.0),
            source_out_us: TimeUs::from_seconds(5.0),
        };

        let project = Project {
            id: Uuid::new_v4(),
            name: "4K Test".to_string(),
            settings: ProjectSettings {
                width: 3840,
                height: 2160,
                fps: 30.0,
                sample_rate: 48000,
            },
            assets: vec![asset],
            timeline: Timeline {
                tracks: vec![Track {
                    id: Uuid::new_v4(),
                    kind: TrackKind::Video,
                    items: vec![clip],
                }],
                markers: vec![],
            },
        };

        let plan = compile(&project).unwrap();
        assert!(plan.filter_graph.contains(
            "scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2"
        ));
    }

    #[test]
    fn compile_with_audio_overlay_uses_amix() {
        let video_asset_id = Uuid::new_v4();
        let audio_asset_id = Uuid::new_v4();
        let video_track_id = Uuid::new_v4();
        let audio_track_id = Uuid::new_v4();

        let video_asset = make_asset(video_asset_id, "/tmp/clip.mp4");
        let audio_asset = Asset {
            id: audio_asset_id,
            name: "music.mp3".to_string(),
            path: PathBuf::from("/tmp/music.mp3"),
            kind: AssetKind::Audio,
            probe: Some(ProbeResult {
                duration_us: TimeUs::from_seconds(60.0),
                width: 0,
                height: 0,
                fps: 0.0,
                codec: "mp3".to_string(),
                audio_channels: 2,
                audio_sample_rate: 44100,
            }),
        };

        let video_clip = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id: video_asset_id,
            track_id: video_track_id,
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs::from_seconds(0.0),
            source_out_us: TimeUs::from_seconds(10.0),
        };

        let audio_clip = Item::AudioClip {
            id: Uuid::new_v4(),
            asset_id: audio_asset_id,
            track_id: audio_track_id,
            timeline_start_us: TimeUs::from_seconds(2.0),
            source_in_us: TimeUs::from_seconds(0.0),
            source_out_us: TimeUs::from_seconds(8.0),
            volume: 0.5,
        };

        let project = Project {
            id: Uuid::new_v4(),
            name: "AudioTest".to_string(),
            settings: ProjectSettings {
                width: 1920,
                height: 1080,
                fps: 30.0,
                sample_rate: 48000,
            },
            assets: vec![video_asset, audio_asset],
            timeline: Timeline {
                tracks: vec![
                    Track {
                        id: video_track_id,
                        kind: TrackKind::Video,
                        items: vec![video_clip],
                    },
                    Track {
                        id: audio_track_id,
                        kind: TrackKind::Audio,
                        items: vec![audio_clip],
                    },
                ],
                markers: vec![],
            },
        };

        let plan = compile(&project).unwrap();

        // Should have 2 inputs (video + audio)
        assert_eq!(plan.inputs.len(), 2);

        // Should use amix to mix audio
        assert!(plan.filter_graph.contains("amix=inputs=2:duration=longest"));

        // Should apply volume filter
        assert!(plan.filter_graph.contains("volume=0.5"));

        // Should apply fade in/out
        assert!(plan.filter_graph.contains("afade=t=in:d=0.1"));
        assert!(plan.filter_graph.contains("afade=t=out:"));

        // Should have adelay for timeline positioning (2 seconds = 2000ms)
        assert!(plan.filter_graph.contains("adelay=2000|2000"));

        // Concat output should go to concat_a, not outa directly
        assert!(plan.filter_graph.contains("[concat_a]"));
    }

    #[test]
    fn compile_without_audio_overlay_no_amix() {
        let asset_id = Uuid::new_v4();
        let asset = make_asset(asset_id, "/tmp/clip.mp4");

        let clip = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id,
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs::from_seconds(0.0),
            source_out_us: TimeUs::from_seconds(5.0),
        };

        let project = make_project_with_clips(vec![clip], vec![asset]);
        let plan = compile(&project).unwrap();

        assert!(!plan.filter_graph.contains("amix"));
        assert!(!plan.filter_graph.contains("concat_a"));
        assert!(plan.filter_graph.contains("[outa]"));
    }

    #[test]
    fn compile_missing_asset_returns_error() {
        let clip = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id: Uuid::new_v4(), // non-existent asset
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs(0),
            source_out_us: TimeUs::from_seconds(5.0),
        };

        let project = make_project_with_clips(vec![clip], vec![]);
        let result = compile(&project);
        assert!(matches!(result.unwrap_err(), RenderError::AssetNotFound(_)));
    }

    #[test]
    fn build_ffmpeg_args_includes_expected_flags() {
        let plan = RenderPlan {
            inputs: vec![
                RenderInput {
                    path: PathBuf::from("/tmp/a.mp4"),
                    index: 0,
                },
                RenderInput {
                    path: PathBuf::from("/tmp/b.mp4"),
                    index: 1,
                },
            ],
            filter_graph: "[0:v]trim=0:5[v0];[0:a]atrim=0:5[a0];[v0][a0]concat=n=1:v=1:a=1[outv][outa]".to_string(),
            output_args: vec![
                "-map".to_string(), "[outv]".to_string(),
                "-map".to_string(), "[outa]".to_string(),
                "-c:v".to_string(), "libx264".to_string(),
            ],
            output_path: PathBuf::from("/tmp/out.mp4"),
        };

        let args = build_ffmpeg_args(&plan);

        assert_eq!(args[0], "-y");
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"/tmp/a.mp4".to_string()));
        assert!(args.contains(&"/tmp/b.mp4".to_string()));
        assert!(args.contains(&"-filter_complex".to_string()));
        assert!(args.contains(&"-map".to_string()));
        assert!(args.contains(&"[outv]".to_string()));
        assert!(args.contains(&"[outa]".to_string()));
        assert!(args.contains(&"-c:v".to_string()));
        assert!(args.contains(&"libx264".to_string()));
        assert_eq!(args.last().unwrap(), "/tmp/out.mp4");
    }

    #[test]
    fn parse_progress_extracts_time_and_calculates_percent() {
        let line =
            "frame=  150 fps= 30 q=28.0 size=    1024kB time=00:00:05.00 bitrate= 200.0kbits/s speed=1.50x";
        let total_secs = 10.0;

        let progress = parse_progress(line, total_secs).unwrap();

        assert_eq!(progress.frame, 150);
        assert!((progress.fps - 30.0).abs() < 0.01);
        assert!((progress.percent - 50.0).abs() < 0.1);
        assert_eq!(progress.speed, "1.50x");
        // ETA: (10 - 5) / 1.5 = 3.33s
        assert!((progress.eta_seconds.unwrap() - 3.33).abs() < 0.1);
    }

    #[test]
    fn parse_progress_returns_none_for_non_progress_lines() {
        assert!(parse_progress("Input #0, mov,mp4...", 10.0).is_none());
        assert!(parse_progress("Stream #0:0: Video: h264", 10.0).is_none());
        assert!(parse_progress("", 10.0).is_none());
    }

    #[test]
    fn parse_progress_handles_zero_total_duration() {
        let line = "frame=  10 fps= 30 time=00:00:01.00 speed=1.00x";
        let progress = parse_progress(line, 0.0).unwrap();
        assert!((progress.percent - 0.0).abs() < 0.01);
    }

    #[test]
    fn parse_time_str_valid() {
        assert!((parse_time_str("00:01:02.05").unwrap() - 62.05).abs() < 0.001);
        assert!((parse_time_str("01:00:00.00").unwrap() - 3600.0).abs() < 0.001);
        assert!((parse_time_str("00:00:00.00").unwrap() - 0.0).abs() < 0.001);
    }

    #[test]
    fn parse_time_str_invalid() {
        assert!(parse_time_str("invalid").is_none());
        assert!(parse_time_str("00:00").is_none());
    }

    #[test]
    fn extract_value_works() {
        let line = "frame=  150 fps= 30.0 time=00:00:05.00 speed=1.50x";
        assert_eq!(extract_value(line, "frame=").unwrap(), "150");
        assert_eq!(extract_value(line, "fps=").unwrap(), "30.0");
        assert_eq!(extract_value(line, "time=").unwrap(), "00:00:05.00");
        assert_eq!(extract_value(line, "speed=").unwrap(), "1.50x");
        assert!(extract_value(line, "missing=").is_none());
    }

    // --- Tests for \r-delimited chunk parsing (mirrors execute() logic) ---

    /// Simulate the chunk-splitting logic from execute(): split on \r and \n,
    /// trim each segment, and collect parse_progress results.
    fn parse_chunk(raw: &str, total_secs: f64) -> Vec<RenderProgress> {
        let mut results = Vec::new();
        for segment in raw.split(['\r', '\n']) {
            if let Some(progress) = parse_progress(segment.trim(), total_secs) {
                results.push(progress);
            }
        }
        results
    }

    #[test]
    fn parse_cr_delimited_progress_yields_multiple_updates() {
        let raw = "frame=  10 fps= 30 time=00:00:00.33 speed=1.00x\rframe=  20 fps= 30 time=00:00:00.66 speed=1.00x\rframe=  30 fps= 30 time=00:00:01.00 speed=1.00x\r";
        let results = parse_chunk(raw, 10.0);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].frame, 10);
        assert_eq!(results[1].frame, 20);
        assert_eq!(results[2].frame, 30);
        assert!((results[2].percent - 10.0).abs() < 0.1);
    }

    #[test]
    fn parse_mixed_cr_and_lf_delimiters() {
        let raw = "frame=  10 fps= 30 time=00:00:01.00 speed=1.00x\rframe=  20 fps= 30 time=00:00:02.00 speed=1.50x\nframe=  30 fps= 30 time=00:00:03.00 speed=2.00x\n";
        let results = parse_chunk(raw, 10.0);
        assert_eq!(results.len(), 3);
        assert!((results[0].percent - 10.0).abs() < 0.1);
        assert!((results[1].percent - 20.0).abs() < 0.1);
        assert!((results[2].percent - 30.0).abs() < 0.1);
    }

    #[test]
    fn parse_cr_chunk_filters_non_progress_lines() {
        let raw = "Input #0, mov,mp4...\rStream #0:0: Video: h264\rframe=  50 fps= 25 time=00:00:02.00 speed=1.00x\r";
        let results = parse_chunk(raw, 10.0);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].frame, 50);
    }

    #[test]
    fn parse_many_rapid_cr_updates() {
        let mut raw = String::new();
        for i in 1..=100 {
            let time_s = i as f64 * 0.1;
            let h = (time_s / 3600.0) as u32;
            let m = ((time_s % 3600.0) / 60.0) as u32;
            let s = time_s % 60.0;
            raw.push_str(&format!(
                "frame={:4} fps= 60 time={:02}:{:02}:{:05.2} speed=2.00x\r",
                i * 6, h, m, s
            ));
        }
        let results = parse_chunk(&raw, 30.0);
        assert_eq!(results.len(), 100);
        assert_eq!(results[0].frame, 6);
        assert_eq!(results[99].frame, 600);
        // Last update: time=10.0s out of 30.0s = 33.3%
        assert!((results[99].percent - 33.3).abs() < 0.5);
    }

    #[test]
    fn parse_cr_chunk_with_trailing_whitespace() {
        let raw = "  frame=  10 fps= 30 time=00:00:01.00 speed=1.00x  \r  \r  frame=  20 fps= 30 time=00:00:02.00 speed=1.50x  \r";
        let results = parse_chunk(raw, 10.0);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].frame, 10);
        assert_eq!(results[1].frame, 20);
    }
}
