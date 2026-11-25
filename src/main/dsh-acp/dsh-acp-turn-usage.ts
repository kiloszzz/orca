import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  normalizeTurnUsageFromDisjoint,
  type AgentSessionTurnUsage
} from '../../shared/agent-session/conversation-context/agent-session-turn-usage'
import { zstdTranscriptStream } from '../native-chat/transcript-streaming/transcript-zstd-decompression'
import { findDshAcpSessionFile, resolveDshAcpHomeDir } from './dsh-acp-transcript-import'

type DshRawUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

type DshTurnAccumulator = {
  samples: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  hasExactTotal: boolean
  cacheReadTokens: number
  hasCacheRead: boolean
  cacheWriteTokens: number
  reasoningTokens: number
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function readRawUsage(value: unknown): DshRawUsage | null {
  if (!isPlainRecord(value)) {
    return null
  }
  const inputTokens = nonNegativeInt(value.inputTokens)
  const outputTokens = nonNegativeInt(value.outputTokens)
  if (inputTokens === undefined || outputTokens === undefined) {
    return null
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: nonNegativeInt(value.totalTokens),
    cacheReadTokens: nonNegativeInt(value.cacheReadTokens),
    cacheWriteTokens: nonNegativeInt(value.cacheWriteTokens),
    reasoningTokens: nonNegativeInt(value.reasoningTokens)
  }
}

function lastStreamUsage(stream: unknown): DshRawUsage | null {
  if (!Array.isArray(stream)) {
    return null
  }
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const chunk = stream[index]
    if (isPlainRecord(chunk) && chunk.type === 'usage') {
      const parsed = readRawUsage(chunk.usage)
      if (parsed) {
        return parsed
      }
    }
  }
  return null
}

function createTurnAccumulator(): DshTurnAccumulator {
  return {
    samples: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    hasExactTotal: true,
    cacheReadTokens: 0,
    hasCacheRead: false,
    cacheWriteTokens: 0,
    reasoningTokens: 0
  }
}

function appendUsageSample(turn: DshTurnAccumulator, sample: DshRawUsage): void {
  turn.samples += 1
  turn.inputTokens += sample.inputTokens
  turn.outputTokens += sample.outputTokens
  if (sample.totalTokens !== undefined) {
    turn.totalTokens += sample.totalTokens
  } else {
    turn.hasExactTotal = false
  }
  if (sample.cacheReadTokens !== undefined) {
    turn.cacheReadTokens += sample.cacheReadTokens
    turn.hasCacheRead = true
  }
  if (sample.cacheWriteTokens !== undefined) {
    turn.cacheWriteTokens += sample.cacheWriteTokens
  }
  if (sample.reasoningTokens !== undefined) {
    turn.reasoningTokens += sample.reasoningTokens
  }
}

function toCanonicalTurnUsage(turn: DshTurnAccumulator | null): AgentSessionTurnUsage | undefined {
  if (!turn || turn.samples === 0) {
    return undefined
  }
  return normalizeTurnUsageFromDisjoint({
    inputTokens: turn.inputTokens,
    outputTokens: turn.outputTokens,
    totalTokens: turn.hasExactTotal ? turn.totalTokens : undefined,
    cachedReadTokens: turn.hasCacheRead ? turn.cacheReadTokens : undefined,
    cachedWriteTokens: turn.cacheWriteTokens > 0 ? turn.cacheWriteTokens : undefined,
    reasoningTokens: turn.reasoningTokens > 0 ? turn.reasoningTokens : undefined
  })
}

/** Stream a DSH v4 compressed session file and fold the latest turn's token usage. */
export async function readLatestDshSessionTurnUsage(
  sessionFilePath: string
): Promise<AgentSessionTurnUsage | undefined> {
  const raw = createReadStream(sessionFilePath)
  const decoded = zstdTranscriptStream(raw)
  const lines = createInterface({ input: decoded, crlfDelay: Infinity })
  let current: DshTurnAccumulator | null = null
  let lastCompleted: DshTurnAccumulator | null = null
  try {
    for await (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (!isPlainRecord(parsed) || typeof parsed.type !== 'string') {
        continue
      }
      if (parsed.type === 'turn/start') {
        current = createTurnAccumulator()
        continue
      }
      if (parsed.type === 'turn/end') {
        if (current && current.samples > 0) {
          lastCompleted = current
        }
        current = null
        continue
      }
      if (parsed.type === 'assistant/message' || parsed.type === 'assistant/attempt') {
        const data = isPlainRecord(parsed.data) ? parsed.data : null
        if (!data) {
          continue
        }
        const sample = readRawUsage(data.usage) ?? lastStreamUsage(data.stream)
        if (sample) {
          current ??= createTurnAccumulator()
          appendUsageSample(current, sample)
        }
      }
    }
  } catch {
    return undefined
  } finally {
    lines.close()
    decoded.destroy()
    raw.destroy()
  }
  return toCanonicalTurnUsage(current && current.samples > 0 ? current : lastCompleted)
}

/** Fallback per-turn usage resolver for `dsh --profile acp`, whose ACP PromptResponse omits `usage`. */
export async function resolveDshAcpTurnUsage(input: {
  providerSessionId: string
  env: Readonly<Record<string, string>>
}): Promise<AgentSessionTurnUsage | undefined> {
  const dshHome = resolveDshAcpHomeDir(input.env)
  const sessionFile = await findDshAcpSessionFile(
    join(dshHome, 'sessions'),
    input.providerSessionId
  )
  if (!sessionFile) {
    return undefined
  }
  return readLatestDshSessionTurnUsage(sessionFile)
}
