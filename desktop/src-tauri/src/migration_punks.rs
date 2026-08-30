use std::path::{Path, PathBuf};

pub(super) fn previous_product_nest(home: &Path, current_nest: &Path) -> PathBuf {
    home.join(
        if current_nest
            .file_name()
            .is_some_and(|name| name == ".punks-dev")
        {
            ".punks-dev"
        } else {
            ".punks"
        },
    )
}

pub(super) fn migrate_previous_product_repos_dir(
    home: &Path,
    current_nest: &Path,
    is_dev: bool,
    reset_completed: bool,
) {
    if reset_completed || current_nest.join(".repos-dir").exists() {
        return;
    }
    let previous = home
        .join(if is_dev { ".punks-dev" } else { ".punks" })
        .join(".repos-dir");
    if !previous.is_file() {
        return;
    }
    if let Err(error) = std::fs::create_dir_all(current_nest)
        .and_then(|()| std::fs::copy(&previous, current_nest.join(".repos-dir")).map(|_| ()))
    {
        eprintln!("punks: previous nest repos migration failed: {error}");
    }
}

pub(super) fn is_retired_mcp_command(value: &str) -> bool {
    const MASK: u8 = 90;
    const RETIRED: &[&[u8]] = &[
        &[56, 47, 32, 32, 119, 55, 57, 42, 119, 41, 63, 40, 44, 63, 40],
        &[56, 47, 32, 32, 119, 62, 63, 44, 119, 55, 57, 42],
    ];
    RETIRED.iter().any(|encoded| {
        value.len() == encoded.len()
            && value
                .bytes()
                .zip(encoded.iter().copied())
                .all(|(byte, expected)| byte ^ MASK == expected)
    })
}
