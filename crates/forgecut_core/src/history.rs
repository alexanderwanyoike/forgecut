use crate::error::{CoreError, Result};
use crate::types::*;
use std::cell::RefCell;
use uuid::Uuid;

/// A command that can be executed, undone, and described.
pub trait Command: std::fmt::Debug {
    fn execute(&self, timeline: &mut Timeline) -> Result<()>;
    fn undo(&self, timeline: &mut Timeline) -> Result<()>;
    fn description(&self) -> &str;
}

/// Undo/redo history stack.
///
/// Safety: History is only accessed behind a Mutex, ensuring single-threaded access.
/// The Command implementations use RefCell for interior mutability which is not Send,
/// but since we guarantee exclusive access via Mutex, this is safe.
pub struct History {
    undo_stack: Vec<Box<dyn Command>>,
    redo_stack: Vec<Box<dyn Command>>,
    max_size: usize,
}

// Safety: History is always accessed behind a Mutex in AppState
unsafe impl Send for History {}

impl History {
    pub fn new(max_size: usize) -> Self {
        Self {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            max_size,
        }
    }

    /// Execute a command and push it onto the undo stack. Clears redo stack.
    pub fn execute(&mut self, cmd: Box<dyn Command>, timeline: &mut Timeline) -> Result<()> {
        cmd.execute(timeline)?;
        self.redo_stack.clear();
        self.undo_stack.push(cmd);
        if self.undo_stack.len() > self.max_size {
            self.undo_stack.remove(0);
        }
        Ok(())
    }

    /// Undo the last command.
    pub fn undo(&mut self, timeline: &mut Timeline) -> Result<()> {
        let cmd = self.undo_stack.pop().ok_or(CoreError::NothingToUndo)?;
        cmd.undo(timeline)?;
        self.redo_stack.push(cmd);
        Ok(())
    }

    /// Redo the last undone command.
    pub fn redo(&mut self, timeline: &mut Timeline) -> Result<()> {
        let cmd = self.redo_stack.pop().ok_or(CoreError::NothingToRedo)?;
        cmd.execute(timeline)?;
        self.undo_stack.push(cmd);
        Ok(())
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn undo_description(&self) -> Option<&str> {
        self.undo_stack.last().map(|cmd| cmd.description())
    }

    pub fn redo_description(&self) -> Option<&str> {
        self.redo_stack.last().map(|cmd| cmd.description())
    }
}

// ---------------------------------------------------------------------------
// AddItemCommand
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct AddItemCommand {
    track_id: Uuid,
    item: Item,
}

impl AddItemCommand {
    pub fn new(track_id: Uuid, item: Item) -> Self {
        Self { track_id, item }
    }
}

impl Command for AddItemCommand {
    fn execute(&self, timeline: &mut Timeline) -> Result<()> {
        timeline.add_item(self.track_id, self.item.clone())
    }

    fn undo(&self, timeline: &mut Timeline) -> Result<()> {
        timeline.remove_item(self.item.id()).map(|_| ())
    }

    fn description(&self) -> &str {
        "Add clip"
    }
}

// ---------------------------------------------------------------------------
// RemoveItemCommand
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct RemoveItemCommand {
    item_id: Uuid,
    removed_item: RefCell<Option<Item>>,
    track_id: RefCell<Option<Uuid>>,
}

impl RemoveItemCommand {
    pub fn new(item_id: Uuid) -> Self {
        Self {
            item_id,
            removed_item: RefCell::new(None),
            track_id: RefCell::new(None),
        }
    }
}

impl Command for RemoveItemCommand {
    fn execute(&self, timeline: &mut Timeline) -> Result<()> {
        let item = timeline.remove_item(self.item_id)?;
        *self.track_id.borrow_mut() = Some(item.track_id());
        *self.removed_item.borrow_mut() = Some(item);
        Ok(())
    }

    fn undo(&self, timeline: &mut Timeline) -> Result<()> {
        let track_id = self
            .track_id
            .borrow()
            .ok_or_else(|| CoreError::InvalidOperation("no track_id saved".into()))?;
        let item = self
            .removed_item
            .borrow()
            .clone()
            .ok_or_else(|| CoreError::InvalidOperation("no removed item saved".into()))?;
        timeline.add_item(track_id, item)
    }

    fn description(&self) -> &str {
        "Remove clip"
    }
}

// ---------------------------------------------------------------------------
// MoveItemCommand
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct MoveItemCommand {
    item_id: Uuid,
    new_start_us: TimeUs,
    old_start_us: RefCell<Option<TimeUs>>,
}

impl MoveItemCommand {
    pub fn new(item_id: Uuid, new_start_us: TimeUs) -> Self {
        Self {
            item_id,
            new_start_us,
            old_start_us: RefCell::new(None),
        }
    }
}

impl Command for MoveItemCommand {
    fn execute(&self, timeline: &mut Timeline) -> Result<()> {
        // Find the item to save its current start before moving
        let old_start = find_item(timeline, self.item_id)?.timeline_start_us();
        *self.old_start_us.borrow_mut() = Some(old_start);
        timeline.move_item(self.item_id, self.new_start_us)
    }

    fn undo(&self, timeline: &mut Timeline) -> Result<()> {
        let old_start = self
            .old_start_us
            .borrow()
            .ok_or_else(|| CoreError::InvalidOperation("no old start saved".into()))?;
        timeline.move_item(self.item_id, old_start)
    }

    fn description(&self) -> &str {
        "Move clip"
    }
}

// ---------------------------------------------------------------------------
// TrimInCommand
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct TrimInCommand {
    item_id: Uuid,
    new_in_us: TimeUs,
    old_in_us: RefCell<Option<TimeUs>>,
}

impl TrimInCommand {
    pub fn new(item_id: Uuid, new_in_us: TimeUs) -> Self {
        Self {
            item_id,
            new_in_us,
            old_in_us: RefCell::new(None),
        }
    }
}

impl Command for TrimInCommand {
    fn execute(&self, timeline: &mut Timeline) -> Result<()> {
        let item = find_item(timeline, self.item_id)?;
        let old_in = match item {
            Item::VideoClip { source_in_us, .. } | Item::AudioClip { source_in_us, .. } => {
                *source_in_us
            }
            Item::ImageOverlay {
                timeline_start_us, ..
            }
            | Item::TextOverlay {
                timeline_start_us, ..
            } => *timeline_start_us,
        };
        *self.old_in_us.borrow_mut() = Some(old_in);
        timeline.trim_in(self.item_id, self.new_in_us)
    }

    fn undo(&self, timeline: &mut Timeline) -> Result<()> {
        let old_in = self
            .old_in_us
            .borrow()
            .ok_or_else(|| CoreError::InvalidOperation("no old in-point saved".into()))?;
        timeline.trim_in(self.item_id, old_in)
    }

    fn description(&self) -> &str {
        "Trim in-point"
    }
}

// ---------------------------------------------------------------------------
// TrimOutCommand
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct TrimOutCommand {
    item_id: Uuid,
    new_out_us: TimeUs,
    old_out_us: RefCell<Option<TimeUs>>,
}

impl TrimOutCommand {
    pub fn new(item_id: Uuid, new_out_us: TimeUs) -> Self {
        Self {
            item_id,
            new_out_us,
            old_out_us: RefCell::new(None),
        }
    }
}

impl Command for TrimOutCommand {
    fn execute(&self, timeline: &mut Timeline) -> Result<()> {
        let item = find_item(timeline, self.item_id)?;
        let old_out = match item {
            Item::VideoClip {
                source_out_us, ..
            }
            | Item::AudioClip {
                source_out_us, ..
            } => *source_out_us,
            Item::ImageOverlay {
                timeline_start_us,
                duration_us,
                ..
            }
            | Item::TextOverlay {
                timeline_start_us,
                duration_us,
                ..
            } => TimeUs(timeline_start_us.0 + duration_us.0),
        };
        *self.old_out_us.borrow_mut() = Some(old_out);
        timeline.trim_out(self.item_id, self.new_out_us)
    }

    fn undo(&self, timeline: &mut Timeline) -> Result<()> {
        let old_out = self
            .old_out_us
            .borrow()
            .ok_or_else(|| CoreError::InvalidOperation("no old out-point saved".into()))?;
        timeline.trim_out(self.item_id, old_out)
    }

    fn description(&self) -> &str {
        "Trim out-point"
    }
}

// ---------------------------------------------------------------------------
// SplitCommand
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct SplitCommand {
    item_id: Uuid,
    split_time_us: TimeUs,
    right_id: RefCell<Option<Uuid>>,
    original_item: RefCell<Option<Item>>,
}

impl SplitCommand {
    pub fn new(item_id: Uuid, split_time_us: TimeUs) -> Self {
        Self {
            item_id,
            split_time_us,
            right_id: RefCell::new(None),
            original_item: RefCell::new(None),
        }
    }
}

impl Command for SplitCommand {
    fn execute(&self, timeline: &mut Timeline) -> Result<()> {
        // Save original item state before splitting
        let item = find_item(timeline, self.item_id)?;
        *self.original_item.borrow_mut() = Some(item.clone());

        let (_left_id, right_id) = timeline.split_at(self.item_id, self.split_time_us)?;
        *self.right_id.borrow_mut() = Some(right_id);
        Ok(())
    }

    fn undo(&self, timeline: &mut Timeline) -> Result<()> {
        let right_id = self
            .right_id
            .borrow()
            .ok_or_else(|| CoreError::InvalidOperation("no right_id saved".into()))?;
        let original = self
            .original_item
            .borrow()
            .clone()
            .ok_or_else(|| CoreError::InvalidOperation("no original item saved".into()))?;

        // Remove the right half
        timeline.remove_item(right_id)?;

        // Find the left half (which has the original item's id) and replace it
        // with the original item
        for track in &mut timeline.tracks {
            if let Some(pos) = track.items.iter().position(|i| i.id() == self.item_id) {
                track.items[pos] = original;
                return Ok(());
            }
        }
        Err(CoreError::ItemNotFound(self.item_id))
    }

    fn description(&self) -> &str {
        "Split clip"
    }
}

// ---------------------------------------------------------------------------
// MoveItemToTrackCommand
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct MoveItemToTrackCommand {
    item_id: Uuid,
    new_track_id: Uuid,
    new_start_us: TimeUs,
    old_track_id: RefCell<Option<Uuid>>,
    old_start_us: RefCell<Option<TimeUs>>,
}

impl MoveItemToTrackCommand {
    pub fn new(item_id: Uuid, new_track_id: Uuid, new_start_us: TimeUs) -> Self {
        Self {
            item_id,
            new_track_id,
            new_start_us,
            old_track_id: RefCell::new(None),
            old_start_us: RefCell::new(None),
        }
    }
}

impl Command for MoveItemToTrackCommand {
    fn execute(&self, timeline: &mut Timeline) -> Result<()> {
        let item = find_item(timeline, self.item_id)?;
        *self.old_track_id.borrow_mut() = Some(item.track_id());
        *self.old_start_us.borrow_mut() = Some(item.timeline_start_us());
        timeline.move_item_to_track(self.item_id, self.new_track_id, self.new_start_us)
    }

    fn undo(&self, timeline: &mut Timeline) -> Result<()> {
        let old_track_id = self
            .old_track_id
            .borrow()
            .ok_or_else(|| CoreError::InvalidOperation("no old track_id saved".into()))?;
        let old_start_us = self
            .old_start_us
            .borrow()
            .ok_or_else(|| CoreError::InvalidOperation("no old start saved".into()))?;
        timeline.move_item_to_track(self.item_id, old_track_id, old_start_us)
    }

    fn description(&self) -> &str {
        "Move clip to track"
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn find_item(timeline: &Timeline, item_id: Uuid) -> Result<&Item> {
    for track in &timeline.tracks {
        for item in &track.items {
            if item.id() == item_id {
                return Ok(item);
            }
        }
    }
    Err(CoreError::ItemNotFound(item_id))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_timeline() -> (Timeline, Uuid, Uuid, Item) {
        let track_id = Uuid::new_v4();
        let clip_id = Uuid::new_v4();
        let asset_id = Uuid::new_v4();
        let item = Item::VideoClip {
            id: clip_id,
            asset_id,
            track_id,
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs(0),
            source_out_us: TimeUs(5_000_000),
        };
        let tl = Timeline {
            tracks: vec![Track {
                id: track_id,
                kind: TrackKind::Video,
                items: vec![],
            }],
            markers: vec![],
        };
        (tl, track_id, clip_id, item)
    }

    // -----------------------------------------------------------------------
    // AddItemCommand + undo/redo
    // -----------------------------------------------------------------------

    #[test]
    fn add_undo_redo() {
        let (mut tl, track_id, _clip_id, item) = make_test_timeline();
        let mut history = History::new(100);

        let cmd = Box::new(AddItemCommand::new(track_id, item));
        history.execute(cmd, &mut tl).unwrap();
        assert_eq!(tl.tracks[0].items.len(), 1);

        // Undo: item removed
        history.undo(&mut tl).unwrap();
        assert!(tl.tracks[0].items.is_empty());

        // Redo: item restored
        history.redo(&mut tl).unwrap();
        assert_eq!(tl.tracks[0].items.len(), 1);
    }

    // -----------------------------------------------------------------------
    // New action clears redo stack
    // -----------------------------------------------------------------------

    #[test]
    fn new_action_clears_redo() {
        let (mut tl, track_id, clip_id, item) = make_test_timeline();
        let mut history = History::new(100);

        let cmd = Box::new(AddItemCommand::new(track_id, item));
        history.execute(cmd, &mut tl).unwrap();

        // Undo, so redo stack has 1
        history.undo(&mut tl).unwrap();
        assert!(history.can_redo());

        // New action clears redo
        let item2 = Item::VideoClip {
            id: clip_id,
            asset_id: Uuid::new_v4(),
            track_id,
            timeline_start_us: TimeUs(10_000_000),
            source_in_us: TimeUs(0),
            source_out_us: TimeUs(3_000_000),
        };
        let cmd2 = Box::new(AddItemCommand::new(track_id, item2));
        history.execute(cmd2, &mut tl).unwrap();
        assert!(!history.can_redo());
    }

    // -----------------------------------------------------------------------
    // Undo on empty history returns error
    // -----------------------------------------------------------------------

    #[test]
    fn undo_empty_history_errors() {
        let (mut tl, _, _, _) = make_test_timeline();
        let mut history = History::new(100);
        let result = history.undo(&mut tl);
        assert!(matches!(result.unwrap_err(), CoreError::NothingToUndo));
    }

    // -----------------------------------------------------------------------
    // Redo on empty redo stack returns error
    // -----------------------------------------------------------------------

    #[test]
    fn redo_empty_stack_errors() {
        let (mut tl, _, _, _) = make_test_timeline();
        let mut history = History::new(100);
        let result = history.redo(&mut tl);
        assert!(matches!(result.unwrap_err(), CoreError::NothingToRedo));
    }

    // -----------------------------------------------------------------------
    // MoveItemCommand: move -> undo -> original position
    // -----------------------------------------------------------------------

    #[test]
    fn move_undo_restores_position() {
        let (mut tl, track_id, clip_id, item) = make_test_timeline();
        tl.add_item(track_id, item).unwrap();

        let mut history = History::new(100);
        let cmd = Box::new(MoveItemCommand::new(clip_id, TimeUs(10_000_000)));
        history.execute(cmd, &mut tl).unwrap();
        assert_eq!(
            tl.tracks[0].items[0].timeline_start_us(),
            TimeUs(10_000_000)
        );

        history.undo(&mut tl).unwrap();
        assert_eq!(tl.tracks[0].items[0].timeline_start_us(), TimeUs(0));
    }

    // -----------------------------------------------------------------------
    // TrimInCommand: trim -> undo -> original
    // -----------------------------------------------------------------------

    #[test]
    fn trim_in_undo_restores() {
        let (mut tl, track_id, clip_id, item) = make_test_timeline();
        tl.add_item(track_id, item).unwrap();

        let mut history = History::new(100);
        let cmd = Box::new(TrimInCommand::new(clip_id, TimeUs(1_000_000)));
        history.execute(cmd, &mut tl).unwrap();

        let item = &tl.tracks[0].items[0];
        assert_eq!(item.timeline_end_us(), TimeUs(5_000_000));
        if let Item::VideoClip { source_in_us, .. } = item {
            assert_eq!(*source_in_us, TimeUs(1_000_000));
        }

        history.undo(&mut tl).unwrap();
        let item = &tl.tracks[0].items[0];
        assert_eq!(item.timeline_start_us(), TimeUs(0));
        if let Item::VideoClip { source_in_us, .. } = item {
            assert_eq!(*source_in_us, TimeUs(0));
        }
    }

    // -----------------------------------------------------------------------
    // TrimOutCommand: trim -> undo -> original
    // -----------------------------------------------------------------------

    #[test]
    fn trim_out_undo_restores() {
        let (mut tl, track_id, clip_id, item) = make_test_timeline();
        tl.add_item(track_id, item).unwrap();

        let mut history = History::new(100);
        let cmd = Box::new(TrimOutCommand::new(clip_id, TimeUs(3_000_000)));
        history.execute(cmd, &mut tl).unwrap();

        assert_eq!(tl.tracks[0].items[0].timeline_end_us(), TimeUs(3_000_000));

        history.undo(&mut tl).unwrap();
        assert_eq!(tl.tracks[0].items[0].timeline_end_us(), TimeUs(5_000_000));
    }

    // -----------------------------------------------------------------------
    // SplitCommand: split -> undo -> original single clip
    // -----------------------------------------------------------------------

    #[test]
    fn split_undo_restores_original() {
        let (mut tl, track_id, clip_id, item) = make_test_timeline();
        tl.add_item(track_id, item).unwrap();

        let mut history = History::new(100);
        let cmd = Box::new(SplitCommand::new(clip_id, TimeUs(2_000_000)));
        history.execute(cmd, &mut tl).unwrap();
        assert_eq!(tl.tracks[0].items.len(), 2);

        history.undo(&mut tl).unwrap();
        assert_eq!(tl.tracks[0].items.len(), 1);
        let restored = &tl.tracks[0].items[0];
        assert_eq!(restored.id(), clip_id);
        assert_eq!(restored.timeline_start_us(), TimeUs(0));
        assert_eq!(restored.timeline_end_us(), TimeUs(5_000_000));
    }

    // -----------------------------------------------------------------------
    // max_size limits undo stack
    // -----------------------------------------------------------------------

    #[test]
    fn max_size_limits_undo_stack() {
        let (mut tl, track_id, _, _) = make_test_timeline();
        let mut history = History::new(3);

        // Execute 5 commands -- only last 3 should remain
        for i in 0..5 {
            let item = Item::VideoClip {
                id: Uuid::new_v4(),
                asset_id: Uuid::new_v4(),
                track_id,
                timeline_start_us: TimeUs(i * 10_000_000),
                source_in_us: TimeUs(0),
                source_out_us: TimeUs(5_000_000),
            };
            let cmd = Box::new(AddItemCommand::new(track_id, item));
            history.execute(cmd, &mut tl).unwrap();
        }

        assert_eq!(tl.tracks[0].items.len(), 5);

        // Should only be able to undo 3 times
        assert!(history.undo(&mut tl).is_ok());
        assert!(history.undo(&mut tl).is_ok());
        assert!(history.undo(&mut tl).is_ok());
        assert!(history.undo(&mut tl).is_err());
        assert_eq!(tl.tracks[0].items.len(), 2);
    }

    // -----------------------------------------------------------------------
    // can_undo / can_redo flags
    // -----------------------------------------------------------------------

    #[test]
    fn can_undo_can_redo_flags() {
        let (mut tl, track_id, _, item) = make_test_timeline();
        let mut history = History::new(100);

        assert!(!history.can_undo());
        assert!(!history.can_redo());

        let cmd = Box::new(AddItemCommand::new(track_id, item));
        history.execute(cmd, &mut tl).unwrap();
        assert!(history.can_undo());
        assert!(!history.can_redo());

        history.undo(&mut tl).unwrap();
        assert!(!history.can_undo());
        assert!(history.can_redo());

        history.redo(&mut tl).unwrap();
        assert!(history.can_undo());
        assert!(!history.can_redo());
    }

    // -----------------------------------------------------------------------
    // description methods
    // -----------------------------------------------------------------------

    #[test]
    fn description_methods() {
        let (mut tl, track_id, _, item) = make_test_timeline();
        let mut history = History::new(100);

        assert_eq!(history.undo_description(), None);
        assert_eq!(history.redo_description(), None);

        let cmd = Box::new(AddItemCommand::new(track_id, item));
        history.execute(cmd, &mut tl).unwrap();
        assert_eq!(history.undo_description(), Some("Add clip"));

        history.undo(&mut tl).unwrap();
        assert_eq!(history.redo_description(), Some("Add clip"));
        assert_eq!(history.undo_description(), None);
    }

    // -----------------------------------------------------------------------
    // RemoveItemCommand
    // -----------------------------------------------------------------------

    #[test]
    fn remove_undo_redo() {
        let (mut tl, track_id, clip_id, item) = make_test_timeline();
        tl.add_item(track_id, item).unwrap();

        let mut history = History::new(100);
        let cmd = Box::new(RemoveItemCommand::new(clip_id));
        history.execute(cmd, &mut tl).unwrap();
        assert!(tl.tracks[0].items.is_empty());

        // Undo: item restored
        history.undo(&mut tl).unwrap();
        assert_eq!(tl.tracks[0].items.len(), 1);
        assert_eq!(tl.tracks[0].items[0].id(), clip_id);

        // Redo: item removed again
        history.redo(&mut tl).unwrap();
        assert!(tl.tracks[0].items.is_empty());
    }

    // -----------------------------------------------------------------------
    // Split redo
    // -----------------------------------------------------------------------

    #[test]
    fn split_redo_works() {
        let (mut tl, track_id, clip_id, item) = make_test_timeline();
        tl.add_item(track_id, item).unwrap();

        let mut history = History::new(100);
        let cmd = Box::new(SplitCommand::new(clip_id, TimeUs(2_000_000)));
        history.execute(cmd, &mut tl).unwrap();
        assert_eq!(tl.tracks[0].items.len(), 2);

        history.undo(&mut tl).unwrap();
        assert_eq!(tl.tracks[0].items.len(), 1);

        history.redo(&mut tl).unwrap();
        assert_eq!(tl.tracks[0].items.len(), 2);
    }

    // -----------------------------------------------------------------------
    // MoveItemToTrackCommand: move to track -> undo -> redo
    // -----------------------------------------------------------------------

    #[test]
    fn move_to_track_undo_redo() {
        let track_a = Uuid::new_v4();
        let track_b = Uuid::new_v4();
        let clip_id = Uuid::new_v4();
        let item = Item::VideoClip {
            id: clip_id,
            asset_id: Uuid::new_v4(),
            track_id: track_a,
            timeline_start_us: TimeUs(0),
            source_in_us: TimeUs(0),
            source_out_us: TimeUs(5_000_000),
        };
        let mut tl = Timeline {
            tracks: vec![
                Track { id: track_a, kind: TrackKind::Video, items: vec![item] },
                Track { id: track_b, kind: TrackKind::Video, items: vec![] },
            ],
            markers: vec![],
        };
        let mut history = History::new(100);

        // Execute: move to track B at 2M
        let cmd = Box::new(MoveItemToTrackCommand::new(clip_id, track_b, TimeUs(2_000_000)));
        history.execute(cmd, &mut tl).unwrap();
        assert!(tl.tracks[0].items.is_empty());
        assert_eq!(tl.tracks[1].items.len(), 1);
        assert_eq!(tl.tracks[1].items[0].timeline_start_us(), TimeUs(2_000_000));

        // Undo: back on track A at 0
        history.undo(&mut tl).unwrap();
        assert_eq!(tl.tracks[0].items.len(), 1);
        assert!(tl.tracks[1].items.is_empty());
        assert_eq!(tl.tracks[0].items[0].timeline_start_us(), TimeUs(0));

        // Redo: back on track B at 2M
        history.redo(&mut tl).unwrap();
        assert!(tl.tracks[0].items.is_empty());
        assert_eq!(tl.tracks[1].items.len(), 1);
        assert_eq!(tl.tracks[1].items[0].timeline_start_us(), TimeUs(2_000_000));
    }

    // -----------------------------------------------------------------------
    // Move redo
    // -----------------------------------------------------------------------

    #[test]
    fn move_redo_works() {
        let (mut tl, track_id, clip_id, item) = make_test_timeline();
        tl.add_item(track_id, item).unwrap();

        let mut history = History::new(100);
        let cmd = Box::new(MoveItemCommand::new(clip_id, TimeUs(10_000_000)));
        history.execute(cmd, &mut tl).unwrap();

        history.undo(&mut tl).unwrap();
        assert_eq!(tl.tracks[0].items[0].timeline_start_us(), TimeUs(0));

        history.redo(&mut tl).unwrap();
        assert_eq!(
            tl.tracks[0].items[0].timeline_start_us(),
            TimeUs(10_000_000)
        );
    }
}
