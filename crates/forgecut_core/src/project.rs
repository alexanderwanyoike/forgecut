use crate::error::{CoreError, Result};
use crate::types::*;
use std::path::Path;
use uuid::Uuid;

impl Project {
    /// Create a new empty project with the given name and settings.
    pub fn new(name: impl Into<String>, settings: ProjectSettings) -> Self {
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            settings,
            assets: vec![],
            timeline: Timeline::new(),
        }
    }

    /// Save project to a file as pretty-printed JSON.
    /// Automatically appends `.forgecut` extension if not present.
    pub fn save_to_file(&self, path: impl AsRef<Path>) -> Result<()> {
        let path = ensure_extension(path.as_ref());
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    /// Load a project from a JSON file.
    pub fn load_from_file(path: impl AsRef<Path>) -> Result<Self> {
        let data = std::fs::read_to_string(path.as_ref()).map_err(|e| {
            CoreError::Io(e)
        })?;
        let project: Project = serde_json::from_str(&data)?;
        Ok(project)
    }
}

impl Timeline {
    pub fn new() -> Self {
        Self {
            tracks: vec![],
            markers: vec![],
        }
    }
}

impl Default for Timeline {
    fn default() -> Self {
        Self::new()
    }
}

/// 1920x1080 30fps preset.
pub fn preset_1080p() -> ProjectSettings {
    ProjectSettings {
        width: 1920,
        height: 1080,
        fps: 30.0,
        sample_rate: 48000,
    }
}

/// 1080x1920 30fps (vertical/shorts) preset.
pub fn preset_shorts() -> ProjectSettings {
    ProjectSettings {
        width: 1080,
        height: 1920,
        fps: 30.0,
        sample_rate: 48000,
    }
}

/// 1280x720 30fps preset.
pub fn preset_720p() -> ProjectSettings {
    ProjectSettings {
        width: 1280,
        height: 720,
        fps: 30.0,
        sample_rate: 48000,
    }
}

/// 3840x2160 30fps (4K) preset.
pub fn preset_4k() -> ProjectSettings {
    ProjectSettings {
        width: 3840,
        height: 2160,
        fps: 30.0,
        sample_rate: 48000,
    }
}

/// 1920x1080 60fps preset.
pub fn preset_1080p_60() -> ProjectSettings {
    ProjectSettings {
        width: 1920,
        height: 1080,
        fps: 60.0,
        sample_rate: 48000,
    }
}

fn ensure_extension(path: &Path) -> std::path::PathBuf {
    if path.extension().and_then(|e| e.to_str()) == Some("forgecut") {
        path.to_path_buf()
    } else {
        let mut p = path.to_path_buf();
        let mut name = p
            .file_name()
            .unwrap_or_default()
            .to_os_string();
        name.push(".forgecut");
        p.set_file_name(name);
        p
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    #[test]
    fn create_save_load_roundtrip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test_project.forgecut");

        let project = Project::new("Test Project", preset_1080p());
        project.save_to_file(&path).unwrap();

        let loaded = Project::load_from_file(&path).unwrap();
        assert_eq!(project, loaded);
    }

    #[test]
    fn save_load_with_assets_and_clips() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("populated.forgecut");

        let asset_id = Uuid::new_v4();
        let track_id = Uuid::new_v4();

        let mut project = Project::new("Populated", preset_1080p());
        project.assets.push(Asset {
            id: asset_id,
            name: "clip.mp4".to_string(),
            path: PathBuf::from("/media/clip.mp4"),
            kind: AssetKind::Video,
            probe: Some(ProbeResult {
                duration_us: TimeUs(10_000_000),
                width: 1920,
                height: 1080,
                fps: 30.0,
                codec: "h264".to_string(),
                audio_channels: 2,
                audio_sample_rate: 48000,
            }),
        });
        project.timeline.tracks.push(Track {
            id: track_id,
            kind: TrackKind::Video,
            items: vec![Item::VideoClip {
                id: Uuid::new_v4(),
                asset_id,
                track_id,
                timeline_start_us: TimeUs(0),
                source_in_us: TimeUs(0),
                source_out_us: TimeUs(5_000_000),
            }],
        });

        project.save_to_file(&path).unwrap();
        let loaded = Project::load_from_file(&path).unwrap();
        assert_eq!(project, loaded);
    }

    #[test]
    fn load_nonexistent_file_returns_error() {
        let result = Project::load_from_file("/tmp/does_not_exist_forgecut_test.forgecut");
        assert!(result.is_err());
    }

    #[test]
    fn preset_values_are_correct() {
        let p1080 = preset_1080p();
        assert_eq!(p1080.width, 1920);
        assert_eq!(p1080.height, 1080);
        assert_eq!(p1080.fps, 30.0);
        assert_eq!(p1080.sample_rate, 48000);

        let shorts = preset_shorts();
        assert_eq!(shorts.width, 1080);
        assert_eq!(shorts.height, 1920);
        assert_eq!(shorts.fps, 30.0);
        assert_eq!(shorts.sample_rate, 48000);

        let p720 = preset_720p();
        assert_eq!(p720.width, 1280);
        assert_eq!(p720.height, 720);
        assert_eq!(p720.fps, 30.0);
        assert_eq!(p720.sample_rate, 48000);

        let p4k = preset_4k();
        assert_eq!(p4k.width, 3840);
        assert_eq!(p4k.height, 2160);
        assert_eq!(p4k.fps, 30.0);
        assert_eq!(p4k.sample_rate, 48000);

        let p1080_60 = preset_1080p_60();
        assert_eq!(p1080_60.width, 1920);
        assert_eq!(p1080_60.height, 1080);
        assert_eq!(p1080_60.fps, 60.0);
        assert_eq!(p1080_60.sample_rate, 48000);
    }

    #[test]
    fn extension_appended_if_missing() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("no_ext");

        let project = Project::new("ExtTest", preset_720p());
        project.save_to_file(&path).unwrap();

        // The file should have been saved with .forgecut extension
        let expected_path = dir.path().join("no_ext.forgecut");
        assert!(expected_path.exists());

        let loaded = Project::load_from_file(&expected_path).unwrap();
        assert_eq!(project, loaded);
    }

    #[test]
    fn timeline_default() {
        let tl = Timeline::default();
        assert!(tl.tracks.is_empty());
        assert!(tl.markers.is_empty());
    }
}
