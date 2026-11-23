import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveAbsoluteDirOverride } from '../../shared/file-access/absolute-dir-override'
import { directoryTranscriptImport } from '../native-chat/conversation-adoption/structured-agent-cli-conversations'

export const DSH_ACP_SESSION_TRANSCRIPT_FILE = 'session.v4.jsonl.zstd'

export function resolveDshAcpHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveAbsoluteDirOverride(env.DSH_HOME, join(homedir(), '.dsh'))
}

export async function findDshAcpSessionFile(
  sessionsDir: string,
  sessionId: string,
  signal?: AbortSignal
): Promise<string | null> {
  const trimmed = sessionId.trim()
  if (
    !trimmed ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed === '.' ||
    trimmed === '..'
  ) {
    return null
  }
  let buckets
  try {
    buckets = await readdir(sessionsDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of buckets) {
    signal?.throwIfAborted()
    if (!entry.isDirectory()) {
      continue
    }
    const candidate = join(sessionsDir, entry.name, trimmed, DSH_ACP_SESSION_TRANSCRIPT_FILE)
    try {
      const info = await stat(candidate)
      if (info.isFile()) {
        return candidate
      }
    } catch {
      // Session belongs to a different cwd bucket.
    }
  }
  return null
}

export const DSH_ACP_TRANSCRIPT_IMPORT = directoryTranscriptImport({
  conversationStore: ({ accountHomePath }) => join(accountHomePath, 'sessions'),
  accountHomeCandidates: ({ selectedAccountHomePath }) => [
    selectedAccountHomePath,
    resolveDshAcpHomeDir()
  ],
  findTranscript: ({ providerSessionId, store }) => findDshAcpSessionFile(store, providerSessionId)
})
