// The person's own message bubble, for their prompts and anything else they said in the chat.
import { cn } from '@/lib/class-names'

export function NativeChatUserBubble({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'max-w-[80%] rounded-2xl rounded-br-sm border border-chat-user-bubble-border bg-chat-user-bubble-surface px-3.5 py-2.5 text-sm text-chat-user-bubble-foreground shadow-2xs',
        className
      )}
    >
      {children}
    </div>
  )
}
