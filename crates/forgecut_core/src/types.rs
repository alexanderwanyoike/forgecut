use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::{Add, Div, Mul, Sub};
use std::path::PathBuf;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// TimeUs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TimeUs(pub i64);

impl TimeUs {
    pub const ZERO: Self = Self(0);

    pub fn from_seconds(s: f64) -> Self {
        Self((s * 1_000_000.0) as i64)
    }

    pub fn as_seconds(&self) -> f64 {
        self.0 as f64 / 1_000_000.0
    }
}

impl Add for TimeUs {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self(self.0 + rhs.0)
    }
}

impl Sub for TimeUs {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        Self(self.0 - rhs.0)
    }
}

impl Mul<i64> for TimeUs {
    type Output = Self;
    fn mul(self, rhs: i64) -> Self {
        Self(self.0 * rhs)
    }
}

impl Div<i64> for TimeUs {
    type Output = Self;
    fn div(self, rhs: i64) -> Self {
        Self(self.0 / rhs)
    }
}

impl fmt::Display for TimeUs {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let total_us = self.0.unsigned_abs();
        let total_ms = total_us / 1_000;
        let ms = total_ms % 1_000;
        let total_secs = total_ms / 1_000;
        let secs = total_secs % 60;
        let total_mins = total_secs / 60;
        let mins = total_mins % 60;
        let hours = total_mins / 60;
        if self.0 < 0 {
            write!(f, "-{:02}:{:02}:{:02}.{:03}", hours, mins, secs, ms)
        } else {
            write!(f, "{:02}:{:02}:{:02}.{:03}", hours, mins, secs, ms)
        }
    }
}

// ---------------------------------------------------------------------------
// AssetKind
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AssetKind {
    Video,
    Audio,
    Image,
}

// ---------------------------------------------------------------------------
// ProbeResult
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProbeResult {
    pub duration_us: TimeUs,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
    pub audio_channels: u32,
    pub audio_sample_rate: u32,
}

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Asset {
    pub id: Uuid,
    pub name: String,
    pub path: PathBuf,
    pub kind: AssetKind,
    pub probe: Option<ProbeResult>,
}

// ---------------------------------------------------------------------------
// TrackKind
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TrackKind {
    Video,
    Audio,
    OverlayImage,
    OverlayText,
}

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Item {
    VideoClip {
        id: Uuid,
        asset_id: Uuid,
        track_id: Uuid,
        timeline_start_us: TimeUs,
        source_in_us: TimeUs,
        source_out_us: TimeUs,
    },
    AudioClip {
        id: Uuid,
        asset_id: Uuid,
        track_id: Uuid,
        timeline_start_us: TimeUs,
        source_in_us: TimeUs,
        source_out_us: TimeUs,
        volume: f64,
    },
    ImageOverlay {
        id: Uuid,
        asset_id: Uuid,
        track_id: Uuid,
        timeline_start_us: TimeUs,
        duration_us: TimeUs,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        opacity: f64,
    },
    TextOverlay {
        id: Uuid,
        track_id: Uuid,
        timeline_start_us: TimeUs,
        duration_us: TimeUs,
        text: String,
        font_size: u32,
        color: String,
        x: i32,
        y: i32,
    },
}

impl Item {
    pub fn id(&self) -> Uuid {
        match self {
            Item::VideoClip { id, .. } => *id,
            Item::AudioClip { id, .. } => *id,
            Item::ImageOverlay { id, .. } => *id,
            Item::TextOverlay { id, .. } => *id,
        }
    }

    pub fn timeline_start_us(&self) -> TimeUs {
        match self {
            Item::VideoClip { timeline_start_us, .. } => *timeline_start_us,
            Item::AudioClip { timeline_start_us, .. } => *timeline_start_us,
            Item::ImageOverlay { timeline_start_us, .. } => *timeline_start_us,
            Item::TextOverlay { timeline_start_us, .. } => *timeline_start_us,
        }
    }

    pub fn duration_us(&self) -> TimeUs {
        match self {
            Item::VideoClip { source_in_us, source_out_us, .. } => {
                TimeUs(source_out_us.0 - source_in_us.0)
            }
            Item::AudioClip { source_in_us, source_out_us, .. } => {
                TimeUs(source_out_us.0 - source_in_us.0)
            }
            Item::ImageOverlay { duration_us, .. } => *duration_us,
            Item::TextOverlay { duration_us, .. } => *duration_us,
        }
    }

    pub fn timeline_end_us(&self) -> TimeUs {
        TimeUs(self.timeline_start_us().0 + self.duration_us().0)
    }

    pub fn track_id(&self) -> Uuid {
        match self {
            Item::VideoClip { track_id, .. } => *track_id,
            Item::AudioClip { track_id, .. } => *track_id,
            Item::ImageOverlay { track_id, .. } => *track_id,
            Item::TextOverlay { track_id, .. } => *track_id,
        }
    }

    pub fn asset_id(&self) -> Option<Uuid> {
        match self {
            Item::VideoClip { asset_id, .. } => Some(*asset_id),
            Item::AudioClip { asset_id, .. } => Some(*asset_id),
            Item::ImageOverlay { asset_id, .. } => Some(*asset_id),
            Item::TextOverlay { .. } => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Track
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Track {
    pub id: Uuid,
    pub kind: TrackKind,
    pub items: Vec<Item>,
}

// ---------------------------------------------------------------------------
// Marker
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Marker {
    pub id: Uuid,
    pub time_us: TimeUs,
    pub label: String,
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Timeline {
    pub tracks: Vec<Track>,
    pub markers: Vec<Marker>,
}

// ---------------------------------------------------------------------------
// ProjectSettings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectSettings {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub sample_rate: u32,
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub settings: ProjectSettings,
    pub assets: Vec<Asset>,
    pub timeline: Timeline,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_us_add_sub() {
        let a = TimeUs(5_000_000);
        let b = TimeUs(3_000_000);
        assert_eq!(a + b, TimeUs(8_000_000));
        assert_eq!(a - b, TimeUs(2_000_000));
    }

    #[test]
    fn time_us_from_seconds_as_seconds() {
        let t = TimeUs::from_seconds(2.5);
        assert_eq!(t, TimeUs(2_500_000));
        assert!((t.as_seconds() - 2.5).abs() < 1e-9);
    }

    #[test]
    fn time_us_display() {
        assert_eq!(TimeUs(0).to_string(), "00:00:00.000");
        assert_eq!(TimeUs(1_500_000).to_string(), "00:00:01.500");
        assert_eq!(TimeUs::from_seconds(3661.5).to_string(), "01:01:01.500");
    }

    #[test]
    fn time_us_ordering() {
        let a = TimeUs(1_000_000);
        let b = TimeUs(2_000_000);
        assert!(a < b);
        assert!(b > a);
        assert_eq!(a, TimeUs(1_000_000));
    }

    #[test]
    fn time_us_mul_div() {
        let t = TimeUs(2_000_000);
        assert_eq!(t * 3, TimeUs(6_000_000));
        assert_eq!(t / 2, TimeUs(1_000_000));
    }

    #[test]
    fn time_us_zero() {
        assert_eq!(TimeUs::ZERO, TimeUs(0));
    }

    #[test]
    fn serde_roundtrip_time_us() {
        let t = TimeUs(42_000_000);
        let json = serde_json::to_string(&t).unwrap();
        let back: TimeUs = serde_json::from_str(&json).unwrap();
        assert_eq!(t, back);
    }

    #[test]
    fn serde_roundtrip_asset() {
        let asset = Asset {
            id: Uuid::new_v4(),
            name: "test.mp4".to_string(),
            path: PathBuf::from("/tmp/test.mp4"),
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
        };
        let json = serde_json::to_string(&asset).unwrap();
        let back: Asset = serde_json::from_str(&json).unwrap();
        assert_eq!(asset, back);
    }

    #[test]
    fn serde_roundtrip_item() {
        let item = Item::VideoClip {
            id: Uuid::new_v4(),
            asset_id: Uuid::new_v4(),
            track_id: Uuid::new_v4(),
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs(0),
            source_out_us: TimeUs(5_000_000),
        };
        let json = serde_json::to_string(&item).unwrap();
        let back: Item = serde_json::from_str(&json).unwrap();
        assert_eq!(item, back);
    }

    #[test]
    fn serde_roundtrip_track() {
        let track = Track {
            id: Uuid::new_v4(),
            kind: TrackKind::Video,
            items: vec![],
        };
        let json = serde_json::to_string(&track).unwrap();
        let back: Track = serde_json::from_str(&json).unwrap();
        assert_eq!(track, back);
    }

    #[test]
    fn serde_roundtrip_timeline() {
        let timeline = Timeline {
            tracks: vec![],
            markers: vec![Marker {
                id: Uuid::new_v4(),
                time_us: TimeUs(1_000_000),
                label: "intro".to_string(),
            }],
        };
        let json = serde_json::to_string(&timeline).unwrap();
        let back: Timeline = serde_json::from_str(&json).unwrap();
        assert_eq!(timeline, back);
    }

    #[test]
    fn serde_roundtrip_project() {
        let project = Project {
            id: Uuid::new_v4(),
            name: "My Project".to_string(),
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
        let json = serde_json::to_string(&project).unwrap();
        let back: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(project, back);
    }

    #[test]
    fn item_accessor_methods() {
        let item_id = Uuid::new_v4();
        let asset_id = Uuid::new_v4();
        let track_id = Uuid::new_v4();

        let video = Item::VideoClip {
            id: item_id,
            asset_id,
            track_id,
            timeline_start_us: TimeUs(1_000_000),
            source_in_us: TimeUs(0),
            source_out_us: TimeUs(5_000_000),
        };

        assert_eq!(video.id(), item_id);
        assert_eq!(video.timeline_start_us(), TimeUs(1_000_000));
        assert_eq!(video.duration_us(), TimeUs(5_000_000));
        assert_eq!(video.timeline_end_us(), TimeUs(6_000_000));
        assert_eq!(video.track_id(), track_id);
        assert_eq!(video.asset_id(), Some(asset_id));

        let text = Item::TextOverlay {
            id: item_id,
            track_id,
            timeline_start_us: TimeUs(0),
            duration_us: TimeUs(3_000_000),
            text: "Hello".to_string(),
            font_size: 24,
            color: "#ffffff".to_string(),
            x: 100,
            y: 200,
        };

        assert_eq!(text.asset_id(), None);
        assert_eq!(text.duration_us(), TimeUs(3_000_000));
        assert_eq!(text.timeline_end_us(), TimeUs(3_000_000));
    }

    #[test]
    fn item_audio_clip_accessors() {
        let item_id = Uuid::new_v4();
        let asset_id = Uuid::new_v4();
        let track_id = Uuid::new_v4();

        let audio = Item::AudioClip {
            id: item_id,
            asset_id,
            track_id,
            timeline_start_us: TimeUs(2_000_000),
            source_in_us: TimeUs(1_000_000),
            source_out_us: TimeUs(4_000_000),
            volume: 0.8,
        };

        assert_eq!(audio.id(), item_id);
        assert_eq!(audio.timeline_start_us(), TimeUs(2_000_000));
        assert_eq!(audio.duration_us(), TimeUs(3_000_000));
        assert_eq!(audio.timeline_end_us(), TimeUs(5_000_000));
        assert_eq!(audio.track_id(), track_id);
        assert_eq!(audio.asset_id(), Some(asset_id));
    }

    #[test]
    fn item_image_overlay_accessors() {
        let item_id = Uuid::new_v4();
        let asset_id = Uuid::new_v4();
        let track_id = Uuid::new_v4();

        let img = Item::ImageOverlay {
            id: item_id,
            asset_id,
            track_id,
            timeline_start_us: TimeUs(0),
            duration_us: TimeUs(2_000_000),
            x: 10,
            y: 20,
            width: 320,
            height: 240,
            opacity: 0.5,
        };

        assert_eq!(img.id(), item_id);
        assert_eq!(img.duration_us(), TimeUs(2_000_000));
        assert_eq!(img.timeline_end_us(), TimeUs(2_000_000));
        assert_eq!(img.asset_id(), Some(asset_id));
    }

}
