/**
 * 재고이전 — 자연어 → JSON → DI 경유 또는 SAP_STOCK_TRANSFER_URL
 */
import { resolveSapCredentials } from './sapContext.js'
import {
  diStockTransferEndpoint,
  postStockTransferThroughDi,
} from './diClient.js'

const CHAT = 'https://api.openai.com/v1/chat/completions'

function parseJson(content) {
  let s = String(content || '').trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/s, '')
  }
  return JSON.parse(s)
}

export function normalizeHttpUrl(u) {
  let s = (u || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s
  return s
}

function defaultWerksFrom() {
  return (
    process.env.SAP_DEFAULT_WERKS_FROM ||
    process.env.SAP_DEFAULT_WERKS ||
    '1000'
  )
    .trim()
    .slice(0, 4)
}

function defaultWerksTo() {
  return (
    process.env.SAP_DEFAULT_WERKS_TO ||
    process.env.SAP_DEFAULT_WERKS ||
    '1000'
  )
    .trim()
    .slice(0, 4)
}

/** B1 창고 코드 대문자 정규화, 한글 placeholder 치환 */
function normWhs(v) {
  if (v == null) return ''
  return String(v).toUpperCase().replace(/\s/g, '').slice(0, 10)
}

function badWarehouse(v) {
  const s = String(v ?? '').trim()
  if (!s) return true
  if (/[가-힣]/.test(s)) return true
  if (/플랜트|입고|출고|코드|창고\s*코드|plant|warehouse\s*code/i.test(s)) return true
  return false
}

/** 한글·placeholder → .env 기본값, B1 필드(FromWarehouse/ToWarehouse) 정규화 */
export function applyStockTransferDefaults(proposal) {
  const wf = defaultWerksFrom()
  const wt = defaultWerksTo()
  const p = { ...proposal }
  const fromWhs = p.FromWarehouse ?? p.lgortFrom
  const toWhs = p.ToWarehouse ?? p.lgortTo
  if (badWarehouse(fromWhs)) {
    p.FromWarehouse = process.env.SAP_DEFAULT_FROM_WAREHOUSE || 'AA120'
    p.lgortFrom = p.FromWarehouse
  } else {
    p.FromWarehouse = normWhs(fromWhs)
    p.lgortFrom = p.FromWarehouse
  }
  if (badWarehouse(toWhs)) {
    p.ToWarehouse = process.env.SAP_DEFAULT_TO_WAREHOUSE || 'AA100'
    p.lgortTo = p.ToWarehouse
  } else {
    p.ToWarehouse = normWhs(toWhs)
    p.lgortTo = p.ToWarehouse
  }
  if (!p.PostingDate) p.PostingDate = new Date().toISOString().slice(0, 10)
  if (!p.DocDate) p.DocDate = p.PostingDate
  if (p.Series == null) p.Series = process.env.SAP_STOCK_TRANSFER_SERIES || '주회'
  if (p.JournalRemark == null && p.bktxt) p.JournalRemark = p.bktxt
  if (p.JournalRemark == null) p.JournalRemark = '재고 이전 -'
  if (Array.isArray(p.Lines) && p.Lines.length) {
    p.Lines = p.Lines.map((ln) => ({
      ItemCode: ln.ItemCode ?? ln.matnr ?? '',
      Quantity: Number(ln.Quantity ?? ln.menge ?? 0) || 0,
      ItemDescription: ln.ItemDescription ?? ln.matnrText ?? '',
    }))
  }
  if (!Array.isArray(p.Lines) && (p.matnr || p.ItemCode)) {
    p.Lines = [
      {
        ItemCode: p.ItemCode ?? p.matnr ?? '',
        Quantity: Number(p.Quantity ?? p.menge ?? 0) || 0,
        ItemDescription: p.ItemDescription ?? p.matnrText ?? '',
      },
    ]
  }
  const badWerks = (v) => {
    const s = String(v ?? '').trim()
    if (!s || s.length > 4) return true
    if (/[가-힣]/.test(s)) return true
    if (/플랜트|입고|출고|코드|plant|from|to|code/i.test(s)) return true
    return false
  }
  if (badWerks(p.werksFrom)) p.werksFrom = wf
  if (badWerks(p.werksTo)) p.werksTo = wt
  return p
}

function formatFetchError(e) {
  const c = e?.cause
  if (c && typeof c === 'object') {
    const code = c.code || c.errno || ''
    const msg = c.message || ''
    const port = c.port ? `:${c.port}` : ''
    const addr = c.address || c.hostname || ''
    if (code || addr)
      return `${code || 'NETWORK'} ${addr}${port} — ${msg || e.message}`.trim()
  }
  if (e?.code) return `${e.code}: ${e.message || e}`
  return String(e?.message || e)
}

export async function generateStockTransferProposal(instruction, apiKey) {
  const wf = defaultWerksFrom()
  const wt = defaultWerksTo()
  const today = new Date().toISOString().slice(0, 10)
  const system = `SAP Business One "재고 이전" 폼 기준 JSON만 출력.

[폼 필드 매핑]
- 출고 창고 → FromWarehouse (대문자, 예 AA120)
- 입고 창고 → ToWarehouse (대문자, 예 AA100)
- 전기일 → PostingDate (YYYY-MM-DD)
- 증빙일 → DocDate (YYYY-MM-DD)
- 시리즈 → Series (예 주회, 없으면 빈 문자열)
- 회계 비고 → JournalRemark (예 "재고 이전 -")
- 품목 행 → Lines 배열:
  [{ "ItemCode": "11411-053", "Quantity": 4, "ItemDescription": "품목내역(선택)", "ErpBatchNo": "배치/일련번호(있으면)", "LotNo": "로트(있으면)", "ExpYmd": "유통기한 yyyymmdd(있으면)" }]

규칙:
- FromWarehouse, ToWarehouse: 한글·placeholder 금지. 문맥에 없으면 "${wf}" 또는 AA120/AA100 스타일 창고코드.
- ItemCode: 품목번호 (예 11411-053). Quantity: 숫자.
- 배치/일련번호(ErpBatchNo)가 사용자의 요청에 있으면 반드시 그대로 넣기. 없으면 생략 가능(빈값).
- 여러 품목이면 Lines에 여러 개. 단일 품목이면 Lines 1개.
- 하위 호환용: lgortFrom=FromWarehouse, lgortTo=ToWarehouse, matnr=첫 품목 ItemCode, menge=첫 품목 Quantity 도 넣어도 됨.

오직 JSON만 출력.`


  const res = await fetch(CHAT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.15,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `재고이전 요청:\n${instruction}` },
      ],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI 오류 ${res.status}: ${err.slice(0, 200)}`)
  }
  const json = await res.json()
  const proposal = parseJson(json?.choices?.[0]?.message?.content)
  if (!proposal || typeof proposal !== 'object') {
    throw new Error('재고이전 JSON 파싱 실패')
  }
  return applyStockTransferDefaults(proposal)
}

/** 사용자 문장에 배치/로트 번호가 있으면 추출 */
export function extractBatchNo(text) {
  const s = String(text || '')
  // 예: "배치번호 11411-053@260422", "배치 260422", "lotNo=ABC"
  const m =
    s.match(/(?:배치|batch|로트|lot)\s*번호?\s*[:=]?\s*([A-Za-z0-9@._\-\/]+)/i) ||
    s.match(/erpBatchNo\s*[:=]\s*([A-Za-z0-9@._\-\/]+)/i)
  return m?.[1]?.trim() || ''
}

/** 사용자 문장에 시간이 있으면 HHmmss 로 추출 */
export function extractProcHms(text) {
  const s = String(text || '')
  // 170255 / 17:02:55 / 17-02-55 / 17시 02분 55초
  let m = s.match(/\b([01]\d|2[0-3])([0-5]\d)([0-5]\d)\b/)
  if (m) return `${m[1]}${m[2]}${m[3]}`
  m = s.match(/\b([01]?\d|2[0-3])\s*[:\-]\s*([0-5]\d)\s*[:\-]\s*([0-5]\d)\b/)
  if (m) return `${String(m[1]).padStart(2, '0')}${m[2]}${m[3]}`
  m = s.match(/([01]?\d|2[0-3])\s*시\s*([0-5]?\d)\s*분\s*([0-5]?\d)\s*초/)
  if (m)
    return `${String(m[1]).padStart(2, '0')}${String(m[2]).padStart(2, '0')}${String(m[3]).padStart(2, '0')}`
  return ''
}

/** 사용자 문장에 날짜가 있으면 YYYYMMDD 로 추출 (명시된 경우에만) */
export function extractProcYmd(text) {
  const s = String(text || '')
  // 키워드 기반 우선: "날짜/전기일/증빙일/procYmd: 20231001" 또는 "2023-10-01"
  let m =
    s.match(
      /(?:날짜|전기일|증빙일|docdate|postingdate|procYmd)\s*[:=]?\s*(\d{4}[-/.]\d{2}[-/.]\d{2})/i
    ) ||
    s.match(
      /(?:날짜|전기일|증빙일|docdate|postingdate|procYmd)\s*[:=]?\s*(\d{8})/i
    )
  if (m) {
    const v = m[1].replace(/[^\d]/g, '')
    if (v.length === 8) return v
  }
  // 날짜만 단독으로 있는 경우(yyyy-mm-dd)도 허용
  m = s.match(/\b(20\d{2})[-/.](\d{2})[-/.](\d{2})\b/)
  if (m) return `${m[1]}${m[2]}${m[3]}`
  return ''
}

/** URL에 포트 없음(=80)이면 8080·8000… 순으로 자동 시도 */
export function stockTransferUrlCandidates(baseUrl) {
  const normalized = normalizeHttpUrl(baseUrl)
  if (!normalized) return []
  let u
  try {
    u = new URL(normalized)
  } catch {
    return [normalized]
  }
  const path = u.pathname + (u.search || '')
  const proto = u.protocol
  const host = u.hostname
  if (u.port && u.port !== '80') {
    return [normalized]
  }
  const ports = (
    process.env.SAP_STOCK_TRANSFER_PORTS || '8080,8000,8001,44300,80'
  )
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  const seen = new Set()
  const out = []
  for (const port of ports) {
    const cand =
      port === '80'
        ? `${proto}//${host}${path}`
        : `${proto}//${host}:${port}${path}`
    if (!seen.has(cand)) {
      seen.add(cand)
      out.push(cand)
    }
  }
  return out.length ? out : [normalized]
}

function isRetryableNetworkError(e) {
  const d = formatFetchError(e)
  return /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(
    d
  )
}

/**
 * KAI proposal → MACRO_WMS CSM001 API 형식 변환 (add/Controllers/CSM001.cs, add/Models/CSM001.cs)
 * Swagger 스키마(소문자 camelCase)에 맞춰 전송:
 * { apikey, bizSeq, reqList: [{ ifKey, wmsReqNo, procYmd, procHms, procUserId, procBundleNo, prodList: [...] }] }
 */
export function proposalToCSM001Body(proposal) {
  const now = new Date()
  const ymdNow = now.toISOString().slice(0, 10).replace(/-/g, '').slice(0, 8)
  const procYmd = (proposal.PostingDate || proposal.DocDate || now.toISOString().slice(0, 10))
    .replace(/-/g, '')
    .slice(0, 8)
  const procHms =
    String(proposal.ProcHms || proposal.procHms || '').trim() ||
    (String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0'))
  const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  const ifKey = `KAI-${ymdNow}-${seq}`
  const wmsReqNo = String(proposal.WmsReqNo || ifKey)
  const fromWh = String(proposal.FromWarehouse ?? proposal.lgortFrom ?? '').trim() || (process.env.SAP_DEFAULT_FROM_WAREHOUSE || '1')
  const toWh = String(proposal.ToWarehouse ?? proposal.lgortTo ?? '').trim() || (process.env.SAP_DEFAULT_TO_WAREHOUSE || '2')
  const lines = Array.isArray(proposal.Lines) && proposal.Lines.length
    ? proposal.Lines
    : (proposal.ItemCode || proposal.matnr)
      ? [{ ItemCode: proposal.ItemCode ?? proposal.matnr, Quantity: Number(proposal.Quantity ?? proposal.menge ?? 0) || 0 }]
      : []
  const batchStrategy = String(process.env.SAP_CSM001_BATCH_STRATEGY || '')
    .trim()
    .toLowerCase() // 'auto'면 (기존처럼) 임의 생성, 그 외는 생성 안 함
  const prodList = (lines.length ? lines : [{}]).map((ln, idx) => {
    const ifProdId = String(ln.ItemCode ?? ln.IfProdId ?? '').trim()
    const procQty = Number(ln.Quantity ?? ln.ProcQty ?? 0) || 0
    const explicitBatch = String(ln.ErpBatchNo ?? ln.erpBatchNo ?? '').trim()
    const fallbackBatch =
      batchStrategy === 'auto' && ifProdId ? `${ifProdId}-${procYmd || ymdNow}` : ''
    return {
      ifIdx: String(idx),
      erpLineNo: idx,
      frWh: String(ln.FrWh ?? ln.FromWarehouse ?? fromWh).trim() || '',
      frLoc: String(ln.FrLoc ?? '').trim() || '',
      toWh: String(ln.ToWh ?? ln.ToWarehouse ?? toWh).trim() || '',
      toLoc: String(ln.ToLoc ?? '').trim() || '',
      ifProdId: ifProdId || '',
      procQty: procQty,
      expYmd: String(ln.ExpYmd ?? '').trim().slice(0, 8) || '',
      lotNo: String(ln.LotNo ?? '').trim() || '',
      // 배치/일련번호는 SAP에 실제 존재하는 값만 써야 함.
      // 기본은 임의 생성하지 않음(빈 값). 필요하면 .env SAP_CSM001_BATCH_STRATEGY=auto 로 예전 동작 사용.
      erpBatchNo: explicitBatch || fallbackBatch,
    }
  })
  // Swagger 예시가 apikey/bizSeq/reqList(소문자)로 노출됨 → 그 형태로 전송
  return {
    apikey: String(process.env.SAP_CSM001_APIKEY || 'emdc')
      .trim()
      .toLowerCase(),
    bizSeq: Math.max(1, parseInt(process.env.SAP_CSM001_BIZSEQ || '1', 10)),
    reqList: [
      {
        ifKey: ifKey,
        wmsReqNo: wmsReqNo,
        procYmd: String(procYmd || ymdNow),
        procHms: String(procHms),
        procUserId: String((process.env.SAP_CSM001_USER || 'KAI').trim()),
        procBundleNo: String(proposal.ProcBundleNo || ''),
        prodList: prodList,
      },
    ],
  }
}

export async function postStockTransfer(postUrl, user, pass, proposal) {
  const useCSM001Format =
    process.env.SAP_STOCK_TRANSFER_CSM001_FORMAT === 'true' ||
    Boolean((process.env.SAP_CSM001_APIKEY || '').trim())
  const payload = useCSM001Format
    ? proposalToCSM001Body(proposal)
    : {
        type: 'KAI_STOCK_TRANSFER_V1',
        program: 'CSM001',
        proposal,
        postedAt: new Date().toISOString(),
      }

  // DI 서버가 설정되어 있으면 DI 경유로 전송 (DI가 SAP/CSM001로 전달)
  const diEndpoint = diStockTransferEndpoint()
  if (diEndpoint) {
    const result = await postStockTransferThroughDi(user, pass, payload)
    return { ...result, viaDi: true }
  }

  const urls = stockTransferUrlCandidates(postUrl)
  if (!urls.length) {
    return { ok: false, status: 0, body: 'URL 없음', docNo: null, viaDi: false }
  }
  const { user: u, pass: p } = resolveSapCredentials(user, pass)
  const auth = Buffer.from(`${u}:${p}`, 'utf8').toString('base64')
  const perTryMs = Math.min(
    Math.max(Number(process.env.SAP_STOCK_TRANSFER_TRY_TIMEOUT_MS) || 20000, 5000),
    180000
  )
  const bodyStr = JSON.stringify(payload)

  const tlsInsecure =
    String(process.env.SAP_STOCK_TRANSFER_TLS_INSECURE || '').trim().toLowerCase() ===
    'true'

  let dispatcher
  if (tlsInsecure) {
    // Node fetch(undici)가 자체서명 인증서로 실패하는 경우를 우회 (개발용)
    // dispatcher 설정이 먹지 않는 런타임을 대비해 환경변수도 함께 설정
    if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    }
    try {
      const { Agent } = await import('undici')
      dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
    } catch (_) {}
  }

  const attempts = []
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), perTryMs)
    try {
      const opts = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain;q=0.9',
          Authorization: `Basic ${auth}`,
          'X-KAI-Source': 'kai-stock-transfer',
        },
        body: bodyStr,
        signal: ctrl.signal,
      }
      if (url.startsWith('https:') && dispatcher) opts.dispatcher = dispatcher
      const res = await fetch(url, opts)
      clearTimeout(t)
      const text = await res.text()
      let parsed = null
      try {
        parsed = JSON.parse(text)
      } catch (_) {}
      // add/ CSM001 API: cResult { HttpResult/httpResult: "S"|"E", HttpMessage/httpMessage, ResultList/resultList: [...] }
      const httpResult = parsed?.HttpResult ?? parsed?.httpResult
      const cResultOk = httpResult === 'S'
      const resultList = parsed?.ResultList ?? parsed?.resultList
      const firstResult = Array.isArray(resultList) && resultList[0]
      const docNoFromResult =
        firstResult?.ProcBundleNo ||
        firstResult?.procBundleNo ||
        firstResult?.IfKey ||
        firstResult?.ifKey ||
        parsed?.documentNumber
      if (res.ok && (useCSM001Format ? cResultOk : true)) {
        return {
          ok: useCSM001Format ? cResultOk : true,
          status: res.status,
          body: text.slice(0, 4000),
          docNo:
            useCSM001Format
              ? docNoFromResult
              : parsed?.mblpo ||
                parsed?.mblnr ||
                parsed?.documentNumber ||
                parsed?.belnr ||
                null,
          usedUrl: url,
          viaDi: false,
        }
      }
      if (res.ok && useCSM001Format && !cResultOk) {
        const errMsg =
          firstResult?.Message ||
          firstResult?.message ||
          parsed?.HttpMessage ||
          parsed?.httpMessage ||
          text.slice(0, 500)
        // 배치/일련번호 오류는 흔함 → 원인 힌트 추가
        const hint =
          /배치\/일련번호|batch|serial/i.test(String(errMsg))
            ? '\n(힌트) 이 품목은 배치/일련번호 관리 품목입니다. `erpBatchNo`는 SAP에 실제 존재하는 번호여야 합니다. KAI는 기본으로 임의 생성하지 않으니, 요청에 배치번호를 명시하거나 WMS에서 받은 값을 넣어주세요.'
            : ''
        return {
          ok: false,
          status: res.status,
          body: `${errMsg}${hint}`.slice(0, 4000),
          docNo: null,
          usedUrl: url,
          viaDi: false,
        }
      }
      attempts.push(`POST ${url} → HTTP ${res.status}`)
      if (res.status >= 400 && res.status < 500 && urls.length > 1 && i === 0) {
        /* 첫 URL이 연결은 됐는데 401/404면 다른 포트는 의미 없을 수 있음 — 그래도 사용자 지정 순서대로만 */
      }
      return {
        ok: false,
        status: res.status,
        body: text.slice(0, 4000),
        docNo: null,
        usedUrl: url,
        attempts: attempts.join('\n'),
        viaDi: false,
      }
    } catch (e) {
      clearTimeout(t)
      const detail = formatFetchError(e)
      attempts.push(`${url}: ${detail}`)
      const last = i === urls.length - 1
      const retry = !last && isRetryableNetworkError(e)
      if (retry) continue
      const hint = last
        ? `\n시도한 주소:\n${attempts.join('\n')}\n.env SAP_STOCK_TRANSFER_PORTS=실제포트 로 순서 지정 가능.`
        : ''
      return {
        ok: false,
        status: 0,
        body: `${detail}${e?.name === 'AbortError' ? ` (${perTryMs}ms)` : ''}${hint}`,
        docNo: null,
        attempts: attempts.join('\n'),
        viaDi: false,
      }
    }
  }
  return {
    ok: false,
    status: 0,
    body: attempts.join('\n'),
    docNo: null,
    viaDi: false,
  }
}
