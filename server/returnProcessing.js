/**
 * 반품마감 CBP006 — ORDN 생성 + ORRR Close (DI 서버)
 */
import {
  normalizeHttpUrl,
  extractBatchNo,
  extractProcHms,
  extractProcYmd,
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

/** CBP006 C# DateTime.ParseExact(procYmd,"yyyyMMdd") — "YYYYMMDD" 문자열이면 파싱 실패 */
export function coerceProcYmd(v, ymdFallback) {
  const digits = String(v ?? '').replace(/\D/g, '')
  if (digits.length === 8 && /^\d{8}$/.test(digits)) return digits
  return ymdFallback
}

/** CBP006 procHms — 6자리 숫자만 유효 */
export function coerceProcHms(v, hmsFallback) {
  const digits = String(v ?? '').replace(/\D/g, '')
  if (digits.length === 6 && /^\d{6}$/.test(digits)) return digits
  return hmsFallback
}

function firstProp(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) {
      return obj[k]
    }
  }
  return undefined
}

function effectiveApiKey(v) {
  const s = String(v != null ? v : '').trim()
  if (!s || s.toLowerCase() === 'string') return null
  return s
}

/** 포트 미지정 시에만 SAP_CBP006_PORTS 로 확장. 포트·경로가 정확한 URL은 쉼표로 나열하세요. */
function expandOneCbp006Url(baseUrl) {
  const normalized = normalizeHttpUrl(baseUrl)
  if (!normalized) return []
  let u
  try {
    u = new URL(normalized)
  } catch {
    return [normalized]
  }
  if (u.port && u.port !== '80' && u.port !== '') return [normalized]
  const ports = (
    process.env.SAP_CBP006_PORTS ||
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

/**
 * SAP_CBP006_URL 에 쉼표/세미콜론으로 여러 개를 넣을 수 있음 (우선순위 순).
 * 예: http://host:8080/api/CBP006,https://host:44346/CBP006
 */
export function cbp006UrlCandidates(baseUrl) {
  const raw = String(baseUrl ?? '').trim()
  if (!raw) return []
  const parts = raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
  const baseUrls = []
  const seenBase = new Set()
  for (const p of parts) {
    for (const c of expandOneCbp006Url(p)) {
      if (!seenBase.has(c)) {
        seenBase.add(c)
        baseUrls.push(c)
      }
    }
  }

  const pathCandidates = (
    process.env.SAP_CBP006_PATH_CANDIDATES ||
    '/CBP006,/api/CBP006,/cbp006,/api/cbp006'
  )
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const out = []
  const seen = new Set()
  for (const u0 of baseUrls) {
    let u
    try {
      u = new URL(u0)
    } catch {
      if (!seen.has(u0)) {
        seen.add(u0)
        out.push(u0)
      }
      continue
    }
    const originalPath = u.pathname || '/'
    const shouldExpandPath =
      pathCandidates.length > 0 &&
      (originalPath === '/' ||
        /^\/cbp006$/i.test(originalPath) ||
        /^\/api\/cbp006$/i.test(originalPath))
    if (!shouldExpandPath) {
      const cand = `${u.protocol}//${u.host}${u.pathname}${u.search || ''}`
      if (!seen.has(cand)) {
        seen.add(cand)
        out.push(cand)
      }
      continue
    }
    for (const p of pathCandidates) {
      const pp = p.startsWith('/') ? p : `/${p}`
      const cand = `${u.protocol}//${u.host}${pp}${u.search || ''}`
      if (!seen.has(cand)) {
        seen.add(cand)
        out.push(cand)
      }
    }
  }
  return out
}

function httpStatusShouldTryNextUrl(status) {
  const n = Number(status)
  if (!Number.isFinite(n)) return false
  if (n === 404 || n === 405 || n === 408) return true
  if (n >= 502 && n <= 504) return true
  return false
}

function enrichHttpErrorHint(status, bodyText, usedUrl) {
  const s = String(bodyText || '')
  if (
    Number(status) === 400 &&
    /Invalid Hostname|request hostname is invalid/i.test(s)
  ) {
    return (
      `${s}\n` +
      `힌트: IIS 바인딩 HostName과 URL 호스트가 다릅니다. ` +
      `IP(${usedUrl}) 대신 IIS 바인딩에 등록된 도메인/호스트명으로 SAP_CBP006_URL을 설정하세요.`
    )
  }
  return s
}

function rrr1Get(row, ...names) {
  if (!row || typeof row !== 'object') return undefined
  const keys = Object.keys(row)
  for (const n of names) {
    const k = keys.find((kk) => kk.toLowerCase() === n.toLowerCase())
    if (k !== undefined && row[k] != null && String(row[k]).trim() !== '') {
      return row[k]
    }
  }
  return undefined
}

function formatExpYmd(v) {
  if (v == null || v === '') return ''
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}${m}${d}`
  }
  const s = String(v).replace(/\D/g, '')
  if (s.length >= 8) return s.slice(0, 8)
  return ''
}

function looksLikeAbsEntryBarcodeOnly(s) {
  const t = String(s ?? '').trim()
  if (!t || /[a-z@]/i.test(t)) return false
  if (!/^\d+$/.test(t)) return false
  const minLen = Math.max(8, Math.min(20, Number(process.env.KAI_SBO_OBTN_ABS_ENTRY_MIN_LEN) || 10))
  return t.length >= minLen
}

/**
 * RRR1 행에서 CBP006용 배치 문자열.
 * BatchNum에 OBTN AbsEntry(긴 숫자)만 있고 DistNumber에 품목@유통기한 형이 있을 때,
 * 컬럼 순서 때문에 AbsEntry가 먼저 잡히면 DI가 실패하므로 @ 포함 값을 우선한다.
 */
function pickBatchFromRrrRow(r) {
  if (!r || typeof r !== 'object') return ''
  const names = [
    'DistNumber',
    'DistNum',
    'BatchNum',
    'VBatchNum',
    'SubCatNum',
    'U_Batch',
    'U_ErpBatch',
    'ErpBatchNo',
    'BatchNumber',
    'MnfSerial',
    'SerialNum',
    'LotNumber',
    'LotNo',
  ]
  const candidates = []
  const seen = new Set()
  const push = (s) => {
    const t = String(s ?? '').trim()
    if (!t || seen.has(t)) return
    seen.add(t)
    candidates.push(t)
  }
  for (const n of names) {
    push(rrr1Get(r, n))
  }
  for (const v of Object.values(r)) {
    const s = String(v ?? '').trim()
    if (s.includes('@') && /[A-Za-z0-9._-]/.test(s)) push(s)
  }
  if (!candidates.length) return ''
  const withAt = candidates.find((s) => s.includes('@'))
  if (withAt) return withAt
  const notAbs = candidates.find((s) => !looksLikeAbsEntryBarcodeOnly(s))
  if (notAbs) return notAbs
  return candidates[0]
}

/** CBP006 본문(reqList)에서 ORRR DocEntry 후보 — 질문 텍스트보다 우선(3자리 등도 포함) */
export function extractDocEntriesFromCbp006Request(body) {
  const list = body?.reqList || body?.ReqList
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const req of list) {
    const raw = req?.erpReqNo ?? req?.ErpReqNo
    const n = Number(String(raw ?? '').replace(/\D/g, '') || '0')
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out.slice(0, 200)
}

/**
 * 붙여넣은 JSON에 잘못된 erpBatchNo(OBTN AbsEntry 등)만 있을 때,
 * RRR1에 이미 채워진 DistNumber를 같은 DocEntry·품목·라인에 맞춰 덮어씀.
 */
export function mergeRrr1BatchIntoCbp006Body(requestBody, rrrRows) {
  const rows = Array.isArray(rrrRows) ? rrrRows : []
  if (!rows.length || !requestBody || typeof requestBody !== 'object') {
    return requestBody
  }
  const body = JSON.parse(JSON.stringify(requestBody))
  const list = body.reqList || body.ReqList
  if (!Array.isArray(list)) return body

  for (const req of list) {
    const docEntry = Number(req.erpReqNo ?? req.ErpReqNo ?? NaN)
    if (!Number.isFinite(docEntry) || docEntry <= 0) continue
    const prods = req.prodList || req.ProdList
    if (!Array.isArray(prods)) continue

    for (const p of prods) {
      const lineNum = Number(p.erpLineNo ?? p.ErpLineNo ?? 0)
      const itemCode = String(p.ifProdId ?? p.IfProdId ?? '').trim()
      const prev = String(p.erpBatchNo ?? p.ErpBatchNo ?? '').trim()
      const hasDistFormat = /@/.test(prev) && !/^\d+$/.test(prev.replace(/@/g, ''))
      if (hasDistFormat && prev.length > 4) continue

      const matchRow = (r) => {
        const de = Number(rrr1Get(r, 'DocEntry'))
        if (de !== docEntry) return false
        const ic = String(rrr1Get(r, 'ItemCode') ?? '').trim()
        if (itemCode && ic && ic !== itemCode) return false
        const ln = Number(rrr1Get(r, 'LineNum', 'VisOrder')) || 0
        if (!Number.isFinite(lineNum)) return true
        return (
          ln === lineNum ||
          ln === lineNum + 1 ||
          ln === lineNum - 1
        )
      }
      let r = rows.find(matchRow)
      if (!r && itemCode) {
        r = rows.find((row) => {
          const de = Number(rrr1Get(row, 'DocEntry'))
          if (de !== docEntry) return false
          const ic = String(rrr1Get(row, 'ItemCode') ?? '').trim()
          return ic === itemCode
        })
      }
      if (!r) continue
      const batch = pickBatchFromRrrRow(r)
      if (!batch) continue
      const shouldApply =
        !prev ||
        looksLikeAbsEntryBarcodeOnly(prev) ||
        (batch !== prev && !looksLikeAbsEntryBarcodeOnly(batch))
      if (shouldApply) {
        p.erpBatchNo = batch
        if (p.ErpBatchNo !== undefined) p.ErpBatchNo = batch
      }
    }
  }
  return body
}

export function mergeRrr1IntoProposal(proposal, rrrRows) {
  const rows = Array.isArray(rrrRows) ? rrrRows : []
  const lines = []
  for (const r of rows) {
    const item = String(rrr1Get(r, 'ItemCode') ?? '').trim()
    const qty = Number(rrr1Get(r, 'Quantity', 'Qty')) || 0
    if (!item || qty <= 0) continue
    const wh = String(
      rrr1Get(r, 'WhsCode', 'Warehouse', 'ToWhsCod', 'ToWhsCode') ?? ''
    )
      .trim()
      .toUpperCase()
      .replace(/\s/g, '')
      .slice(0, 10)
    const lineNum = Number(rrr1Get(r, 'LineNum', 'VisOrder')) || 0
    const batch = pickBatchFromRrrRow(r)
    const expYmd =
      formatExpYmd(rrr1Get(r, 'ExpDate', 'ExpDat')) ||
      (() => {
        const bn = batch
        const m = bn.match(/@(\d{6})$/) || bn.match(/@(\d{6})\b/)
        return m ? `20${m[1]}` : ''
      })()
    lines.push({
      ifIdx: String(lines.length),
      erpLineNo: lineNum,
      ifProdId: item,
      towh: wh,
      exQty: qty,
      lotNo: String(rrr1Get(r, 'LotNo', 'LotNumber') ?? '').trim(),
      expYmd: expYmd || formatExpYmd(new Date()),
      erpBatchNo: batch,
    })
  }
  if (!lines.length) return proposal
  const de = rrr1Get(rows[0], 'DocEntry')
  const erpReqNo = de != null ? String(de).trim() : ''
  const { reqList: _r, ReqList: _R, ...rest } =
    proposal && typeof proposal === 'object' ? proposal : {}
  const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  const { ymd: ymdNow, hms: hmsNow } = nowYmdHms()
  return {
    ...rest,
    apikey: proposal?.apikey || 'emdc',
    bizSeq: proposal?.bizSeq ?? 1,
    reqList: [
      {
        ifKey: proposal?.reqList?.[0]?.ifKey || `KAI-RR-${ymdNow}-${seq}`,
        returnTypeCd: 'RT01',
        centerSeq: 0,
        wmsReqNo:
          proposal?.reqList?.[0]?.wmsReqNo ||
          `KAI-RR-${ymdNow}-${seq}`,
        erpReqNo: proposal?.reqList?.[0]?.erpReqNo || erpReqNo,
        procYmd: proposal?.reqList?.[0]?.procYmd || ymdNow,
        procHms: proposal?.reqList?.[0]?.procHms || hmsNow,
        procUserId: proposal?.reqList?.[0]?.procUserId || 'KAI',
        procBundleNo: proposal?.reqList?.[0]?.procBundleNo || '',
        prodList: lines,
      },
    ],
  }
}

export function toDotNetCbp006Payload(internal) {
  const src = internal && typeof internal === 'object' ? internal : {}
  const rawApi = firstProp(src, ['apikey', 'APIKEY', 'APIKey', 'ApiKey'])
  const apiKeyVal = String(
    effectiveApiKey(rawApi) || process.env.SAP_CBP006_APIKEY || 'emdc'
  )
    .trim()
    .toLowerCase()
  const rawBiz = firstProp(src, ['bizSeq', 'BizSeq'])
  const defaultBiz = Math.max(1, parseInt(process.env.SAP_CBP006_BIZSEQ || '1', 10) || 1)
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
      IfIdx: String(def(firstProp(p, ['ifIdx', 'IfIdx']), '0')).trim(),
      ErpLineNo: Number(def(firstProp(p, ['erpLineNo', 'ErpLineNo']), 0)) || 0,
      IfProdId: String(def(firstProp(p, ['ifProdId', 'IfProdId']), '')).trim(),
      ToWh: String(def(firstProp(p, ['toWh', 'ToWh', 'towh', 'Towh']), ''))
        .trim()
        .toUpperCase(),
      ExQty: Number(def(firstProp(p, ['exQty', 'ExQty', 'procQty', 'ProcQty']), 0)) || 0,
      LotNo: String(def(firstProp(p, ['lotNo', 'LotNo']), '')).trim(),
      ExpYmd: String(def(firstProp(p, ['expYmd', 'ExpYmd']), '')).trim().slice(0, 8),
      ErpBatchNo: String(def(firstProp(p, ['erpBatchNo', 'ErpBatchNo']), '')).trim(),
    }))
    return {
      IfKey: String(def(firstProp(req, ['ifKey', 'IfKey']), '')).trim(),
      ReturnTypeCd: String(
        def(firstProp(req, ['returnTypeCd', 'ReturnTypeCd']), 'RT01')
      ).trim(),
      CenterSeq: Number(def(firstProp(req, ['centerSeq', 'CenterSeq']), 0)) || 0,
      WmsReqNo: String(def(firstProp(req, ['wmsReqNo', 'WmsReqNo']), '')).trim(),
      ErpReqNo: String(def(firstProp(req, ['erpReqNo', 'ErpReqNo']), '')).trim(),
      ProcYmd: String(def(firstProp(req, ['procYmd', 'ProcYmd']), '')).trim(),
      ProcHms: String(def(firstProp(req, ['procHms', 'ProcHms']), '')).trim(),
      ProcUserId: String(def(firstProp(req, ['procUserId', 'ProcUserId']), 'KAI')).trim(),
      ProcBundleNo: String(def(firstProp(req, ['procBundleNo', 'ProcBundleNo']), '')).trim(),
      ProdList,
    }
  })

  return {
    APIKEY: apiKeyVal,
    BizSeq: bizSeqVal,
    ReqList,
  }
}

export function applyCBP006Defaults(parsed) {
  const { ymd: ymdNow, hms: hmsNow } = nowYmdHms()
  const cleanString = (v) => {
    const s = String(v != null ? v : '').trim()
    if (!s) return ''
    if (s.toLowerCase() === 'string') return ''
    return s
  }
  const apiKey = String(
    effectiveApiKey(firstProp(parsed, ['apikey', 'APIKEY'])) ||
      process.env.SAP_CBP006_APIKEY ||
      'emdc'
  )
    .trim()
    .toLowerCase()
  const bizSeq = Math.max(1, parseInt(process.env.SAP_CBP006_BIZSEQ || '1', 10) || 1)
  const user = String(process.env.SAP_CBP006_USER || 'KAI').trim()
  const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  const defaultIfKey = `KAI-RR-${ymdNow}-${seq}`

  const reqList =
    Array.isArray(parsed?.reqList) && parsed.reqList.length
      ? parsed.reqList
      : Array.isArray(parsed?.ReqList) && parsed.ReqList.length
        ? parsed.ReqList
        : [{}]

  const normalizedReqList = reqList.map((req) => {
    const prodList =
      Array.isArray(req?.prodList) && req.prodList.length
        ? req.prodList
        : Array.isArray(req?.ProdList) && req.ProdList.length
          ? req.ProdList
          : [{}]
    const r = (key, def) => {
      const v = firstProp(req, key)
      return v != null ? v : def
    }
    const rawIfKey = cleanString(r(['ifKey', 'IfKey'], ''))
    const rawWms = cleanString(r(['wmsReqNo', 'WmsReqNo'], ''))
    const badKey = (s) =>
      !s ||
      s === '고유키' ||
      s === 'WMS요청번호' ||
      /^WMS/i.test(s) && /요청번호$/.test(s)
    return {
      ifKey: badKey(rawIfKey) ? defaultIfKey : rawIfKey,
      returnTypeCd: cleanString(r(['returnTypeCd', 'ReturnTypeCd'], 'RT01')) || 'RT01',
      centerSeq: Number(r(['centerSeq', 'CenterSeq'], 0)) || 0,
      wmsReqNo: badKey(rawWms) ? defaultIfKey : rawWms,
      erpReqNo: cleanString(r(['erpReqNo', 'ErpReqNo'], '')),
      procYmd: coerceProcYmd(r(['procYmd', 'ProcYmd']), ymdNow),
      procHms: coerceProcHms(r(['procHms', 'ProcHms']), hmsNow),
      procUserId: cleanString(r(['procUserId', 'ProcUserId'], user)) || user,
      procBundleNo: cleanString(r(['procBundleNo', 'ProcBundleNo'], '')),
      prodList: prodList.map((p) => {
        const pv = (keys, def) =>
          firstProp(p, keys) != null ? firstProp(p, keys) : def
        const expYmdRaw = cleanString(pv(['expYmd', 'ExpYmd'], ''))
        const expYmdCoerced = coerceProcYmd(
          expYmdRaw,
          (() => {
            const bn = cleanString(pv(['erpBatchNo', 'ErpBatchNo'], ''))
            const m = bn.match(/@(\d{6})$/) || bn.match(/@(\d{6})\b/)
            return m ? `20${m[1]}` : ymdNow
          })()
        )
        return {
          ifIdx: cleanString(pv(['ifIdx', 'IfIdx'], '0')),
          erpLineNo: Number(pv(['erpLineNo', 'ErpLineNo'], 0)) || 0,
          ifProdId: cleanString(pv(['ifProdId', 'IfProdId'], '')),
          towh: cleanString(pv(['towh', 'Towh', 'toWh', 'ToWh'], '')).toUpperCase(),
          exQty: Number(pv(['exQty', 'ExQty', 'procQty', 'ProcQty'], 0)) || 0,
          lotNo: cleanString(pv(['lotNo', 'LotNo'], '')),
          expYmd: expYmdCoerced,
          erpBatchNo: cleanString(pv(['erpBatchNo', 'ErpBatchNo'], '')),
        }
      }),
    }
  })

  const parsedBiz = parsed && (parsed.bizSeq != null ? parsed.bizSeq : parsed.BizSeq)
  return {
    apikey: apiKey,
    bizSeq: Number(parsedBiz != null ? parsedBiz : bizSeq) || bizSeq,
    reqList: normalizedReqList,
  }
}

export function tryParseCBP006RequestFromInstruction(instruction) {
  const s = String(instruction || '').trim()
  if (!s) return null
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  const raw = s.slice(first, last + 1)
  try {
    const obj = JSON.parse(raw)
    const list =
      obj && obj.reqList != null
        ? obj.reqList
        : obj && obj.ReqList != null
          ? obj.ReqList
          : null
    if (!obj || !Array.isArray(list)) return null
    return { ...obj, reqList: list }
  } catch (_) {
    return null
  }
}

export function normalizeCBP006Request(req) {
  return applyCBP006Defaults(req)
}

function formatReturnTransportPayload(instruction, proposal) {
  const batchNo = extractBatchNo(instruction)
  const ymd = extractProcYmd(instruction)
  const hms = extractProcHms(instruction)
  const out = applyCBP006Defaults(proposal)
  const { ymd: ymdNow, hms: hmsNow } = nowYmdHms()
  if (out.reqList?.[0]) {
    const h0 = out.reqList[0]
    h0.procYmd = coerceProcYmd(ymd || h0.procYmd, ymdNow)
    h0.procHms = coerceProcHms(hms || h0.procHms, hmsNow)
    if (h0.prodList?.[0]) {
      const p0 = h0.prodList[0]
      p0.expYmd = coerceProcYmd(p0.expYmd, h0.procYmd)
    }
    if (batchNo && h0.prodList?.[0]) {
      h0.prodList[0].erpBatchNo = batchNo || h0.prodList[0].erpBatchNo
    }
  }
  return out
}

export function buildReturnRequestBody(instruction, proposal) {
  return formatReturnTransportPayload(instruction, proposal)
}

export async function generateReturnProcessingProposal(instruction, apiKey) {
  const { ymd: ymdNow, hms: hmsNow } = nowYmdHms()
  const system = `반품마감(CBP006) Swagger 요청 JSON만 출력. 일반반품 RT01.

반드시 반환할 형식(camelCase):
{
  "apikey":"emdc",
  "bizSeq":1,
  "reqList":[
    {
      "ifKey":"고유키",
      "returnTypeCd":"RT01",
      "centerSeq":0,
      "wmsReqNo":"WMS요청번호",
      "erpReqNo":"반품요청 ORRR DocEntry 숫자 문자열",
      "procYmd":"20260331",
      "procHms":"143000",
      "procUserId":"KAI",
      "procBundleNo":"",
      "prodList":[
        {
          "ifIdx":"0",
          "erpLineNo":0,
          "ifProdId":"품목코드",
          "towh":"입고창고코드",
          "exQty":1,
          "lotNo":"",
          "expYmd":"20260331",
          "erpBatchNo":"배치"
        }
      ]
    }
  ]
}

규칙:
1) JSON만 출력.
2) erpReqNo는 사용자가 준 반품요청 DocEntry.
3) prodList는 반품요청 라인에 맞게 채움. erpLineNo는 SAP 라인번호(0부터).
4) procYmd·procHms·expYmd는 반드시 숫자만(각각 8자리·6자리·8자리). "YYYYMMDD" 같은 글자는 넣지 말 것.
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
        { role: 'user', content: `반품마감 요청:\n${instruction}` },
      ],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI 오류 ${res.status}: ${err.slice(0, 200)}`)
  }
  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  const parsed = typeof content === 'string' ? JSON.parse(content) : content
  return parsed
}

function tlsInsecureEnabled() {
  return (
    String(process.env.SAP_CBP006_TLS_INSECURE || process.env.SAP_INBOUND_PROCESS_TLS_INSECURE || '')
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

export async function postReturnProcessing(postUrl, user, pass, payload) {
  const urls = cbp006UrlCandidates(postUrl)
  if (!urls.length) {
    return { ok: false, status: 0, body: 'URL 없음', docNo: null, usedUrl: null }
  }
  const { user: u, pass: p } = resolveSapCredentials(user, pass)
  const auth = Buffer.from(`${u}:${p}`, 'utf8').toString('base64')
  const perTryMs = Math.min(
    Math.max(Number(process.env.SAP_CBP006_TRY_TIMEOUT_MS) || 20000, 5000),
    180000
  )
  const bodyStr = JSON.stringify(toDotNetCbp006Payload(payload))

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
          'X-KAI-Source': 'kai-return-processing',
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
      const httpResult =
        parsed?.HttpResult != null ? parsed.HttpResult : parsed?.httpResult
      const resultList = Array.isArray(parsed?.ResultList)
        ? parsed.ResultList
        : Array.isArray(parsed?.resultList)
          ? parsed.resultList
          : []
      const firstResult = resultList[0] || null
      const itemResult =
        firstResult &&
        (firstResult.Result != null ? firstResult.Result : firstResult.result)
      const itemMessage =
        firstResult &&
        (firstResult.Message != null ? firstResult.Message : firstResult.message)
      const docNo =
        firstResult &&
        (firstResult.ProcBundleNo ||
          firstResult.procBundleNo ||
          firstResult.IfKey ||
          firstResult.ifKey)
      const itemRes = String(
        firstResult?.Result ?? firstResult?.result ?? ''
      ).toUpperCase()
      const httpBad = String(httpResult ?? '').toUpperCase() === 'E'
      /** CBP006: ResultList[0].Result === 'S' 가 실제 반품(ORDN) 성공 */
      const ok =
        res.ok &&
        !httpBad &&
        itemRes === 'S'

      if (ok) {
        return {
          ok: true,
          status: res.status,
          body: text.slice(0, 4000),
          docNo: docNo || null,
          resultMessage: itemMessage,
          usedUrl: url,
        }
      }
      attempts.push(`POST ${url} → HTTP ${res.status}`)
      const errDetailBase =
        itemRes === 'E' || httpBad
          ? [itemMessage, parsed?.HttpMessage || parsed?.httpMessage]
              .filter(Boolean)
              .join(' — ') || text.slice(0, 800)
          : text.slice(0, 4000)
      const errDetail =
        String(errDetailBase || '').trim() ||
        `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''} (본문 없음)`
      const errDetailWithHint = enrichHttpErrorHint(res.status, errDetail, url)

      if (res.ok) {
        return {
          ok: false,
          status: res.status,
          body: errDetailWithHint,
          docNo: null,
          resultMessage: itemMessage,
          usedUrl: url,
          attempts: attempts.join('\n'),
        }
      }

      if (httpStatusShouldTryNextUrl(res.status) && i < urls.length - 1) {
        continue
      }

      return {
        ok: false,
        status: res.status,
        body: errDetailWithHint,
        docNo: null,
        resultMessage: itemMessage,
        usedUrl: url,
        attempts: attempts.join('\n'),
      }
    } catch (e) {
      clearTimeout(t)
      const detail = formatFetchError(e)
      attempts.push(`${url}: ${detail}`)
      const retry = !isRetryableNetworkError(e) ? false : i < urls.length - 1
      if (retry) continue
      return { ok: false, status: 0, body: `${detail}`, docNo: null, attempts: attempts.join('\n') }
    }
  }
  return { ok: false, status: 0, body: attempts.join('\n'), docNo: null }
}
