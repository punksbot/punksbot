//! Thin `punks-admin deletions` adapter.

pub use punks_deletion::Command as DeletionsCommand;

/// Delegate to the shared durable deletion engine.
pub async fn run(command: DeletionsCommand) -> anyhow::Result<i32> {
    punks_deletion::run(command).await
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    #[test]
    fn continuous_worker_command_is_not_exposed() {
        let command = crate::Cli::try_parse_from(["punks-admin", "deletions", "worker"]);
        assert!(command.is_err());
    }
}
