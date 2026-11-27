import { DESKTOP_AWAY_SECONDS } from '../../../shared/app-lifecycle/presence/desktop-away-threshold'
import { addAppKeyListener, removeAppKeyListener } from '@/lib/keyboard/app-keyboard-router'

// Only trusted renderer input stamps presence; main’s below-idle-threshold answer applies to that scan and must not extend the presence window again.
let presenceGated = true
let presentAt = Number.NEGATIVE_INFINITY

/** False where there is no native idle query (browsers): the window gate stands alone. */
export function setPresenceGated(gated: boolean): void {
  presenceGated = gated
  presentAt = Number.NEGATIVE_INFINITY
}

export function notePresence(): void {
  presentAt = Date.now()
}

/** Trusted input within the desktop away threshold, or no idle query to ask (browsers). */
export function isPresenceConfirmed(): boolean {
  return !presenceGated || Date.now() - presentAt < DESKTOP_AWAY_SECONDS * 1000
}

/** How long presence holds without new input; null where it is not gated (browsers). */
export function presenceRemainingMs(): number | null {
  return presenceGated
    ? Math.max(0, Math.round(DESKTOP_AWAY_SECONDS * 1000 - (Date.now() - presentAt)))
    : null
}

export function createAutoAckPresenceCheck(
  readAway: () => Promise<boolean | undefined>,
  onPresent: () => void
): { request: () => void; dispose: () => void } {
  let disposed = false
  let pending = false
  return {
    request() {
      if (disposed || pending) {
        return
      }
      pending = true
      void readAway()
        .then((away) => {
          // Unknown presence must not clear unread attention.
          if (!disposed && away === false) {
            onPresent()
          }
        })
        .catch(() => {})
        .finally(() => {
          pending = false
        })
    },
    dispose() {
      disposed = true
    }
  }
}

const SIDEBAR_NAVIGATION_TARGET_SELECTOR =
  '[data-workspace-agent-row], [data-worktree-card-surface]'
const FOCUS_RESCAN_COALESCE_MS = 120
const SIDEBAR_NAVIGATION_PRESS_TIMEOUT_MS = 600
const SIDEBAR_NAVIGATION_RELEASE_SETTLE_MS = 50

let sidebarNavigationPressPending = false
let sidebarNavigationPressTimer: ReturnType<typeof setTimeout> | null = null
let focusRescanTimer: ReturnType<typeof setTimeout> | null = null

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer !== null) {
    clearTimeout(timer)
  }
  return null
}

function isSidebarNavigationPointerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SIDEBAR_NAVIGATION_TARGET_SELECTOR) !== null
}

/** Clear pending sidebar press deferral once click-driven navigation finishes switching surfaces. */
export function clearPendingSidebarNavigationPress(): void {
  sidebarNavigationPressPending = false
  sidebarNavigationPressTimer = clearTimer(sidebarNavigationPressTimer)
  focusRescanTimer = clearTimer(focusRescanTimer)
}

export function subscribeAutoAckPresenceSignals(
  onRescan: () => void,
  onInput: () => void,
  options?: { deferSidebarNavigationFocus?: boolean }
): () => void {
  const deferSidebarNavigation = options?.deferSidebarNavigationFocus === true
  const onVisibilityChange = (): void => {
    onRescan()
  }
  const onFocus = (): void => {
    if (!deferSidebarNavigation) {
      onRescan()
      return
    }
    focusRescanTimer = clearTimer(focusRescanTimer)
    focusRescanTimer = setTimeout(() => {
      focusRescanTimer = null
      if (!sidebarNavigationPressPending) {
        onRescan()
      }
    }, FOCUS_RESCAN_COALESCE_MS)
  }
  const onPointerDown = (event: Event): void => {
    if (!event.isTrusted) {
      return
    }
    if (deferSidebarNavigation && isSidebarNavigationPointerTarget(event.target)) {
      // Pressing a sidebar row/card is about to switch tabs; avoid acknowledging the old screen before click runs.
      focusRescanTimer = clearTimer(focusRescanTimer)
      sidebarNavigationPressPending = true
      sidebarNavigationPressTimer = clearTimer(sidebarNavigationPressTimer)
      sidebarNavigationPressTimer = setTimeout(() => {
        sidebarNavigationPressTimer = null
        sidebarNavigationPressPending = false
        onRescan()
      }, SIDEBAR_NAVIGATION_PRESS_TIMEOUT_MS)
      return
    }
    focusRescanTimer = clearTimer(focusRescanTimer)
    onInput()
  }
  const onPointerEnd = (): void => {
    if (!deferSidebarNavigation || !sidebarNavigationPressPending) {
      return
    }
    sidebarNavigationPressTimer = clearTimer(sidebarNavigationPressTimer)
    sidebarNavigationPressTimer = setTimeout(() => {
      sidebarNavigationPressTimer = null
      if (sidebarNavigationPressPending) {
        sidebarNavigationPressPending = false
        onRescan()
      }
    }, SIDEBAR_NAVIGATION_RELEASE_SETTLE_MS)
  }
  const input = (event: Event): void => {
    if (event.isTrusted) {
      focusRescanTimer = clearTimer(focusRescanTimer)
      onInput()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerEnd)
  window.addEventListener('pointercancel', onPointerEnd)
  window.addEventListener('pointermove', input)
  window.addEventListener('wheel', input, { passive: true })
  // Why capture: xterm stops the keydowns it handles before they bubble to the window.
  addAppKeyListener('keydown', input)
  return () => {
    clearPendingSidebarNavigationPress()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointerup', onPointerEnd)
    window.removeEventListener('pointercancel', onPointerEnd)
    window.removeEventListener('pointermove', input)
    window.removeEventListener('wheel', input)
    removeAppKeyListener('keydown', input)
  }
}
