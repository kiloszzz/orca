import { join } from 'node:path'
import type { AcpLaunchSpec } from '../acp/launch/acp-launch-contract'
import { GENERIC_ACP_DIALECT } from '../acp/acp-dialects/acp-dialect'
import { directoryAccountBinding } from '../acp/launch/acp-account-binding'
import { agentSessionSetupFor } from '../../shared/agent-session/lifecycle/launch/agent-session-setup-commands'
import { dshAcpFallbackModelOptions } from '../../shared/agent-session/options/agent-session-option-catalog-dsh-acp'
import type { StructuredAgentSessionHistory } from '../native-chat/conversation-adoption/structured-agent-cli-conversations'
import { DSH_ACP_TRANSCRIPT_IMPORT } from './dsh-acp-transcript-import'
import { resolveDshAcpTurnUsage } from './dsh-acp-turn-usage'

// Chats and Session History share $DSH_HOME/sessions and UUID/session-* ids.
const DSH_ACP_SESSION_HISTORY: StructuredAgentSessionHistory = {
  rowAgents: ['dsh-acp'],
  rowSessionId: (link) => link.handle.nativeId,
  parseResumeArgs: () => null
}

// Standalone `dsh --profile acp` integration, kept separate from upstream `dsh` (`dsh-tui`).
export const DSH_ACP_LAUNCH_SPEC: AcpLaunchSpec = {
  agent: 'dsh-acp',
  command: 'dsh',
  ignoreAgentCommandSetting: true,
  args: () => ['--profile', 'acp'],
  env: {},
  dialect: GENERIC_ACP_DIALECT,
  loginCommand: agentSessionSetupFor('dsh-acp')?.loginCommand ?? [],
  account: directoryAccountBinding('DSH_HOME', (homePath) => join(homePath, '.dsh')),
  installDirectories: () => [],
  modelDiscovery: {
    kind: 'unavailable',
    reason: 'DSH lists its models only inside a session'
  },
  fallbackModels: dshAcpFallbackModelOptions,
  // DSH cannot delete a session, so a discovery session would land in the user's own history.
  keepsEverySession: true,
  resumePreference: 'resume',
  transcriptImport: DSH_ACP_TRANSCRIPT_IMPORT,
  sessionHistory: DSH_ACP_SESSION_HISTORY,
  resolveFallbackTurnUsage: resolveDshAcpTurnUsage
}
