#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Service(Mutex<Option<Child>>);
impl Drop for Service {
    fn drop(&mut self) {
        if let Ok(child) = self.0.get_mut() {
            if let Some(mut child) = child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn node_bin(runtime: &std::path::Path) -> std::path::PathBuf {
    if cfg!(windows) {
        runtime.join("node/node.exe")
    } else {
        runtime.join("node/node")
    }
}

fn data_dir() -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    if let Ok(dir) = std::env::var("AGENTS_DATA_DIR") {
        if !dir.trim().is_empty() {
            return Ok(std::path::PathBuf::from(dir));
        }
    }
    let home = dirs_home().ok_or("无法解析用户目录")?;
    Ok(home.join(".skerry"))
}

fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let runtime = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
            } else {
                app.path().resource_dir()?.join("runtime")
            };
            let data = data_dir()?;
            std::fs::create_dir_all(&data)?;
            let mut command = Command::new(node_bin(&runtime));
            command
                .arg(runtime.join("src/server.mjs"))
                .current_dir(&runtime)
                .env("PORT", "0")
                .env("AGENTS_DATA_DIR", &data)
                .env("MULTI_AGENT_SECRETS", data.join("secrets"))
                .env("AGENTS_DESKTOP", "1")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            #[cfg(windows)]
            command.creation_flags(0x08000000);
            let mut child = command.spawn()?;
            let stdout = child.stdout.take().ok_or("无法读取本地服务状态")?;
            app.manage(Service(Mutex::new(Some(child))));
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                let mut line = String::new();
                let _ = BufReader::new(stdout).read_line(&mut line);
                let _ = tx.send(line);
            });
            let line = rx.recv_timeout(Duration::from_secs(20))?;
            let address = line
                .trim()
                .strip_prefix("AGENTS_READY ")
                .ok_or("本地服务启动失败")?;
            let url: tauri::Url = address.parse()?;
            if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port().is_none()
            {
                return Err("无效的本地服务地址".into());
            }
            let allowed = url.origin();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Skerry")
                .inner_size(1280.0, 840.0)
                .min_inner_size(960.0, 640.0)
                .center()
                .on_navigation(move |url| url.origin() == allowed)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无法启动 Skerry");
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(service) = app.try_state::<Service>() {
                if let Ok(mut child) = service.0.lock() {
                    if let Some(mut child) = child.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        }
    });
}
