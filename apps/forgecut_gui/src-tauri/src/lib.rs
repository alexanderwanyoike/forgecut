mod state;

use state::AppState;
use tauri::Emitter;
use tauri::Manager;

fn percent_decode(s: &str) -> String {
    let mut result = Vec::with_capacity(s.len());
    let mut bytes = s.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let h = bytes.next().unwrap_or(b'0');
            let l = bytes.next().unwrap_or(b'0');
            let hex_str = [h, l];
            if let Ok(decoded) = u8::from_str_radix(std::str::from_utf8(&hex_str).unwrap_or("00"), 16) {
                result.push(decoded);
            }
        } else {
            result.push(b);
        }
    }
    String::from_utf8_lossy(&result).into_owned()
}

/// Start a local HTTP file server that streams media files with Range support.
/// Returns the port number.
fn start_media_server() -> u16 {
    use std::io::{Read, Seek, SeekFrom};

    let server = tiny_http::Server::http("127.0.0.1:0").expect("Failed to start media server");
    let port = server.server_addr().to_ip().unwrap().port();
    tracing::info!("Media server started on port {}", port);

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let raw_path = request.url().to_string();
            let path = percent_decode(raw_path.strip_prefix('/').unwrap_or(&raw_path));

            let file = match std::fs::File::open(&path) {
                Ok(f) => f,
                Err(e) => {
                    let resp = tiny_http::Response::from_string(format!("Not found: {}", e))
                        .with_status_code(404);
                    let _ = request.respond(resp);
                    continue;
                }
            };

            let total_size = file.metadata().map(|m| m.len()).unwrap_or(0);
            let mime: tiny_http::Header = {
                let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
                let ct = match ext.as_str() {
                    "mp4" => "video/mp4",
                    "mkv" => "video/x-matroska",
                    "webm" => "video/webm",
                    "avi" => "video/x-msvideo",
                    "mov" => "video/quicktime",
                    "mp3" => "audio/mpeg",
                    "wav" => "audio/wav",
                    "flac" => "audio/flac",
                    "png" => "image/png",
                    "jpg" | "jpeg" => "image/jpeg",
                    _ => "application/octet-stream",
                };
                tiny_http::Header::from_bytes("Content-Type", ct).unwrap()
            };

            let accept_ranges = tiny_http::Header::from_bytes("Accept-Ranges", "bytes").unwrap();
            let cors = tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();

            // Check for Range header
            let range_header = request.headers().iter()
                .find(|h| h.field.as_str() == "Range" || h.field.as_str() == "range")
                .map(|h| h.value.as_str().to_string());

            if let Some(range) = range_header {
                let range_str = range.strip_prefix("bytes=").unwrap_or(&range);
                let parts: Vec<&str> = range_str.split('-').collect();
                let start: u64 = parts[0].parse().unwrap_or(0);
                let end: u64 = if parts.len() > 1 && !parts[1].is_empty() {
                    parts[1].parse().unwrap_or(total_size - 1)
                } else {
                    total_size - 1
                };

                let length = end - start + 1;
                let mut file = file;
                let _ = file.seek(SeekFrom::Start(start));
                let reader = file.take(length);

                let content_range = tiny_http::Header::from_bytes(
                    "Content-Range",
                    format!("bytes {}-{}/{}", start, end, total_size),
                ).unwrap();

                let resp = tiny_http::Response::new(
                    tiny_http::StatusCode(206),
                    vec![mime, accept_ranges, cors, content_range],
                    reader,
                    Some(length as usize),
                    None,
                );
                let _ = request.respond(resp);
            } else {
                let resp = tiny_http::Response::new(
                    tiny_http::StatusCode(200),
                    vec![mime, accept_ranges, cors],
                    file,
                    Some(total_size as usize),
                    None,
                );
                let _ = request.respond(resp);
            }
        }
    });

    port
}

#[tauri::command]
fn create_project(state: tauri::State<AppState>) -> Result<String, String> {
    tracing::info!("create_project called");
    let project = state.project.lock().unwrap();
    serde_json::to_string(&*project).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project(state: tauri::State<AppState>) -> Result<(), String> {
    tracing::info!("save_project called");
    let _project = state.project.lock().unwrap();
    Ok(())
}

#[tauri::command]
fn load_project(state: tauri::State<AppState>) -> Result<String, String> {
    tracing::info!("load_project called");
    let project = state.project.lock().unwrap();
    serde_json::to_string(&*project).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_assets(
    paths: Vec<String>,
    state: tauri::State<AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let mut project = state.project.lock().unwrap();
    let mut imported = Vec::new();
    for path_str in paths {
        let path = std::path::PathBuf::from(&path_str);
        match forgecut_render::probe::import_asset(&path) {
            Ok(asset) => {
                let json = serde_json::to_value(&asset).unwrap();
                project.assets.push(asset);
                imported.push(json);
            }
            Err(e) => return Err(format!("Failed to import {}: {}", path_str, e)),
        }
    }
    Ok(imported)
}

#[tauri::command]
fn get_assets(state: tauri::State<AppState>) -> Result<Vec<serde_json::Value>, String> {
    let project = state.project.lock().unwrap();
    Ok(project
        .assets
        .iter()
        .map(|a| serde_json::to_value(a).unwrap())
        .collect())
}

#[tauri::command]
fn remove_asset(id: String, state: tauri::State<AppState>) -> Result<(), String> {
    let uuid = uuid::Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let mut project = state.project.lock().unwrap();
    project.assets.retain(|a| a.id != uuid);
    Ok(())
}

#[tauri::command]
fn get_timeline(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let project = state.project.lock().unwrap();
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_clip_to_timeline(
    asset_id: String,
    track_id: String,
    timeline_start_us: i64,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let asset_uuid = uuid::Uuid::parse_str(&asset_id).map_err(|e| e.to_string())?;
    let track_uuid = uuid::Uuid::parse_str(&track_id).map_err(|e| e.to_string())?;

    let mut project = state.project.lock().unwrap();

    let asset = project
        .assets
        .iter()
        .find(|a| a.id == asset_uuid)
        .ok_or("Asset not found")?
        .clone();

    let duration = asset
        .probe
        .as_ref()
        .map(|p| p.duration_us)
        .unwrap_or(forgecut_core::types::TimeUs::from_seconds(5.0));

    let item = match asset.kind {
        forgecut_core::types::AssetKind::Video => forgecut_core::types::Item::VideoClip {
            id: uuid::Uuid::new_v4(),
            asset_id: asset_uuid,
            track_id: track_uuid,
            timeline_start_us: forgecut_core::types::TimeUs(timeline_start_us),
            source_in_us: forgecut_core::types::TimeUs::ZERO,
            source_out_us: duration,
        },
        forgecut_core::types::AssetKind::Audio => forgecut_core::types::Item::AudioClip {
            id: uuid::Uuid::new_v4(),
            asset_id: asset_uuid,
            track_id: track_uuid,
            timeline_start_us: forgecut_core::types::TimeUs(timeline_start_us),
            source_in_us: forgecut_core::types::TimeUs::ZERO,
            source_out_us: duration,
            volume: 1.0,
        },
        forgecut_core::types::AssetKind::Image => forgecut_core::types::Item::ImageOverlay {
            id: uuid::Uuid::new_v4(),
            asset_id: asset_uuid,
            track_id: track_uuid,
            timeline_start_us: forgecut_core::types::TimeUs(timeline_start_us),
            duration_us: forgecut_core::types::TimeUs::from_seconds(5.0),
            x: 0,
            y: 0,
            width: 320,
            height: 240,
            opacity: 1.0,
        },
    };

    project
        .timeline
        .add_item(track_uuid, item)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn init_default_tracks(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let mut project = state.project.lock().unwrap();
    if project.timeline.tracks.is_empty() {
        project
            .timeline
            .tracks
            .push(forgecut_core::types::Track {
                id: uuid::Uuid::new_v4(),
                kind: forgecut_core::types::TrackKind::Video,
                items: vec![],
            });
        project
            .timeline
            .tracks
            .push(forgecut_core::types::Track {
                id: uuid::Uuid::new_v4(),
                kind: forgecut_core::types::TrackKind::Audio,
                items: vec![],
            });
    }
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn trim_clip(
    item_id: String,
    trim_type: String,
    new_us: i64,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let uuid = uuid::Uuid::parse_str(&item_id).map_err(|e| e.to_string())?;
    let mut project = state.project.lock().unwrap();
    let mut history = state.history.lock().unwrap();

    let cmd: Box<dyn forgecut_core::history::Command> = if trim_type == "in" {
        Box::new(forgecut_core::history::TrimInCommand::new(
            uuid,
            forgecut_core::types::TimeUs(new_us),
        ))
    } else {
        Box::new(forgecut_core::history::TrimOutCommand::new(
            uuid,
            forgecut_core::types::TimeUs(new_us),
        ))
    };

    history
        .execute(cmd, &mut project.timeline)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn split_clip(
    item_id: String,
    split_time_us: i64,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let uuid = uuid::Uuid::parse_str(&item_id).map_err(|e| e.to_string())?;
    let mut project = state.project.lock().unwrap();
    let mut history = state.history.lock().unwrap();

    let cmd = Box::new(forgecut_core::history::SplitCommand::new(
        uuid,
        forgecut_core::types::TimeUs(split_time_us),
    ));
    history
        .execute(cmd, &mut project.timeline)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_clip(
    item_id: String,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let uuid = uuid::Uuid::parse_str(&item_id).map_err(|e| e.to_string())?;
    let mut project = state.project.lock().unwrap();
    let mut history = state.history.lock().unwrap();

    let cmd = Box::new(forgecut_core::history::RemoveItemCommand::new(uuid));
    history
        .execute(cmd, &mut project.timeline)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_clip(
    item_id: String,
    new_start_us: i64,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let uuid = uuid::Uuid::parse_str(&item_id).map_err(|e| e.to_string())?;
    let mut project = state.project.lock().unwrap();
    let mut history = state.history.lock().unwrap();

    let cmd = Box::new(forgecut_core::history::MoveItemCommand::new(
        uuid,
        forgecut_core::types::TimeUs(new_start_us),
    ));
    history
        .execute(cmd, &mut project.timeline)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn undo(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let mut project = state.project.lock().unwrap();
    let mut history = state.history.lock().unwrap();
    history
        .undo(&mut project.timeline)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn redo(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let mut project = state.project.lock().unwrap();
    let mut history = state.history.lock().unwrap();
    history
        .redo(&mut project.timeline)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

/// Given a playhead position in microseconds, find the clip under it and return
/// the file path and the seek offset within that clip.
#[tauri::command]
fn get_media_port(state: tauri::State<AppState>) -> Result<u16, String> {
    Ok(state.media_server_port)
}

#[tauri::command]
fn get_clip_at_playhead(
    playhead_us: i64,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let project = state.project.lock().unwrap();
    let playhead = forgecut_core::types::TimeUs(playhead_us);

    // Search video tracks first, then audio
    for track in &project.timeline.tracks {
        for item in &track.items {
            let start = item.timeline_start_us();
            let end = item.timeline_end_us();
            if playhead >= start && playhead < end {
                if let Some(asset_id) = item.asset_id() {
                    if let Some(asset) = project.assets.iter().find(|a| a.id == asset_id) {
                        // Calculate seek offset into the source file
                        let offset_in_timeline = forgecut_core::types::TimeUs(playhead.0 - start.0);
                        let source_in = match item {
                            forgecut_core::types::Item::VideoClip { source_in_us, .. } => *source_in_us,
                            forgecut_core::types::Item::AudioClip { source_in_us, .. } => *source_in_us,
                            _ => forgecut_core::types::TimeUs::ZERO,
                        };
                        let seek_us = forgecut_core::types::TimeUs(source_in.0 + offset_in_timeline.0);

                        return Ok(serde_json::json!({
                            "file_path": asset.path.to_string_lossy(),
                            "seek_seconds": seek_us.as_seconds(),
                            "clip_start_us": start.0,
                            "clip_end_us": end.0,
                            "source_in_us": source_in.0,
                        }));
                    }
                }
            }
        }
    }
    // No clip at playhead
    Ok(serde_json::json!(null))
}

#[tauri::command]
fn set_clip_volume(
    item_id: String,
    volume: f64,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let uuid = uuid::Uuid::parse_str(&item_id).map_err(|e| e.to_string())?;
    let mut project = state.project.lock().unwrap();
    for track in &mut project.timeline.tracks {
        for item in &mut track.items {
            if item.id() == uuid {
                if let forgecut_core::types::Item::AudioClip { volume: vol, .. } = item {
                    *vol = volume;
                }
            }
        }
    }
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_image_overlay(
    asset_id: String,
    timeline_start_us: i64,
    duration_us: i64,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    opacity: f64,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let asset_uuid = uuid::Uuid::parse_str(&asset_id).map_err(|e| e.to_string())?;
    let mut project = state.project.lock().unwrap();

    // Find or create an OverlayImage track
    let track_id = project
        .timeline
        .tracks
        .iter()
        .find(|t| t.kind == forgecut_core::types::TrackKind::OverlayImage)
        .map(|t| t.id);

    let track_id = match track_id {
        Some(id) => id,
        None => {
            let id = uuid::Uuid::new_v4();
            project
                .timeline
                .tracks
                .push(forgecut_core::types::Track {
                    id,
                    kind: forgecut_core::types::TrackKind::OverlayImage,
                    items: vec![],
                });
            id
        }
    };

    let item = forgecut_core::types::Item::ImageOverlay {
        id: uuid::Uuid::new_v4(),
        asset_id: asset_uuid,
        track_id,
        timeline_start_us: forgecut_core::types::TimeUs(timeline_start_us),
        duration_us: forgecut_core::types::TimeUs(duration_us),
        x,
        y,
        width,
        height,
        opacity,
    };

    project
        .timeline
        .add_item(track_id, item)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_text_overlay(
    track_id: String,
    timeline_start_us: i64,
    duration_us: i64,
    text: String,
    font_size: u32,
    color: String,
    x: i32,
    y: i32,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let track_uuid = uuid::Uuid::parse_str(&track_id).map_err(|e| e.to_string())?;
    let mut project = state.project.lock().unwrap();

    let item = forgecut_core::types::Item::TextOverlay {
        id: uuid::Uuid::new_v4(),
        track_id: track_uuid,
        timeline_start_us: forgecut_core::types::TimeUs(timeline_start_us),
        duration_us: forgecut_core::types::TimeUs(duration_us),
        text,
        font_size,
        color,
        x,
        y,
    };

    // Ensure an overlay text track exists
    if !project
        .timeline
        .tracks
        .iter()
        .any(|t| t.kind == forgecut_core::types::TrackKind::OverlayText)
    {
        project
            .timeline
            .tracks
            .push(forgecut_core::types::Track {
                id: track_uuid,
                kind: forgecut_core::types::TrackKind::OverlayText,
                items: vec![],
            });
    }

    let text_track_id = project
        .timeline
        .tracks
        .iter()
        .find(|t| t.kind == forgecut_core::types::TrackKind::OverlayText)
        .unwrap()
        .id;

    project
        .timeline
        .add_item(text_track_id, item)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_overlays_at_time(
    playhead_us: i64,
    state: tauri::State<AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let project = state.project.lock().unwrap();
    let playhead = forgecut_core::types::TimeUs(playhead_us);
    let mut overlays = Vec::new();

    for track in &project.timeline.tracks {
        if track.kind != forgecut_core::types::TrackKind::OverlayImage
            && track.kind != forgecut_core::types::TrackKind::OverlayText
        {
            continue;
        }
        for item in &track.items {
            let start = item.timeline_start_us();
            let end = item.timeline_end_us();
            if playhead >= start && playhead < end {
                let mut val = serde_json::to_value(item).map_err(|e| e.to_string())?;
                // For image overlays, attach the file path
                if let Some(asset_id) = item.asset_id() {
                    if let Some(asset) = project.assets.iter().find(|a| a.id == asset_id) {
                        if let serde_json::Value::Object(ref mut map) = val {
                            // The value is like {"ImageOverlay": {...}}, we need to add file_path inside
                            for (_key, inner) in map.iter_mut() {
                                if let serde_json::Value::Object(ref mut inner_map) = inner {
                                    inner_map.insert(
                                        "file_path".to_string(),
                                        serde_json::Value::String(
                                            asset.path.to_string_lossy().to_string(),
                                        ),
                                    );
                                }
                            }
                        }
                    }
                }
                overlays.push(val);
            }
        }
    }

    Ok(overlays)
}

#[tauri::command]
fn get_item_details(
    item_id: String,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let uuid = uuid::Uuid::parse_str(&item_id).map_err(|e| e.to_string())?;
    let project = state.project.lock().unwrap();
    for track in &project.timeline.tracks {
        for item in &track.items {
            if item.id() == uuid {
                let mut val = serde_json::to_value(item).map_err(|e| e.to_string())?;
                // Attach asset name if applicable
                if let Some(asset_id) = item.asset_id() {
                    if let Some(asset) = project.assets.iter().find(|a| a.id == asset_id) {
                        if let serde_json::Value::Object(ref mut map) = val {
                            for (_key, inner) in map.iter_mut() {
                                if let serde_json::Value::Object(ref mut inner_map) = inner {
                                    inner_map.insert(
                                        "asset_name".to_string(),
                                        serde_json::Value::String(asset.name.clone()),
                                    );
                                }
                            }
                        }
                    }
                }
                return Ok(val);
            }
        }
    }
    Err("Item not found".into())
}

#[tauri::command]
fn update_item_property(
    item_id: String,
    property: String,
    value: serde_json::Value,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let uuid = uuid::Uuid::parse_str(&item_id).map_err(|e| e.to_string())?;
    let mut project = state.project.lock().unwrap();
    for track in &mut project.timeline.tracks {
        for item in &mut track.items {
            if item.id() == uuid {
                match item {
                    forgecut_core::types::Item::VideoClip { .. } => {
                        // VideoClips don't have editable properties via inspector for now
                    }
                    forgecut_core::types::Item::AudioClip { volume, .. } => match property.as_str()
                    {
                        "volume" => {
                            *volume = value.as_f64().ok_or("Invalid volume value")?;
                        }
                        _ => return Err(format!("Unknown property: {}", property)),
                    },
                    forgecut_core::types::Item::TextOverlay {
                        text,
                        font_size,
                        color,
                        x,
                        y,
                        ..
                    } => match property.as_str() {
                        "text" => {
                            *text = value
                                .as_str()
                                .ok_or("Invalid text value")?
                                .to_string();
                        }
                        "font_size" => {
                            *font_size =
                                value.as_u64().ok_or("Invalid font_size value")? as u32;
                        }
                        "color" => {
                            *color = value
                                .as_str()
                                .ok_or("Invalid color value")?
                                .to_string();
                        }
                        "x" => {
                            *x = value.as_i64().ok_or("Invalid x value")? as i32;
                        }
                        "y" => {
                            *y = value.as_i64().ok_or("Invalid y value")? as i32;
                        }
                        _ => return Err(format!("Unknown property: {}", property)),
                    },
                    forgecut_core::types::Item::ImageOverlay {
                        x,
                        y,
                        width,
                        height,
                        opacity,
                        ..
                    } => match property.as_str() {
                        "x" => {
                            *x = value.as_i64().ok_or("Invalid x value")? as i32;
                        }
                        "y" => {
                            *y = value.as_i64().ok_or("Invalid y value")? as i32;
                        }
                        "width" => {
                            *width = value.as_u64().ok_or("Invalid width value")? as u32;
                        }
                        "height" => {
                            *height =
                                value.as_u64().ok_or("Invalid height value")? as u32;
                        }
                        "opacity" => {
                            *opacity = value.as_f64().ok_or("Invalid opacity value")?;
                        }
                        _ => return Err(format!("Unknown property: {}", property)),
                    },
                }
                return serde_json::to_value(&project.timeline)
                    .map_err(|e| e.to_string());
            }
        }
    }
    Err("Item not found".into())
}

#[tauri::command]
fn get_project_settings(
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let project = state.project.lock().unwrap();
    serde_json::to_value(&project.settings).map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_project(
    output_path: String,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let project = state.project.lock().unwrap().clone();

    let plan = forgecut_render::render::compile(&project)
        .map_err(|e| format!("Compile error: {}", e))?;

    let mut plan = plan;
    plan.output_path = std::path::PathBuf::from(&output_path);

    // Calculate total duration for progress
    let total_duration_us = {
        let mut max_end = forgecut_core::types::TimeUs::ZERO;
        for track in &project.timeline.tracks {
            for item in &track.items {
                let end = item.timeline_end_us();
                if end > max_end {
                    max_end = end;
                }
            }
        }
        max_end
    };

    let (progress_tx, mut progress_rx) =
        tokio::sync::watch::channel(forgecut_render::render::RenderProgress::default());

    // Spawn progress reporter
    let app_handle = app.clone();
    tokio::spawn(async move {
        loop {
            if progress_rx.changed().await.is_err() {
                break;
            }
            let progress = progress_rx.borrow().clone();
            let _ = app_handle.emit(
                "export-progress",
                serde_json::to_value(&progress).unwrap(),
            );
            if progress.percent >= 100.0 {
                break;
            }
        }
    });

    // Run the export
    forgecut_render::render::execute(&plan, progress_tx, total_duration_us)
        .await
        .map_err(|e| format!("Export error: {}", e))?;

    let _ = app.emit(
        "export-complete",
        serde_json::json!({"output_path": output_path}),
    );
    Ok(())
}

fn check_dependencies() {
    let deps = [
        ("ffmpeg", "video rendering/export", "sudo apt install ffmpeg"),
        ("ffprobe", "media file analysis", "sudo apt install ffmpeg"),
    ];

    let mut missing = Vec::new();
    for (bin, purpose, install) in &deps {
        if std::process::Command::new(bin)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_err()
        {
            missing.push((*bin, *purpose, *install));
        }
    }

    if !missing.is_empty() {
        eprintln!("\n=== ForgeCut: Missing required dependencies ===\n");
        for (bin, purpose, install) in &missing {
            eprintln!("  ✗ {bin} -- {purpose}");
            eprintln!("    Install: {install}\n");
        }
        eprintln!("Install with:");
        eprintln!("  sudo apt install ffmpeg\n");
        std::process::exit(1);
    }
}

pub fn run() {
    check_dependencies();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let media_port = start_media_server();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            project: std::sync::Mutex::new(forgecut_core::types::Project::new(
                "Untitled",
                forgecut_core::project::preset_1080p(),
            )),
            history: std::sync::Mutex::new(forgecut_core::history::History::new(100)),
            media_server_port: media_port,
        })
        .invoke_handler(tauri::generate_handler![
            create_project,
            save_project,
            load_project,
            import_assets,
            get_assets,
            remove_asset,
            get_timeline,
            add_clip_to_timeline,
            init_default_tracks,
            trim_clip,
            split_clip,
            delete_clip,
            move_clip,
            undo,
            redo,
            get_clip_at_playhead,
            get_media_port,
            set_clip_volume,
            add_image_overlay,
            add_text_overlay,
            get_overlays_at_time,
            get_item_details,
            update_item_property,
            get_project_settings,
            export_project,
        ])
        .setup(|app| {
            let window =
                app.get_webview_window("main").expect("main window not found");
            tracing::info!("ForgeCut window created: {:?}", window.title());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
