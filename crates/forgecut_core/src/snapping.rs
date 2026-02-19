use crate::types::*;

/// Find the nearest snap point within the threshold.
/// Returns the snapped position if within threshold, otherwise the original position.
pub fn find_snap_point(
    position_us: TimeUs,
    snap_points: &[TimeUs],
    threshold_us: TimeUs,
) -> TimeUs {
    let mut best = position_us;
    let mut best_dist = threshold_us.0 + 1; // start beyond threshold

    for &point in snap_points {
        let dist = (position_us.0 - point.0).abs();
        if dist < best_dist {
            best = point;
            best_dist = dist;
        }
    }

    if best_dist <= threshold_us.0 {
        best
    } else {
        position_us
    }
}

/// Collect all snap points from a timeline (clip edges, markers).
pub fn collect_snap_points(
    timeline: &Timeline,
    exclude_item_id: Option<uuid::Uuid>,
) -> Vec<TimeUs> {
    let mut points = Vec::new();

    // Playhead at 0 is always a snap point
    points.push(TimeUs::ZERO);

    for track in &timeline.tracks {
        for item in &track.items {
            if Some(item.id()) == exclude_item_id {
                continue;
            }
            points.push(item.timeline_start_us());
            points.push(item.timeline_end_us());
        }
    }

    // Markers
    for marker in &timeline.markers {
        points.push(marker.time_us);
    }

    points.sort();
    points.dedup();
    points
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_timeline_with_clips() -> Timeline {
        let track_id = Uuid::new_v4();
        Timeline {
            tracks: vec![Track {
                id: track_id,
                kind: TrackKind::Video,
                items: vec![
                    Item::VideoClip {
                        id: Uuid::new_v4(),
                        asset_id: Uuid::new_v4(),
                        track_id,
                        timeline_start_us: TimeUs(1_000_000),
                        source_in_us: TimeUs::ZERO,
                        source_out_us: TimeUs(3_000_000),
                    },
                    Item::VideoClip {
                        id: Uuid::new_v4(),
                        asset_id: Uuid::new_v4(),
                        track_id,
                        timeline_start_us: TimeUs(5_000_000),
                        source_in_us: TimeUs::ZERO,
                        source_out_us: TimeUs(2_000_000),
                    },
                ],
            }],
            markers: vec![Marker {
                id: Uuid::new_v4(),
                time_us: TimeUs(10_000_000),
                label: "marker1".to_string(),
            }],
        }
    }

    #[test]
    fn snap_to_nearest_point() {
        let points = vec![TimeUs(0), TimeUs(1_000_000), TimeUs(5_000_000)];
        let threshold = TimeUs(200_000);

        // Position close to 1_000_000
        let result = find_snap_point(TimeUs(1_100_000), &points, threshold);
        assert_eq!(result, TimeUs(1_000_000));
    }

    #[test]
    fn no_snap_beyond_threshold() {
        let points = vec![TimeUs(0), TimeUs(1_000_000), TimeUs(5_000_000)];
        let threshold = TimeUs(200_000);

        // Position far from any snap point
        let result = find_snap_point(TimeUs(3_000_000), &points, threshold);
        assert_eq!(result, TimeUs(3_000_000));
    }

    #[test]
    fn snap_to_zero() {
        let points = vec![TimeUs(0), TimeUs(5_000_000)];
        let threshold = TimeUs(500_000);

        let result = find_snap_point(TimeUs(300_000), &points, threshold);
        assert_eq!(result, TimeUs(0));
    }

    #[test]
    fn collect_snap_points_from_timeline() {
        let timeline = make_timeline_with_clips();
        let points = collect_snap_points(&timeline, None);

        // Should contain: 0, 1_000_000 (clip1 start), 4_000_000 (clip1 end),
        //                 5_000_000 (clip2 start), 7_000_000 (clip2 end),
        //                 10_000_000 (marker)
        assert!(points.contains(&TimeUs(0)));
        assert!(points.contains(&TimeUs(1_000_000)));
        assert!(points.contains(&TimeUs(4_000_000)));
        assert!(points.contains(&TimeUs(5_000_000)));
        assert!(points.contains(&TimeUs(7_000_000)));
        assert!(points.contains(&TimeUs(10_000_000)));
    }

    #[test]
    fn collect_excludes_item() {
        let track_id = Uuid::new_v4();
        let item_id = Uuid::new_v4();
        let timeline = Timeline {
            tracks: vec![Track {
                id: track_id,
                kind: TrackKind::Video,
                items: vec![
                    Item::VideoClip {
                        id: item_id,
                        asset_id: Uuid::new_v4(),
                        track_id,
                        timeline_start_us: TimeUs(1_000_000),
                        source_in_us: TimeUs::ZERO,
                        source_out_us: TimeUs(2_000_000),
                    },
                    Item::VideoClip {
                        id: Uuid::new_v4(),
                        asset_id: Uuid::new_v4(),
                        track_id,
                        timeline_start_us: TimeUs(5_000_000),
                        source_in_us: TimeUs::ZERO,
                        source_out_us: TimeUs(1_000_000),
                    },
                ],
            }],
            markers: vec![],
        };

        let points = collect_snap_points(&timeline, Some(item_id));

        // The excluded item's edges (1_000_000 and 3_000_000) should not appear
        assert!(!points.contains(&TimeUs(1_000_000)));
        assert!(!points.contains(&TimeUs(3_000_000)));
        // The other item's edges should appear
        assert!(points.contains(&TimeUs(5_000_000)));
        assert!(points.contains(&TimeUs(6_000_000)));
        // Zero is always present
        assert!(points.contains(&TimeUs(0)));
    }

    #[test]
    fn empty_snap_points_returns_original() {
        let points: Vec<TimeUs> = vec![];
        let threshold = TimeUs(500_000);

        let result = find_snap_point(TimeUs(2_000_000), &points, threshold);
        assert_eq!(result, TimeUs(2_000_000));
    }

    #[test]
    fn exact_match_snaps() {
        let points = vec![TimeUs(0), TimeUs(3_000_000), TimeUs(6_000_000)];
        let threshold = TimeUs(100_000);

        let result = find_snap_point(TimeUs(3_000_000), &points, threshold);
        assert_eq!(result, TimeUs(3_000_000));
    }

    #[test]
    fn snap_to_closest_of_two() {
        let points = vec![TimeUs(1_000_000), TimeUs(2_000_000)];
        let threshold = TimeUs(600_000);

        // 1_400_000 is 400k from 1M and 600k from 2M -- should snap to 1M
        let result = find_snap_point(TimeUs(1_400_000), &points, threshold);
        assert_eq!(result, TimeUs(1_000_000));

        // 1_700_000 is 700k from 1M (beyond threshold) and 300k from 2M -- should snap to 2M
        let result = find_snap_point(TimeUs(1_700_000), &points, threshold);
        assert_eq!(result, TimeUs(2_000_000));
    }
}
