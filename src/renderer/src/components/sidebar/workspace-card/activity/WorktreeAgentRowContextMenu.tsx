import React, { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { useAppStore } from '@/store/index'
import { agentAttentionTurnAt } from '@/attention/agent-attention-acknowledgement'
import type { DashboardAgentRow as AgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import { agentRowDisplayDotState } from '../../../../../../shared/agent-row-dot-state'
import { useTranslate } from '@/i18n/use-translate'
import { CLOSE_ALL_CONTEXT_MENUS_EVENT } from '@/lib/overlay-interaction/close-all-context-menus'
import { WORKTREE_CONTEXT_MENU_SCOPE_ATTR } from '../../workspace-actions/context-menu/worktree-context-menu-policy'

type Props = {
  paneKey: string
  row: AgentRow
  acknowledgedAt: number
  disabled?: boolean
  children: React.ReactElement
}

/** Right-click menu scoped to a single sidebar agent row without opening the parent workspace menu. */
export const WorktreeAgentRowContextMenu = React.memo(function WorktreeAgentRowContextMenu({
  paneKey,
  row,
  acknowledgedAt,
  disabled = false,
  children
}: Props): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const turnAt = agentAttentionTurnAt(row.entry)
  const dotState = agentRowDisplayDotState(row)
  const isUnread = row.rowSource === 'live' && dotState === 'done' && acknowledgedAt < turnAt
  const canToggleUnread =
    !disabled && row.rowSource === 'live' && (isUnread || (dotState === 'done' && turnAt > 0))

  useEffect(() => {
    const closeMenu = (): void => setOpen(false)
    window.addEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
    return () => window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
  }, [])

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    window.dispatchEvent(new Event(CLOSE_ALL_CONTEXT_MENUS_EVENT))
  }, [])

  const handleSelect = useCallback(
    (event: Event) => {
      event.stopPropagation()
      const store = useAppStore.getState()
      if (isUnread) {
        store.acknowledgeAgents([paneKey], undefined, 'explicit')
      } else {
        store.unacknowledgeAgents([paneKey])
      }
    },
    [isUnread, paneKey]
  )

  if (!canToggleUnread) {
    return children
  }

  return (
    <ContextMenu open={open} onOpenChange={setOpen} modal={false}>
      <ContextMenuTrigger asChild>
        <div
          className="min-w-0"
          {...{ [WORKTREE_CONTEXT_MENU_SCOPE_ATTR]: 'agent-row' }}
          onContextMenu={handleContextMenu}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent animation="none" className="min-w-40">
        <ContextMenuItem onSelect={handleSelect}>
          {isUnread ? (
            <BellOff className="size-3.5 shrink-0" />
          ) : (
            <Bell className="size-3.5 shrink-0" />
          )}
          {isUnread
            ? t('auto.components.sidebar.WorktreeContextMenu.8dacff1fe0', 'Mark Read')
            : t('auto.components.sidebar.WorktreeContextMenu.f50603c6b2', 'Mark Unread')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
