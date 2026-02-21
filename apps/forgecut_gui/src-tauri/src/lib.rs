mod state;

use state::AppState;
use raw_window_handle::HasWindowHandle;
use tauri::Emitter;
use tauri::Manager;

#[tauri::command]
fn create_project(state: tauri::State<AppState>) -> Result<String, String> {
    tracing::info!("create_project called");
    let project = state.project.lock().unwrap();
    serde_json::to_string(&*project).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project(path: String, state: tauri::State<AppState>) -> Result<(), String> {
    tracing::info!("save_project called: {}", path);
    let project = state.project.lock().unwrap();
    project
        .save_to_file(&path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_project(path: String, state: tauri::State<AppState>) -> Result<String, String> {
    tracing::info!("load_project called: {}", path);
    let loaded = forgecut_core::types::Project::load_from_file(&path)
        .map_err(|e| e.to_string())?;
    let mut project = state.project.lock().unwrap();
    *project = loaded;
    // Also reset history since the project changed
    let mut history = state.history.lock().unwrap();
    *history = forgecut_core::history::History::new(100);
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
            Err(e) => return Err(format!("Failed to import {path_str}: {e}")),
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
fn move_clip_to_track(
    item_id: String,
    new_track_id: String,
    new_start_us: i64,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let item_uuid = uuid::Uuid::parse_str(&item_id).map_err(|e| e.to_string())?;
    let track_uuid = uuid::Uuid::parse_str(&new_track_id).map_err(|e| e.to_string())?;
    let mut project = state.project.lock().unwrap();
    let mut history = state.history.lock().unwrap();

    let cmd = Box::new(forgecut_core::history::MoveItemToTrackCommand::new(
        item_uuid,
        track_uuid,
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

#[allow(clippy::too_many_arguments)]
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

#[allow(clippy::too_many_arguments)]
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
                        _ => return Err(format!("Unknown property: {property}")),
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
                        _ => return Err(format!("Unknown property: {property}")),
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
                        _ => return Err(format!("Unknown property: {property}")),
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
fn add_track(kind: String, state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let mut project = state.project.lock().unwrap();
    let track_kind = match kind.as_str() {
        "Video" => forgecut_core::types::TrackKind::Video,
        "Audio" => forgecut_core::types::TrackKind::Audio,
        "OverlayImage" => forgecut_core::types::TrackKind::OverlayImage,
        "OverlayText" => forgecut_core::types::TrackKind::OverlayText,
        _ => return Err(format!("Unknown track kind: {kind}")),
    };
    project.timeline.tracks.push(forgecut_core::types::Track {
        id: uuid::Uuid::new_v4(),
        kind: track_kind,
        items: vec![],
    });
    serde_json::to_value(&project.timeline).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_snap_points(
    exclude_item_id: Option<String>,
    state: tauri::State<AppState>,
) -> Result<Vec<i64>, String> {
    let exclude_uuid = exclude_item_id.and_then(|s| uuid::Uuid::parse_str(&s).ok());
    let project = state.project.lock().unwrap();
    let points = forgecut_core::snapping::collect_snap_points(&project.timeline, exclude_uuid);
    Ok(points.iter().map(|p| p.0).collect())
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
        .map_err(|e| format!("Compile error: {e}"))?;

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
        .map_err(|e| format!("Export error: {e}"))?;

    let _ = app.emit(
        "export-complete",
        serde_json::json!({"output_path": output_path}),
    );
    Ok(())
}

#[tauri::command]
fn generate_proxy(asset_id: String, state: tauri::State<AppState>) -> Result<String, String> {
    let project = state.project.lock().unwrap();
    let asset = project
        .assets
        .iter()
        .find(|a| a.id.to_string() == asset_id)
        .ok_or("Asset not found")?;

    let proxy_dir = std::env::temp_dir().join("forgecut-proxies");
    let proxy_path =
        forgecut_render::proxy::generate_proxy(&asset.path, &proxy_dir, &asset_id)
            .map_err(|e| e.to_string())?;

    Ok(proxy_path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_proxy_path(asset_id: String) -> Result<Option<String>, String> {
    let proxy_dir = std::env::temp_dir().join("forgecut-proxies");
    Ok(
        forgecut_render::proxy::proxy_path(&proxy_dir, &asset_id)
            .map(|p| p.to_string_lossy().to_string()),
    )
}

#[tauri::command]
fn autosave(state: tauri::State<AppState>) -> Result<(), String> {
    let project = state.project.lock().unwrap();
    let autosave_dir = std::env::temp_dir().join("forgecut-autosave");
    std::fs::create_dir_all(&autosave_dir).map_err(|e| e.to_string())?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let filename = format!("autosave-{timestamp}.forgecut");
    let path = autosave_dir.join(&filename);

    project.save_to_file(&path).map_err(|e| e.to_string())?;

    // Clean old autosaves (keep last 5)
    let mut entries: Vec<_> = std::fs::read_dir(&autosave_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("autosave-"))
        .collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
    for old in entries.into_iter().skip(5) {
        let _ = std::fs::remove_file(old.path());
    }

    tracing::info!("Autosaved to {}", path.display());
    Ok(())
}

#[tauri::command]
fn get_autosave_path() -> Result<Option<String>, String> {
    let autosave_dir = std::env::temp_dir().join("forgecut-autosave");
    if !autosave_dir.exists() {
        return Ok(None);
    }

    let mut entries: Vec<_> = std::fs::read_dir(&autosave_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("autosave-"))
        .collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.file_name()));

    Ok(entries
        .first()
        .map(|e| e.path().to_string_lossy().to_string()))
}

#[tauri::command]
async fn get_clip_thumbnails(asset_id: String, state: tauri::State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let (asset_path, duration_seconds, aid) = {
        let project = state.project.lock().unwrap();
        let asset = project
            .assets
            .iter()
            .find(|a| a.id.to_string() == asset_id)
            .ok_or("Asset not found")?;

        let duration = asset
            .probe
            .as_ref()
            .map(|p| p.duration_us.as_seconds())
            .unwrap_or(5.0);

        (asset.path.clone(), duration, asset_id.clone())
    };

    let thumbs = tokio::task::spawn_blocking(move || {
        let cache_dir = std::env::temp_dir().join("forgecut-thumbnails");
        forgecut_render::thumbnails::extract_thumbnails_base64(
            &asset_path,
            &cache_dir,
            &aid,
            duration_seconds,
            2.0,
            160,
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    Ok(thumbs
        .into_iter()
        .map(|(time_seconds, data_uri)| {
            serde_json::json!({
                "time_seconds": time_seconds,
                "data_uri": data_uri,
            })
        })
        .collect())
}

#[tauri::command]
fn get_waveform(asset_id: String, state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let project = state.project.lock().unwrap();
    let asset = project
        .assets
        .iter()
        .find(|a| a.id.to_string() == asset_id)
        .ok_or("Asset not found")?;

    let cache_dir = std::env::temp_dir().join("forgecut-waveforms");
    let data = forgecut_render::waveform::extract_waveform(&asset.path, &cache_dir, &asset_id, 256)
        .map_err(|e| e.to_string())?;

    serde_json::to_value(&data).map_err(|e| e.to_string())
}

#[tauri::command]
fn mpv_start(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    state: tauri::State<AppState>,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let parent_xid = {
        let handle = window
            .window_handle()
            .map_err(|e| format!("window handle error: {e}"))?;
        match handle.as_ref() {
            raw_window_handle::RawWindowHandle::Xlib(h) => h.window as u64,
            raw_window_handle::RawWindowHandle::Xcb(h) => h.window.get() as u64,
            other => return Err(format!("Unsupported window handle type: {other:?}")),
        }
    };

    let mut mpv = state.mpv.lock().unwrap();
    mpv.start_embedded(parent_xid, x, y, w, h)
}

#[tauri::command]
fn mpv_stop(state: tauri::State<AppState>) -> Result<(), String> {
    let mut mpv = state.mpv.lock().unwrap();
    mpv.stop();
    Ok(())
}

#[tauri::command]
fn mpv_load_file(path: String, state: tauri::State<AppState>) -> Result<(), String> {
    let mpv = state.mpv.lock().unwrap();
    mpv.load_file(&path)
}

#[tauri::command]
fn mpv_seek(seconds: f64, state: tauri::State<AppState>) -> Result<(), String> {
    let mpv = state.mpv.lock().unwrap();
    mpv.seek(seconds)
}

#[tauri::command]
fn mpv_pause(state: tauri::State<AppState>) -> Result<(), String> {
    let mpv = state.mpv.lock().unwrap();
    mpv.pause()
}

#[tauri::command]
fn mpv_resume(state: tauri::State<AppState>) -> Result<(), String> {
    let mpv = state.mpv.lock().unwrap();
    mpv.resume()
}

#[tauri::command]
fn mpv_get_position(state: tauri::State<AppState>) -> Result<f64, String> {
    let mpv = state.mpv.lock().unwrap();
    mpv.get_position()
}

#[tauri::command]
fn mpv_hide(state: tauri::State<AppState>) -> Result<(), String> {
    let mpv = state.mpv.lock().unwrap();
    mpv.hide();
    Ok(())
}

#[tauri::command]
fn mpv_show(state: tauri::State<AppState>) -> Result<(), String> {
    let mpv = state.mpv.lock().unwrap();
    mpv.show();
    Ok(())
}

#[tauri::command]
fn mpv_update_geometry(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let mpv = state.mpv.lock().unwrap();
    mpv.update_geometry(x, y, w, h);
    Ok(())
}

fn check_dependencies() {
    let deps = [
        ("ffmpeg", "video rendering/export", "sudo apt install ffmpeg"),
        ("ffprobe", "media file analysis", "sudo apt install ffmpeg"),
        ("mpv", "video preview playback", "sudo apt install mpv"),
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
            mpv: std::sync::Mutex::new(forgecut_preview::mpv::MpvController::new()),
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
            move_clip_to_track,
            undo,
            redo,
            get_clip_at_playhead,
            set_clip_volume,
            add_image_overlay,
            add_text_overlay,
            get_overlays_at_time,
            get_item_details,
            update_item_property,
            get_snap_points,
            add_track,
            get_project_settings,
            export_project,
            generate_proxy,
            get_proxy_path,
            autosave,
            get_autosave_path,
            get_clip_thumbnails,
            get_waveform,
            mpv_start,
            mpv_stop,
            mpv_load_file,
            mpv_seek,
            mpv_pause,
            mpv_resume,
            mpv_get_position,
            mpv_update_geometry,
            mpv_hide,
            mpv_show,
        ])
        .setup(|app| {
            // Set GTK default icon so ALL windows (including file dialogs) show it
            {
                use gdk_pixbuf::prelude::PixbufLoaderExt;
                let icon_bytes = include_bytes!("../icons/icon.png");
                let loader = gdk_pixbuf::PixbufLoader::with_type("png").expect("png loader");
                loader.write(icon_bytes).expect("icon write");
                loader.close().expect("icon close");
                if let Some(pixbuf) = loader.pixbuf() {
                    gtk::Window::set_default_icon(&pixbuf);
                }
            }

            let window =
                app.get_webview_window("main").expect("main window not found");
            tracing::info!("ForgeCut window created: {:?}", window.title());

            // Kill mpv on window close to prevent orphan processes
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    if let Some(state) = app_handle.try_state::<AppState>() {
                        let mut mpv = state.mpv.lock().unwrap();
                        mpv.stop();
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
