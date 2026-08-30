import { invokeTauri } from "@/shared/api/tauri";

export async function setLocalNotificationPreferences(input: {
  accountPubkey: string;
  desktopEnabled: boolean;
  remindersEnabled: boolean;
}): Promise<void> {
  await invokeTauri("punks_local_set_notification_preferences", input);
}
