use forgecut_core::history::History;
use forgecut_core::types::Project;
use std::sync::Mutex;

pub struct AppState {
    pub project: Mutex<Project>,
    pub history: Mutex<History>,
    pub media_server_port: u16,
}
