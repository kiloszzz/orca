import React, { useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import type { ExecutionHostId } from '../../../../../../shared/execution-host/execution-host'
import { useWorktreeAgentExpansionState } from './worktree-card-agents-expansion-state'
import { useWorktreeAgentsSummary } from './use-worktree-agents-summary'

const stopPropagation = (event: React.SyntheticEvent): void => {
  event.stopPropagation()
}

type Props = {
  worktreeId: string
  executionHostId?: ExecutionHostId
}

/** Per-workspace collapse toggle for inline AI sessions, keeping count and unread visible while collapsed. */
export const WorktreeCardAgentsCollapseToggle = React.memo(
  function WorktreeCardAgentsCollapseToggle({
    worktreeId,
    executionHostId
  }: Props): React.JSX.Element | null {
    const t = useTranslate()
    const { rootCount, unreadDoneCount } = useWorktreeAgentsSummary(worktreeId, executionHostId)
    const { agentsCollapsed, toggleAgentsCollapsed } = useWorktreeAgentExpansionState(
      worktreeId,
      executionHostId
    )

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        event.stopPropagation()
        toggleAgentsCollapsed()
      },
      [toggleAgentsCollapsed]
    )

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.stopPropagation()
      }
    }, [])

    if (rootCount === 0) {
      return null
    }

    const hasUnread = unreadDoneCount > 0
    const agentCountLabel = t('sidebar.agentSummary.agentCount', '{{count}} agents', {
      count: rootCount,
      defaultValue_one: '{{count}} agent'
    })
    const unreadLabel = t(
      'auto.components.activity.ActivityTitlebarControls.unreadCount',
      '{{count}} unread',
      {
        count: unreadDoneCount,
        defaultValue_one: '{{count}} unread'
      }
    )
    const pillText = agentsCollapsed
      ? hasUnread
        ? `${unreadLabel} · ${rootCount}`
        : String(rootCount)
      : hasUnread
        ? unreadLabel
        : String(rootCount)
    const ariaLabel = agentsCollapsed
      ? t(
          'auto.components.sidebar.worktree.card.compact.agents.289a1d2ca7',
          'Expand {{value0}}. {{value1}}',
          {
            value0: agentCountLabel,
            value1: hasUnread ? unreadLabel : ''
          }
        )
      : t(
          'auto.components.sidebar.worktree.card.compact.agents.0c1debfe84',
          'Collapse {{value0}}',
          {
            value0: agentCountLabel
          }
        )

    return (
      <button
        type="button"
        draggable={false}
        data-worktree-agents-collapse-toggle=""
        aria-label={ariaLabel}
        aria-expanded={!agentsCollapsed}
        title={ariaLabel}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerDown={stopPropagation}
        onMouseDown={stopPropagation}
        onDoubleClick={stopPropagation}
        className={cn(
          'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-none tabular-nums',
          'text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-foreground',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring'
        )}
      >
        <span
          className={cn(
            'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
            hasUnread
              ? 'bg-agent-unread/20 text-agent-unread-text'
              : 'bg-worktree-sidebar-foreground/[0.07] text-muted-foreground'
          )}
        >
          {pillText}
        </span>
        <ChevronDown
          className={cn(
            'size-3 shrink-0 transition-transform duration-150',
            agentsCollapsed && '-rotate-90'
          )}
          aria-hidden="true"
        />
      </button>
    )
  }
)
