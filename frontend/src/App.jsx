import { useCallback } from 'react'
import { useApiStatus } from './hooks/useApiStatus'
import { useChat } from './hooks/useChat'
import Header from './components/Header'
import ChatPanel from './components/ChatPanel'
import QuestionForm from './components/QuestionForm'
import './App.css'

export default function App() {
  const { status } = useApiStatus()
  const { history, loading, sendQuestion, bottomRef } = useChat()

  const handleSubmit = useCallback(
    (question) => sendQuestion(question, {}),
    [sendQuestion]
  )

  return (
    <div className="app">
      <Header status={status} />
      <main className="app-main">
        <ChatPanel
          history={history}
          loading={loading}
          bottomRef={bottomRef}
        />
        <QuestionForm onSubmit={handleSubmit} loading={loading} />
      </main>
    </div>
  )
}
