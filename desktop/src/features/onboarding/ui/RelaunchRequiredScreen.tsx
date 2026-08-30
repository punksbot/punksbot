import { RecoveryScreen } from "./RecoveryScreen";

export function RelaunchRequiredScreen() {
  return (
    <RecoveryScreen
      testId="relaunch-required"
      title="Restart Punks to finish recovery"
      body="Your identity was updated. Punks needs to restart so syncing and agents run under it."
    />
  );
}
