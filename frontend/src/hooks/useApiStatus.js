import { useState, useEffect } from 'react'
import { getStatus } from '../api/client'

export function useApiStatus() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    getStatus()
      .then(setStatus)
      .catch(() => setStatus({ apiConfigured: false, chunkCount: 0 }))
  }, [])

  return { status }
}
