# Frozen Punks workflow baseline

These files are the complete workflow sources imported from
`punksbot/punksbot@da818eddc2f470c006a1073c8c5452f8a989f272`.

They are deliberately stored outside `.github/workflows`, so GitHub does not
register or execute them for Punks Bot. Some of them build the legacy relay or
start infrastructure that is forbidden by Punks Bot's managed-only boundary.
They remain available solely as historical and differential-migration input.

Do not move or copy one of these files back into the active workflow directory.
A required behavior must be reimplemented as a Workers-only Punks workflow.

`punks-pre-managed/` preserves the last fork-local variants that were still
registered as active workflows before the managed-only boundary was enforced.
They are historical migration inputs only and must not be executed.
