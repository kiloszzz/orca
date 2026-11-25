import * as z from 'zod'

/** Per-turn aggregate token usage normalized across providers.
 *  `inputTokens` is always uncached input tokens, disjoint from `cachedReadTokens` and `cachedWriteTokens`. */
export type AgentSessionTurnUsage = {
  /** Uncached input tokens billed at standard input rate. */
  inputTokens: number
  outputTokens: number
  /** Aggregate tokens across all LLM calls in this turn. */
  totalTokens: number
  /** Input tokens served from prompt cache; absent when the provider does not report cache hits. */
  cachedReadTokens?: number
  /** Input tokens written into prompt cache; absent when zero or not reported. */
  cachedWriteTokens?: number
  /** Reasoning/thought output tokens; absent when zero or not reported. */
  reasoningTokens?: number
}

const TokenCount = z.number().finite().nonnegative()

export const AgentSessionTurnUsageSchema = z.object({
  inputTokens: TokenCount,
  outputTokens: TokenCount,
  totalTokens: TokenCount,
  cachedReadTokens: TokenCount.optional(),
  cachedWriteTokens: TokenCount.optional(),
  reasoningTokens: TokenCount.optional()
})

export function isAdmissibleAgentSessionTurnUsage(value: unknown): value is AgentSessionTurnUsage {
  return AgentSessionTurnUsageSchema.safeParse(value).success
}

type Admits<T extends true> = T
export type CanonicalTurnUsageIsAdmissible = Admits<
  AgentSessionTurnUsage extends z.input<typeof AgentSessionTurnUsageSchema> ? true : false
>

function nonNegativeCount(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined
}

function finalizeTurnUsage(input: {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cachedReadTokens?: number
  cachedWriteTokens?: number
  reasoningTokens?: number
}): AgentSessionTurnUsage | undefined {
  const inputTokens = Math.max(0, Math.round(input.inputTokens))
  const outputTokens = Math.max(0, Math.round(input.outputTokens))
  const cachedReadTokens = nonNegativeCount(input.cachedReadTokens)
  const cachedWriteTokens = nonNegativeCount(input.cachedWriteTokens)
  const reasoningTokens = nonNegativeCount(input.reasoningTokens)
  const computedTotal =
    inputTokens + outputTokens + (cachedReadTokens ?? 0) + (cachedWriteTokens ?? 0)
  const reportedTotal = nonNegativeCount(input.totalTokens)
  const totalTokens =
    reportedTotal !== undefined && reportedTotal > 0 ? reportedTotal : computedTotal
  if (totalTokens <= 0) {
    return undefined
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cachedReadTokens !== undefined ? { cachedReadTokens } : {}),
    ...(cachedWriteTokens !== undefined && cachedWriteTokens > 0 ? { cachedWriteTokens } : {}),
    ...(reasoningTokens !== undefined && reasoningTokens > 0 ? { reasoningTokens } : {})
  }
}

/** Normalize usage where `inputTokens` already excludes cached read/write tokens (ACP, DeepSeek, Anthropic). */
export function normalizeTurnUsageFromDisjoint(input: {
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  cachedReadTokens?: number | null
  cachedWriteTokens?: number | null
  reasoningTokens?: number | null
}): AgentSessionTurnUsage | undefined {
  return finalizeTurnUsage({
    inputTokens: nonNegativeCount(input.inputTokens) ?? 0,
    outputTokens: nonNegativeCount(input.outputTokens) ?? 0,
    totalTokens: nonNegativeCount(input.totalTokens),
    cachedReadTokens: nonNegativeCount(input.cachedReadTokens),
    cachedWriteTokens: nonNegativeCount(input.cachedWriteTokens),
    reasoningTokens: nonNegativeCount(input.reasoningTokens)
  })
}

/** Normalize usage where `inputTokens` includes cached read/write tokens (OpenAI / Codex). */
export function normalizeTurnUsageFromInclusiveInput(input: {
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  cachedReadTokens?: number | null
  cachedWriteTokens?: number | null
  reasoningTokens?: number | null
}): AgentSessionTurnUsage | undefined {
  const totalInput = nonNegativeCount(input.inputTokens) ?? 0
  const cachedReadTokens = nonNegativeCount(input.cachedReadTokens)
  const cachedWriteTokens = nonNegativeCount(input.cachedWriteTokens)
  const uncachedInput = Math.max(0, totalInput - (cachedReadTokens ?? 0) - (cachedWriteTokens ?? 0))
  return finalizeTurnUsage({
    inputTokens: uncachedInput,
    outputTokens: nonNegativeCount(input.outputTokens) ?? 0,
    totalTokens: nonNegativeCount(input.totalTokens),
    cachedReadTokens,
    cachedWriteTokens,
    reasoningTokens: nonNegativeCount(input.reasoningTokens)
  })
}

/** Total prompt input tokens (cached + uncached + cache write). */
export function turnUsageTotalInputTokens(usage: AgentSessionTurnUsage): number {
  return usage.inputTokens + (usage.cachedReadTokens ?? 0) + (usage.cachedWriteTokens ?? 0)
}

/** Prompt cache hit rate in [0, 100] rounded to 1 decimal place, or null when unsupported/empty. */
export function computeTurnCacheHitRate(usage: AgentSessionTurnUsage): number | null {
  if (usage.cachedReadTokens === undefined) {
    return null
  }
  const totalInput = turnUsageTotalInputTokens(usage)
  if (totalInput <= 0) {
    return null
  }
  const percent = Math.round((usage.cachedReadTokens / totalInput) * 1000) / 10
  return Math.min(100, Math.max(0, percent))
}
