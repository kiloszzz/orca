import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  computeTurnCacheHitRate,
  turnUsageTotalInputTokens,
  type AgentSessionTurnUsage
} from '../../../../../src/shared/agent-session/conversation-context/agent-session-turn-usage'
import { formatContextTokenCount } from '../../../../../src/shared/native-chat/native-chat-context-usage-summary'
import { BottomDrawer } from '../../../components/bottom-drawer/BottomDrawer'
import { SheetHeader } from '../../../components/nav-bar/SheetHeader'
import { getUiIntlLocale } from '../../../i18n/ui-intl-locale'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { colors, radii, spacing, typography } from '../../../theme/mobile-theme'
import { themedStyleSheet } from '../../../theme/themed-styles'
import { useMobileColorScheme } from '../../../theme/use-mobile-color-scheme'
import {
  formatTurnUsageCachePercent,
  HIGH_CACHE_HIT_PERCENT,
  LOW_CACHE_HIT_PERCENT
} from './MobileNativeChatTurnUsageBadge'

function BreakdownRow({
  label,
  tokens,
  locale,
  accent,
  divided
}: {
  label: string
  tokens: number
  locale: string
  accent?: boolean
  divided: boolean
}): React.JSX.Element {
  return (
    <View style={[styles.row, divided && styles.rowDivided]}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.rowValue, accent && styles.rowValueAccent]} selectable>
        {tokens.toLocaleString(locale)}
      </Text>
    </View>
  )
}

/** Bottom sheet showing a turn's token breakdown and prompt-cache hit rate. */
export function MobileNativeChatTurnUsageSheet({
  usage,
  onClose
}: {
  usage: AgentSessionTurnUsage
  onClose: () => void
}): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const locale = getUiIntlLocale()
  const [visible, setVisible] = useState(true)
  const close = () => setVisible(false)
  const cacheHitRate = computeTurnCacheHitRate(usage)
  const totalCompact = formatContextTokenCount(usage.totalTokens)
  const totalInput = turnUsageTotalInputTokens(usage)
  const highCacheHit = cacheHitRate !== null && cacheHitRate >= HIGH_CACHE_HIT_PERCENT
  const lowCacheHit =
    cacheHitRate !== null && cacheHitRate > 0 && cacheHitRate < LOW_CACHE_HIT_PERCENT
  const cachePercentLabel = cacheHitRate !== null ? formatTurnUsageCachePercent(cacheHitRate) : null
  const filledPercent = cacheHitRate !== null ? Math.min(Math.max(cacheHitRate, 0), 100) : 0

  const rows: { key: string; label: string; tokens: number; accent?: boolean }[] = []
  if (usage.cachedReadTokens !== undefined) {
    rows.push({
      key: 'cachedInput',
      label: t('components.native-chat.turnUsage.cachedInput', 'Cached input'),
      tokens: usage.cachedReadTokens,
      accent: highCacheHit
    })
  }
  rows.push({
    key: 'input',
    label:
      usage.cachedReadTokens !== undefined
        ? t('components.native-chat.turnUsage.uncachedInput', 'Uncached input')
        : t('components.native-chat.turnUsage.input', 'Input'),
    tokens: usage.inputTokens
  })
  if (usage.cachedWriteTokens !== undefined && usage.cachedWriteTokens > 0) {
    rows.push({
      key: 'cacheWrite',
      label: t('components.native-chat.turnUsage.cacheWrite', 'Cache write'),
      tokens: usage.cachedWriteTokens
    })
  }
  rows.push({
    key: 'output',
    label: t('components.native-chat.turnUsage.output', 'Output'),
    tokens: usage.outputTokens
  })
  if (usage.reasoningTokens !== undefined && usage.reasoningTokens > 0) {
    rows.push({
      key: 'reasoning',
      label: t('components.native-chat.turnUsage.reasoning', 'Reasoning'),
      tokens: usage.reasoningTokens
    })
  }

  return (
    <BottomDrawer visible={visible} onClose={close} onAfterClose={onClose} dragContentToDismiss>
      <SheetHeader
        title={t('components.native-chat.turnUsage.title', 'Turn usage')}
        subtitle={t('components.native-chat.turnUsage.totalTokens', '{{total}} tokens', {
          total: totalCompact
        })}
        onClose={close}
      />
      <View style={styles.body}>
        {cacheHitRate !== null && cachePercentLabel !== null ? (
          <View style={styles.cacheCard}>
            <View style={styles.cacheHeader}>
              <Text style={styles.cacheTitle}>
                {t('components.native-chat.turnUsage.cacheHitRate', 'Cache hit rate')}
              </Text>
              <Text
                style={[
                  styles.cacheRate,
                  highCacheHit && styles.cacheRateHigh,
                  lowCacheHit && styles.cacheRateLow
                ]}
              >
                {cachePercentLabel}
              </Text>
            </View>
            <View
              style={styles.track}
              accessibilityRole="progressbar"
              accessibilityLabel={t(
                'components.native-chat.turnUsage.cacheHitProgress',
                'Cache hit rate {{rate}}',
                { rate: cachePercentLabel }
              )}
              accessibilityValue={{ min: 0, max: 100, now: Math.round(filledPercent) }}
            >
              <View
                style={[
                  styles.fill,
                  highCacheHit && styles.fillHigh,
                  lowCacheHit && styles.fillLow,
                  { width: `${filledPercent}%` }
                ]}
              />
            </View>
            <Text style={styles.cacheSummary}>
              {t(
                'components.native-chat.turnUsage.cacheSummary',
                '{{cached}} / {{input}} input tokens cached',
                {
                  cached: formatContextTokenCount(usage.cachedReadTokens ?? 0),
                  input: formatContextTokenCount(totalInput)
                }
              )}
            </Text>
          </View>
        ) : null}
        <View style={styles.group}>
          {rows.map((row, index) => (
            <BreakdownRow
              key={row.key}
              label={row.label}
              tokens={row.tokens}
              locale={locale}
              accent={row.accent}
              divided={index > 0}
            />
          ))}
        </View>
      </View>
    </BottomDrawer>
  )
}

const styles = themedStyleSheet(() => ({
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md
  },
  cacheCard: {
    backgroundColor: colors.sheetGroup,
    borderRadius: radii.surface,
    padding: spacing.md,
    gap: spacing.sm
  },
  cacheHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  cacheTitle: {
    fontSize: typography.metaSize,
    color: colors.textMuted
  },
  cacheRate: {
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums']
  },
  cacheRateHigh: {
    color: colors.chatDiffAdded
  },
  cacheRateLow: {
    color: colors.statusAmber
  },
  track: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.translucentFill,
    overflow: 'hidden'
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.textPrimary
  },
  fillHigh: {
    backgroundColor: colors.chatDiffAdded
  },
  fillLow: {
    backgroundColor: colors.statusAmber
  },
  cacheSummary: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    fontVariant: ['tabular-nums']
  },
  group: {
    backgroundColor: colors.sheetGroup,
    borderRadius: radii.surface,
    paddingHorizontal: spacing.md
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle
  },
  rowLabel: {
    flexShrink: 1,
    fontSize: typography.bodySize,
    color: colors.textMuted
  },
  rowValue: {
    fontSize: typography.bodySize,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums']
  },
  rowValueAccent: {
    fontWeight: '600',
    color: colors.chatDiffAdded
  }
}))
