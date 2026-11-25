import {
  normalizeTurnUsageFromDisjoint,
  type AgentSessionTurnUsage
} from '../../../shared/agent-session/conversation-context/agent-session-turn-usage'
import type { AcpDialect, AcpTurnEnding } from '../acp-dialects/acp-dialect'
import type { PromptResponse } from '../generated/acp-protocol.generated'
import type { AcpStructuredLane } from '../journal/acp-structured-lane'
import type { AcpLaunchSpec } from '../launch/acp-launch-contract'
import { acpPromptTurnId } from './acp-prompt-turns'

/** Normalize a PromptResponse's `usage`, deferring to a dialect hook when provided. */
export function acpPromptResponseTurnUsage(
  result: PromptResponse,
  dialect: AcpDialect
): AgentSessionTurnUsage | undefined {
  const usage = result.usage
  if (!usage) {
    return undefined
  }
  if (dialect.normalizeTurnUsage) {
    return dialect.normalizeTurnUsage(usage)
  }
  return normalizeTurnUsageFromDisjoint({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedReadTokens: usage.cachedReadTokens,
    cachedWriteTokens: usage.cachedWriteTokens,
    reasoningTokens: usage.thoughtTokens
  })
}

export function acpPromptResultEnding(
  result: PromptResponse,
  at: number,
  cancelRequested: boolean,
  dialect: AcpDialect
): AcpTurnEnding {
  const turnUsage = acpPromptResponseTurnUsage(result, dialect)
  return {
    stopReason: result.stopReason,
    at,
    hookBlock: dialect.hookBlock?.(result._meta),
    cancelRequested,
    ...(turnUsage ? { turnUsage } : {})
  }
}

export function acpFallbackTurnUsageResolver(
  spec: Pick<AcpLaunchSpec, 'resolveFallbackTurnUsage'>,
  providerSessionId: string,
  env: Readonly<Record<string, string>>
): (() => Promise<AgentSessionTurnUsage | undefined>) | undefined {
  const resolve = spec.resolveFallbackTurnUsage
  return resolve ? () => resolve({ providerSessionId, env }) : undefined
}

export function dispatchAcpFallbackTurnUsage(
  deps: {
    resolveFallbackTurnUsage?: () => Promise<AgentSessionTurnUsage | undefined>
    lane: AcpStructuredLane
  },
  clientMessageId: string,
  result: PromptResponse,
  cancelled: boolean,
  isEnded: () => boolean
): void {
  const resolve = deps.resolveFallbackTurnUsage
  if (!resolve || result.usage || cancelled) {
    return
  }
  const turn = acpPromptTurnId(clientMessageId)
  void resolve()
    .then((usage) => {
      if (usage && !isEnded()) {
        deps.lane.apply([
          {
            type: 'turn.usage',
            usage,
            join: { thread: deps.lane.translator.providerSessionId, turn }
          }
        ])
      }
    })
    .catch(() => undefined)
}
