#[cfg(unix)]
mod pty;
#[cfg(unix)]
mod zsh;

use tauri::{ipc::Channel, State};

#[derive(Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Output {
    Data { bytes: Vec<u8> },
    Closed,
}

#[cfg(unix)]
mod sessions {
    use std::{
        collections::HashMap,
        env,
        io::{self, Read, Write},
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
        time::Duration,
    };

    use super::{pty::Pty, Channel, Output};
    use crate::storage::message;

    #[derive(Default)]
    pub struct Sessions(Arc<Mutex<HashMap<String, Pty>>>);

    impl Sessions {
        pub fn start(
            &self,
            id: String,
            directory: Option<String>,
            columns: u16,
            rows: u16,
            output: Channel<Output>,
        ) -> Result<(), String> {
            if uuid::Uuid::parse_str(&id).is_err() {
                return Err("Session invalide.".into());
            }
            let cwd = directory
                .map(PathBuf::from)
                .or_else(|| env::var_os("HOME").map(PathBuf::from))
                .ok_or("Répertoire personnel introuvable.")?;
            if !cwd.is_dir() {
                return Err("Répertoire du terminal introuvable.".into());
            }
            let shell = env::var_os("SHELL")
                .map(PathBuf::from)
                .filter(|path| path.is_absolute() && path.is_file())
                .unwrap_or_else(|| Path::new("/bin/sh").to_owned());
            let mut entries = self.0.lock().map_err(message)?;
            if entries.contains_key(&id) {
                return Err("Session déjà ouverte.".into());
            }
            let pty = Pty::spawn(&shell, &cwd, columns, rows).map_err(message)?;
            let mut reader = pty.master.try_clone().map_err(message)?;
            entries.insert(id.clone(), pty);
            let sessions = self.0.clone();
            let thread_id = id.clone();
            let worker = std::thread::Builder::new()
                .name("lab-pty".into())
                .spawn(move || {
                    use std::os::fd::AsRawFd;
                    let mut bytes = [0; 8192];
                    loop {
                        let mut descriptor = libc::pollfd {
                            fd: reader.as_raw_fd(),
                            events: libc::POLLIN,
                            revents: 0,
                        };
                        let ready = unsafe {
                            libc::poll(
                                &mut descriptor,
                                1,
                                Duration::from_millis(200).as_millis() as i32,
                            )
                        };
                        if !sessions
                            .lock()
                            .is_ok_and(|entries| entries.contains_key(&thread_id))
                        {
                            break;
                        }
                        if ready == 0 {
                            continue;
                        }
                        if ready < 0 {
                            if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                                continue;
                            }
                            break;
                        }
                        match reader.read(&mut bytes) {
                            Ok(0) => break,
                            Ok(size) => {
                                if output
                                    .send(Output::Data {
                                        bytes: bytes[..size].to_vec(),
                                    })
                                    .is_err()
                                {
                                    break;
                                }
                            }
                            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                            Err(_) => break,
                        }
                    }
                    let _ = sessions
                        .lock()
                        .map(|mut entries| entries.remove(&thread_id));
                    let _ = output.send(Output::Closed);
                });
            if let Err(error) = worker {
                entries.remove(&id);
                return Err(message(error));
            }
            Ok(())
        }

        pub fn input(&self, id: &str, input: String) -> Result<(), String> {
            let mut writer = self
                .0
                .lock()
                .map_err(message)?
                .get(id)
                .ok_or("Session fermée.")?
                .master
                .try_clone()
                .map_err(message)?;
            writer.write_all(input.as_bytes()).map_err(message)
        }

        pub fn resize(&self, id: &str, columns: u16, rows: u16) -> Result<(), String> {
            if let Some(pty) = self.0.lock().map_err(message)?.get(id) {
                pty.resize(columns, rows).map_err(message)?;
            }
            Ok(())
        }

        pub fn close(&self, id: &str) -> Result<(), String> {
            let entry = self.0.lock().map_err(message)?.remove(id);
            if let Some(mut pty) = entry {
                pty.stop().map_err(message)?;
            }
            Ok(())
        }

        pub fn close_all(&self) {
            if let Ok(mut entries) = self.0.lock() {
                entries.clear();
            }
        }
    }
}

#[cfg(unix)]
pub use sessions::Sessions;
#[cfg(not(unix))]
#[derive(Default)]
pub struct Sessions;

#[tauri::command]
pub fn terminal_start(
    sessions: State<'_, Sessions>,
    id: String,
    directory: Option<String>,
    columns: u16,
    rows: u16,
    output: Channel<Output>,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        sessions.start(id, directory, columns, rows, output)
    }
    #[cfg(not(unix))]
    {
        let _ = (sessions, id, directory, columns, rows, output);
        Err("Terminal disponible sur Unix.".into())
    }
}

#[tauri::command]
pub async fn terminal_input(
    app: tauri::AppHandle,
    id: String,
    input: String,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        use tauri::Manager;
        tauri::async_runtime::spawn_blocking(move || app.state::<Sessions>().input(&id, input))
            .await
            .map_err(crate::storage::message)?
    }
    #[cfg(not(unix))]
    {
        let _ = (app, id, input);
        Err("Terminal indisponible.".into())
    }
}

#[tauri::command]
pub fn terminal_resize(
    sessions: State<'_, Sessions>,
    id: String,
    columns: u16,
    rows: u16,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        sessions.resize(&id, columns, rows)
    }
    #[cfg(not(unix))]
    {
        let _ = (sessions, id, columns, rows);
        Ok(())
    }
}

#[tauri::command]
pub fn terminal_close(sessions: State<'_, Sessions>, id: String) -> Result<(), String> {
    #[cfg(unix)]
    {
        sessions.close(&id)
    }
    #[cfg(not(unix))]
    {
        let _ = (sessions, id);
        Ok(())
    }
}
