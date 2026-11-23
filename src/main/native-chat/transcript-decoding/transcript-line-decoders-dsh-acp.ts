import type {
  NativeChatBlock,
  NativeChatMessage
} from '../../../shared/native-chat/native-chat-types'
import { arrayValue, asRecord } from '../../ai-vault/parsing/session-record-fields'
import { extractString } from '../../../shared/text/trimmed-string'
import { parseJsonObject } from '../../ai-vault/parsing/session-json-object'
import { timestampMs } from '../../ai-vault/parsing/session-record-time'
import { toolResultOutput } from './transcript-record-blocks'

function parseToolArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw
  }
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function textBlocks(content: unknown, skipReasoning: boolean): NativeChatBlock[] {
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : []
  }
  const blocks: NativeChatBlock[] = []
  for (const item of arrayValue(content)) {
    const record = asRecord(item)
    if (!record) {
      continue
    }
    if (skipReasoning && extractString(record.type) === 'reasoning') {
      continue
    }
    const text = extractString(record.text)
    if (text) {
      blocks.push({ type: 'text', text })
    }
  }
  return blocks
}

function reasoningText(content: unknown): string | null {
  const parts: string[] = []
  for (const item of arrayValue(content)) {
    const record = asRecord(item)
    if (record && extractString(record.type) === 'reasoning') {
      const text = extractString(record.text)
      if (text) {
        parts.push(text)
      }
    }
  }
  return parts.length > 0 ? parts.join('\n') : null
}

export function decodeDshAcpTranscriptLine(
  line: string,
  fallbackId: string
): NativeChatMessage | null {
  const record = parseJsonObject(line)
  if (!record) {
    return null
  }
  const type = extractString(record.type)
  const data = asRecord(record.data)
  if (!type || !data) {
    return null
  }
  const timestamp = timestampMs(record.time) ?? undefined
  const seq = typeof record.seq === 'number' ? String(record.seq) : null
  const id = seq ? `${fallbackId}:${seq}` : fallbackId

  if (type === 'user/message') {
    const source = asRecord(data.source)
    const sourceKind = source ? extractString(source.kind) : null
    if (sourceKind && sourceKind !== 'user') {
      return null
    }
    const blocks = textBlocks(data.content, false)
    return blocks.length > 0 ? { id, role: 'user', blocks, timestamp, source: 'transcript' } : null
  }

  if (type === 'assistant/message') {
    const content = asRecord(data.message)?.content
    const blocks = textBlocks(content, true)
    if (blocks.length > 0) {
      return { id, role: 'assistant', blocks, timestamp, source: 'transcript' }
    }
    const reasoning = reasoningText(content)
    return reasoning
      ? {
          id,
          role: 'reasoning',
          blocks: [{ type: 'text', text: reasoning }],
          timestamp,
          source: 'transcript'
        }
      : null
  }

  if (type === 'tool/call') {
    const name = extractString(data.name) ?? 'tool'
    const input = parseToolArgs(data.arguments)
    return {
      id,
      role: 'assistant',
      blocks: [{ type: 'tool-call', name, input }],
      timestamp,
      source: 'transcript'
    }
  }

  if (type === 'tool/result') {
    const message = asRecord(data.message)
    const output = toolResultOutput(message?.content)
    return {
      id,
      role: 'tool',
      blocks: [{ type: 'tool-result', output }],
      timestamp,
      source: 'transcript'
    }
  }

  return null
}
