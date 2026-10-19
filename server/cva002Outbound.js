import { normalizeHttpUrl } from './stockTransfer.js'
import { resolveSapCredentials } from './sapContext.js'
import {
  CVA002_LEGACY_OB_CODES,
  CVA002_OUTBIZ_OWtq_U_LINETYPE_CODES,
  defaultEtcOutbizCode,
  fillEtcOutbizTypeCdWhenEmpty,
  isEtcOutbizOwtqCode,
} from './cva002EtcCodes.js'

export { CVA002_LEGACY_OB_CODES, CVA002_OUTBIZ_OWtq_U_LINETYPE_CODES }

/**
 * 출하처리 CVA002 — ODLN(ORDR) / OWTR(OWTQ) / OIGE(OWTQ+EtcOutbizTypeCd 등)
 * add/Models/CVA002.cs · Controllers/CVA002.cs 와 동일 본문(PascalCase APIKEY)
 *
 * **기타출하** = ZSM108 **O-*** 출고 코드(예: O-900 기타출고) 또는 레거시 **OB91/OB93** 등 (`isEtcOutbizOwtqCode`).
 * `EtcOutbizTypeCd` 로 U_LineType·계정 분기. **I-201** 은 ZSM108 소분입고(입고) 유형 — CVA002 `I-201` 분기는 가격리스트 처리용.
 * - `erpReqTypCd` 가 비어 있으면 `OWTQ` 로 보완.
 * - `etcOutbizTypeCd` 가 비어 있으면: **기타출고**(레거시 OB·기본 O-900)는 `defaultEtcOutbizCode()`(기본 **O-900**), 그 외 `O-*` 는 Outbiz 와 동일(OWTQ+Etc 빈값이면 OWTR로 잘못 가는 것 방지).
 * - 재고이전만(OWTR)일 때는 `etcOutbizTypeCd` 를 비움(CVA002: OWTQ && Etc 빈값 → OWTR).
 *
 * **기타출고(OIGE) 예:** `outbizTypeCd` **OB91** + `etcOutbizTypeCd` **O-101** 등 ZSM108 `O-*` (출고 유형이 Outbiz와 다를 수 있음; `prodList` 다중 라인 가능).
 */
/** @deprecated 내부적으로 `isEtcOutbizOwtqCode` 사용 */
function isOutbizOwtqLineTypeCode(outbizTypeCd) {
  return isEtcOutbizOwtqCode(outbizTypeCd)
}

function defaultEtcOutboundOutbizCode() {
  return defaultEtcOutbizCode()
}

function isEtcOutboundNameText(t) {
  return /기타\s*출고|기타출고|기타\s*출하|기타출하/i.test(String(t || ''))
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

function nowYmdHms() {
  const now = new Date()
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '').slice(0, 8)
  const hms =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')
  return { ymd, hms }
}

function cleanString(v) {
  const s = String(v != null ? v : '').trim()
  if (!s) return ''
  if (s.toLowerCase() === 'string') return ''
  return s
}

/**
 * 내부(camelCase 혼용) → C# CVA002 역직렬화용 PascalCase
 */
export function toDotNetCva002Payload(internal) {
  const src = internal && typeof internal === 'object' ? internal : {}
  const rawApi = firstProp(src, [
    'apikey',
    'APIKEY',
    'APIKey',
    'ApiKey',
  ])
  const apiKeyVal = String(
    effectiveApiKey(rawApi) || process.env.SAP_CVA002_APIKEY || 'emdc'
  )
    .trim()
    .toLowerCase()
  const rawBiz = firstProp(src, ['bizSeq', 'BizSeq'])
  const defaultBiz = Math.max(1, parseInt(process.env.SAP_CVA002_BIZSEQ || '1', 10) || 1)
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
      FrWh: String(def(firstProp(p, ['frWh', 'FrWh']), '')).trim(),
      ExQty: Number(def(firstProp(p, ['exQty', 'ExQty', 'procQty', 'ProcQty']), 0)) || 0,
      ExpYmd: String(def(firstProp(p, ['expYmd', 'ExpYmd']), '')).trim(),
      LotNo: String(def(firstProp(p, ['lotNo', 'LotNo']), '')).trim(),
      ErpBatchNo: String(def(firstProp(p, ['erpBatchNo', 'ErpBatchNo']), '')).trim(),
    }))
    return {
      IfKey: String(def(firstProp(req, ['ifKey', 'IfKey']), '')).trim(),
      OutbizTypeCd: String(def(firstProp(req, ['outbizTypeCd', 'OutbizTypeCd']), '')).trim(),
      ProcBundleNo: String(def(firstProp(req, ['procBundleNo', 'ProcBundleNo']), '')).trim(),
      CenterSeq: Number(def(firstProp(req, ['centerSeq', 'CenterSeq']), 0)) || 0,
      WmsReqNo: String(def(firstProp(req, ['wmsReqNo', 'WmsReqNo']), '')).trim(),
      ErpReqTypCd: String(def(firstProp(req, ['erpReqTypCd', 'ErpReqTypCd']), '')).trim(),
      ErpReqNo: String(def(firstProp(req, ['erpReqNo', 'ErpReqNo']), '')).trim(),
      ErpPickingNo: String(def(firstProp(req, ['erpPickingNo', 'ErpPickingNo']), '')).trim(),
      EtcOutbizTypeCd: String(
        def(firstProp(req, ['etcOutbizTypeCd', 'EtcOutbizTypeCd']), '')
      ).trim(),
      ProcYmd: String(def(firstProp(req, ['procYmd', 'ProcYmd']), '')).trim(),
      ProcHms: String(def(firstProp(req, ['procHms', 'ProcHms']), '')).trim(),
      ProcUserId: String(def(firstProp(req, ['procUserId', 'ProcUserId']), '')).trim(),
      ProdList,
    }
  })

  return {
    APIKEY: apiKeyVal,
    BizSeq: bizSeqVal,
    ReqList,
  }
}

export function applyCva002Defaults(parsed) {
  const { ymd: ymdNow, hms: hmsNow } = nowYmdHms()
  const parsedApi = firstProp(parsed, [
    'apikey',
    'APIKEY',
    'APIKey',
    'ApiKey',
  ])
  const apiKey = String(
    effectiveApiKey(parsedApi) || process.env.SAP_CVA002_APIKEY || 'emdc'
  )
    .trim()
    .toLowerCase()
  const bizSeq = Math.max(
    1,
    parseInt(process.env.SAP_CVA002_BIZSEQ || '1', 10) || 1
  )
  const user = String(process.env.SAP_CVA002_USER || 'KAI').trim()

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
    let outbizTypeCd = cleanString(r(['outbizTypeCd', 'OutbizTypeCd'], ''))
    if (isEtcOutboundNameText(outbizTypeCd)) {
      outbizTypeCd = defaultEtcOutboundOutbizCode()
    }
    let erpReqTypCd = cleanString(r(['erpReqTypCd', 'ErpReqTypCd'], ''))
    if (!erpReqTypCd && isOutbizOwtqLineTypeCode(outbizTypeCd)) {
      erpReqTypCd = 'OWTQ'
    }
    /** OB91/OB93 + ORDR 동시 지정은 납품(ODLN)으로 잘못 전송되므로 OWTQ로 교정 */
    if (
      isOutbizOwtqLineTypeCode(outbizTypeCd) &&
      String(erpReqTypCd).toUpperCase() === 'ORDR'
    ) {
      erpReqTypCd = 'OWTQ'
    }
    let etcOutbizTypeCd = cleanString(r(['etcOutbizTypeCd', 'EtcOutbizTypeCd'], ''))
    /**
     * C# CVA002: OWTQ + Etc 빈값 → OWTR, OWTQ + Etc 있음 → OIGE(기타출하).
     * 기타출고(OB91·93 등)는 Etc에 **O-900**(`fillEtcOutbizTypeCdWhenEmpty`).
     */
    etcOutbizTypeCd = fillEtcOutbizTypeCdWhenEmpty(outbizTypeCd, etcOutbizTypeCd)
    return {
      ifKey: cleanString(r(['ifKey', 'IfKey'], '')),
      outbizTypeCd,
      procBundleNo: cleanString(r(['procBundleNo', 'ProcBundleNo'], '')),
      centerSeq: Number(r(['centerSeq', 'CenterSeq'], 0)) || 0,
      wmsReqNo: cleanString(r(['wmsReqNo', 'WmsReqNo'], '')),
      erpReqTypCd,
      erpReqNo: cleanString(r(['erpReqNo', 'ErpReqNo'], '')),
      erpPickingNo: cleanString(r(['erpPickingNo', 'ErpPickingNo'], '')),
      etcOutbizTypeCd,
      procYmd: cleanString(String(r(['procYmd', 'ProcYmd'], ''))) || ymdNow,
      procHms: cleanString(String(r(['procHms', 'ProcHms'], ''))) || hmsNow,
      procUserId: cleanString(r(['procUserId', 'ProcUserId'], user)) || user,
      prodList: prodList.map((p) => {
        const pv = (keys, def) =>
          firstProp(p, keys) != null ? firstProp(p, keys) : def
        return {
          ifIdx: cleanString(pv(['ifIdx', 'IfIdx'], '')),
          erpLineNo: Number(pv(['erpLineNo', 'ErpLineNo'], 0)) || 0,
          ifProdId: cleanString(pv(['ifProdId', 'IfProdId'], '')),
          frWh: cleanString(pv(['frWh', 'FrWh'], '')),
          exQty: Number(pv(['exQty', 'ExQty', 'procQty', 'ProcQty'], 0)) || 0,
          expYmd: cleanString(pv(['expYmd', 'ExpYmd'], '')),
          lotNo: cleanString(pv(['lotNo', 'LotNo'], '')),
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

/**
 * instruction 에 CVA002 JSON 이 붙어 있으면 파싱 (reqList 필수)
 */
export function tryParseCva002RequestFromInstruction(instruction) {
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
  } catch {
    return null
  }
}

/** CVA002 본문인지: ORDR/OWTQ/OIGE 분기 필드가 있거나 질문에 CVA002 명시 */
export function isCva002OutboundPayloadQuestion(q, parsed) {
  const s = String(q || '')
  if (/CVA002/i.test(s)) return true
  if (!parsed || !Array.isArray(parsed.reqList) || !parsed.reqList.length) return false
  const h = parsed.reqList[0]
  if (!h || typeof h !== 'object') return false
  const typ = String(h.erpReqTypCd ?? h.ErpReqTypCd ?? '').trim()
  if (typ) return true
  if (h.outbizTypeCd != null && String(h.outbizTypeCd).trim()) return true
  if (h.OutbizTypeCd != null && String(h.OutbizTypeCd).trim()) return true
  return false
}

/**
 * 자연어 출하처리 초안 — ORDR(납품) 또는 OWTQ+OB91/93(기타출하)
 * - "판매오더 1234 …" → 번호는 ORDR 기준(출하유형에 따라 OWTQ)
 * - "재고이전요청 70200 …" / "OWTQ 70200 …" → 번호는 **재고이전요청 DocEntry** → 항상 `erpReqTypCd: OWTQ`
 * - 판매유형 **O-900·OB91** 등 또는 문구 **기타출고·기타출하** → 기타출고(OIGE) = `erpReqTypCd: OWTQ`, Outbiz는 없으면 `KAI_CVA002_DEFAULT_ETC_OUTBIZ`(기본 O-900)
 * (JSON 본문이 없을 때만 호출; `자료없음` 등 꼬리 문구는 무시)
 */
export function parseOrdrOutboundCva002Instruction(q) {
  let s = String(q || '')
    .trim()
    .replace(/\s*,\s*자료\s*없음\s*$/i, '')
    .trim()
  if (!s) return null
  if (!/출하\s*처리|출하처리/i.test(s)) return null

  const hasEtcOutboundName = isEtcOutboundNameText(s)

  const mOwtqPhrase =
    s.match(/재고\s*이전\s*요청\s*[:#]?\s*(\d{4,10})/i) ||
    s.match(/(?:^|\s)재고이전요청\s+(\d{4,10})/i) ||
    s.match(/\bOWTQ\s+(\d{4,10})\b/i)
  const mOrd =
    s.match(/판매\s*오더\s*[:#]?\s*(\d{4,10})/i) ||
    s.match(/(?:^|\s)판매오더\s+(\d{4,10})/i) ||
    s.match(/(?:ORDR|판매)\s+(\d{4,10})/i)

  let erpReqNo = null
  let fromOwtqKeyword = false
  if (mOwtqPhrase) {
    erpReqNo = mOwtqPhrase[1]
    fromOwtqKeyword = true
  } else if (mOrd) {
    erpReqNo = mOrd[1]
  } else {
    const mDocNo = s.match(/문서\s*번호\s*[:：#]?\s*(\d{4,10})/i)
    const mDe = s.match(/\bDocEntry\s*[:：#]?\s*(\d{4,10})/i)
    const owtqCtx =
      /재고\s*이전\s*요청|재고이전요청|\bOWTQ\b/i.test(s)
    if (owtqCtx && (mDocNo || mDe)) {
      erpReqNo = (mDocNo || mDe)[1]
      fromOwtqKeyword = true
    } else {
      return null
    }
  }

  let outbiz = ''
  const mObToken = s.match(/\b(O-\d{2,4}|OB\d{2,4})\b/i)
  const mPu = s.match(/판매\s*유형\s*[:#]?\s*(\S+)/i)
  if (mObToken) {
    outbiz = String(mObToken[1]).trim().toUpperCase()
  } else if (mPu) {
    const pv = String(mPu[1]).trim()
    if (isEtcOutboundNameText(pv)) {
      outbiz = defaultEtcOutboundOutbizCode()
    } else if (/^O-\d{2,4}$/i.test(pv) || /^OB\d{2,4}$/i.test(pv)) {
      outbiz = pv.toUpperCase()
    }
  }
  if (hasEtcOutboundName && !isOutbizOwtqLineTypeCode(outbiz)) {
    outbiz = defaultEtcOutboundOutbizCode()
  }

  const oige = isOutbizOwtqLineTypeCode(outbiz)
  const erpReqTypCd = fromOwtqKeyword ? 'OWTQ' : oige ? 'OWTQ' : 'ORDR'

  return {
    erpReqNo,
    outbizTypeCd: outbiz || undefined,
    erpReqTypCd,
  }
}

export function buildCva002OrdrDraft(hint) {
  const { ymd, hms } = nowYmdHms()
  const de = String(hint.erpReqNo)
  const typ = String(hint.erpReqTypCd || 'ORDR').toUpperCase()
  const isOwtq = typ === 'OWTQ'
  const keyPrefix = isOwtq ? 'OWTQ' : 'ORDR'
  return {
    reqList: [
      {
        ifKey: `KAI-${keyPrefix}-${de}-${ymd}`,
        outbizTypeCd: hint.outbizTypeCd ? String(hint.outbizTypeCd).trim() : '',
        procBundleNo: '',
        centerSeq: 0,
        wmsReqNo: de,
        erpReqTypCd: isOwtq ? 'OWTQ' : 'ORDR',
        erpReqNo: de,
        erpPickingNo: '',
        etcOutbizTypeCd: '',
        procYmd: ymd,
        procHms: hms,
        procUserId: String(process.env.SAP_CVA002_USER || 'KAI').trim(),
        prodList: [],
      },
    ],
  }
}

/** WTQ1 행 → CVA002 prodList (OWTQ·기타출하 OIGE용) */
export function mergeWtq1RowsIntoCva002Draft(draft, rows) {
  if (!draft?.reqList?.[0] || !Array.isArray(rows)) return draft
  const prodList = rows
    .map((r, idx) => {
      const lineNum = Number(r.LineNum ?? r.lineNum ?? idx) || 0
      const item = String(r.ItemCode ?? r.itemCode ?? '').trim()
      const whs = String(
        r.FromWhsCod ??
          r.FromWhsCode ??
          r.WhsCode ??
          r.FromWhs ??
          r.fromWhsCod ??
          ''
      ).trim()
      const qty = Number(
        r.Quantity ?? r.quantity ?? r.OpenQty ?? r.openQty ?? 0
      )
      const batchFromRow = String(
        r.VBatchNum ??
          r.vBatchNum ??
          r.BatchNum ??
          r.batchNum ??
          r.DistNumber ??
          r.distNumber ??
          ''
      ).trim()
      return {
        ifIdx: String(idx),
        erpLineNo: lineNum,
        ifProdId: item,
        frWh: whs,
        exQty: Math.max(0, Math.floor(Number(qty) || 0)),
        expYmd: '',
        lotNo: '',
        erpBatchNo: batchFromRow,
      }
    })
    .filter((p) => p.ifProdId && p.exQty > 0)
  draft.reqList[0].prodList = prodList
  return draft
}

/** SQL RDR1 행 → CVA002 prodList (OpenQty 우선, 없으면 Quantity) */
export function mergeRdr1RowsIntoCva002Draft(draft, rows) {
  if (!draft?.reqList?.[0] || !Array.isArray(rows)) return draft
  const prodList = rows
    .map((r, idx) => {
      const lineNum = Number(r.LineNum ?? r.lineNum ?? idx) || 0
      const item = String(r.ItemCode ?? r.itemCode ?? '').trim()
      const whs = String(
        r.WhsCode ?? r.WhsCod ?? r.FromWhsCod ?? r.fromWhsCod ?? ''
      ).trim()
      const openQ = Number(r.OpenQty ?? r.openQty)
      const qty = Number(r.Quantity ?? r.quantity ?? r.InvQty ?? r.invQty ?? 0)
      const ex =
        Number.isFinite(openQ) && openQ > 0 ? openQ : qty
      const batchFromRow = String(
        r.VBatchNum ??
          r.vBatchNum ??
          r.BatchNum ??
          r.batchNum ??
          r.DistNumber ??
          r.distNumber ??
          ''
      ).trim()
      return {
        ifIdx: String(idx),
        erpLineNo: lineNum,
        ifProdId: item,
        frWh: whs,
        exQty: Math.max(0, Math.floor(Number(ex) || 0)),
        expYmd: '',
        lotNo: '',
        erpBatchNo: batchFromRow,
      }
    })
    .filter((p) => p.ifProdId && p.exQty > 0)
  draft.reqList[0].prodList = prodList
  return draft
}

/** CVA002 전송 전 — 품목·수량이 한 줄이라도 있어야 함(ORDR·OWTQ 공통) */
export function cva002ReqHasRunnableProdList(normalized) {
  const pl = normalized?.reqList?.[0]?.prodList
  if (!Array.isArray(pl)) return false
  return pl.some(
    (p) => String(p.ifProdId ?? p.IfProdId ?? '').trim() && Number(p.exQty ?? p.ExQty ?? 0) > 0
  )
}

function formatFetchError(e) {
  const c = e?.cause
  if (c && typeof c === 'object') {
    const code = c.code || c.errno || ''
    const msg = c.message || ''
    const port = c.port ? `:${c.port}` : ''
    const addr = c.address || c.hostname || ''
    if (code || addr) return `${code || 'NETWORK'} ${addr}${port} — ${msg || e.message}`.trim()
  }
  if (e?.code) return `${e.code}: ${e.message}`
  return String(e?.message || e)
}

/** fetch `AbortSignal` 타임아웃 등 — 사용자에게 흔한 `20: This operation was aborted` 안내 */
function appendCva002AbortHint(e, perTryMs) {
  const msg = String(e?.message || '')
  const aborted =
    e?.name === 'AbortError' ||
    /aborted/i.test(msg) ||
    String(e?.code) === '20' ||
    String(e?.cause?.code || '') === 'UND_ERR_ABORTED'
  if (!aborted) return ''
  return (
    ` — (요청 중단·타임아웃 ${perTryMs}ms 가능) \`SAP_CVA002_TRY_TIMEOUT_MS\` 증가, WMS 기동·\`SAP_CVA002_URL\` 확인, 로컬 HTTPS는 \`SAP_CVA002_TLS_INSECURE=true\``
  )
}

/**
 * @param {object} internal - applyCva002Defaults 결과(camelCase)
 */
export async function postCva002(postUrl, user, pass, internal) {
  const url = normalizeHttpUrl(postUrl)
  if (!url) {
    return {
      ok: false,
      status: 0,
      body: 'URL 없음',
      docNo: null,
      usedUrl: null,
      requestBody: null,
    }
  }
  const payload = toDotNetCva002Payload(internal)
  const { user: u, pass: p } = resolveSapCredentials(user, pass)
  const auth = Buffer.from(`${u}:${p}`, 'utf8').toString('base64')
  const perTryMs = Math.min(
    Math.max(Number(process.env.SAP_CVA002_TRY_TIMEOUT_MS) || 30000, 5000),
    180000
  )
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), perTryMs)
  const tlsInsecure =
    String(process.env.SAP_CVA002_TLS_INSECURE || '').trim().toLowerCase() === 'true'
  let dispatcher
  if (tlsInsecure) {
    if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    }
    try {
      const { Agent } = await import('undici')
      dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
    } catch (_) {}
  }
  try {
    const opts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain;q=0.9',
        Authorization: `Basic ${auth}`,
        'X-KAI-Source': 'kai-cva002',
      },
      body: JSON.stringify(payload),
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
    const resultList = parsed?.ResultList ?? parsed?.resultList
    const list = Array.isArray(resultList) ? resultList : []
    const httpResult = String(parsed?.HttpResult ?? parsed?.httpResult ?? '')
      .trim()
      .toUpperCase()
    const allLineSuccess =
      list.length > 0 &&
      list.every((r) => String(r?.Result ?? r?.result ?? '').toUpperCase() === 'S')
    /** CVA002는 일부 오류 경로에서 HttpResult만 S이고 ResultList는 E인 경우가 있어 행 단위로 판정 */
    const ok = res.ok && httpResult !== 'E' && allLineSuccess
    if (ok) {
      const firstResult = list[0]
      return {
        ok: true,
        status: res.status,
        body: text.slice(0, 4000),
        docNo:
          firstResult?.ProcBundleNo ||
          firstResult?.procBundleNo ||
          firstResult?.IfKey ||
          firstResult?.ifKey ||
          null,
        usedUrl: url,
        requestBody: payload,
      }
    }
    const firstResult = list[0]
    const listMsgs = list
      .map(
        (r) =>
          String(r?.Message ?? r?.message ?? '')
            .trim()
      )
      .filter(Boolean)
    const errMsg =
      listMsgs.join(' | ') ||
      firstResult?.Message ||
      firstResult?.message ||
      parsed?.HttpMessage ||
      parsed?.httpMessage ||
      text.slice(0, 800)
    return {
      ok: false,
      status: res.status,
      body: String(errMsg),
      docNo: null,
      usedUrl: url,
      requestBody: payload,
    }
  } catch (e) {
    clearTimeout(t)
    const body =
      formatFetchError(e) + appendCva002AbortHint(e, perTryMs)
    return {
      ok: false,
      status: 0,
      body,
      docNo: null,
      usedUrl: url,
      requestBody: toDotNetCva002Payload(internal),
    }
  }
}
