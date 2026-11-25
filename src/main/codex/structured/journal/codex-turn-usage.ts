import {
  normalizeTurnUsageFromInclusiveInput,
  type AgentSessionTurnUsage
} from '../../../../shared/agent-session/conversation-context/agent-session-turn-usage'
import { parseAgentJournalItemKey } from '../../../../shared/agent-session/journal/agent-session-journal-item-key'
import { writeAgentJournalTurnRow } from '../../../native-chat/agent-session-timeline/agent-journal-turn-row-revision'
import type { StructuredAgentSessionEventSink } from '../../../native-chat/agent-session-wire/journal-ingress/structured-agent-session-event-sink'
import { readRecord } from '../../app-server/codex-item-field-readers'
import { readCodexTurnId } from '../../app-server/codex-structured-thread-facts'
import type { CodexRowAttribution } from '../background-work/codex-subagent-linkage'
import type { CodexJournalActiveTurns } from './codex-structured-journal-translation-turn-state'

type CodexTokenBreakdown = {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function readBreakdown(value: unknown): CodexTokenBreakdown | null {
  const record = readRecord(value)
  const totalTokens = nonNegativeNumber(record.totalTokens)
  const inputTokens = nonNegativeNumber(record.inputTokens)
  const outputTokens = nonNegativeNumber(record.outputTokens)
  if (totalTokens === null && inputTokens === null && outputTokens === null) {
    return null
  }
  return {
    totalTokens: totalTokens ?? 0,
    inputTokens: inputTokens ?? 0,
    cachedInputTokens: nonNegativeNumber(record.cachedInputTokens) ?? 0,
    cacheWriteInputTokens: nonNegativeNumber(record.cacheWriteInputTokens) ?? 0,
    outputTokens: outputTokens ?? 0,
    reasoningOutputTokens: nonNegativeNumber(record.reasoningOutputTokens) ?? 0
  }
}

function subtractBreakdown(
  current: CodexTokenBreakdown,
  baseline: CodexTokenBreakdown
): CodexTokenBreakdown | null {
  if (current.totalTokens < baseline.totalTokens || current.inputTokens < baseline.inputTokens) {
    return null
  }
  return {
    totalTokens: Math.max(0, current.totalTokens - baseline.totalTokens),
    inputTokens: Math.max(0, current.inputTokens - baseline.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - baseline.cachedInputTokens),
    cacheWriteInputTokens: Math.max(
      0,
      current.cacheWriteInputTokens - baseline.cacheWriteInputTokens
    ),
    outputTokens: Math.max(0, current.outputTokens - baseline.outputTokens),
    reasoningOutputTokens: Math.max(
      0,
      current.reasoningOutputTokens - baseline.reasoningOutputTokens
    )
  }
}

function breakdownToTurnUsage(
  breakdown: CodexTokenBreakdown,
  hasCachedField: boolean
): AgentSessionTurnUsage | undefined {
  return normalizeTurnUsageFromInclusiveInput({
    inputTokens: breakdown.inputTokens,
    outputTokens: breakdown.outputTokens,
    totalTokens: breakdown.totalTokens,
    cachedReadTokens: hasCachedField ? breakdown.cachedInputTokens : undefined,
    cachedWriteTokens: breakdown.cacheWriteInputTokens,
    reasoningTokens: breakdown.reasoningOutputTokens
  })
}

function sameTurnUsage(
  previous: AgentSessionTurnUsage | undefined,
  next: AgentSessionTurnUsage
): boolean {
  return (
    previous !== undefined &&
    previous.totalTokens === next.totalTokens &&
    previous.inputTokens === next.inputTokens &&
    previous.outputTokens === next.outputTokens &&
    previous.cachedReadTokens === next.cachedReadTokens &&
    previous.cachedWriteTokens === next.cachedWriteTokens &&
    previous.reasoningTokens === next.reasoningTokens
  )
}

/** Tracks per-turn net token usage from Codex's cumulative `thread/tokenUsage/updated` frames. */
export class CodexTurnUsageTracker {
  private readonly lastTotalByThread = new Map<string, CodexTokenBreakdown>()
  private readonly turnBaselineByKey = new Map<string, CodexTokenBreakdown>()
  private readonly publishedByKey = new Map<string, AgentSessionTurnUsage>()

  observeTurnStarted(threadId: string, turnId: string | null): void {
    if (!turnId) {
      return
    }
    const previousTotal = this.lastTotalByThread.get(threadId)
    if (previousTotal) {
      this.turnBaselineByKey.set(`${threadId}:${turnId}`, previousTotal)
    }
  }

  forgetTurn(threadId: string, turnId: string | null): void {
    if (!turnId) {
      return
    }
    const key = `${threadId}:${turnId}`
    this.turnBaselineByKey.delete(key)
    this.publishedByKey.delete(key)
  }

  clear(): void {
    this.lastTotalByThread.clear()
    this.turnBaselineByKey.clear()
    this.publishedByKey.clear()
  }

  record(input: {
    sink: StructuredAgentSessionEventSink
    activeTurns: Pick<CodexJournalActiveTurns, 'current' | 'has'>
    attributionFor: CodexRowAttribution
    threadId: string
    params: unknown
  }): void {
    const tokenUsage = readRecord(readRecord(input.params).tokenUsage)
    const total = readBreakdown(tokenUsage.total)
    const last = readBreakdown(tokenUsage.last)
    if (total) {
      this.lastTotalByThread.set(input.threadId, total)
    }
    const turnId = readCodexTurnId(input.params) ?? input.activeTurns.current(input.threadId)
    if (!turnId || !input.activeTurns.has(input.threadId, turnId)) {
      return
    }
    const key = `${input.threadId}:${turnId}`
    let baseline = this.turnBaselineByKey.get(key)
    if (!baseline && total && last) {
      // Derive the pre-turn cumulative total even on resumed threads without prior replay frames.
      baseline = subtractBreakdown(total, last) ?? undefined
      if (baseline) {
        this.turnBaselineByKey.set(key, baseline)
      }
    }
    const delta = (total && baseline ? subtractBreakdown(total, baseline) : null) ?? last
    if (!delta) {
      return
    }
    const rawSample = readRecord(tokenUsage.total ?? tokenUsage.last)
    const hasCachedField = nonNegativeNumber(rawSample.cachedInputTokens) !== null
    const turnUsage = breakdownToTurnUsage(delta, hasCachedField)
    if (!turnUsage || sameTurnUsage(this.publishedByKey.get(key), turnUsage)) {
      return
    }
    const scope = input.attributionFor(input.threadId, turnId).turnScope
    const identity = scope.kind === 'turn' ? parseAgentJournalItemKey(scope.turnItemId) : null
    if (!identity) {
      return
    }
    this.publishedByKey.set(key, turnUsage)
    writeAgentJournalTurnRow(input.sink, { identity }, { turnUsage }, { publish: true })
  }
}
