import { useState, useCallback, useRef, useEffect } from 'react'
import { postQuery } from '../api/client'

const CONNECTION_ERROR_MSG =
  '연결 실패. 백엔드(run-web.bat)가 실행 중인지 확인하세요.'

export function useChat() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])

  const sendQuestion = useCallback(async (question, queryOptions = {}) => {
    const q = question?.trim()
    if (!q || loading) return
    setLoading(true)
    setHistory((prev) => [...prev, { role: 'user', text: q }])
    try {
      const reply = await postQuery(q, queryOptions)
      setHistory((prev) => [...prev, { role: 'assistant', text: reply }])
    } catch {
      setHistory((prev) => [
        ...prev,
        { role: 'assistant', text: CONNECTION_ERROR_MSG },
      ])
    } finally {
      setLoading(false)
    }
  }, [loading])

  return { history, loading, sendQuestion, bottomRef }
}
