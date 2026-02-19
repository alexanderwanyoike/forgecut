use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("file not found: {0}")]
    FileNotFound(PathBuf),

    #[error("failed to execute ffprobe: {0}")]
    FfprobeExec(String),

    #[error("ffprobe failed: {0}")]
    FfprobeFailed(String),

    #[error("ffmpeg not found")]
    FfmpegNotFound,

    #[error("ffmpeg failed: {0}")]
    FfmpegFailed(String),

    #[error("no clips to render")]
    NoClips,

    #[error("asset not found: {0}")]
    AssetNotFound(uuid::Uuid),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, RenderError>;
