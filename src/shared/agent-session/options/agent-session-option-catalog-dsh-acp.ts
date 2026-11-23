import type { AgentSessionModelOption } from './model-catalog/agent-session-model-option'
import type {
  AgentSessionOptionCatalog,
  CatalogModel,
  CatalogOption
} from './catalog-providers/agent-session-option-catalog-types'

const DSH_ACP_EFFORT_CHOICES = [
  { value: 'off', label: 'Off', description: 'Use for simple tasks that do not need reasoning.' },
  { value: 'low', label: 'Low', description: 'Prefer for routine or latency-sensitive tasks.' },
  { value: 'high', label: 'High', description: 'The default balance for most tasks.' },
  { value: 'max', label: 'Max', description: 'Reserve for the hardest quality-first tasks.' }
]

const DSH_ACP_EFFORT: CatalogOption = {
  id: 'effort',
  label: 'Reasoning effort',
  category: 'thought_level',
  kind: {
    type: 'select',
    choices: DSH_ACP_EFFORT_CHOICES,
    defaultValue: 'high'
  },
  apply: {}
}

const DSH_ACP_SEED_MODELS: CatalogModel[] = [
  {
    id: '["deepseek-official","deepseek-flash"]',
    label: 'DeepSeek-V4.1-Flash',
    isDefault: true,
    options: [DSH_ACP_EFFORT]
  },
  {
    id: '["deepseek-official","deepseek-v4-pro"]',
    label: 'DeepSeek-V4-Pro',
    description: 'Stronger agentic coding, knowledge, and difficult reasoning.',
    options: [DSH_ACP_EFFORT]
  },
  {
    id: '["deepseek-account","deepseek-flash"]',
    label: 'DeepSeek-V4.1-Flash (Account)',
    options: [DSH_ACP_EFFORT]
  },
  {
    id: '["deepseek-account","deepseek-v4-pro"]',
    label: 'DeepSeek-V4-Pro (Account)',
    description: 'Stronger agentic coding, knowledge, and difficult reasoning.',
    options: [DSH_ACP_EFFORT]
  }
]

export function dshAcpFallbackModelOptions(): AgentSessionModelOption[] {
  return DSH_ACP_SEED_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {}),
    isDefault: model.isDefault === true,
    efforts: DSH_ACP_EFFORT_CHOICES,
    defaultEffort: 'high'
  }))
}

export const DSH_ACP_SESSION_OPTION_CATALOG: AgentSessionOptionCatalog = {
  supportsWorkerLaunchPreferences: true,
  models: DSH_ACP_SEED_MODELS,
  modelApply: {},
  unknownModelOptions: [DSH_ACP_EFFORT]
}
