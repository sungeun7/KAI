export default function MessageBubble({ role, text }) {
  return (
    <div className={`message-bubble message-bubble--${role}`} role="article">
      {text}
    </div>
  )
}
