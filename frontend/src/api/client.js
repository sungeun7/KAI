const API_BASE = '/api'

export async function getStatus() {
  const res = await fetch(`${API_BASE}/status`)
  if (!res.ok) throw new Error('Status check failed')
  return res.json()
}

export async function postQuery(question, options = {}) {
  const body = {
    question: question.trim(),
    includeSapOdata: Boolean(options.includeSapOdata),
  }
  if (options.sapContext != null && String(options.sapContext).trim()) {
    body.sapContext = String(options.sapContext).slice(0, 20000)
  }
  const ou = (options.sapOdataUrl || '').trim()
  if (ou) {
    body.sapOdataUrl = ou.slice(0, 2048)
    body.sapOdataUser = String(options.sapOdataUser ?? '')
    body.sapOdataPassword = String(options.sapOdataPassword ?? '')
  }
  if (options.sapDocument === true) body.sapDocument = true
  const res = await fetch(`${API_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Query failed')
  const data = await res.json()
  return data.answer ?? '[응답 없음]'
}
