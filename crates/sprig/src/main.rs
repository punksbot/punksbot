fn main() {
    if let Err(e) = dispatch() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn dispatch() -> Result<(), String> {
    let argv0 = std::env::args().next().unwrap_or_default();
    let cmd = std::path::Path::new(&argv0)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match cmd.as_str() {
        "punks-acp" => punks_acp::run().map_err(|e| e.to_string()),
        "punks-agent" => punks_agent::run().map_err(|e| e.to_string()),
        "sprig" => match std::env::args().nth(1).as_deref() {
            Some("-V") | Some("--version") => {
                println!("sprig {}", env!("CARGO_PKG_VERSION"));
                Ok(())
            }
            Some("-h") | Some("--help") | None => {
                print_usage();
                if std::env::args().len() <= 1 {
                    Err("error: invoke Sprig via a personality symlink".into())
                } else {
                    Ok(())
                }
            }
            Some(other) => {
                print_usage();
                Err(format!(
                    "error: unknown Sprig option or personality: {other}"
                ))
            }
        },
        // punks-dev-mcp also handles its own multicall names: rg, tree,
        // punks, git-credential-nostr, and git-sign-nostr.
        _ => punks_dev_mcp::run().map_err(|e| e.to_string()),
    }
}

fn print_usage() {
    println!(
        "Sprig — all-in-one Punks ACP harness, agent, and developer MCP\n\n\
Sprig is a multicall binary. Invoke it through one of the personality names:\n\n\
  punks-acp       ACP harness\n  punks-agent     ACP-compliant agent\n  punks-dev-mcp   Developer MCP server\n\n\
Developer MCP helper names are also supported: rg, tree, punks, git-credential-nostr, git-sign-nostr.\n\n\
Installers can create links with:\n  ln -s sprig punks-acp\n  ln -s sprig punks-agent\n  ln -s sprig punks-dev-mcp"
    );
}
