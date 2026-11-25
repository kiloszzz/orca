import { Text, View } from 'react-native'
import type { AgentSessionTurnUsage } from '../../../../../../src/shared/agent-session/conversation-context/agent-session-turn-usage'
import type { NativeChatMessage } from '../../../../../../src/shared/native-chat/native-chat-types'
import { nativeChatMessageCopyText } from '../../../../../../src/shared/native-chat/transcript/messages/native-chat-message-copy-text'
import { MobileNativeChatMessageTime } from './MobileNativeChatMessageTime'
import { MobileNativeChatRewindButton } from '../message-actions/MobileNativeChatRewindButton'
import { MobileNativeChatResponseActions } from '../message-actions/MobileNativeChatResponseActions'
import { mobileNativeChatRowHoldsForkSlot } from '../../history/use-mobile-native-chat-fork'
import { MobileNativeChatTurnUsageBadge } from '../../usage/MobileNativeChatTurnUsageBadge'
import { styles } from './mobile-native-chat-message-styles'

/** A chat turn's time, actions (copy, fork, scroll-to-top, rewind), and settled per-turn token usage. */
export function MobileNativeChatMessageMeta({
  message,
  rowKey,
  fontScale,
  rewindable,
  turnUsage
}: {
  message: NativeChatMessage
  rowKey: string
  fontScale: number
  rewindable?: true
  turnUsage?: AgentSessionTurnUsage
}): React.JSX.Element {
  const copyText = nativeChatMessageCopyText(message)
  const hasActions =
    copyText.length > 0 || rewindable === true || mobileNativeChatRowHoldsForkSlot(message)
  const showTurnUsage = message.role === 'assistant' && turnUsage !== undefined
  return (
    <View style={styles.meta}>
      <MobileNativeChatMessageTime timestamp={message.timestamp} fontScale={fontScale} />
      {/* An empty wrapper would still pull the time over by the icons' edge margin. */}
      {hasActions ? (
        <View style={styles.metaActions}>
          <MobileNativeChatResponseActions message={message} rowKey={rowKey} copyText={copyText} />
          {rewindable ? <MobileNativeChatRewindButton itemId={message.id} /> : null}
        </View>
      ) : null}
      {showTurnUsage ? (
        <>
          {message.timestamp != null || hasActions ? (
            <Text style={styles.metaDot} accessible={false}>
              ·
            </Text>
          ) : null}
          <MobileNativeChatTurnUsageBadge usage={turnUsage} fontScale={fontScale} />
        </>
      ) : null}
    </View>
  )
}
