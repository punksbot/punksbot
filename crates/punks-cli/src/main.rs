#[tokio::main]
async fn main() {
    std::process::exit(punks_cli::run_from_args(std::env::args()).await);
}
