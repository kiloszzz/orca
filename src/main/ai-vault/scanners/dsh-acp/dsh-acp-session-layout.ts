import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { resolveAbsoluteDirOverride } from '../../../../shared/file-access/absolute-dir-override'
import type { AiVaultAgentSource } from '../../discovery/session-scanner-agent-sources'
import { sessionRootDirs } from '../../discovery/session-scanner-roots'

export const DSH_ACP_AGENT_SOURCE: AiVaultAgentSource = {
  rootDirs: (options, wslHomeDirs) =>
    sessionRootDirs(
      options.dshAcpSessionsDir ??
        join(resolveAbsoluteDirOverride(process.env.DSH_HOME, join(homedir(), '.dsh')), 'sessions'),
      wslHomeDirs,
      ['.dsh', 'sessions']
    ),
  extensions: ['.zstd'],
  filePredicate: (filePath) => basename(filePath) === 'session.v4.jsonl.zstd'
}
