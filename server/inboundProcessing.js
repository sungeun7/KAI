/**
 * 입고처리 (CBP002) — 자연어/LLM → 내부 정규화(camelCase) → POST 시 ASP.NET 모델과 동일한 PascalCase
 * (모델 수정 없이 `apikey`만내면 System.Text.Json 이 `APIKEY`에 매핑 못 해 jCBP002 가 null 될 수 있음)
 */
import {
  extractBatchNo,
  extractProcHms,
  extractProcYmd,
  normalizeHttpUrl,
} from './stockTransfer.js'
import { resolveSapCredentials } from './sapContext.js'

const CHAT = 'https://api.openai.com/v1/chat/completions'

function nowYmdHms() {
  const now = new Date()
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '').slice(0, 8)
  const hms =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')
  return { ymd, hms }
}

function inboundUrlCandidates(baseUrl) {
  const normalized = normalizeHttpUrl(baseUrl)
  if (!normalized) return []
  // 스톡이전과 같은 포트 자동시도 로직을 재사용하되, 별도 env를 우선 적용
  let u
  try {
    u = new URL(normalized)
  } catch {
    return [normalized]
  }
  if (u.port && u.port !== '80' && u.port !== '') return [normalized]
  // CBP002는 ASP.NET/IIS 포트 우선. 8080은 KAI Node 서버라 맨 뒤로 둠.
  const ports = (
    process.env.SAP_INBOUND_PROCESS_PORTS ||
    '44346,8443,443,80,8000,8001,44300,8080'
  )
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  const path = u.pathname + (u.search || '')
  const proto = u.protocol
  const host = u.hostname
  const out = []
  const seen = new Set()
  for (const port of ports) {
    const cand =
      port === '80' ? `${proto}//${host}${path}` : `${proto}//${host}:${port}${path}`
    if (!seen.has(cand)) {
      seen.add(cand)
      out.push(cand)
    }
  }
  return out.length ? out : [normalized]
}

/** 객체에서 여러 키 후보 중 첫 번째로 정의된 값 */
function firstProp(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) {
      return obj[k]
    }
  }
  return undefined
}

/** 스웨거/LLM placeholder("string" 등)면 null 반환 → env 기본값 사용 */
function effectiveApiKey(v) {
  const s = String(v != null ? v : '').trim()
  if (!s || s.toLowerCase() === 'string') return null
  return s
}

/**
 * KAI 내부 객체(camelCase) → C# CBP002 모델과 동일한 JSON 키(PascalCase, APIKEY)
 * ASP.NET [FromBody] 역직렬화 시 모델/컨트롤러 수정 없이 바인딩되도록 함.
 */
export function toDotNetCbp002Payload(internal) {
  const src = internal && typeof internal === 'object' ? internal : {}
  const rawApi = firstProp(src, ['apikey', 'APIKEY', 'APIKey', 'ApiKey'])
  const apiKeyVal = String(
    effectiveApiKey(rawApi) || process.env.SAP_CBP002_APIKEY || 'emdc'
  ).trim().toLowerCase()
  const rawBiz = firstProp(src, ['bizSeq', 'BizSeq'])
  const defaultBiz = Math.max(1, parseInt(process.env.SAP_CBP002_BIZSEQ || '1', 10) || 1)
  const bizSeqVal = Number(rawBiz != null ? rawBiz : defaultBiz) || defaultBiz

  const reqListRaw = Array.isArray(src.reqList)
    ? src.reqList
    : Array.isArray(src.ReqList)
      ? src.ReqList
      : []

  const ReqList = reqListRaw.map((req) => {
    const prodSrc = Array.isArray(req?.prodList)
      ? req.prodList
      : Array.isArray(req?.ProdList)
        ? req.ProdList
        : [{}]
    const def = (val, d) => (val != null ? val : d)
    const ProdList = prodSrc.map((p) => ({
      IfIdx: String(def(firstProp(p, ['ifIdx', 'IfIdx']), '')).trim(),
      ErpLineNo: Number(def(firstProp(p, ['erpLineNo', 'ErpLineNo']), 0)) || 0,
      IfProdId: String(def(firstProp(p, ['ifProdId', 'IfProdId']), '')).trim(),
      Towh: String(def(firstProp(p, ['towh', 'Towh', 'towH', 'TowH']), ''))
        .trim()
        .toUpperCase(),
      ExQty: Number(def(firstProp(p, ['exQty', 'ExQty', 'procQty', 'ProcQty']), 0)) || 0,
      LotNo: String(def(firstProp(p, ['lotNo', 'LotNo']), '')).trim(),
      ExpYmd: String(def(firstProp(p, ['expYmd', 'ExpYmd']), '')).trim(),
      ErpBatchNo: String(def(firstProp(p, ['erpBatchNo', 'ErpBatchNo']), '')).trim(),
    }))
    return {
      IfKey: String(def(firstProp(req, ['ifKey', 'IfKey']), '')).trim(),
      InwhTypeCd: String(def(firstProp(req, ['inwhTypeCd', 'InwhTypeCd']), '')).trim(),
      ProcBundleNo: String(def(firstProp(req, ['procBundleNo', 'ProcBundleNo']), '')).trim(),
      InwhTypeDtlCd: String(def(firstProp(req, ['inwhTypeDtlCd', 'InwhTypeDtlCd']), '')).trim(),
      CenterSeq: Number(def(firstProp(req, ['centerSeq', 'CenterSeq']), 0)) || 0,
      WmsReqNo: String(def(firstProp(req, ['wmsReqNo', 'WmsReqNo']), '')).trim(),
      ErpReqNo: String(def(firstProp(req, ['erpReqNo', 'ErpReqNo']), '')).trim(),
      ProcYmd: String(def(firstProp(req, ['procYmd', 'ProcYmd']), '')).trim(),
      ProcHms: String(def(firstProp(req, ['procHms', 'ProcHms']), '')).trim(),
      ProcUserId: String(def(firstProp(req, ['procUserId', 'ProcUserId']), '')).trim(),
      Note: String(def(firstProp(req, ['note', 'Note']), '')).trim(),
      ProdList,
    }
  })

  return {
    APIKEY: apiKeyVal,
    BizSeq: bizSeqVal,
    ReqList,
  }
}

export function applyCBP002Defaults(parsed) {
  const { ymd: ymdNow, hms: hmsNow } = nowYmdHms()
  const cleanString = (v) => {
    const s = String(v != null ? v : '').trim()
    if (!s) return ''
    if (s.toLowerCase() === 'string') return ''
    return s
  }
  const normalizeExpYmd = (v) => {
    const s = cleanString(v)
    if (!s) return ''
    const digits = s.replace(/[^\d]/g, '')
    if (digits.length === 8) return digits
    // YYMMDD (예: 260422) -> 20YYMMDD (예: 20260422)
    if (digits.length === 6) return `20${digits}`
    return digits
  }
  const parsedApi = firstProp(parsed, ['apikey', 'APIKEY', 'APIKey', 'ApiKey'])
  const apiKey = String(
    effectiveApiKey(parsedApi) || process.env.SAP_CBP002_APIKEY || 'emdc'
  ).trim().toLowerCase()
  const bizSeq = Math.max(
    1,
    parseInt(process.env.SAP_CBP002_BIZSEQ || '1', 10) || 1
  )
  const user = String(process.env.SAP_CBP002_USER || 'KAI').trim()

  const reqList =
    Array.isArray(parsed && parsed.reqList) && parsed.reqList.length
      ? parsed.reqList
      : Array.isArray(parsed && parsed.ReqList) && parsed.ReqList.length
        ? parsed.ReqList
        : [{}]

  const normalizedReqList = reqList.map((req) => {
    const prodList =
      Array.isArray(req && req.prodList) && req.prodList.length
        ? req.prodList
        : Array.isArray(req && req.ProdList) && req.ProdList.length
          ? req.ProdList
          : [{}]
    const r = (key, def) => {
      const v = firstProp(req, key)
      return v != null ? v : def
    }
    return {
      ifKey: cleanString(r(['ifKey', 'IfKey'], '')),
      inwhTypeCd: cleanString(r(['inwhTypeCd', 'InwhTypeCd'], '')),
      procBundleNo: cleanString(r(['procBundleNo', 'ProcBundleNo'], '')),
      inwhTypeDtlCd: cleanString(r(['inwhTypeDtlCd', 'InwhTypeDtlCd'], '')),
      centerSeq: Number(r(['centerSeq', 'CenterSeq'], 0)) || 0,
      wmsReqNo: cleanString(r(['wmsReqNo', 'WmsReqNo'], '')),
      erpReqNo: cleanString(r(['erpReqNo', 'ErpReqNo'], '')),
      procYmd: cleanString(String(r(['procYmd', 'ProcYmd'], ''))) || ymdNow,
      procHms: cleanString(String(r(['procHms', 'ProcHms'], ''))) || hmsNow,
      procUserId: cleanString(r(['procUserId', 'ProcUserId'], user)) || user,
      note: cleanString(r(['note', 'Note'], '')),
      prodList: prodList.map((p) => {
        const pv = (keys, def) => (firstProp(p, keys) != null ? firstProp(p, keys) : def)
        return {
          ifIdx: cleanString(pv(['ifIdx', 'IfIdx'], '')),
          erpLineNo: Number(pv(['erpLineNo', 'ErpLineNo'], 0)) || 0,
          ifProdId: cleanString(pv(['ifProdId', 'IfProdId'], '')),
          towh: cleanString(pv(['towh', 'Towh', 'towH', 'TowH'], '')).toUpperCase(),
          exQty: Number(pv(['exQty', 'ExQty', 'procQty', 'ProcQty'], 0)) || 0,
          expYmd: (() => {
            const exp = normalizeExpYmd(p && p.expYmd != null ? p.expYmd : (p && p.ExpYmd != null ? p.ExpYmd : ''))
            if (exp) return exp
            const bn = cleanString(p && p.erpBatchNo != null ? p.erpBatchNo : (p && p.ErpBatchNo != null ? p.ErpBatchNo : ''))
          const m = bn.match(/@(\d{6})$/) || bn.match(/@(\d{6})\b/)
          if (!m) return ''
          return `20${m[1]}`
        })(),
        lotNo: cleanString(pv(['lotNo', 'LotNo'], '')),
        erpBatchNo: cleanString(pv(['erpBatchNo', 'ErpBatchNo'], '')),
        }
      })
    }
  })

  const parsedBiz = parsed && (parsed.bizSeq != null ? parsed.bizSeq : parsed.BizSeq)
  return {
    apikey: apiKey,
    bizSeq: Number(parsedBiz != null ? parsedBiz : bizSeq) || bizSeq,
    reqList: normalizedReqList,
  }
}

/**
 * 입고처리(CBP002) 요청 JSON을 그대로 붙여넣은 경우를 지원
 * - instruction 전체가 JSON이면 그대로 파싱
 * - instruction 중간에 JSON이 섞여 있어도 { ... } 구간만 파싱 시도
 */
export function tryParseCBP002RequestFromInstruction(instruction) {
  const s = String(instruction || '').trim()
  if (!s) return null
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  const raw = s.slice(first, last + 1)
  try {
    const obj = JSON.parse(raw)
    // 최소한의 형태 체크 (camelCase 또는 C# PascalCase)
    const list = (obj && obj.reqList != null) ? obj.reqList : (obj && obj.ReqList != null ? obj.ReqList : null)
    if (!obj || !Array.isArray(list)) return null
    return { ...obj, reqList: list }
  } catch (_) {
    return null
  }
}

export function normalizeCBP002Request(req) {
  return applyCBP002Defaults(req)
}

/**
 * LLM이 CBP002 Swagger JSON(camelCase)만 출력하도록 생성
 */
export async function generateInboundProcessingProposal(instruction, apiKey) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '').slice(0, 8)
  const system = `입고처리(CBP002) Swagger 요청 JSON만 출력.

[요청 스키마(camelCase, 빈값 포함)]
{
  "apikey":"string",
  "bizSeq":0,
  "reqList":[
    {
      "ifKey":"string",
      "inwhTypeCd":"string",
      "procBundleNo":"string",
      "inwhTypeDtlCd":"string",
      "centerSeq":0,
      "wmsReqNo":"string",
      "erpReqNo":"string",
      "procYmd":"string",
      "procHms":"string",
      "procUserId":"string",
      "note":"string",
      "prodList":[
        {
          "ifIdx":"string",
          "erpLineNo":0,
          "ifProdId":"string",
          "towh":"string",
          "exQty":0,
          "expYmd":"string",
          "lotNo":"string",
          "erpBatchNo":"string"
        }
      ]
    }
  ]
}

[규칙]
1) 오직 JSON만 출력.
2) procYmd는 YYYYMMDD, procHms는 HHmmss. 사용자가 날짜/시간을 안 주면 전기 시각 기준의 값으로 넣어도 됨.
3) 품목번호(ifProdId)와 수량(exQty)은 반드시 채워라.
4) 배치관리 품목이면 erpBatchNo(예: 11411-053@260422)를 요청 문장에서 찾아 가능한 한 채워라. 없으면 빈 문자열 "".
5) 입고창고(towh)는 요청 문장에서 찾아 채워라. 없으면 빈 문자열 "".
`
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
        { role: 'user', content: `입고처리 요청:\n${instruction}` },
      ],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI 오류 ${res.status}: ${err.slice(0, 200)}`)
  }
  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  // content가 이미 object일 수도 있고 string일 수도 있어 방어
  const parsed = typeof content === 'string' ? JSON.parse(content) : content
  return parsed
}

function formatInboundTransportPayload(instruction, proposal) {
  const batchNo = extractBatchNo(instruction)
  const ymd = extractProcYmd(instruction)
  const hms = extractProcHms(instruction)
  const out = applyCBP002Defaults(proposal)

  // 재고이전과 동일하게: 사용자가 날짜/시간을 안 주면 "현재"로 강제
  const { ymd: ymdNow, hms: hmsNow } = nowYmdHms()
  out.reqList[0].procYmd = ymd || ymdNow
  out.reqList[0].procHms = hms || hmsNow

  // 사용자 배치번호가 있으면 강제 (LLM이 틀려도 전송값 보정)
  if (batchNo) out.reqList[0].prodList[0].erpBatchNo = batchNo
  return out
}

function tlsInsecureEnabled() {
  return (
    String(process.env.SAP_INBOUND_PROCESS_TLS_INSECURE || process.env.SAP_STOCK_TRANSFER_TLS_INSECURE || '')
      .trim()
      .toLowerCase() === 'true'
  )
}

function formatFetchError(e) {
  const code = e?.cause?.code || e?.code || ''
  const msg = e?.cause?.message || e?.message || ''
  return `${code || 'NETWORK'} ${msg}`.trim()
}

function isRetryableNetworkError(e) {
  const d = formatFetchError(e)
  return /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(d)
}

export async function postInboundProcessing(postUrl, user, pass, payload) {
  const urls = inboundUrlCandidates(postUrl)
  if (!urls.length) {
    return { ok: false, status: 0, body: 'URL 없음', viaDi: false, docNo: null }
  }
  const { user: u, pass: p } = resolveSapCredentials(user, pass)
  const auth = Buffer.from(`${u}:${p}`, 'utf8').toString('base64')

  const perTryMs = Math.min(
    Math.max(Number(process.env.SAP_INBOUND_PROCESS_TRY_TIMEOUT_MS) || 20000, 5000),
    180000
  )
  const bodyStr = JSON.stringify(toDotNetCbp002Payload(payload))

  let dispatcher
  if (tlsInsecureEnabled()) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
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
          'X-KAI-Source': 'kai-inbound-processing',
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
      const httpResult = (parsed && parsed.HttpResult != null) ? parsed.HttpResult : (parsed && parsed.httpResult != null ? parsed.httpResult : undefined)
      const resultList = Array.isArray(parsed?.ResultList) ? parsed.ResultList : (Array.isArray(parsed?.resultList) ? parsed.resultList : [])
      const firstResult = resultList[0] || null
      const itemResult = firstResult && (firstResult.Result != null ? firstResult.Result : firstResult.result)
      const itemMessage = firstResult && (firstResult.Message != null ? firstResult.Message : firstResult.message)
      const docNo = firstResult && (firstResult.ProcBundleNo || firstResult.procBundleNo || firstResult.IfKey || firstResult.ifKey || null)
      const ok = res.ok && httpResult === 'S' && itemResult !== 'E'

      if (ok) {
        return { ok: true, status: res.status, body: text.slice(0, 4000), docNo: docNo || null, resultMessage: itemMessage, usedUrl: url, viaDi: false }
      }
      attempts.push(`POST ${url} → HTTP ${res.status}`)
      const errDetail = itemResult === 'E' ? (itemMessage || text.slice(0, 500)) : text.slice(0, 4000)
      if (res.ok) {
        return { ok: false, status: res.status, body: errDetail, docNo: null, resultMessage: itemMessage, usedUrl: url, viaDi: false }
      }
      return { ok: false, status: res.status, body: errDetail, docNo: null, resultMessage: itemMessage, usedUrl: url, viaDi: false }
    } catch (e) {
      clearTimeout(t)
      const detail = formatFetchError(e)
      attempts.push(`${url}: ${detail}`)
      const retry = !isRetryableNetworkError(e) ? false : i < urls.length - 1
      if (retry) continue
      return { ok: false, status: 0, body: `${detail}`, docNo: null, attempts: attempts.join('\n'), viaDi: false }
    }
  }
  return { ok: false, status: 0, body: attempts.join('\n'), docNo: null, viaDi: false }
}

export function buildInboundRequestBody(instruction, proposal) {
  return formatInboundTransportPayload(instruction, proposal)
}

