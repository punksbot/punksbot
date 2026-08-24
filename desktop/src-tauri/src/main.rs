// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "buzz-desktop")]
    if desktop_lib::print_agent_access_owner_only_probe_if_requested() {
        return;
    }

    // Before anything else: WebKitGTK reads its rendering environment once at
    // process start, and this is the only point where the process is still
    // single threaded and no GTK object exists yet, which is what makes
    // `std::env::set_var` sound.
    #[cfg(all(feature = "buzz-desktop", target_os = "linux"))]
    if let Err(diagnostic) = desktop_lib::webkit_rendering::apply() {
        eprintln!("buzz-desktop: {diagnostic}");
        std::process::exit(1);
    }

    if let Err(error) = desktop_lib::run() {
        eprintln!("desktop: fatal: {error}");
        std::process::exit(1);
    }
}
