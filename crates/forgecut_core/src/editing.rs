use crate::error::{CoreError, Result};
use crate::types::*;
use uuid::Uuid;

impl Timeline {
    /// Add a clip/item to a track. Returns error if it would overlap existing items.
    pub fn add_item(&mut self, track_id: Uuid, item: Item) -> Result<()> {
        let track = self
            .tracks
            .iter_mut()
            .find(|t| t.id == track_id)
            .ok_or(CoreError::TrackNotFound(track_id))?;

        for existing in &track.items {
            if items_overlap(existing, &item) {
                return Err(CoreError::OverlapDetected);
            }
        }

        track.items.push(item);
        Ok(())
    }

    /// Remove an item by its id. Returns the removed item.
    pub fn remove_item(&mut self, item_id: Uuid) -> Result<Item> {
        for track in &mut self.tracks {
            if let Some(pos) = track.items.iter().position(|i| i.id() == item_id) {
                return Ok(track.items.remove(pos));
            }
        }
        Err(CoreError::ItemNotFound(item_id))
    }

    /// Move an item to a new timeline position. Checks for overlaps at new position.
    pub fn move_item(&mut self, item_id: Uuid, new_start_us: TimeUs) -> Result<()> {
        // Find and temporarily remove the item
        let (track_idx, item_idx) = self
            .find_item_location(item_id)
            .ok_or(CoreError::ItemNotFound(item_id))?;

        let mut item = self.tracks[track_idx].items.remove(item_idx);
        let original_start = item.timeline_start_us();

        // Update the timeline start position
        set_timeline_start(&mut item, new_start_us);

        // Check for overlaps with remaining items on the same track
        for existing in &self.tracks[track_idx].items {
            if items_overlap(existing, &item) {
                // Rollback: restore original position and re-insert
                set_timeline_start(&mut item, original_start);
                self.tracks[track_idx].items.insert(item_idx, item);
                return Err(CoreError::OverlapDetected);
            }
        }

        self.tracks[track_idx].items.push(item);
        Ok(())
    }

    /// Trim the in-point of a clip.
    /// For VideoClip/AudioClip: new_in_us is the new source_in_us. Adjusts timeline_start_us
    /// so the end position stays the same. Validates source_in < source_out.
    /// For overlays: adjusts timeline_start_us and duration_us to keep end fixed.
    pub fn trim_in(&mut self, item_id: Uuid, new_in_us: TimeUs) -> Result<()> {
        let (track_idx, item_idx) = self
            .find_item_location(item_id)
            .ok_or(CoreError::ItemNotFound(item_id))?;

        let item = &mut self.tracks[track_idx].items[item_idx];
        let original_end = item.timeline_end_us();

        match item {
            Item::VideoClip {
                source_in_us,
                source_out_us,
                timeline_start_us,
                ..
            } => {
                if new_in_us >= *source_out_us {
                    return Err(CoreError::InvalidOperation(
                        "source_in must be less than source_out".into(),
                    ));
                }
                *source_in_us = new_in_us;
                // Adjust timeline_start so end stays the same:
                // new_start = old_end - new_duration
                *timeline_start_us = TimeUs(original_end.0 - (source_out_us.0 - new_in_us.0));
            }
            Item::AudioClip {
                source_in_us,
                source_out_us,
                timeline_start_us,
                ..
            } => {
                if new_in_us >= *source_out_us {
                    return Err(CoreError::InvalidOperation(
                        "source_in must be less than source_out".into(),
                    ));
                }
                *source_in_us = new_in_us;
                *timeline_start_us = TimeUs(original_end.0 - (source_out_us.0 - new_in_us.0));
            }
            Item::ImageOverlay {
                timeline_start_us,
                duration_us,
                ..
            } => {
                // new_in_us is treated as the new timeline_start_us
                if new_in_us >= original_end {
                    return Err(CoreError::InvalidOperation(
                        "new start must be before end".into(),
                    ));
                }
                *duration_us = TimeUs(original_end.0 - new_in_us.0);
                *timeline_start_us = new_in_us;
            }
            Item::TextOverlay {
                timeline_start_us,
                duration_us,
                ..
            } => {
                if new_in_us >= original_end {
                    return Err(CoreError::InvalidOperation(
                        "new start must be before end".into(),
                    ));
                }
                *duration_us = TimeUs(original_end.0 - new_in_us.0);
                *timeline_start_us = new_in_us;
            }
        }

        // Check overlaps after trim
        let item_clone = self.tracks[track_idx].items[item_idx].clone();
        for (i, existing) in self.tracks[track_idx].items.iter().enumerate() {
            if i != item_idx && items_overlap(existing, &item_clone) {
                // We don't rollback trim_in for simplicity -- caller should check beforehand
                return Err(CoreError::OverlapDetected);
            }
        }

        Ok(())
    }

    /// Trim the out-point of a clip.
    /// For VideoClip/AudioClip: new_out_us is the new source_out_us. Validates source_in < source_out.
    /// For overlays: adjusts duration_us.
    pub fn trim_out(&mut self, item_id: Uuid, new_out_us: TimeUs) -> Result<()> {
        let (track_idx, item_idx) = self
            .find_item_location(item_id)
            .ok_or(CoreError::ItemNotFound(item_id))?;

        let item = &mut self.tracks[track_idx].items[item_idx];

        match item {
            Item::VideoClip {
                source_in_us,
                source_out_us,
                ..
            } => {
                if new_out_us <= *source_in_us {
                    return Err(CoreError::InvalidOperation(
                        "source_out must be greater than source_in".into(),
                    ));
                }
                *source_out_us = new_out_us;
            }
            Item::AudioClip {
                source_in_us,
                source_out_us,
                ..
            } => {
                if new_out_us <= *source_in_us {
                    return Err(CoreError::InvalidOperation(
                        "source_out must be greater than source_in".into(),
                    ));
                }
                *source_out_us = new_out_us;
            }
            Item::ImageOverlay {
                timeline_start_us,
                duration_us,
                ..
            } => {
                let new_dur = TimeUs(new_out_us.0 - timeline_start_us.0);
                if new_dur.0 <= 0 {
                    return Err(CoreError::InvalidOperation(
                        "new out must be after start".into(),
                    ));
                }
                *duration_us = new_dur;
            }
            Item::TextOverlay {
                timeline_start_us,
                duration_us,
                ..
            } => {
                let new_dur = TimeUs(new_out_us.0 - timeline_start_us.0);
                if new_dur.0 <= 0 {
                    return Err(CoreError::InvalidOperation(
                        "new out must be after start".into(),
                    ));
                }
                *duration_us = new_dur;
            }
        }

        // Check overlaps after trim
        let item_clone = self.tracks[track_idx].items[item_idx].clone();
        for (i, existing) in self.tracks[track_idx].items.iter().enumerate() {
            if i != item_idx && items_overlap(existing, &item_clone) {
                return Err(CoreError::OverlapDetected);
            }
        }

        Ok(())
    }

    /// Split an item at a given timeline position into two items.
    /// The position must be strictly between start and end.
    /// Returns the IDs of (left, right) items.
    pub fn split_at(&mut self, item_id: Uuid, split_time_us: TimeUs) -> Result<(Uuid, Uuid)> {
        let (track_idx, item_idx) = self
            .find_item_location(item_id)
            .ok_or(CoreError::ItemNotFound(item_id))?;

        let item = &self.tracks[track_idx].items[item_idx];
        let start = item.timeline_start_us();
        let end = item.timeline_end_us();

        if split_time_us <= start || split_time_us >= end {
            return Err(CoreError::InvalidOperation(
                "split position must be strictly between item start and end".into(),
            ));
        }

        let right_id = Uuid::new_v4();
        let left_id = item.id();

        let (left, right) = match item.clone() {
            Item::VideoClip {
                id,
                asset_id,
                track_id,
                timeline_start_us,
                source_in_us,
                source_out_us,
            } => {
                // Time elapsed from start to split point
                let offset = TimeUs(split_time_us.0 - timeline_start_us.0);
                let split_source = TimeUs(source_in_us.0 + offset.0);

                let left = Item::VideoClip {
                    id,
                    asset_id,
                    track_id,
                    timeline_start_us,
                    source_in_us,
                    source_out_us: split_source,
                };
                let right = Item::VideoClip {
                    id: right_id,
                    asset_id,
                    track_id,
                    timeline_start_us: split_time_us,
                    source_in_us: split_source,
                    source_out_us,
                };
                (left, right)
            }
            Item::AudioClip {
                id,
                asset_id,
                track_id,
                timeline_start_us,
                source_in_us,
                source_out_us,
                volume,
            } => {
                let offset = TimeUs(split_time_us.0 - timeline_start_us.0);
                let split_source = TimeUs(source_in_us.0 + offset.0);

                let left = Item::AudioClip {
                    id,
                    asset_id,
                    track_id,
                    timeline_start_us,
                    source_in_us,
                    source_out_us: split_source,
                    volume,
                };
                let right = Item::AudioClip {
                    id: right_id,
                    asset_id,
                    track_id,
                    timeline_start_us: split_time_us,
                    source_in_us: split_source,
                    source_out_us,
                    volume,
                };
                (left, right)
            }
            Item::ImageOverlay {
                id,
                asset_id,
                track_id,
                timeline_start_us,
                duration_us: _,
                x,
                y,
                width,
                height,
                opacity,
            } => {
                let left_dur = TimeUs(split_time_us.0 - timeline_start_us.0);
                let right_dur = TimeUs(end.0 - split_time_us.0);

                let left = Item::ImageOverlay {
                    id,
                    asset_id,
                    track_id,
                    timeline_start_us,
                    duration_us: left_dur,
                    x,
                    y,
                    width,
                    height,
                    opacity,
                };
                let right = Item::ImageOverlay {
                    id: right_id,
                    asset_id,
                    track_id,
                    timeline_start_us: split_time_us,
                    duration_us: right_dur,
                    x,
                    y,
                    width,
                    height,
                    opacity,
                };
                (left, right)
            }
            Item::TextOverlay {
                id,
                track_id,
                timeline_start_us,
                duration_us: _,
                text,
                font_size,
                color,
                x,
                y,
            } => {
                let left_dur = TimeUs(split_time_us.0 - timeline_start_us.0);
                let right_dur = TimeUs(end.0 - split_time_us.0);

                let left = Item::TextOverlay {
                    id,
                    track_id,
                    timeline_start_us,
                    duration_us: left_dur,
                    text: text.clone(),
                    font_size,
                    color: color.clone(),
                    x,
                    y,
                };
                let right = Item::TextOverlay {
                    id: right_id,
                    track_id,
                    timeline_start_us: split_time_us,
                    duration_us: right_dur,
                    text,
                    font_size,
                    color,
                    x,
                    y,
                };
                (left, right)
            }
        };

        // Replace original with left, insert right after it
        self.tracks[track_idx].items[item_idx] = left;
        self.tracks[track_idx].items.insert(item_idx + 1, right);

        Ok((left_id, right_id))
    }

    /// Reorder an item within its track (move to a different index in items vec)
    pub fn reorder_item(&mut self, item_id: Uuid, new_index: usize) -> Result<()> {
        let (track_idx, item_idx) = self
            .find_item_location(item_id)
            .ok_or(CoreError::ItemNotFound(item_id))?;

        let track = &mut self.tracks[track_idx];
        if new_index >= track.items.len() {
            return Err(CoreError::InvalidOperation(format!(
                "new_index {} out of bounds (track has {} items)",
                new_index,
                track.items.len()
            )));
        }

        let item = track.items.remove(item_idx);
        track.items.insert(new_index, item);
        Ok(())
    }

    /// Find the (track_index, item_index) for a given item id.
    fn find_item_location(&self, item_id: Uuid) -> Option<(usize, usize)> {
        for (ti, track) in self.tracks.iter().enumerate() {
            for (ii, item) in track.items.iter().enumerate() {
                if item.id() == item_id {
                    return Some((ti, ii));
                }
            }
        }
        None
    }
}

/// Helper: check if two items overlap on the timeline.
/// Two items overlap if their timeline ranges [start, end) intersect.
fn items_overlap(a: &Item, b: &Item) -> bool {
    let a_start = a.timeline_start_us().0;
    let a_end = a.timeline_end_us().0;
    let b_start = b.timeline_start_us().0;
    let b_end = b.timeline_end_us().0;

    a_start < b_end && b_start < a_end
}

/// Helper: set timeline_start_us on any Item variant.
fn set_timeline_start(item: &mut Item, new_start: TimeUs) {
    match item {
        Item::VideoClip {
            timeline_start_us, ..
        } => *timeline_start_us = new_start,
        Item::AudioClip {
            timeline_start_us, ..
        } => *timeline_start_us = new_start,
        Item::ImageOverlay {
            timeline_start_us, ..
        } => *timeline_start_us = new_start,
        Item::TextOverlay {
            timeline_start_us, ..
        } => *timeline_start_us = new_start,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_video_clip(
        track_id: Uuid,
        start_us: i64,
        source_in: i64,
        source_out: i64,
    ) -> (Uuid, Item) {
        let id = Uuid::new_v4();
        let item = Item::VideoClip {
            id,
            asset_id: Uuid::new_v4(),
            track_id,
            timeline_start_us: TimeUs(start_us),
            source_in_us: TimeUs(source_in),
            source_out_us: TimeUs(source_out),
        };
        (id, item)
    }

    fn make_test_timeline() -> (Timeline, Uuid, Uuid) {
        let track_id = Uuid::new_v4();
        let (clip_id, clip) = make_video_clip(track_id, 0, 0, 5_000_000);
        let tl = Timeline {
            tracks: vec![Track {
                id: track_id,
                kind: TrackKind::Video,
                items: vec![clip],
            }],
            markers: vec![],
        };
        (tl, track_id, clip_id)
    }

    // -----------------------------------------------------------------------
    // add_item
    // -----------------------------------------------------------------------

    #[test]
    fn add_item_to_empty_track_succeeds() {
        let track_id = Uuid::new_v4();
        let mut tl = Timeline {
            tracks: vec![Track {
                id: track_id,
                kind: TrackKind::Video,
                items: vec![],
            }],
            markers: vec![],
        };

        let (_, clip) = make_video_clip(track_id, 0, 0, 5_000_000);
        assert!(tl.add_item(track_id, clip).is_ok());
        assert_eq!(tl.tracks[0].items.len(), 1);
    }

    #[test]
    fn add_item_with_overlap_fails() {
        let (mut tl, track_id, _) = make_test_timeline();

        // Existing clip: [0, 5_000_000). Try adding overlapping clip at [2_000_000, 7_000_000).
        let (_, clip) = make_video_clip(track_id, 2_000_000, 0, 5_000_000);
        let result = tl.add_item(track_id, clip);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), CoreError::OverlapDetected));
    }

    #[test]
    fn add_item_adjacent_succeeds() {
        let (mut tl, track_id, _) = make_test_timeline();

        // Existing clip: [0, 5_000_000). Add adjacent clip at [5_000_000, 10_000_000).
        let (_, clip) = make_video_clip(track_id, 5_000_000, 0, 5_000_000);
        assert!(tl.add_item(track_id, clip).is_ok());
        assert_eq!(tl.tracks[0].items.len(), 2);
    }

    #[test]
    fn add_item_to_nonexistent_track_fails() {
        let mut tl = Timeline {
            tracks: vec![],
            markers: vec![],
        };
        let fake_track = Uuid::new_v4();
        let (_, clip) = make_video_clip(fake_track, 0, 0, 5_000_000);
        let result = tl.add_item(fake_track, clip);
        assert!(matches!(result.unwrap_err(), CoreError::TrackNotFound(_)));
    }

    // -----------------------------------------------------------------------
    // remove_item
    // -----------------------------------------------------------------------

    #[test]
    fn remove_item_works() {
        let (mut tl, _, clip_id) = make_test_timeline();
        let removed = tl.remove_item(clip_id).unwrap();
        assert_eq!(removed.id(), clip_id);
        assert!(tl.tracks[0].items.is_empty());
    }

    #[test]
    fn remove_item_with_bad_id_fails() {
        let (mut tl, _, _) = make_test_timeline();
        let bad_id = Uuid::new_v4();
        let result = tl.remove_item(bad_id);
        assert!(matches!(result.unwrap_err(), CoreError::ItemNotFound(_)));
    }

    // -----------------------------------------------------------------------
    // move_item
    // -----------------------------------------------------------------------

    #[test]
    fn move_item_to_valid_position() {
        let (mut tl, _, clip_id) = make_test_timeline();
        // Move clip from [0, 5M) to [10M, 15M)
        assert!(tl.move_item(clip_id, TimeUs(10_000_000)).is_ok());
        let item = &tl.tracks[0].items[0];
        assert_eq!(item.timeline_start_us(), TimeUs(10_000_000));
    }

    #[test]
    fn move_item_causing_overlap_fails() {
        let (mut tl, track_id, _clip_id) = make_test_timeline();

        // Add second clip at [5M, 10M)
        let (second_id, clip) = make_video_clip(track_id, 5_000_000, 0, 5_000_000);
        tl.add_item(track_id, clip).unwrap();

        // Try to move second clip to [3M, 8M) -- overlaps first clip [0, 5M)
        let result = tl.move_item(second_id, TimeUs(3_000_000));
        assert!(matches!(result.unwrap_err(), CoreError::OverlapDetected));
    }

    #[test]
    fn move_item_nonexistent_fails() {
        let (mut tl, _, _) = make_test_timeline();
        let bad_id = Uuid::new_v4();
        let result = tl.move_item(bad_id, TimeUs(0));
        assert!(matches!(result.unwrap_err(), CoreError::ItemNotFound(_)));
    }

    // -----------------------------------------------------------------------
    // trim_in
    // -----------------------------------------------------------------------

    #[test]
    fn trim_in_adjusts_start_correctly() {
        let (mut tl, _, clip_id) = make_test_timeline();
        // Original: timeline_start=0, source_in=0, source_out=5M, end=5M
        // Trim in to source_in=1M. End stays at 5M, new duration=4M, new timeline_start=1M
        tl.trim_in(clip_id, TimeUs(1_000_000)).unwrap();

        let item = &tl.tracks[0].items[0];
        assert_eq!(item.timeline_end_us(), TimeUs(5_000_000));
        assert_eq!(item.duration_us(), TimeUs(4_000_000));
        assert_eq!(item.timeline_start_us(), TimeUs(1_000_000));
        if let Item::VideoClip { source_in_us, .. } = item {
            assert_eq!(*source_in_us, TimeUs(1_000_000));
        }
    }

    #[test]
    fn trim_in_invalid_past_out_point_fails() {
        let (mut tl, _, clip_id) = make_test_timeline();
        // source_out is 5M, try to set source_in to 6M
        let result = tl.trim_in(clip_id, TimeUs(6_000_000));
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // trim_out
    // -----------------------------------------------------------------------

    #[test]
    fn trim_out_adjusts_end_correctly() {
        let (mut tl, _, clip_id) = make_test_timeline();
        // Original: timeline_start=0, source_in=0, source_out=5M
        // Trim out to 3M: new end = 0 + 3M = 3M
        tl.trim_out(clip_id, TimeUs(3_000_000)).unwrap();

        let item = &tl.tracks[0].items[0];
        assert_eq!(item.timeline_start_us(), TimeUs(0));
        assert_eq!(item.timeline_end_us(), TimeUs(3_000_000));
        assert_eq!(item.duration_us(), TimeUs(3_000_000));
    }

    #[test]
    fn trim_out_invalid_before_in_point_fails() {
        let (mut tl, track_id, _) = make_test_timeline();
        // Add a clip with source_in=2M, source_out=5M
        let (clip_id, clip) = make_video_clip(track_id, 10_000_000, 2_000_000, 5_000_000);
        tl.add_item(track_id, clip).unwrap();

        // Try to trim out to 1M (before source_in of 2M)
        let result = tl.trim_out(clip_id, TimeUs(1_000_000));
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // split_at
    // -----------------------------------------------------------------------

    #[test]
    fn split_at_creates_two_clips_summing_to_original() {
        let (mut tl, _, clip_id) = make_test_timeline();
        // Original: [0, 5M), source [0, 5M)
        let (left_id, right_id) = tl.split_at(clip_id, TimeUs(2_000_000)).unwrap();

        assert_eq!(left_id, clip_id);
        assert_ne!(right_id, clip_id);

        let left = &tl.tracks[0].items[0];
        let right = &tl.tracks[0].items[1];

        assert_eq!(left.duration_us().0 + right.duration_us().0, 5_000_000);
        assert_eq!(left.timeline_start_us(), TimeUs(0));
        assert_eq!(left.timeline_end_us(), TimeUs(2_000_000));
        assert_eq!(right.timeline_start_us(), TimeUs(2_000_000));
        assert_eq!(right.timeline_end_us(), TimeUs(5_000_000));
    }

    #[test]
    fn split_at_preserves_source_ranges() {
        let (mut tl, _, clip_id) = make_test_timeline();
        tl.split_at(clip_id, TimeUs(2_000_000)).unwrap();

        let left = &tl.tracks[0].items[0];
        let right = &tl.tracks[0].items[1];

        if let Item::VideoClip {
            source_in_us,
            source_out_us,
            ..
        } = left
        {
            assert_eq!(*source_in_us, TimeUs(0));
            assert_eq!(*source_out_us, TimeUs(2_000_000));
        } else {
            panic!("expected VideoClip");
        }

        if let Item::VideoClip {
            source_in_us,
            source_out_us,
            ..
        } = right
        {
            assert_eq!(*source_in_us, TimeUs(2_000_000));
            assert_eq!(*source_out_us, TimeUs(5_000_000));
        } else {
            panic!("expected VideoClip");
        }
    }

    #[test]
    fn split_at_start_fails() {
        let (mut tl, _, clip_id) = make_test_timeline();
        let result = tl.split_at(clip_id, TimeUs(0));
        assert!(result.is_err());
    }

    #[test]
    fn split_at_end_fails() {
        let (mut tl, _, clip_id) = make_test_timeline();
        let result = tl.split_at(clip_id, TimeUs(5_000_000));
        assert!(result.is_err());
    }

    #[test]
    fn split_audio_clip() {
        let track_id = Uuid::new_v4();
        let clip_id = Uuid::new_v4();
        let item = Item::AudioClip {
            id: clip_id,
            asset_id: Uuid::new_v4(),
            track_id,
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs(0),
            source_out_us: TimeUs(6_000_000),
            volume: 0.8,
        };
        let mut tl = Timeline {
            tracks: vec![Track {
                id: track_id,
                kind: TrackKind::Audio,
                items: vec![item],
            }],
            markers: vec![],
        };

        let (left_id, right_id) = tl.split_at(clip_id, TimeUs(3_000_000)).unwrap();
        assert_eq!(left_id, clip_id);

        let left = &tl.tracks[0].items[0];
        let right = &tl.tracks[0].items[1];
        assert_eq!(left.duration_us(), TimeUs(3_000_000));
        assert_eq!(right.duration_us(), TimeUs(3_000_000));
        assert_eq!(right.id(), right_id);

        if let Item::AudioClip { volume, .. } = right {
            assert!((volume - 0.8).abs() < f64::EPSILON);
        }
    }

    // -----------------------------------------------------------------------
    // reorder_item
    // -----------------------------------------------------------------------

    #[test]
    fn reorder_item_works() {
        let track_id = Uuid::new_v4();
        let (id_a, clip_a) = make_video_clip(track_id, 0, 0, 2_000_000);
        let (id_b, clip_b) = make_video_clip(track_id, 5_000_000, 0, 2_000_000);
        let (id_c, clip_c) = make_video_clip(track_id, 10_000_000, 0, 2_000_000);

        let mut tl = Timeline {
            tracks: vec![Track {
                id: track_id,
                kind: TrackKind::Video,
                items: vec![clip_a, clip_b, clip_c],
            }],
            markers: vec![],
        };

        // Move item C (index 2) to index 0
        tl.reorder_item(id_c, 0).unwrap();
        assert_eq!(tl.tracks[0].items[0].id(), id_c);
        assert_eq!(tl.tracks[0].items[1].id(), id_a);
        assert_eq!(tl.tracks[0].items[2].id(), id_b);
    }

    #[test]
    fn reorder_item_out_of_bounds_fails() {
        let (mut tl, _, clip_id) = make_test_timeline();
        let result = tl.reorder_item(clip_id, 5);
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // overlap detection edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn adjacent_clips_dont_overlap() {
        // [0, 5M) and [5M, 10M) should NOT overlap (half-open intervals)
        let track_id = Uuid::new_v4();
        let (_, a) = make_video_clip(track_id, 0, 0, 5_000_000);
        let (_, b) = make_video_clip(track_id, 5_000_000, 0, 5_000_000);
        assert!(!items_overlap(&a, &b));
        assert!(!items_overlap(&b, &a));
    }

    #[test]
    fn overlapping_clips_detected() {
        let track_id = Uuid::new_v4();
        let (_, a) = make_video_clip(track_id, 0, 0, 5_000_000);
        let (_, b) = make_video_clip(track_id, 4_999_999, 0, 5_000_000);
        assert!(items_overlap(&a, &b));
        assert!(items_overlap(&b, &a));
    }

    // -----------------------------------------------------------------------
    // multiple operations in sequence
    // -----------------------------------------------------------------------

    #[test]
    fn multiple_operations_in_sequence() {
        let track_id = Uuid::new_v4();
        let mut tl = Timeline {
            tracks: vec![Track {
                id: track_id,
                kind: TrackKind::Video,
                items: vec![],
            }],
            markers: vec![],
        };

        // Add a clip at [0, 5M)
        let (clip1_id, clip1) = make_video_clip(track_id, 0, 0, 5_000_000);
        tl.add_item(track_id, clip1).unwrap();

        // Add another at [5M, 10M)
        let (clip2_id, clip2) = make_video_clip(track_id, 5_000_000, 0, 5_000_000);
        tl.add_item(track_id, clip2).unwrap();

        // Split first clip at 2M
        let (_, right_id) = tl.split_at(clip1_id, TimeUs(2_000_000)).unwrap();
        assert_eq!(tl.tracks[0].items.len(), 3);

        // Remove the right half of the split
        tl.remove_item(right_id).unwrap();
        assert_eq!(tl.tracks[0].items.len(), 2);

        // Move clip2 to [2M, 7M)
        tl.move_item(clip2_id, TimeUs(2_000_000)).unwrap();

        let items = &tl.tracks[0].items;
        // Clip1-left at [0, 2M), clip2 at [2M, 7M) -- no overlap
        assert_eq!(items.len(), 2);
    }

    // -----------------------------------------------------------------------
    // overlay trim/split
    // -----------------------------------------------------------------------

    #[test]
    fn trim_in_overlay() {
        let track_id = Uuid::new_v4();
        let item_id = Uuid::new_v4();
        let item = Item::TextOverlay {
            id: item_id,
            track_id,
            timeline_start_us: TimeUs(0),
            duration_us: TimeUs(10_000_000),
            text: "Hello".into(),
            font_size: 24,
            color: "#fff".into(),
            x: 0,
            y: 0,
        };
        let mut tl = Timeline {
            tracks: vec![Track {
                id: track_id,
                kind: TrackKind::OverlayText,
                items: vec![item],
            }],
            markers: vec![],
        };

        // Trim in: move start to 3M, end stays at 10M
        tl.trim_in(item_id, TimeUs(3_000_000)).unwrap();
        let item = &tl.tracks[0].items[0];
        assert_eq!(item.timeline_start_us(), TimeUs(3_000_000));
        assert_eq!(item.timeline_end_us(), TimeUs(10_000_000));
        assert_eq!(item.duration_us(), TimeUs(7_000_000));
    }

    #[test]
    fn trim_out_overlay() {
        let track_id = Uuid::new_v4();
        let item_id = Uuid::new_v4();
        let item = Item::ImageOverlay {
            id: item_id,
            asset_id: Uuid::new_v4(),
            track_id,
            timeline_start_us: TimeUs(0),
            duration_us: TimeUs(10_000_000),
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            opacity: 1.0,
        };
        let mut tl = Timeline {
            tracks: vec![Track {
                id: track_id,
                kind: TrackKind::OverlayImage,
                items: vec![item],
            }],
            markers: vec![],
        };

        // Trim out: end at 6M
        tl.trim_out(item_id, TimeUs(6_000_000)).unwrap();
        let item = &tl.tracks[0].items[0];
        assert_eq!(item.timeline_start_us(), TimeUs(0));
        assert_eq!(item.timeline_end_us(), TimeUs(6_000_000));
        assert_eq!(item.duration_us(), TimeUs(6_000_000));
    }
}
