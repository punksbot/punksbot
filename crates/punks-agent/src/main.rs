fn main() {
    if let Err(e) = punks_agent::run() {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}
