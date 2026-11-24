import { useCallback, useMemo } from 'react'
import { useAppStateValue } from '@/store/retained-views/app-state-view'
import { recomputeOn } from '@/lib/recompute-on'
import { agentRowDisplayDotState } from '../../../../../../shared/agent-row-dot-state'
import type { ExecutionHostId } from '../../../../../../shared/execution-host/execution-host'
import { useAgentPresentation } from './useWorktreeAgentRows'
import { useHostRootKeys } from './use-worktree-agent-host-roots'
import { createRootsUnreadSelector } from './worktree-card-agent-ack-inputs'

export type WorktreeAgentsSummary = {
  rootCount: number
  unreadDoneCount: number
}

/** Counts host-visible root agents and unread completed agents for a workspace card. */
export function useWorktreeAgentsSummary(
  worktreeId: string,
  executionHostId?: ExecutionHostId
): WorktreeAgentsSummary {
  const allRoots = useAgentPresentation(
    `roots\0${worktreeId}`,
    useCallback((p) => p.display.roots(worktreeId), [worktreeId])
  )
  const roots = useHostRootKeys(worktreeId, executionHostId, allRoots)
  const projection = useAppStateValue((s) => s.agentStatusByPaneKey.projection)
  const revision = useAgentPresentation(
    `list\0${worktreeId}`,
    useCallback((p) => p.revision(worktreeId), [worktreeId])
  )
  const selectUnread = useMemo(() => createRootsUnreadSelector(worktreeId), [worktreeId])
  const unreadFlags = useAppStateValue(
    useCallback((s) => selectUnread(s, roots), [selectUnread, roots])
  )

  return useMemo(
    () =>
      recomputeOn([revision], () => {
        let unreadDoneCount = 0
        for (let i = 0; i < roots.length; i += 1) {
          if (!unreadFlags[i]) {
            continue
          }
          const row = projection.row(roots[i])
          if (row && row.rowSource === 'live' && agentRowDisplayDotState(row) === 'done') {
            unreadDoneCount += 1
          }
        }
        return { rootCount: roots.length, unreadDoneCount }
      }),
    [projection, revision, roots, unreadFlags]
  )
}
