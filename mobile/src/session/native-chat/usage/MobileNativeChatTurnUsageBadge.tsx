import { useContext } from 'react'
import { Pressable, Text } from 'react-native'
import {
  computeTurnCacheHitRate,
  type AgentSessionTurnUsage
} from '../../../../../src/shared/agent-session/conversation-context/agent-session-turn-usage'
import { formatContextTokenCount } from '../../../../../src/shared/native-chat/native-chat-context-usage-summary'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { colors, pressedStyle, radii, typography } from '../../../theme/mobile-theme'
import { themedStyleSheet } from '../../../theme/themed-styles'
import { useMobileColorScheme } from '../../../theme/use-mobile-color-scheme'
import { scaledType } from '../transcript/messages/mobile-native-chat-message-styles'
import { MobileNativeChatRowOverlaysContext } from '../transcript/message-actions/mobile-native-chat-row-overlays'

export const HIGH_CACHE_HIT_PERCENT = 70
export const LOW_CACHE_HIT_PERCENT = 30

export function formatTurnUsageCachePercent(percent: number): string {
  const fixed = percent.toFixed(1)
  return `${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}%`
}

/** Compact inline token and prompt-cache badge under an assistant turn; tapping opens the breakdown sheet. */
export function MobileNativeChatTurnUsageBadge({
  usage,
  fontScale
}: {
  usage: AgentSessionTurnUsage
  fontScale: number
}): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const { openTurnUsage } = useContext(MobileNativeChatRowOverlaysContext)
  const cacheHitRate = computeTurnCacheHitRate(usage)
  const totalCompact = formatContextTokenCount(usage.totalTokens)
  const cachePercentLabel = cacheHitRate !== null ? formatTurnUsageCachePercent(cacheHitRate) : null
  const highCacheHit = cacheHitRate !== null && cacheHitRate >= HIGH_CACHE_HIT_PERCENT
  const type = scaledType(typography.metaSize, fontScale, 5)
  const accessibilityLabel =
    cachePercentLabel !== null
      ? t(
          'components.native-chat.turnUsage.ariaLabelWithCache',
          'Turn usage: {{total}} tokens, {{rate}} cache hit',
          { total: totalCompact, rate: cachePercentLabel }
        )
      : t('components.native-chat.turnUsage.ariaLabel', 'Turn usage: {{total}} tokens', {
          total: totalCompact
        })

  return (
    <Pressable
      style={({ pressed }) => [styles.badge, pressed && pressedStyle]}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID="native-chat-turn-usage"
      onPress={() => openTurnUsage?.(usage)}
    >
      <Text style={[styles.text, type]} numberOfLines={1}>
        {cachePercentLabel !== null
          ? totalCompact
          : t('components.native-chat.turnUsage.inlineTokens', '{{total}} tokens', {
              total: totalCompact
            })}
      </Text>
      {cachePercentLabel !== null ? (
        <>
          <Text style={[styles.dot, type]} accessible={false}>
            ·
          </Text>
          <Text style={[styles.text, highCacheHit && styles.highCache, type]} numberOfLines={1}>
            {t('components.native-chat.turnUsage.inlineCache', '{{rate}} cache', {
              rate: cachePercentLabel
            })}
          </Text>
        </>
      ) : null}
    </Pressable>
  )
}

const styles = themedStyleSheet(() => ({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radii.control
  },
  text: {
    color: colors.textMuted,
    fontVariant: ['tabular-nums']
  },
  dot: {
    color: colors.textMuted,
    opacity: 0.5
  },
  highCache: {
    color: colors.chatDiffAdded
  }
}))
