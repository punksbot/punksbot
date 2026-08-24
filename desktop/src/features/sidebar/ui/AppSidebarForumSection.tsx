import type * as React from "react";
import { FeatureGate } from "@/shared/features";
import { CapabilityGate } from "@/shared/capabilities";
import type { Channel } from "@/shared/api/types";
import { ChannelGroupSection } from "@/features/sidebar/ui/CustomChannelSection";
import type {
  ChannelSortGroupKey,
  ChannelSortMode,
} from "@/features/sidebar/lib/channelSortPreference";
import type { ActiveChannelTurnSummary } from "@/features/agents/activeAgentTurnsStore";

type AppSidebarForumSectionProps = {
  activeWorkingByChannelId: ReadonlyMap<string, ActiveChannelTurnSummary>;
  collapsed: boolean;
  forumChannels: Channel[];
  mutedChannelIds?: ReadonlySet<string>;
  onMarkAllChannelsRead: () => void;
  onMarkChannelRead: (
    channelId: string,
    lastMessageAt: string | null | undefined,
  ) => void;
  onMarkChannelUnread: (channelId: string) => void;
  onMuteChannel?: (channelId: string) => void;
  onUnmuteChannel?: (channelId: string) => void;
  onSelectChannel: (channelId: string) => void;
  onToggleCollapsed: () => void;
  openCreateDialog: (kind: "stream" | "forum") => void;
  requestDeleteChannel: React.Dispatch<React.SetStateAction<Channel | null>>;
  selectedChannelId: string | null;
  selectedView:
    | "home"
    | "channel"
    | "messages"
    | "agents"
    | "workflows"
    | "pulse"
    | "projects";
  setSortModeFor: (group: ChannelSortGroupKey, mode: ChannelSortMode) => void;
  sortMode: ChannelSortMode;
  unreadChannelCounts: ReadonlyMap<string, number>;
  unreadChannelIds: ReadonlySet<string>;
};

/**
 * Section « Forums » de la sidebar, masquée lorsque la capacité forum n'est
 * pas disponible (garde de Disponibilité de capacité, issue #53).
 */
export function AppSidebarForumSection({
  activeWorkingByChannelId,
  collapsed,
  forumChannels,
  mutedChannelIds,
  onMarkAllChannelsRead,
  onMarkChannelRead,
  onMarkChannelUnread,
  onMuteChannel,
  onUnmuteChannel,
  onSelectChannel,
  onToggleCollapsed,
  openCreateDialog,
  requestDeleteChannel,
  selectedChannelId,
  selectedView,
  setSortModeFor,
  sortMode,
  unreadChannelCounts,
  unreadChannelIds,
}: AppSidebarForumSectionProps) {
  return (
    <CapabilityGate capability="forum">
      <FeatureGate feature="forum">
        <ChannelGroupSection
          createLabel="New forum"
          hasUnread={unreadChannelIds.size > 0}
          isCollapsed={collapsed}
          isActiveChannel={selectedView === "channel"}
          activeWorkingByChannelId={activeWorkingByChannelId}
          items={forumChannels}
          sortMode={sortMode}
          onSortModeChange={(mode) => setSortModeFor("forums", mode)}
          actionsTestId="section-actions-forums"
          listTestId="forum-list"
          onCreateClick={() => openCreateDialog("forum")}
          onMarkAllRead={onMarkAllChannelsRead}
          onMarkChannelRead={onMarkChannelRead}
          onMarkChannelUnread={onMarkChannelUnread}
          onSelectChannel={onSelectChannel}
          onToggleCollapsed={onToggleCollapsed}
          selectedChannelId={selectedChannelId}
          title="Forums"
          unreadChannelCounts={unreadChannelCounts}
          unreadChannelIds={unreadChannelIds}
          mutedChannelIds={mutedChannelIds}
          onMuteChannel={onMuteChannel}
          onUnmuteChannel={onUnmuteChannel}
          onDeleteChannel={requestDeleteChannel}
        />
      </FeatureGate>
    </CapabilityGate>
  );
}
