import { useRef, useEffect } from 'react'
import MessageBubble from './MessageBubble'

export default function ChatPanel({ history, loading, bottomRef }) {
  return (
    <div className="chat-panel">
      {history.length === 0 && !loading && (
        <p className="chat-placeholder">참고 문서를 바탕으로 질문해 보세요.</p>
      )}
      {history.map((item, i) => (
        <MessageBubble key={i} role={item.role} text={item.text} />
      ))}
      {loading && (
        <div className="message-bubble message-bubble--assistant">
          답변 생성 중...
        </div>
      )}
      <div ref={bottomRef} aria-hidden />
    </div>
  )
}
