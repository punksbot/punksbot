import * as React from "react";

import type { useCommunities } from "@/features/communities/useCommunities";
import { renameLocalWorkspace } from "@/shared/api/tauriLocalWorkspaces";

type Communities = ReturnType<typeof useCommunities>;

/** Persist Full Local display-name edits in the native Workspace registry. */
export function useLocalWorkspaceRename(communities: Communities) {
  return React.useCallback(
    (id: string, updates: Parameters<Communities["updateCommunity"]>[1]) => {
      const previousName = communities.communities.find(
        (community) => community.id === id,
      )?.name;
      const result = communities.updateCommunity(id, updates);
      if (
        import.meta.env.VITE_PUNKS_LOCAL === "1" &&
        result.kind === "updated" &&
        updates.name !== undefined
      ) {
        void renameLocalWorkspace(id, updates.name)
          .then((workspace) => {
            communities.updateCommunity(id, { name: workspace.name });
          })
          .catch((error) => {
            console.error("Failed to rename local Workspace:", error);
            if (previousName !== undefined) {
              communities.updateCommunity(id, { name: previousName });
            }
          });
      }
      return result;
    },
    [communities],
  );
}
