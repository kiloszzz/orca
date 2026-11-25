import { createContext } from 'react'
import type { AgentSessionTurnUsage } from '../../../../../../src/shared/agent-session/conversation-context/agent-session-turn-usage'
import type { NativeChatMessage } from '../../../../../../src/shared/native-chat/native-chat-types'
import type { MobileNativeChatImageSource } from '../../visual/mobile-native-chat-image-preview'

export type MobileNativeChatViewedImage = { uri: string; label: string }

// Keep overlays above replaceable rows so echo/transcript swaps cannot close a selected image or actions sheet.
export type MobileNativeChatRowOverlays = {
  openImage: (image: MobileNativeChatViewedImage) => void
  openActions: (message: NativeChatMessage) => void
  /** Confirms, then rewinds the chat to this user message; explains instead when it can't now. */
  openRewind: (itemId: string) => void
  /** Shows the turn's token and prompt-cache breakdown sheet. */
  openTurnUsage?: (usage: AgentSessionTurnUsage) => void
  /** Reads host image paths the phone cannot load itself. */
  imageSource?: MobileNativeChatImageSource
}

export const MobileNativeChatRowOverlaysContext = createContext<MobileNativeChatRowOverlays>({
  openImage: () => {},
  openActions: () => {},
  openRewind: () => {},
  openTurnUsage: () => {}
})
