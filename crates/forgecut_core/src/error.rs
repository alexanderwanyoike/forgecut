use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Item not found: {0}")]
    ItemNotFound(uuid::Uuid),

    #[error("Track not found: {0}")]
    TrackNotFound(uuid::Uuid),

    #[error("Overlap detected")]
    OverlapDetected,

    #[error("Invalid operation: {0}")]
    InvalidOperation(String),

    #[error("Nothing to undo")]
    NothingToUndo,

    #[error("Nothing to redo")]
    NothingToRedo,

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;
