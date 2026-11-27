import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts
} from '../../../../shared/sidebar-list/hosts/host-filtering'
import { getRenderableFolderWorkspaces } from '../../../../shared/sidebar-list/folders/folder-workspace-lanes'
import { worktreeMatchesVisibleHost } from '@/components/sidebar/worktree-list/listing/visible-worktree-host-scope'
import {
  filterFolderWorkspacesFromOtherDevices,
  isWorkspaceOwnedBySomeoneElse
} from '../../../../shared/workspace-view/workspace-creator-visibility'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import type { FolderWorkspace } from '../../../../shared/folder-workspaces/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project/groups/project-group-types'
import type { Repo } from '../../../../shared/repository/repo-types'
import { folderWorkspaceKey } from '../../../../shared/workspace/identity/workspace-scope'
import type { StoredAgentAttentionUnread } from '@/attention/agent-attention-contract'
import {
  isAgentSubjectUnread,
  type AgentAttentionTurnRecords
} from '@/attention/agent-attention-acknowledgement'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import type { Tab } from '../../../../shared/workspace-layout/tab-groups/tab-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { hasLiveTabMarker } from '@/store/slices/workspace-attention/workspace-live-markers'
import type { AgentStatusProjection } from '@/store/slices/agent-status/projection/agent-status-projection'
import { agentRowDisplayDotState } from '../../../../shared/agent-row-dot-state'

export type UnreadBadgeCountSources = {
  worktreeBuckets: Readonly<Record<string, readonly Worktree[]>>
  folderList: readonly FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
  repoMap: Map<string, Repo>
  /** null when the sidebar shows every host. */
  visibleHostIds: ReadonlySet<ExecutionHostId> | null
  defaultHostId: ExecutionHostId
  /** null unless the sidebar hides workspaces created from other devices. */
  hiddenOtherDevicePairings: ReadonlyMap<string, string> | null
  tabsByWorktree?: Readonly<Record<string, readonly Pick<TerminalTab, 'id'>[]>>
  unifiedTabsByWorktree?: Readonly<Record<string, readonly Pick<Tab, 'id' | 'contentType'>[]>>
  unreadTerminalTabs?: Readonly<Record<string, StoredAgentAttentionUnread>>
  agentStatusProjection?: AgentStatusProjection
  agentTurnRecords?: AgentAttentionTurnRecords
}

function countUnreadDoneAgents(
  workspaceId: string,
  projection: AgentStatusProjection | undefined,
  turnRecords: AgentAttentionTurnRecords | undefined
): number {
  if (!projection || !turnRecords) {
    return 0
  }
  let count = 0
  for (const paneKey of projection.display.roots(workspaceId)) {
    const row = projection.row(paneKey)
    if (
      row &&
      row.rowSource === 'live' &&
      agentRowDisplayDotState(row) === 'done' &&
      isAgentSubjectUnread(turnRecords, paneKey)
    ) {
      count += 1
    }
  }
  return count
}

/** Counts unread completed agents across visible workspaces, falling back to 1 per workspace-only unread flag. */
export function getUnreadBadgeCount(sources: UnreadBadgeCountSources): number {
  const { visibleHostIds, defaultHostId, agentStatusProjection, agentTurnRecords } = sources
  const seenWorktreeIds = new Set<string>()
  let worktreeTotal = 0
  for (const worktrees of Object.values(sources.worktreeBuckets)) {
    for (const worktree of worktrees) {
      // Why: the sidebar never renders an archived worktree, nor one on a host it is not showing.
      if (
        worktree.isArchived ||
        seenWorktreeIds.has(worktree.id) ||
        (sources.hiddenOtherDevicePairings &&
          isWorkspaceOwnedBySomeoneElse(worktree, sources.hiddenOtherDevicePairings)) ||
        !worktreeMatchesVisibleHost(worktree, visibleHostIds, sources.repoMap, defaultHostId)
      ) {
        continue
      }
      seenWorktreeIds.add(worktree.id)
      const agentUnread = countUnreadDoneAgents(
        worktree.id,
        agentStatusProjection,
        agentTurnRecords
      )
      if (agentUnread > 0) {
        worktreeTotal += agentUnread
      } else if (worktree.isUnread) {
        worktreeTotal += 1
      }
    }
  }
  return worktreeTotal + countUnreadFolderEntries(sources)
}

/** Folder workspaces through the same membership steps the sidebar runs before building rows. */
function countUnreadFolderEntries(sources: UnreadBadgeCountSources): number {
  const {
    projectGroups,
    visibleHostIds,
    defaultHostId,
    hiddenOtherDevicePairings,
    agentStatusProjection,
    agentTurnRecords
  } = sources
  const unreadByFolderId = new Map<string, number>()
  const candidates: FolderWorkspace[] = []
  for (const folder of sources.folderList) {
    const key = folderWorkspaceKey(folder.id)
    const agentUnread = countUnreadDoneAgents(key, agentStatusProjection, agentTurnRecords)
    const count =
      agentUnread > 0 ? agentUnread : folder.isUnread && hasLiveTabMarker(sources, key) ? 1 : 0
    if (count > 0) {
      unreadByFolderId.set(folder.id, count)
      candidates.push(folder)
    }
  }
  if (candidates.length === 0) {
    return 0
  }
  const onVisibleHosts = filterFolderWorkspacesForVisibleHosts(
    candidates,
    projectGroups,
    visibleHostIds,
    defaultHostId
  )
  const rows = getRenderableFolderWorkspaces(
    hiddenOtherDevicePairings
      ? filterFolderWorkspacesFromOtherDevices(onVisibleHosts, hiddenOtherDevicePairings)
      : onVisibleHosts,
    filterProjectGroupsForVisibleHosts(projectGroups, visibleHostIds, defaultHostId)
  )
  const seenFolderIds = new Set<string>()
  let total = 0
  for (const { folderWorkspace } of rows) {
    if (seenFolderIds.has(folderWorkspace.id)) {
      continue
    }
    seenFolderIds.add(folderWorkspace.id)
    total += unreadByFolderId.get(folderWorkspace.id) ?? 0
  }
  return total
}
