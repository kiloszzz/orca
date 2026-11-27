import { app } from 'electron'
import { setTrayUnreadCount } from '../tray/system-tray'

let unreadCount = 0

export function formatUnreadBadgeLabel(count: number): string {
  return count <= 0 ? '' : count > 99 ? '99+' : String(count)
}

export function setUnreadDockBadgeCount(count: number): void {
  unreadCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  if (process.platform === 'darwin') {
    app.dock?.setBadge(formatUnreadBadgeLabel(unreadCount))
  }
  setTrayUnreadCount(unreadCount)
}
