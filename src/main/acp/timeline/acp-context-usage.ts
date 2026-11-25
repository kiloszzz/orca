import type { AgentSessionContextUsage } from '../../../shared/agent-session/conversation-context/agent-session-context-usage'
import type {
  ProviderTimelineEvent,
  ProviderTimelineJoin
} from '../../native-chat/agent-session-timeline/provider-timeline-event'

import { GENERIC_ACP_DIALECT, type AcpDialect } from '../acp-dialects/acp-dialect'
import type { SessionUpdate, UsageUpdate } from '../generated/acp-protocol.generated'

function readCurrentModelId(models: unknown): string | null {
  if (typeof models !== 'object' || models === null || !('currentModelId' in models)) {
    return null
  }
  const { currentModelId } = models
  return typeof currentModelId === 'string' && currentModelId.trim().length > 0
    ? currentModelId
    : null
}

function resolveWindowTokens(
  reportedTokens: number | undefined,
  dialect: AcpDialect,
  modelId: string | null | undefined
): number | undefined {
  if (!dialect.resolveContextWindow) {
    return reportedTokens
  }
  const resolved = dialect.resolveContextWindow({ reportedTokens, modelId })
  if (typeof resolved === 'number' && Number.isFinite(resolved) && resolved > 0) {
    return resolved
  }
  return reportedTokens
}

function resolveUsageWindow(
  usage: AgentSessionContextUsage,
  dialect: AcpDialect,
  modelId: string | null | undefined
): AgentSessionContextUsage {
  if (!usage.window || !dialect.resolveContextWindow) {
    return usage
  }
  const tokens = resolveWindowTokens(usage.window.tokens, dialect, modelId)
  return tokens === undefined || tokens === usage.window.tokens
    ? usage
    : { ...usage, window: { ...usage.window, tokens } }
}

export class AcpContextTimeline {
  private window?: { tokens: number; capturedAt: number }
  private observedModelId: string | null = null

  constructor(
    private readonly dialect: AcpDialect = GENERIC_ACP_DIALECT,
    private readonly currentModelId?: () => string | null
  ) {}

  private activeModelId(): string | null {
    return this.currentModelId?.() ?? this.observedModelId
  }

  models(
    models: unknown,
    at: number,
    dialect: AcpDialect,
    join: ProviderTimelineJoin
  ): ProviderTimelineEvent[] {
    const reportedModelId = readCurrentModelId(models)
    if (reportedModelId !== null) {
      this.observedModelId = reportedModelId
    }
    const rawTokens = dialect.contextWindow?.(models) ?? this.window?.tokens
    const tokens = resolveWindowTokens(rawTokens, dialect, this.activeModelId())
    if (tokens === undefined) {
      return []
    }
    return this.update({ window: { tokens, capturedAt: at } }, join)
  }

  usageUpdate(
    update: UsageUpdate,
    at: number,
    join: ProviderTimelineJoin
  ): ProviderTimelineEvent[] {
    const usage = acpWindowUsage(update, at, this.dialect, this.activeModelId())
    this.window = usage.window ?? this.window
    return [{ type: 'context.usage', usage, join }]
  }

  update(usage: AgentSessionContextUsage, join: ProviderTimelineJoin): ProviderTimelineEvent[] {
    const normalized = resolveUsageWindow(usage, this.dialect, this.activeModelId())
    this.window = normalized.window ?? this.window
    return [
      {
        type: 'context.usage',
        usage: { ...normalized, ...(this.window ? { window: this.window } : {}) },
        join
      }
    ]
  }

  /** Retain only context-window information from replayed history. */
  history(
    update: SessionUpdate | undefined,
    usage: AgentSessionContextUsage | undefined,
    at: number,
    join: ProviderTimelineJoin
  ): ProviderTimelineEvent[] {
    const events = usage ? this.update(usage, join) : []
    if (update?.sessionUpdate === 'usage_update') {
      events.push(...this.usageUpdate(update, at, join))
    }
    return events
  }
}

export function acpWindowUsage(
  update: UsageUpdate,
  at: number,
  dialect: AcpDialect = GENERIC_ACP_DIALECT,
  modelId?: string | null
): AgentSessionContextUsage {
  const windowTokens = resolveWindowTokens(update.size, dialect, modelId) ?? update.size
  return {
    window: { tokens: windowTokens, capturedAt: at },
    used: {
      kind: 'estimate',
      capturedAt: at,
      usage: {
        inputTokens: update.used,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 0
      }
    }
  }
}
