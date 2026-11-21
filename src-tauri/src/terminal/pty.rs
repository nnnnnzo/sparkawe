use std::{
    fs::File,
    io,
    os::fd::{AsRawFd, FromRawFd, RawFd},
    os::unix::process::CommandExt,
    path::Path,
    process::{Child, Command, Stdio},
};

use super::zsh::ZshStartup;

pub struct Pty {
    pub master: File,
    pub child: Child,
    _zsh_startup: Option<ZshStartup>,
}

impl Pty {
    pub fn spawn(shell: &Path, cwd: &Path, columns: u16, rows: u16) -> io::Result<Self> {
        let mut command = Command::new(shell);
        command.arg("-i").current_dir(cwd);
        Self::spawn_command(command, columns, rows)
    }

    fn spawn_command(mut command: Command, columns: u16, rows: u16) -> io::Result<Self> {
        let mut master_fd = -1;
        let mut slave_fd = -1;
        let mut size = dimensions(columns, rows);
        // openpty initializes both descriptors together on success.
        checked(unsafe {
            libc::openpty(
                &mut master_fd,
                &mut slave_fd,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut size,
            )
        })?;
        let master = unsafe { File::from_raw_fd(master_fd) };
        let slave = unsafe { File::from_raw_fd(slave_fd) };
        for fd in [master_fd, slave_fd] {
            checked(unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) })?;
        }
        // Shell startup must still work on systems without a writable temp directory.
        let zsh_startup = ZshStartup::configure(&mut command).unwrap_or_else(|error| {
            eprintln!("Coloration Zsh indisponible : {error}");
            None
        });
        command
            .env("TERM", "xterm-256color")
            .env("COLORTERM", "truecolor")
            .stdin(Stdio::from(slave.try_clone()?))
            .stdout(Stdio::from(slave.try_clone()?))
            .stderr(Stdio::from(slave));
        // std installs the requested stdio before running pre_exec.
        unsafe {
            command.pre_exec(|| {
                checked(libc::setsid())?;
                checked(libc::ioctl(0, libc::TIOCSCTTY as _, 0))?;
                Ok(())
            });
        }
        let child = command.spawn()?;
        Ok(Self {
            master,
            child,
            _zsh_startup: zsh_startup,
        })
    }

    pub fn resize(&self, columns: u16, rows: u16) -> io::Result<()> {
        let size = dimensions(columns, rows);
        checked(unsafe { libc::ioctl(self.master.as_raw_fd(), libc::TIOCSWINSZ as _, &size) })
    }

    pub fn stop(&mut self) -> io::Result<()> {
        if self.child.try_wait()?.is_none() {
            let foreground = unsafe { libc::tcgetpgrp(self.master.as_raw_fd()) };
            let shell = self.child.id() as libc::pid_t;
            if foreground > 0 && foreground != shell {
                unsafe { libc::kill(-foreground, libc::SIGHUP) };
            }
            unsafe { libc::kill(-shell, libc::SIGHUP) };
            let _ = self.child.kill();
        }
        self.child.wait()?;
        Ok(())
    }
}

impl Drop for Pty {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn dimensions(columns: u16, rows: u16) -> libc::winsize {
    libc::winsize {
        ws_col: columns.max(2),
        ws_row: rows.max(1),
        ws_xpixel: 0,
        ws_ypixel: 0,
    }
}

fn checked(result: RawFd) -> io::Result<()> {
    if result == -1 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::sync::mpsc;
    use std::time::Duration;
    use std::{env, fs, path::PathBuf};

    #[test]
    fn shell_reads_input_and_reports_window_size() {
        let mut terminal = Pty::spawn(Path::new("/bin/sh"), Path::new("/tmp"), 80, 24).unwrap();
        terminal.resize(100, 32).unwrap();
        let mut reader = terminal.master.try_clone().unwrap();
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = reader.read_to_end(&mut bytes);
            let _ = send.send(String::from_utf8_lossy(&bytes).into_owned());
        });
        terminal
            .master
            .write_all(b"stty size; pwd; exit\n")
            .unwrap();
        let output = receive.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(output.contains("32 100"), "{output}");
        assert!(output.contains("/tmp"), "{output}");
        terminal.stop().unwrap();
    }

    #[test]
    fn zsh_colors_unsubmitted_commands_after_loading_user_configuration() {
        let Some(shell) = ["/bin/zsh", "/usr/bin/zsh"]
            .into_iter()
            .find(|path| Path::new(path).is_file())
        else {
            eprintln!("Zsh indisponible, test ignoré.");
            return;
        };
        struct UserConfig(PathBuf);
        impl Drop for UserConfig {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let directory = env::temp_dir().join(format!("lab-zsh-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let config = UserConfig(directory);
        fs::write(config.0.join(".zshenv"), "LAB_TEST_ENV=loaded\n").unwrap();
        fs::write(
            config.0.join(".zshrc"),
            "PS1=\"LAB-${LAB_TEST_ENV}-${COLORTERM}>\"\nHISTFILE=\n",
        )
        .unwrap();
        let mut command = Command::new(shell);
        command
            .arg("-i")
            .env("HOME", &config.0)
            .env("ZDOTDIR", &config.0)
            .current_dir(&config.0);
        let mut terminal = Pty::spawn_command(command, 80, 24).unwrap();
        let mut reader = terminal.master.try_clone().unwrap();
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = [0; 1024];
            while let Ok(size @ 1..) = reader.read(&mut bytes) {
                if send.send(bytes[..size].to_vec()).is_err() {
                    break;
                }
            }
        });
        let mut output = Vec::new();
        let mut read_through = |expected: &[u8]| {
            while !output
                .windows(expected.len())
                .any(|bytes| bytes == expected)
            {
                output.extend(receive.recv_timeout(Duration::from_secs(5)).unwrap_or_else(
                    |error| panic!("{error}: {}", String::from_utf8_lossy(&output)),
                ));
            }
        };
        read_through(b"LAB-loaded-truecolor>");
        terminal.master.write_all(b"printf 'color'").unwrap();
        read_through(b"\x1b[32mp");
        read_through(b"\x1b[33m'");
    }
}
