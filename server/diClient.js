/**
 * DI(Data Integration) 서버 경유 — KAI → DI → SAP
 * .env: DI_SERVER_URL, DI_JOURNAL_PATH, DI_ODATA_PATH, (선택) DI_API_KEY / DI_KAI_USER·DI_KAI_PASSWORD
 */

function diBase() {
  return (process.env.DI_SERVER_URL || '').trim().replace(/\/+$/, '')
}

export function diConfigured() {
  return Boolean(diBase())
}

export function diJournalEndpoint() {
  const b = diBase()
  if (!b) return null
  const p = (process.env.DI_JOURNAL_PATH || '/kai/journal').trim()
  return b + (p.startsWith('/') ? p : `/${p}`)
}

export function diOdataEndpoint() {
  const b = diBase()
  if (!b) return null
  const p = (process.env.DI_ODATA_PATH || '/kai/odata').trim()
  return b + (p.startsWith('/') ? p : `/${p}`)
}

/** 재고이전(CSM001): DI 경유 시 이 경로로 POST */
export function diStockTransferEndpoint() {
  const b = diBase()
  if (!b) return null
  const p = (process.env.DI_STOCK_TRANSFER_PATH || '/kai/stock-transfer').trim()
  return b + (p.startsWith('/') ? p : `/${p}`)
}

function sapCreds(user, pass) {
  const u =
    (user || '').trim() ||
    (process.env.SAP_USER || '').trim() ||
    'manager'
  const p =
    (pass || '').trim() ||
    (process.env.SAP_PASSWORD || '').trim() ||
    'emdc'
  return { u, p }
}

/** KAI → DI 호출 시 인증 (DI 쪽에서 검증) */
function diAuthHeaders() {
  const key = (process.env.DI_API_KEY || '').trim()
  if (key) {
    return {
      Authorization: key.includes(' ') ? key : `Bearer ${key}`,
    }
  }
  const du = (process.env.DI_KAI_USER || '').trim()
  const dp = (process.env.DI_KAI_PASSWORD || '').trim()
  if (du || dp) {
    return {
      Authorization:
        'Basic ' + Buffer.from(`${du}:${dp}`, 'utf8').toString('base64'),
    }
  }
  const { u, p } = sapCreds(process.env.SAP_USER, process.env.SAP_PASSWORD)
  return {
    Authorization: 'Basic ' + Buffer.from(`${u}:${p}`, 'utf8').toString('base64'),
  }
}

const MAX_ODATA = 50000

/**
 * OData: DI에 sapUrl + 계정 넘기면 DI가 SAP GET 후 본문 반환
 */
export async function forwardOdataThroughDi(sapUrl, user, pass, authorization) {
  const endpoint = diOdataEndpoint()
  if (!endpoint) {
    return { ok: false, text: '', error: 'DI_SERVER_URL 미설정' }
  }
  const { u, p } = sapCreds(user, pass)
  const body = {
    method: 'GET',
    sapOdataUrl: String(sapUrl).trim(),
    sapUser: u,
    sapPassword: p,
  }
  if ((authorization || '').trim()) {
    body.sapAuthorization = authorization.trim()
    delete body.sapUser
    delete body.sapPassword
  }

  const ctrl = new AbortController()
  const t = setTimeout(
    () => ctrl.abort(),
    Math.min(
      Math.max(Number(process.env.SAP_FETCH_TIMEOUT_MS) || 45000, 5000),
      120000
    )
  )
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, application/xml;q=0.9',
        'X-KAI-Source': 'kai-rag',
        ...diAuthHeaders(),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    const text = await res.text()
    if (!res.ok) {
      return {
        ok: false,
        text: '',
        error: `DI OData HTTP ${res.status}: ${text.slice(0, 400)}`,
      }
    }
    let out = text
    try {
      const j = JSON.parse(text)
      out =
        j.body ??
        j.data ??
        j.response ??
        j.payload ??
        j.result ??
        (typeof j === 'string' ? j : text)
      if (typeof out !== 'string') out = JSON.stringify(out)
    } catch (_) {}
    const max = Math.min(
      Number(process.env.SAP_RESPONSE_MAX_CHARS) || 12000,
      MAX_ODATA
    )
    return { ok: true, text: String(out).slice(0, max), error: null }
  } catch (e) {
    clearTimeout(t)
    return {
      ok: false,
      text: '',
      error: e?.name === 'AbortError' ? '시간 초과' : String(e?.message || e),
    }
  }
}

/**
 * 분개: DI가 받아 SAP BAPI 등으로 전기 (본문은 기존과 동일 JSON)
 */
export async function postJournalThroughDi(user, pass, payload) {
  const endpoint = diJournalEndpoint()
  if (!endpoint) {
    return {
      ok: false,
      status: 0,
      body: 'DI_JOURNAL 경로 없음',
      parsed: null,
      belnr: null,
    }
  }
  const { u, p } = sapCreds(user, pass)
  const wrap =
    (process.env.DI_JOURNAL_WRAP || '').trim() === 'true'
      ? {
          source: 'KAI',
          journalRequest: payload,
        }
      : payload

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 60000)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain;q=0.9',
        'X-KAI-Source': 'kai-journal',
        ...diAuthHeaders(),
      },
      body: JSON.stringify(wrap),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    const text = await res.text()
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch (_) {}
    if (wrap !== payload && parsed?.journalResponse) {
      parsed = parsed.journalResponse
    }
    return {
      ok: res.ok,
      status: res.status,
      body: text.slice(0, 4000),
      parsed,
      belnr:
        parsed?.belnr ||
        parsed?.documentNumber ||
        parsed?.Belnr ||
        null,
    }
  } catch (e) {
    clearTimeout(t)
    return {
      ok: false,
      status: 0,
      body: String(e?.message || e),
      parsed: null,
      belnr: null,
    }
  }
}

/**
 * 재고이전(CSM001): DI가 받아 192.168.0.37/CSM001 등으로 전달
 */
export async function postStockTransferThroughDi(user, pass, payload) {
  const endpoint = diStockTransferEndpoint()
  if (!endpoint) {
    return {
      ok: false,
      status: 0,
      body: 'DI_STOCK_TRANSFER_PATH 없음',
      docNo: null,
      usedUrl: null,
    }
  }
  const wrap =
    (process.env.DI_STOCK_TRANSFER_WRAP || '').trim() === 'true'
      ? { source: 'KAI', stockTransferRequest: payload }
      : payload

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 60000)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain;q=0.9',
        'X-KAI-Source': 'kai-stock-transfer',
        ...diAuthHeaders(),
      },
      body: JSON.stringify(wrap),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    const text = await res.text()
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch (_) {}
    if (wrap !== payload && parsed?.stockTransferResponse) {
      parsed = parsed.stockTransferResponse
    }
    return {
      ok: res.ok,
      status: res.status,
      body: text.slice(0, 4000),
      docNo:
        parsed?.docNo ||
        parsed?.mblnr ||
        parsed?.documentNumber ||
        parsed?.belnr ||
        null,
      usedUrl: endpoint,
    }
  } catch (e) {
    clearTimeout(t)
    return {
      ok: false,
      status: 0,
      body: String(e?.message || e),
      docNo: null,
      usedUrl: endpoint,
    }
  }
}
