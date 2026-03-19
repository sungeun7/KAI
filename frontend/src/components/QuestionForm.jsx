import { useState } from 'react'

export default function QuestionForm({ onSubmit, loading }) {
  const [question, setQuestion] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    const q = question.trim()
    if (!q || loading) return
    onSubmit(q)
    setQuestion('')
  }

  return (
    <form onSubmit={handleSubmit} className="question-form" aria-label="질문 입력">
      <input
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="질문 입력..."
        disabled={loading}
        className="question-input"
        autoComplete="off"
      />
      <button type="submit" disabled={loading} className="question-button">
        전송
      </button>
    </form>
  )
}
