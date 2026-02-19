use serde_json::json;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

pub struct MpvController {
    process: Option<Child>,
    socket_path: PathBuf,
}

// Safety: Only accessed behind Mutex in AppState
unsafe impl Send for MpvController {}

impl MpvController {
    pub fn new() -> Self {
        let socket_path =
            std::env::temp_dir().join(format!("forgecut-mpv-{}", std::process::id()));
        Self {
            process: None,
            socket_path,
        }
    }

    /// Start mpv as a borderless window positioned at screen coordinates (sx, sy) with size (w, h).
    pub fn start_at(
        &mut self,
        sx: i32,
        sy: i32,
        w: u32,
        h: u32,
    ) -> Result<(), String> {
        self.stop();

        let geometry = format!("{}x{}+{}+{}", w, h, sx, sy);
        let log_path =
            std::env::temp_dir().join(format!("forgecut-mpv-{}.log", std::process::id()));
        let log_file = std::fs::File::create(&log_path).ok();
        eprintln!("[mpv] starting with geometry={}", geometry);
        eprintln!("[mpv] log: {}", log_path.display());

        let child = Command::new("mpv")
            .args([
                "--idle=yes",
                "--keep-open=yes",
                "--osc=no",
                "--osd-level=0",
                "--no-border",
                "--on-all-workspaces=no",
                "--ontop",
                "--no-focus-on-open",
                "--title=forgecut-preview",
                &format!("--geometry={}", geometry),
                &format!("--input-ipc-server={}", self.socket_path.display()),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log_file.map(Stdio::from).unwrap_or(Stdio::null()))
            .spawn()
            .map_err(|e| format!("Failed to start mpv: {}", e))?;

        self.process = Some(child);

        // Wait for socket
        for _ in 0..50 {
            if self.socket_path.exists() {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        Err("mpv socket did not appear".into())
    }

    /// Reposition the mpv window using xdotool.
    pub fn update_geometry(&self, sx: i32, sy: i32, w: u32, h: u32) {
        let _ = Command::new("xdotool")
            .args([
                "search",
                "--name",
                "forgecut-preview",
                "windowmove",
                &sx.to_string(),
                &sy.to_string(),
                "windowsize",
                &w.to_string(),
                &h.to_string(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    fn send_command(&self, command: serde_json::Value) -> Result<serde_json::Value, String> {
        let mut stream = UnixStream::connect(&self.socket_path)
            .map_err(|e| format!("Failed to connect to mpv: {}", e))?;
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(2)))
            .ok();

        let msg = format!("{}\n", command);
        stream
            .write_all(msg.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;

        let mut reader = BufReader::new(stream);
        let mut response = String::new();
        reader
            .read_line(&mut response)
            .map_err(|e| format!("Read failed: {}", e))?;

        serde_json::from_str(&response).map_err(|e| format!("Parse failed: {}", e))
    }

    pub fn load_file(&self, path: &str) -> Result<(), String> {
        self.send_command(json!({ "command": ["loadfile", path] }))?;
        Ok(())
    }

    pub fn seek(&self, seconds: f64) -> Result<(), String> {
        self.send_command(json!({ "command": ["seek", seconds, "absolute"] }))?;
        Ok(())
    }

    pub fn pause(&self) -> Result<(), String> {
        self.send_command(json!({ "command": ["set_property", "pause", true] }))?;
        Ok(())
    }

    pub fn resume(&self) -> Result<(), String> {
        self.send_command(json!({ "command": ["set_property", "pause", false] }))?;
        Ok(())
    }

    pub fn get_position(&self) -> Result<f64, String> {
        let resp = self.send_command(json!({ "command": ["get_property", "time-pos"] }))?;
        resp.get("data")
            .and_then(|d| d.as_f64())
            .ok_or("No position data".into())
    }

    pub fn is_running(&self) -> bool {
        self.process.is_some()
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

impl Drop for MpvController {
    fn drop(&mut self) {
        self.stop();
    }
}
