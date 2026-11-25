import { useCallback, useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { useIntlLocale, useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import {
  computeTurnCacheHitRate,
  turnUsageTotalInputTokens,
  type AgentSessionTurnUsage
} from '../../../../../shared/agent-session/conversation-context/agent-session-turn-usage'
import { formatContextTokenCount } from '../../../../../shared/native-chat/native-chat-context-usage-summary'

const HOVER_OPEN_DELAY_MS = 150
const HOVER_CLOSE_DELAY_MS = 100
const HIGH_CACHE_HIT_PERCENT = 70
const LOW_CACHE_HIT_PERCENT = 30

function useTurnUsagePopoverOpen(): {
  open: boolean
  setOpen: (next: boolean) => void
  setOpenAfterHover: (next: boolean) => void
} {
  const [open, setOpenState] = useState(false)
  const cancelPendingHover = useRef<(() => void) | null>(null)
  const dropPendingHover = useCallback((): void => {
    cancelPendingHover.current?.()
    cancelPendingHover.current = null
  }, [])
  useEffect(() => dropPendingHover, [dropPendingHover])
  const setOpen = useCallback(
    (next: boolean): void => {
      dropPendingHover()
      setOpenState(next)
    },
    [dropPendingHover]
  )
  const setOpenAfterHover = useCallback(
    (next: boolean): void => {
      dropPendingHover()
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          dropPendingHover()
        }
      }
      const timer = setTimeout(
        () => setOpen(next),
        next ? HOVER_OPEN_DELAY_MS : HOVER_CLOSE_DELAY_MS
      )
      document.addEventListener('keydown', onKeyDown, true)
      cancelPendingHover.current = () => {
        clearTimeout(timer)
        document.removeEventListener('keydown', onKeyDown, true)
      }
    },
    [dropPendingHover, setOpen]
  )
  return { open, setOpen, setOpenAfterHover }
}

function formatCachePercent(percent: number): string {
  const fixed = percent.toFixed(1)
  return `${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}%`
}

function TurnUsageRow({
  label,
  tokens,
  locale,
  accent
}: {
  label: string
  tokens: number
  locale: string
  accent?: boolean
}): React.JSX.Element {
  const exact = tokens.toLocaleString(locale)
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span
        title={exact}
        className={cn(
          'shrink-0 tabular-nums',
          accent ? 'font-medium text-chat-diff-added' : 'text-foreground'
        )}
      >
        {exact}
      </span>
    </li>
  )
}

/** Compact per-turn token and prompt-cache readout with hover/click breakdown popover. */
export function NativeChatTurnUsageBadge({
  usage
}: {
  usage: AgentSessionTurnUsage
}): React.JSX.Element {
  const t = useTranslate()
  const intlLocale = useIntlLocale()
  const { open, setOpen, setOpenAfterHover } = useTurnUsagePopoverOpen()
  const cacheHitRate = computeTurnCacheHitRate(usage)
  const totalCompact = formatContextTokenCount(usage.totalTokens)
  const totalExact = usage.totalTokens.toLocaleString(intlLocale)
  const totalInput = turnUsageTotalInputTokens(usage)
  const highCacheHit = cacheHitRate !== null && cacheHitRate >= HIGH_CACHE_HIT_PERCENT
  const lowCacheHit =
    cacheHitRate !== null && cacheHitRate > 0 && cacheHitRate < LOW_CACHE_HIT_PERCENT
  const cachePercentLabel = cacheHitRate !== null ? formatCachePercent(cacheHitRate) : null
  const ariaLabel =
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
    <div
      className="flex items-center"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') {
          setOpenAfterHover(true)
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') {
          setOpenAfterHover(false)
        }
      }}
      onContextMenu={() => setOpen(false)}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel}
            aria-expanded={open}
            data-native-chat-turn-usage={usage.totalTokens}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs whitespace-nowrap tabular-nums text-chat-foreground-faint transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            // Read-only readout: clicking must not steal focus from the composer.
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              setOpen(true)
            }}
          >
            <span>
              {cachePercentLabel !== null
                ? totalCompact
                : t('components.native-chat.turnUsage.inlineTokens', '{{total}} tokens', {
                    total: totalCompact
                  })}
            </span>
            {cachePercentLabel !== null ? (
              <>
                <span aria-hidden="true" className="opacity-50">
                  ·
                </span>
                <span className={cn(highCacheHit && 'text-chat-diff-added')}>
                  {t('components.native-chat.turnUsage.inlineCache', '{{rate}} cache', {
                    rate: cachePercentLabel
                  })}
                </span>
              </>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={ariaLabel}
          side="top"
          align="start"
          sideOffset={8}
          className="w-64"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="p-3.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-foreground">
                {t('components.native-chat.turnUsage.title', 'Turn usage')}
              </span>
              <span title={totalExact} className="font-medium tabular-nums text-foreground">
                {t('components.native-chat.turnUsage.totalTokens', '{{total}} tokens', {
                  total: totalCompact
                })}
              </span>
            </div>
            {cacheHitRate !== null && cachePercentLabel !== null ? (
              <div className="mt-2.5 rounded-md bg-muted/50 px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    {t('components.native-chat.turnUsage.cacheHitRate', 'Cache hit rate')}
                  </span>
                  <span
                    className={cn(
                      'font-medium tabular-nums',
                      highCacheHit
                        ? 'text-chat-diff-added'
                        : lowCacheHit
                          ? 'text-chat-warning'
                          : 'text-foreground'
                    )}
                  >
                    {cachePercentLabel}
                  </span>
                </div>
                <Progress
                  value={cacheHitRate}
                  aria-label={t(
                    'components.native-chat.turnUsage.cacheHitProgress',
                    'Cache hit rate {{rate}}',
                    { rate: cachePercentLabel }
                  )}
                  className="mt-1.5 h-1.5"
                />
                <p className="mt-1.5 text-2xs tabular-nums text-muted-foreground">
                  {t(
                    'components.native-chat.turnUsage.cacheSummary',
                    '{{cached}} / {{input}} input tokens cached',
                    {
                      cached: formatContextTokenCount(usage.cachedReadTokens ?? 0),
                      input: formatContextTokenCount(totalInput)
                    }
                  )}
                </p>
              </div>
            ) : null}
            <ul className="mt-3 space-y-1.5 border-t border-border pt-2.5 text-xs">
              {usage.cachedReadTokens !== undefined ? (
                <TurnUsageRow
                  label={t('components.native-chat.turnUsage.cachedInput', 'Cached input')}
                  tokens={usage.cachedReadTokens}
                  locale={intlLocale}
                  accent={highCacheHit}
                />
              ) : null}
              <TurnUsageRow
                label={
                  usage.cachedReadTokens !== undefined
                    ? t('components.native-chat.turnUsage.uncachedInput', 'Uncached input')
                    : t('components.native-chat.turnUsage.input', 'Input')
                }
                tokens={usage.inputTokens}
                locale={intlLocale}
              />
              {usage.cachedWriteTokens !== undefined && usage.cachedWriteTokens > 0 ? (
                <TurnUsageRow
                  label={t('components.native-chat.turnUsage.cacheWrite', 'Cache write')}
                  tokens={usage.cachedWriteTokens}
                  locale={intlLocale}
                />
              ) : null}
              <TurnUsageRow
                label={t('components.native-chat.turnUsage.output', 'Output')}
                tokens={usage.outputTokens}
                locale={intlLocale}
              />
              {usage.reasoningTokens !== undefined && usage.reasoningTokens > 0 ? (
                <TurnUsageRow
                  label={t('components.native-chat.turnUsage.reasoning', 'Reasoning')}
                  tokens={usage.reasoningTokens}
                  locale={intlLocale}
                />
              ) : null}
            </ul>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
