use forgecut_core::history::History;
use forgecut_core::types::Project;
use forgecut_preview::mpv::MpvController;
use std::sync::Mutex;

pub struct AppState {
    pub project: Mutex<Project>,
    pub history: Mutex<History>,
    pub mpv: Mutex<MpvController>,
}
