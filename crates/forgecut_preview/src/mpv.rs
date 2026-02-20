use serde_json::json;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

pub struct MpvController {
    process: Option<Child>,
    socket_path: PathBuf,
    xlib: Option<x11_dl::xlib::Xlib>,
    display: Option<*mut x11_dl::xlib::Display>,
    child_window: Option<u64>,
}

// Safety: Only accessed behind Mutex in AppState
unsafe impl Send for MpvController {}

impl Default for MpvController {
    fn default() -> Self {
        Self::new()
    }
}

impl MpvController {
    pub fn new() -> Self {
        let socket_path =
            std::env::temp_dir().join(format!("forgecut-mpv-{}", std::process::id()));
        Self {
            process: None,
            socket_path,
            xlib: None,
            display: None,
            child_window: None,
        }
    }

    /// Start mpv embedded as a child window of the given X11 parent window.
    /// Creates an X11 child window at (x, y) with size (w, h) inside the parent,
    /// then starts mpv with --wid pointing to the child window.
    pub fn start_embedded(
        &mut self,
        parent_xid: u64,
        x: i32,
        y: i32,
        w: u32,
        h: u32,
    ) -> Result<(), String> {
        self.stop();

        let xlib = x11_dl::xlib::Xlib::open().map_err(|e| format!("Failed to open Xlib: {e}"))?;

        let display = unsafe { (xlib.XOpenDisplay)(std::ptr::null()) };
        if display.is_null() {
            return Err("Failed to open X11 display".into());
        }

        let screen = unsafe { (xlib.XDefaultScreen)(display) };
        let black_pixel = unsafe { (xlib.XBlackPixel)(display, screen) };

        let child_xid = unsafe {
            (xlib.XCreateSimpleWindow)(
                display,
                parent_xid as x11_dl::xlib::Window,
                x,
                y,
                w,
                h,
                0,          // border width
                black_pixel,
                black_pixel,
            )
        };

        if child_xid == 0 {
            unsafe { (xlib.XCloseDisplay)(display) };
            return Err("Failed to create X11 child window".into());
        }

        unsafe { (xlib.XMapWindow)(display, child_xid) };
        unsafe { (xlib.XFlush)(display) };

        self.xlib = Some(xlib);
        self.display = Some(display);
        self.child_window = Some(child_xid);

        let log_path =
            std::env::temp_dir().join(format!("forgecut-mpv-{}.log", std::process::id()));
        let log_file = std::fs::File::create(&log_path).ok();
        tracing::info!("[mpv] starting embedded in child xid={child_xid}, parent={parent_xid}");
        tracing::info!("[mpv] log: {}", log_path.display());

        let child = Command::new("mpv")
            .args([
                "--idle=yes",
                "--keep-open=yes",
                "--osc=no",
                "--osd-level=0",
                "--no-focus-on-open",
                &format!("--wid={child_xid}"),
                &format!("--input-ipc-server={}", self.socket_path.display()),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log_file.map(Stdio::from).unwrap_or(Stdio::null()))
            .spawn()
            .map_err(|e| format!("Failed to start mpv: {e}"))?;

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

    /// Reposition and resize the X11 child window.
    pub fn update_geometry(&self, x: i32, y: i32, w: u32, h: u32) {
        if let (Some(ref xlib), Some(display), Some(child_xid)) =
            (&self.xlib, self.display, self.child_window)
        {
            unsafe {
                (xlib.XMoveResizeWindow)(
                    display,
                    child_xid as x11_dl::xlib::Window,
                    x,
                    y,
                    w,
                    h,
                );
                (xlib.XFlush)(display);
            }
        }
    }

    fn send_command(&self, command: serde_json::Value) -> Result<serde_json::Value, String> {
        let mut stream = UnixStream::connect(&self.socket_path)
            .map_err(|e| format!("Failed to connect to mpv: {e}"))?;
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(2)))
            .ok();

        let msg = format!("{command}\n");
        stream
            .write_all(msg.as_bytes())
            .map_err(|e| format!("Write failed: {e}"))?;

        let mut reader = BufReader::new(stream);
        let mut response = String::new();
        reader
            .read_line(&mut response)
            .map_err(|e| format!("Read failed: {e}"))?;

        serde_json::from_str(&response).map_err(|e| format!("Parse failed: {e}"))
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

        // Destroy X11 child window and close display
        if let (Some(ref xlib), Some(display), Some(child_xid)) =
            (&self.xlib, self.display, self.child_window)
        {
            unsafe {
                (xlib.XDestroyWindow)(display, child_xid as x11_dl::xlib::Window);
                (xlib.XCloseDisplay)(display);
            }
        }
        self.child_window = None;
        self.display = None;
        self.xlib = None;
    }
}

impl Drop for MpvController {
    fn drop(&mut self) {
        self.stop();
    }
}
