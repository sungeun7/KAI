/**
 * 출하처리 취소 CVA003 — ODLN(ORDR) / OWTR(OWTQ) / OIGE→OIGN
 * add/Controllers/CVA003.cs · Models/CVA003.cs 와 동일 본문(PascalCase APIKEY)
 */
import { normalizeHttpUrl } from './stockTransfer.js'
import { resolveSapCredentials } from './sapContext.js'

function firstProp(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) {
    if (
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] !== undefined &&
      obj[k] !== null
    ) {
      return obj[k]
    }
  }
  return undefined
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

function formatFetchError(e) {
  if (e && typeof e === 'object') {
    const c = e.cause || e
    const code = c.code || c.errno
    const msg = c.message || ''
    const port = c.port ? `:${c.port}` : ''
    const addr = c.address || c.hostname || ''
    if (code || addr) return `${code || 'NETWORK'} ${addr}${port} — ${msg || e.message}`.trim()
  }
  if (e?.code) return `${e.code}: ${e.message}`
  return String(e?.message || e)
}

/**
 * 내부(camelCase) → C# CVA003 역직렬화용 PascalCase
 */
export function toDotNetCva003Payload(internal) {
  const src = internal && typeof internal === 'object' ? internal : {}
  const rawApi = firstProp(src, ['apikey', 'APIKEY', 'APIKey', 'ApiKey'])
  const apiKeyVal = String(
    rawApi || process.env.SAP_CVA003_APIKEY || process.env.SAP_CVA002_APIKEY || 'emdc'
  )
    .trim()
    .toLowerCase()
  const rawBiz = firstProp(src, ['bizSeq', 'BizSeq'])
  const defaultBiz = Math.max(
    1,
    parseInt(process.env.SAP_CVA003_BIZSEQ || process.env.SAP_CVA002_BIZSEQ || '1', 10) ||
      1
  )
  const bizSeqVal = Number(rawBiz != null ? rawBiz : defaultBiz) || defaultBiz

  const reqListRaw = Array.isArray(src.reqList)
    ? src.reqList
    : Array.isArray(src.ReqList)
      ? src.ReqList
      : []

  const ReqList = reqListRaw.map((req) => {
    const def = (val, d) => (val != null ? val : d)
    const prodSrc = Array.isArray(req?.prodList)
      ? req.prodList
      : Array.isArray(req?.ProdList)
        ? req.ProdList
        : []
    const ProdList = prodSrc.map((p) => ({
      IfIdx: String(def(firstProp(p, ['ifIdx', 'IfIdx']), '0')).trim(),
      ErpLineNo: Number(def(firstProp(p, ['erpLineNo', 'ErpLineNo']), 0)) || 0,
      IfProdId: String(def(firstProp(p, ['ifProdId', 'IfProdId']), '')).trim(),
      ExQty: Number(def(firstProp(p, ['exQty', 'ExQty']), 0)) || 0,
      LotNo: String(def(firstProp(p, ['lotNo', 'LotNo']), '')).trim(),
      ErpBatchNo: String(def(firstProp(p, ['erpBatchNo', 'ErpBatchNo']), '')).trim(),
    }))
    return {
      IfKey: String(def(firstProp(req, ['ifKey', 'IfKey']), '')).trim(),
      OutbizTypeCd: String(def(firstProp(req, ['outbizTypeCd', 'OutbizTypeCd']), '')).trim(),
      ProcBundleNo: String(def(firstProp(req, ['procBundleNo', 'ProcBundleNo']), '')).trim(),
      CenterSeq: Number(def(firstProp(req, ['centerSeq', 'CenterSeq']), 1)) || 1,
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

/**
 * ORDR 경로 납품(ODLN) 취소용 최소 본문 — CVA003 `ErpReqTypCd == "ORDR"`
 */
export function buildCva003OrdrDeliveryCancelDraft(opts) {
  const { ymd, hms } = nowYmdHms()
  const erpReqNo = String(opts?.erpReqNo ?? '').trim()
  const wmsReqNo = String(opts?.wmsReqNo ?? '').trim()
  const procBundleNo = String(opts?.procBundleNo ?? '').trim()
  const procYmd = String(opts?.procYmd ?? ymd).replace(/\D/g, '').slice(0, 8) || ymd
  const procHms = String(opts?.procHms ?? hms).replace(/\D/g, '').slice(0, 6) || hms
  return {
    apikey: process.env.SAP_CVA003_APIKEY || process.env.SAP_CVA002_APIKEY || 'emdc',
    bizSeq: Math.max(
      1,
      parseInt(process.env.SAP_CVA003_BIZSEQ || process.env.SAP_CVA002_BIZSEQ || '1', 10) ||
        1
    ),
    reqList: [
      {
        ifKey: String(opts?.ifKey ?? `KAI-CVA003-${erpReqNo}-${procYmd}`).trim(),
        outbizTypeCd: String(opts?.outbizTypeCd ?? 'OB01').trim(),
        centerSeq: Number(opts?.centerSeq) > 0 ? Number(opts.centerSeq) : 1,
        wmsReqNo,
        erpReqTypCd: 'ORDR',
        erpReqNo,
        erpPickingNo: String(opts?.erpPickingNo ?? '').trim(),
        etcOutbizTypeCd: '',
        procYmd,
        procHms,
        procUserId: String(
          opts?.procUserId || process.env.SAP_CVA003_USER || process.env.SAP_CVA002_USER || 'KAI'
        ).trim(),
        procBundleNo,
        prodList: [],
      },
    ],
  }
}

function appendCva003AbortHint(e, perTryMs) {
  const msg = String(e?.message || '')
  const aborted =
    e?.name === 'AbortError' ||
    /aborted/i.test(msg) ||
    String(e?.code) === '20' ||
    String(e?.cause?.code || '') === 'UND_ERR_ABORTED'
  if (!aborted) return ''
  return ` — (타임아웃 ${perTryMs}ms) \`SAP_CVA003_TRY_TIMEOUT_MS\`·\`SAP_CVA003_URL\`·\`SAP_CVA003_TLS_INSECURE\` 확인`
}

/**
 * @param {string} postUrl — 예: https://host/CVA003
 * @param {object} internal — buildCva003OrdrDeliveryCancelDraft 결과 등
 */
export async function postCva003(postUrl, user, pass, internal) {
  const url = normalizeHttpUrl(postUrl)
  if (!url) {
    return {
      ok: false,
      status: 0,
      body: 'URL 없음',
      usedUrl: null,
      requestBody: null,
    }
  }
  const payload = toDotNetCva003Payload(internal)
  const { user: u, pass: p } = resolveSapCredentials(user, pass)
  const auth = Buffer.from(`${u}:${p}`, 'utf8').toString('base64')
  const perTryMs = Math.min(
    Math.max(Number(process.env.SAP_CVA003_TRY_TIMEOUT_MS || process.env.SAP_CVA002_TRY_TIMEOUT_MS) || 30000, 5000),
    180000
  )
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), perTryMs)
  const tlsInsecure =
    String(process.env.SAP_CVA003_TLS_INSECURE || process.env.SAP_CVA002_TLS_INSECURE || '')
      .trim()
      .toLowerCase() === 'true'
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
        'X-KAI-Source': 'kai-cva003',
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
    const ok = res.ok && httpResult !== 'E' && allLineSuccess
    if (ok) {
      const firstResult = list[0]
      return {
        ok: true,
        status: res.status,
        body: text.slice(0, 4000),
        usedUrl: url,
        requestBody: payload,
        resultList: list,
      }
    }
    const listMsgs = list
      .map((r) => String(r?.Message ?? r?.message ?? '').trim())
      .filter(Boolean)
    const errMsg =
      listMsgs.join(' | ') ||
      parsed?.HttpMessage ||
      parsed?.httpMessage ||
      text.slice(0, 800)
    return {
      ok: false,
      status: res.status,
      body: String(errMsg),
      usedUrl: url,
      requestBody: payload,
      resultList: list,
    }
  } catch (e) {
    clearTimeout(t)
    return {
      ok: false,
      status: 0,
      body: formatFetchError(e) + appendCva003AbortHint(e, perTryMs),
      usedUrl: url,
      requestBody: toDotNetCva003Payload(internal),
    }
  }
}
