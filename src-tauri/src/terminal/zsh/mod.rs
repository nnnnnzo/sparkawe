use std::{
    env,
    ffi::{OsStr, OsString},
    fs::{self, DirBuilder},
    io,
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
    process::Command,
};

const BOOTSTRAP: &[u8] = include_bytes!(".zshenv");
const PLUGIN_FILES: &[(&str, &[u8])] = &[
    (".version", include_bytes!("vendor/.version")),
    (".revision-hash", include_bytes!("vendor/.revision-hash")),
    (
        "zsh-syntax-highlighting.zsh",
        include_bytes!("vendor/zsh-syntax-highlighting.zsh"),
    ),
];
const HIGHLIGHTERS: &[(&str, &[u8])] = &[
    (
        "brackets",
        include_bytes!("vendor/highlighters/brackets/brackets-highlighter.zsh"),
    ),
    (
        "cursor",
        include_bytes!("vendor/highlighters/cursor/cursor-highlighter.zsh"),
    ),
    (
        "line",
        include_bytes!("vendor/highlighters/line/line-highlighter.zsh"),
    ),
    (
        "main",
        include_bytes!("vendor/highlighters/main/main-highlighter.zsh"),
    ),
    (
        "pattern",
        include_bytes!("vendor/highlighters/pattern/pattern-highlighter.zsh"),
    ),
    (
        "regexp",
        include_bytes!("vendor/highlighters/regexp/regexp-highlighter.zsh"),
    ),
    (
        "root",
        include_bytes!("vendor/highlighters/root/root-highlighter.zsh"),
    ),
];

pub(super) struct ZshStartup(PathBuf);

impl ZshStartup {
    pub(super) fn configure(command: &mut Command) -> io::Result<Option<Self>> {
        if Path::new(command.get_program()).file_name() != Some(OsStr::new("zsh")) {
            return Ok(None);
        }
        let startup = Self::create()?;
        let original = command
            .get_envs()
            .find(|(key, _)| *key == "ZDOTDIR")
            .map_or_else(
                || env::var_os("ZDOTDIR"),
                |(_, value)| value.map(OsString::from),
            );
        let original_key = "SPARK_ZSH_ORIGINAL_ZDOTDIR";
        command.env("ZDOTDIR", &startup.0);
        if let Some(original) = original {
            command.env(original_key, original);
        } else {
            command.env_remove(original_key);
        }
        Ok(Some(startup))
    }

    fn create() -> io::Result<Self> {
        let directory = env::temp_dir().join(format!("spark-zsh-{}", uuid::Uuid::new_v4()));
        DirBuilder::new().mode(0o700).create(&directory)?;
        let startup = Self(directory);
        fs::write(startup.0.join(".zshenv"), BOOTSTRAP)?;
        let vendor = startup.0.join("vendor");
        fs::create_dir(&vendor)?;
        for (file, contents) in PLUGIN_FILES {
            fs::write(vendor.join(file), contents)?;
        }
        for (name, contents) in HIGHLIGHTERS {
            let path = vendor.join("highlighters").join(name);
            fs::create_dir_all(&path)?;
            fs::write(path.join(format!("{name}-highlighter.zsh")), contents)?;
        }
        Ok(startup)
    }
}

impl Drop for ZshStartup {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
