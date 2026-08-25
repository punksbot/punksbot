/* Generated from profiles/desktop-social-loop@1.json. Do not edit. */

export const DESKTOP_SOCIAL_LOOP_PROFILE_ID = "desktop-social-loop@1" as const;
export const DESKTOP_SOCIAL_LOOP_REGISTRY_VERSION = 1 as const;
export const DESKTOP_SOCIAL_LOOP_CAPABILITIES = [
  "compatibility",
  "account-session",
  "authentication",
  "workspace-selection",
  "stream-list",
  "message-history",
  "threads",
  "bounded-authors",
  "conversation-follow",
  "message-post",
  "unicode-reactions",
] as const;

export type DesktopSocialLoopCapability =
  (typeof DESKTOP_SOCIAL_LOOP_CAPABILITIES)[number];
