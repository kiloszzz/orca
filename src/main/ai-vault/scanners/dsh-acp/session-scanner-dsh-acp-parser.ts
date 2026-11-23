import { basename, dirname } from 'node:path'
import { createInterface } from 'node:readline'
import {
  throwIfAiVaultScanCancelled,
  waitForAiVaultScan
} from '../../scan-lifecycle/ai-vault-scan-cancellation'
import { openTranscriptReadStream } from '../../../native-chat/transcript-filesystem/wsl-transcript-fs-access'
import { zstdTranscriptStream } from '../../../native-chat/transcript-streaming/transcript-zstd-decompression'
import type { AiVaultSession } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import type { ExecutionHostId } from '../../../../shared/execution-host/execution-host'
import type { FileWithMtime } from '../../session-scanner-types'
import type { TranscriptMessageSink } from '../../transcripts/session-transcript-consumers'
import {
  createAccumulator,
  finalizeSession,
  updateTimeline
} from '../../parsing/session-scanner-accumulator'
import { addSessionContent } from '../../parsing/session-scanner-messages'
import { parseJsonObject } from '../../parsing/session-json-object'
import { arrayValue, asRecord } from '../../parsing/session-record-fields'
import { extractString } from '../../../../shared/text/trimmed-string'
import {
  extractContentText,
  normalizeTitleText
} from '../../parsing/session-scanner-text-normalization'

type ParserSessionOptions = {
  executionHostId?: ExecutionHostId
  executionHostPlatform?: NodeJS.Platform | null
  messages?: TranscriptMessageSink
}

function extractTextParts(content: unknown, skipReasoning: boolean): string | null {
  if (!Array.isArray(content)) {
    return extractContentText(content)
  }
  const parts: string[] = []
  for (const item of content) {
    const block = asRecord(item)
    if (!block) {
      continue
    }
    const blockType = extractString(block.type)
    if (skipReasoning && blockType === 'reasoning') {
      continue
    }
    const text = extractString(block.text)
    if (text) {
      parts.push(text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : null
}

function isRealDshUserMessage(data: Record<string, unknown>): boolean {
  const source = asRecord(data.source)
  if (!source) {
    return true
  }
  const kind = extractString(source.kind)
  return !kind || kind === 'user'
}

function dshAcpSessionIdFromPath(filePath: string): string {
  const dirName = basename(dirname(filePath))
  return dirName || basename(filePath)
}

export async function parseDshAcpSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform,
  messages?: TranscriptMessageSink,
  signal?: AbortSignal,
  options: ParserSessionOptions = {}
): Promise<AiVaultSession | null> {
  throwIfAiVaultScanCancelled(signal)
  const raw = openTranscriptReadStream(file.path, {}, 'scan', signal)
  const decoded = zstdTranscriptStream(raw)
  const rl = createInterface({ input: decoded, crlfDelay: Infinity })
  let accumulator: ReturnType<typeof createAccumulator> | null = null
  let sawHeader = false
  let hasExplicitTitle = false

  try {
    for await (const line of rl) {
      throwIfAiVaultScanCancelled(signal)
      const record = parseJsonObject(line)
      if (!record) {
        continue
      }
      const recordType = extractString(record.type)
      if (!sawHeader && recordType === 'session') {
        sawHeader = true
        // Subagent transcripts belong to their parent conversation, not top-level History rows.
        if (extractString(record.origin) === 'subagent' || extractString(record.parentSession)) {
          return null
        }
        const sessionId = extractString(record.id) ?? dshAcpSessionIdFromPath(file.path)
        accumulator = createAccumulator({
          agent: 'dsh-acp',
          file,
          sessionId,
          messages: messages ?? options.messages
        })
        accumulator.cwd = extractString(record.cwd)
        updateTimeline(accumulator, record.createdAt)
        continue
      }
      if (!accumulator) {
        continue
      }
      updateTimeline(accumulator, record.time)
      const data = asRecord(record.data)
      if (!data) {
        continue
      }
      if (recordType === 'session/title') {
        const title = normalizeTitleText(extractString(data.title) ?? '')
        if (title) {
          accumulator.title = title
          hasExplicitTitle = true
        }
        continue
      }
      if (recordType === 'request/context') {
        accumulator.model = extractString(data.model) ?? accumulator.model
        continue
      }
      if (recordType === 'request/header') {
        const config = asRecord(asRecord(data.header)?.config)
        accumulator.model = extractString(config?.model) ?? accumulator.model
        continue
      }
      if (recordType === 'user/message') {
        if (!isRealDshUserMessage(data)) {
          continue
        }
        const text = extractTextParts(data.content, false)
        if (!text) {
          continue
        }
        const titleCandidate = normalizeTitleText(text)
        if (titleCandidate) {
          accumulator.fallbackTitle ??= titleCandidate
        }
        accumulator.messageCount++
        addSessionContent(accumulator, 'user', text, record.time)
        await waitForAiVaultScan(
          (messages ?? options.messages)?.drain?.() ?? Promise.resolve(),
          signal
        )
        continue
      }
      if (recordType === 'assistant/message') {
        const message = asRecord(data.message)
        const text = extractTextParts(arrayValue(message?.content), true)
        if (!text) {
          continue
        }
        accumulator.messageCount++
        addSessionContent(accumulator, 'assistant', text, record.time)
        await waitForAiVaultScan(
          (messages ?? options.messages)?.drain?.() ?? Promise.resolve(),
          signal
        )
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    return null
  } finally {
    rl.close()
    decoded.destroy()
  }

  return accumulator && accumulator.messageCount > 0
    ? finalizeSession(accumulator, platform, {
        ...options,
        titleKind: hasExplicitTitle ? 'named' : 'fallback'
      })
    : null
}
