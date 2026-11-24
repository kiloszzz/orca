import { agentAttentionTurnAt } from '@/attention/agent-attention-acknowledgement'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  isAgentStatusFresh
} from '../../../../../shared/agent-status/contracts/agent-status-freshness'
import type { AgentStatusEntry } from '../../../../../shared/agent-status/contracts/agent-status-types'
import {
  parseLegacyNumericPaneKey,
  parsePaneKey
} from '../../../../../shared/workspace-layout/stable-pane-id'

function parseTabIdFromPaneKey(paneKey: string): string | null {
  return parsePaneKey(paneKey)?.tabId ?? parseLegacyNumericPaneKey(paneKey)?.tabId ?? null
}

/** Collect pane keys in `agentStatusByPaneKey` that belong to a terminal or structured-chat tab. */
export function getTabAgentPaneKeys(
  agentStatusByPaneKey: ReadonlyMap<string, AgentStatusEntry> | undefined,
  tabId: string
): string[] {
  if (!agentStatusByPaneKey) {
    return []
  }
  const keys: string[] = []
  for (const [paneKey, entry] of agentStatusByPaneKey.entries()) {
    if (parseTabIdFromPaneKey(entry.paneKey || paneKey) === tabId) {
      keys.push(paneKey)
    }
  }
  return keys
}

/** True when any fresh completed agent pane on `tabId` is unacknowledged (including manually marked unread). */
export function hasUnacknowledgedDoneAgentForTab(
  agentStatusByPaneKey: ReadonlyMap<string, AgentStatusEntry> | undefined,
  acknowledgedAgentsByPaneKey: Record<string, number> | undefined,
  tabId: string
): boolean {
  if (!agentStatusByPaneKey || !acknowledgedAgentsByPaneKey) {
    return false
  }
  const now = Date.now()
  for (const [paneKey, entry] of agentStatusByPaneKey.entries()) {
    if (parseTabIdFromPaneKey(entry.paneKey || paneKey) !== tabId || entry.restoredUnconfirmed) {
      continue
    }
    if (!isAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS) || entry.state !== 'done') {
      continue
    }
    const turnAt = agentAttentionTurnAt(entry)
    if (turnAt > 0 && (acknowledgedAgentsByPaneKey[paneKey] ?? 0) < turnAt) {
      return true
    }
  }
  return false
}
