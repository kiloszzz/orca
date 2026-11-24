import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { shallow } from 'zustand/shallow'
import { useAppStore } from '@/store/index'
import { useAppStoreWithHostStatuses } from '@/store/slices/runtime-status/views/use-runtime-status-view'
import { deriveRunningAgentSendTargets } from '@/lib/agent-session/messaging/running-agent-targets'
import { recomputeOn } from '@/lib/recompute-on'
import { useTranslate } from '@/i18n/use-translate'
import { agentSendDisabledReasonLabel } from '@/lib/agent-session/messaging/agent-send-disabled-reason-label'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import {
  selectSendTargetControlInputs,
  selectSendTargetInputs
} from './worktree-card-send-target-inputs'
import type { BranchContext } from './worktree-agent-branch-context'

/** Resolves eligible/disabled/sending target metadata while sidebar send-target mode is active. */
export function useWorktreeCardSendTargets(worktreeId: string): BranchContext['targets'] {
  const t = useTranslate()
  const languageRevision = useUiLanguageRevision()
  const control = useAppStore(useShallow((s) => selectSendTargetControlInputs(s, worktreeId)))
  const inputs = useAppStoreWithHostStatuses(
    (s, statuses) => selectSendTargetInputs(s, statuses, worktreeId),
    shallow
  )
  return useMemo(
    () =>
      recomputeOn([languageRevision], () => {
        if (!control.targetMode) {
          return null
        }
        return new Map(
          deriveRunningAgentSendTargets(inputs, worktreeId).map((target) => [
            target.paneKey,
            control.targetMode?.status === 'sending' &&
            control.targetMode.sendingPaneKey === target.paneKey
              ? {
                  status: 'sending' as const,
                  disabledReason: t(
                    'auto.components.sidebar.WorktreeCardAgents.sendingTarget',
                    'Sending...'
                  )
                }
              : {
                  status: target.status,
                  ...(target.disabledReason
                    ? { disabledReason: agentSendDisabledReasonLabel(target.disabledReason) }
                    : {})
                }
          ])
        )
      }),
    [control, inputs, worktreeId, t, languageRevision]
  )
}
