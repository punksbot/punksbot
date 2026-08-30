pub(super) fn punks_local_command_alias(command: &str) -> &str {
    if !cfg!(feature = "punks-local") {
        return command;
    }
    if previous_product_command(command, b"-acp") {
        "punks-acp"
    } else if previous_product_command(command, b"-agent") {
        "punks-agent"
    } else if previous_product_command(command, b"-dev-mcp") {
        "punks-dev-mcp"
    } else if command == "git-credential-nostr" {
        "git-credential-punks"
    } else if previous_product_command(command, b"") {
        "punks"
    } else {
        command
    }
}

fn previous_product_command(command: &str, suffix: &[u8]) -> bool {
    let bytes = command.as_bytes();
    bytes.get(..4) == Some(&[98, 117, 122, 122]) && bytes.get(4..) == Some(suffix)
}
