/**
 * 재고이전 — 자연어 → JSON → DI 경유 또는 SAP_STOCK_TRANSFER_URL
 */
import { resolveSapCredentials } from './sapContext.js'
import {
  diStockTransferEndpoint,
  postStockTransferThroughDi,
} from './diClient.js'
import { resolveCbp007ErpReqStrategiesForOwtr } from './sboOpdnSql.js'
import {
  extractCbp007ErpReqExtraFromText,
  extractCbp007ErpReqHintsFromText,
} from './cbp007ErpReqParse.js'
import {
  defaultEtcOutbizCode,
  fillEtcOutbizTypeCdWhenEmpty,
  isEtcOutbizOwtqCode,
} from './cva002EtcCodes.js'

export { extractCbp007ErpReqExtraFromText, extractCbp007ErpReqHintsFromText }

const CHAT = 'https://api.openai.com/v1/chat/completions'

function parseJson(content) {
  let s = String(content || '').trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/s, '')
  }
  return JSON.parse(s)
}

/** 질문 본문에서 첫 JSON 문자열(코드펜스 또는 균형 잡힌 `{…}`) */
function extractFirstJsonObjectString(text) {
  const s = String(text || '').trim()
  if (!s) return ''
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) return fence[1].trim()
  const brace = s.indexOf('{')
  if (brace < 0) return ''
  let depth = 0
  for (let i = brace; i < s.length; i++) {
    const ch = s[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(brace, i + 1)
    }
  }
  return ''
}

/**
 * 질문에 포함된 첫 JSON 객체 — 재고이전/CVA002 등 형식 가리지 않고 파싱
 * @returns {object|null}
 */
export function tryParseAnyJsonFromInstruction(instruction) {
  const jsonStr = extractFirstJsonObjectString(instruction)
  if (!jsonStr) return null
  try {
    const obj = JSON.parse(jsonStr)
    return obj && typeof obj === 'object' ? obj : null
  } catch {
    return null
  }
}

function isEtcOutbizLineCode(cd) {
  return isEtcOutbizOwtqCode(cd)
}

function isEtcOutboundKoreanText(t) {
  return /기타\s*출고|기타출고|기타\s*출하|기타출하/i.test(String(t || ''))
}

/**
 * 재고이전(CSM001) 응답에 붙일 **판매유형(기타출고유형코드)** 한 줄.
 * JSON·자연어에 기타출고 또는 OB91/OB93 등이 있으면 항상 표시.
 * @returns {string} 빈 문자열이면 생략
 */
export function getStockTransferEtcOutboundDisplayLine(instruction) {
  const s = String(instruction || '')
  let nameHit = isEtcOutboundKoreanText(s)
  const mPv = s.match(/판매\s*유형\s*[:：#]?\s*([^\s,`]+)/i)
  if (mPv && isEtcOutboundKoreanText(mPv[1])) nameHit = true
  const mObText = s.match(/\b(O-\d{2,4}|OB\d{2,4})\b/i)
  const codeFromText =
    mObText && isEtcOutbizLineCode(mObText[1]) ? mObText[1].toUpperCase() : ''

  let outbiz = ''
  let etcOut = ''
  const obj = tryParseAnyJsonFromInstruction(s)
  if (obj && typeof obj === 'object') {
    const rl = Array.isArray(obj.reqList) ? obj.reqList[0] : null
    const h = rl && typeof rl === 'object' ? rl : obj
    outbiz = String(h.outbizTypeCd ?? h.OutbizTypeCd ?? '').trim()
    etcOut = String(h.etcOutbizTypeCd ?? h.EtcOutbizTypeCd ?? '').trim()
    const blocks =
      h && obj && h !== obj ? [h, obj] : [h].filter((b) => b && typeof b === 'object')
    for (const block of blocks) {
      for (const k of Object.keys(block)) {
        if (!/판매|유형|출고|기타/i.test(k)) continue
        const v = block[k]
        const vs = typeof v === 'string' ? v : v != null ? String(v) : ''
        if (isEtcOutboundKoreanText(vs)) nameHit = true
        if (!outbiz && /^(O-\d{2,4}|OB\d{2,4})$/i.test(vs))
          outbiz = vs.trim().toUpperCase()
      }
    }
  }

  const codeHit =
    isEtcOutbizLineCode(outbiz) ||
    isEtcOutbizLineCode(etcOut) ||
    Boolean(codeFromText)

  const show = nameHit || codeHit

  if (!show) return ''

  const parts = ['기타출고']
  if (outbiz) parts.push(`OutbizTypeCd \`${outbiz}\``)
  if (etcOut) parts.push(`EtcOutbizTypeCd \`${etcOut}\``)
  if (!outbiz && !etcOut && codeFromText) parts.push(`\`${codeFromText}\``)
  return `- **판매유형(기타출고유형코드):** ${parts.join(' · ')}\n`
}

/**
 * 질문의 판매유형·OB91/93·기타출고 문구를 proposal에 반영.
 * CSM001 본문 `reqList[0]`에 `outbizTypeCd`·`판매유형` 등으로 실어 보냄(C# 표준 모델 외 필드 — 서버는 무시할 수 있음).
 */
export function applySalesTypeFromInstructionToProposal(proposal, instruction) {
  const p = proposal && typeof proposal === 'object' ? { ...proposal } : {}
  const s = String(instruction || '')

  const existing = String(p.OutbizTypeCd || p.outbizTypeCd || '').trim()
  if (existing) {
    p.OutbizTypeCd = existing
    p.outbizTypeCd = existing
    if (isEtcOutbizLineCode(existing)) {
      const mergedEtc = fillEtcOutbizTypeCdWhenEmpty(
        existing,
        String(p.EtcOutbizTypeCd || p.etcOutbizTypeCd || '').trim()
      )
      if (mergedEtc) {
        p.EtcOutbizTypeCd = mergedEtc
        p.etcOutbizTypeCd = mergedEtc
      }
      if (!String(p['판매유형'] || p.salesTypeKo || '').trim()) {
        p['판매유형'] = '기타출고'
      }
      if (!String(p.ErpReqTypCd || p.erpReqTypCd || '').trim()) {
        p.ErpReqTypCd = 'OWTQ'
        p.erpReqTypCd = 'OWTQ'
      }
    }
    return p
  }

  let code = ''
  const mPvOb = s.match(
    /판매\s*유형\s*[:：#]?\s*((?:O-\d{2,4})|(?:OB\d{2,4}))/i
  )
  const mEtcOb = s.match(
    /기타\s*출고\s*유형\s*[:：#]?\s*((?:O-\d{2,4})|(?:OB\d{2,4}))/i
  )
  const mOb = s.match(/\b(O-\d{2,4}|OB\d{2,4})\b/i)
  if (mPvOb) code = mPvOb[1].toUpperCase()
  else if (mEtcOb) code = mEtcOb[1].toUpperCase()
  else if (mOb) code = mOb[1].toUpperCase()

  if (!code && isEtcOutboundKoreanText(s)) {
    code = defaultEtcOutbizCode()
  }

  if (!code) return p

  if (!isEtcOutbizLineCode(code)) {
    p.OutbizTypeCd = code
    p.outbizTypeCd = code
    return p
  }

  p.OutbizTypeCd = code
  p.outbizTypeCd = code
  const etcFill = fillEtcOutbizTypeCdWhenEmpty(code, '')
  p.EtcOutbizTypeCd = etcFill
  p.etcOutbizTypeCd = etcFill
  p.ErpReqTypCd = 'OWTQ'
  p.erpReqTypCd = 'OWTQ'
  p['판매유형'] = '기타출고'
  return p
}

/**
 * 질문에 붙은 JSON(스웨거·CSM001 형: FrWh, ToWh, Lines[].IfProdId, ProcQty)이 있으면 재고이전 proposal으로 파싱.
 * @returns {object|null}
 */
export function tryParseStockTransferPayloadFromInstruction(instruction) {
  const jsonStr = extractFirstJsonObjectString(instruction)
  if (!jsonStr) return null
  let obj
  try {
    obj = JSON.parse(jsonStr)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const fr = obj.FrWh ?? obj.frWh ?? obj.FromWarehouse ?? obj.fromWarehouse
  const tw = obj.ToWh ?? obj.toWh ?? obj.ToWarehouse ?? obj.toWarehouse
  const linesRaw = obj.Lines ?? obj.lines
  const hasLines = Array.isArray(linesRaw) && linesRaw.length > 0
  const hasTopItem = obj.ItemCode ?? obj.matnr ?? obj.IfProdId ?? obj.ifProdId
  if (!fr && !tw && !hasLines && !hasTopItem) return null
  const lines = hasLines
    ? linesRaw.map((ln) => {
        const item = String(
          ln.ItemCode ?? ln.matnr ?? ln.IfProdId ?? ln.ifProdId ?? ''
        ).trim()
        const qty =
          Number(ln.Quantity ?? ln.ProcQty ?? ln.procQty ?? ln.menge ?? 0) || 0
        return {
          ...ln,
          ItemCode: item,
          Quantity: qty,
          ErpBatchNo: ln.ErpBatchNo ?? ln.erpBatchNo,
          LotNo: ln.LotNo ?? ln.lotNo,
          ExpYmd: ln.ExpYmd ?? ln.expYmd,
        }
      })
    : []
  const proposal = {}
  if (fr != null && String(fr).trim()) proposal.FromWarehouse = String(fr).trim()
  if (tw != null && String(tw).trim()) proposal.ToWarehouse = String(tw).trim()
  if (lines.length) proposal.Lines = lines
  if (!proposal.Lines && hasTopItem) {
    proposal.ItemCode = String(
      obj.ItemCode ?? obj.matnr ?? obj.IfProdId ?? obj.ifProdId ?? ''
    ).trim()
    proposal.Quantity =
      Number(obj.Quantity ?? obj.ProcQty ?? obj.procQty ?? obj.menge ?? 0) || 0
  }
  if (!proposal.Lines && !proposal.ItemCode) return null
  return proposal
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
  // LLM이 플랜트(1000 등)를 창고에 넣는 경우 OWTR.ToWhsCode ODBC -2028 유발
  if (
    process.env.KAI_SBO_ALLOW_NUMERIC_WAREHOUSE !== 'true' &&
    /^\d{4}$/.test(s)
  ) {
    return true
  }
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
      ...ln,
      ItemCode:
        ln.ItemCode ??
        ln.matnr ??
        ln.IfProdId ??
        ln.ifProdId ??
        '',
      Quantity:
        Number(ln.Quantity ?? ln.menge ?? ln.ProcQty ?? ln.procQty ?? 0) || 0,
      ItemDescription: ln.ItemDescription ?? ln.matnrText ?? '',
    }))
  }
  if (!Array.isArray(p.Lines) && (p.matnr || p.ItemCode || p.IfProdId || p.ifProdId)) {
    p.Lines = [
      {
        ItemCode: p.ItemCode ?? p.matnr ?? p.IfProdId ?? p.ifProdId ?? '',
        Quantity:
          Number(p.Quantity ?? p.menge ?? p.ProcQty ?? p.procQty ?? 0) || 0,
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

function wtq1Get(row, ...names) {
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

function formatWtqExpYmd(v) {
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

/**
 * SAP B1 WTQ1 행 → CSM001 proposal.Lines (OWTQ DocEntry 질문 + SQL 조회 결과)
 */
export function mergeWtq1IntoProposal(proposal, wtqRows) {
  const rows = Array.isArray(wtqRows) ? wtqRows : []
  const lines = []
  for (const r of rows) {
    const item = String(wtq1Get(r, 'ItemCode') ?? '').trim()
    const qty = Number(wtq1Get(r, 'Quantity', 'Qty')) || 0
    if (!item || qty <= 0) continue
    const fr = String(
      wtq1Get(
        r,
        'FromWhsCod',
        'FromWhsCode',
        'FromWhs',
        'U_FromWhs',
        'U_FromW'
      ) ?? ''
    )
      .trim()
      .toUpperCase()
      .replace(/\s/g, '')
      .slice(0, 10)
    const to = String(
      wtq1Get(
        r,
        'ToWhsCod',
        'ToWhsCode',
        'ToWhs',
        'U_ToWhs',
        'U_Towhs',
        'U_ToW'
      ) ?? ''
    )
      .trim()
      .toUpperCase()
      .replace(/\s/g, '')
      .slice(0, 10)
    const batch = String(
      wtq1Get(
        r,
        'BatchNum',
        'DistNum',
        'DistNumber',
        'VBatchNum',
        'SubCatNum',
        'ErpBatchNo',
        'U_Batch',
        'U_ErpBatch'
      ) ?? ''
    ).trim()
    const expYmd = formatWtqExpYmd(wtq1Get(r, 'ExpDate', 'ExpDat'))
    const frLoc = String(
      wtq1Get(
        r,
        'FromBinLoc',
        'FrBinLoc',
        'BinFrom',
        'FrLoc',
        'FromBin',
        'U_FrLoc'
      ) ?? ''
    ).trim()
    const toLoc = String(
      wtq1Get(
        r,
        'ToBinLoc',
        'BinTo',
        'ToLoc',
        'ToBin',
        'U_ToLoc'
      ) ?? ''
    ).trim()
    lines.push({
      ItemCode: item,
      Quantity: qty,
      ItemDescription: String(wtq1Get(r, 'Dscription', 'ItemName') ?? '').trim(),
      FromWarehouse: fr,
      ToWarehouse: to,
      ErpBatchNo: batch,
      LotNo: String(wtq1Get(r, 'LotNo', 'LotNumber') ?? '').trim(),
      ExpYmd: expYmd,
      FrWh: fr,
      ToWh: to,
      FrLoc: frLoc,
      ToLoc: toLoc,
    })
  }
  if (!lines.length) return proposal
  const first = lines[0]
  const de = wtq1Get(rows[0], 'DocEntry')
  const {
    FromWarehouse: _fw,
    ToWarehouse: _tw,
    lgortFrom: _lf,
    lgortTo: _lt,
    Lines: _oldLines,
    ...rest
  } = proposal
  const merged = {
    ...rest,
    Lines: lines,
    JournalRemark:
      proposal.JournalRemark ||
      (de != null && String(de).trim() !== ''
        ? `재고이전 OWTQ DocEntry ${de}`
        : '재고이전 OWTQ'),
    ItemCode: first.ItemCode,
    matnr: first.ItemCode,
    Quantity: first.Quantity,
    menge: first.Quantity,
  }
  const fw = String(first.FromWarehouse ?? '').trim()
  const tw = String(first.ToWarehouse ?? '').trim()
  if (fw) {
    merged.FromWarehouse = fw
    merged.lgortFrom = fw
  }
  if (tw) {
    merged.ToWarehouse = tw
    merged.lgortTo = tw
  }
  return applyStockTransferDefaults(merged)
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
- FromWarehouse, ToWarehouse: 한글·placeholder 금지. **1000·2000 같은 숫자 4자리는 플랜트 코드이므로 창고에 넣지 말 것.** 문맥에 없으면 AA120/AA100 스타일 B1 창고코드.
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

/** WTQ1 등에서 창고가 '' 로 들어올 때 ?? 만으로는 헤더값으로 못 넘어감 → 첫 비어있지 않은 값 */
function pickCsmLineWh(...vals) {
  for (const v of vals) {
    const s = String(v ?? '').trim()
    if (s) return s
  }
  return ''
}

function normalizeWhCode(s) {
  return String(s ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s/g, '')
    .slice(0, 10)
}

/**
 * CSM001/DI: 동일 창고(frWh===toWh)인데 출고·입고 빈(frLoc/toLoc)이 모두 비면
 * SAP -1470000519 "출고 빈 위치는 입고 빈 위치와 달라야 합니다" 가 난다.
 * 빈 코드가 있으면 그대로 두고, 없을 때만 .env 기본 출고/입고 창고로 분리(의도적 동일창고+빈 이동은 KAI_SBO_CSM001_SAME_WH_SPLIT=false).
 */
function splitSameWarehouseCsmFrTo(frWh, toWh, frLoc, toLoc) {
  const fr = normalizeWhCode(frWh)
  const to = normalizeWhCode(toWh)
  const locFrom = String(frLoc ?? '').trim()
  const locTo = String(toLoc ?? '').trim()
  if (!fr || !to || fr !== to) {
    return { frWh: String(frWh ?? '').trim() || frWh, toWh: String(toWh ?? '').trim() || toWh }
  }
  if (locFrom || locTo) {
    return { frWh: String(frWh ?? '').trim(), toWh: String(toWh ?? '').trim() }
  }
  if (
    String(process.env.KAI_SBO_CSM001_SAME_WH_SPLIT || 'true')
      .trim()
      .toLowerCase() === 'false'
  ) {
    return { frWh: String(frWh ?? '').trim(), toWh: String(toWh ?? '').trim() }
  }
  const df = String(process.env.SAP_DEFAULT_FROM_WAREHOUSE || 'AA120').trim()
  const dt = String(process.env.SAP_DEFAULT_TO_WAREHOUSE || 'AA100').trim()
  const dfN = normalizeWhCode(df)
  const dtN = normalizeWhCode(dt)
  if (!dfN || !dtN || dfN === dtN) {
    return { frWh: String(frWh ?? '').trim(), toWh: String(toWh ?? '').trim() }
  }
  return { frWh: df, toWh: dt }
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
  const defaultFromWh =
    String(proposal.FromWarehouse ?? proposal.lgortFrom ?? '').trim() ||
    (process.env.SAP_DEFAULT_FROM_WAREHOUSE || 'AA120')
  const defaultToWh =
    String(proposal.ToWarehouse ?? proposal.lgortTo ?? '').trim() ||
    (process.env.SAP_DEFAULT_TO_WAREHOUSE || 'AA100')
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
    const frLocRaw = String(ln.FrLoc ?? ln.frLoc ?? '').trim()
    const toLocRaw = String(ln.ToLoc ?? ln.toLoc ?? '').trim()
    let frWh = pickCsmLineWh(ln.FrWh, ln.FromWarehouse, defaultFromWh) || defaultFromWh
    let toWh =
      pickCsmLineWh(ln.ToWh, ln.ToWarehouse, defaultToWh) || defaultToWh
    const split = splitSameWarehouseCsmFrTo(frWh, toWh, frLocRaw, toLocRaw)
    frWh = split.frWh
    toWh = split.toWh
    return {
      ifIdx: String(idx),
      erpLineNo: idx,
      frWh,
      frLoc: frLocRaw,
      toWh,
      toLoc: toLocRaw,
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
  const body = {
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
  const ob = String(proposal.OutbizTypeCd ?? proposal.outbizTypeCd ?? '').trim()
  const etc = String(proposal.EtcOutbizTypeCd ?? proposal.etcOutbizTypeCd ?? '').trim()
  const erp = String(proposal.ErpReqTypCd ?? proposal.erpReqTypCd ?? '').trim()
  const salesKo = String(proposal['판매유형'] ?? proposal.salesTypeKo ?? '').trim()
  const req0 = body.reqList[0]
  if (ob) {
    req0.outbizTypeCd = ob
    if (etc) req0.etcOutbizTypeCd = etc
    else if (isEtcOutbizLineCode(ob)) {
      const filled = fillEtcOutbizTypeCdWhenEmpty(ob, '')
      if (filled) req0.etcOutbizTypeCd = filled
    }
  } else if (etc) {
    req0.etcOutbizTypeCd = etc
  }
  if (erp) req0.erpReqTypCd = erp
  if (salesKo) req0['판매유형'] = salesKo
  else if (ob && isEtcOutbizLineCode(ob)) req0['판매유형'] = '기타출고'
  return body
}

/**
 * KAI proposal → MACRO_WMS CSM003(예외출고) 형식 변환
 * { apikey, bizSeq, reqList: [{ ifKey,etcTypeCd,procBundleNo,wmsReqNo,erpReqNo,procYmd,procHms,procUserId,note,prodList:[...] }] }
 */
export function proposalToCSM003Body(proposal) {
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
  const etcTypeCd = String(process.env.SAP_CSM003_ETC_TYPE_CD || 'O-300').trim()

  const fromWh = String(proposal.FromWarehouse ?? proposal.lgortFrom ?? '').trim() ||
    (process.env.SAP_DEFAULT_FROM_WAREHOUSE || 'AA120')
  const lines = Array.isArray(proposal.Lines) && proposal.Lines.length
    ? proposal.Lines
    : (proposal.ItemCode || proposal.matnr)
      ? [{ ItemCode: proposal.ItemCode ?? proposal.matnr, Quantity: Number(proposal.Quantity ?? proposal.menge ?? 0) || 0 }]
      : []

  const prodList = (lines.length ? lines : [{}]).map((ln, idx) => ({
    // CSM003 서버는 ExpYmd를 DateTime.ParseExact("yyyyMMdd")로 파싱하므로 빈값이면 실패함.
    // 값이 없을 때는 전기일(procYmd)로 채워 파싱 오류를 방지한다.
    _expYmd: String(ln.ExpYmd ?? '').trim().slice(0, 8),
    ifIdx: String(idx),
    erpLineNo: Number(ln.ErpLineNo ?? idx) || idx,
    ifProdId: String(ln.ItemCode ?? ln.IfProdId ?? '').trim(),
    frWh: String(ln.FrWh ?? ln.FromWarehouse ?? fromWh).trim(),
    exQty: Number(ln.ExQty ?? ln.Quantity ?? 0) || 0,
    lotNo: String(ln.LotNo ?? '').trim(),
    expYmd: '',
    erpBatchNo: String(ln.ErpBatchNo ?? ln.erpBatchNo ?? '').trim(),
  })).map((x) => ({
    ...x,
    expYmd:
      x._expYmd ||
      String(process.env.SAP_CSM003_DEFAULT_EXPYMD || '').trim().slice(0, 8) ||
      procYmd ||
      ymdNow,
    _expYmd: undefined,
  }))

  return {
    apikey: String(process.env.SAP_CSM003_APIKEY || process.env.SAP_CSM001_APIKEY || 'emdc')
      .trim()
      .toLowerCase(),
    bizSeq: Math.max(1, parseInt(process.env.SAP_CSM003_BIZSEQ || process.env.SAP_CSM001_BIZSEQ || '1', 10)),
    reqList: [
      {
        ifKey,
        etcTypeCd,
        procBundleNo: String(proposal.ProcBundleNo || ''),
        wmsReqNo,
        erpReqNo: String(proposal.ErpReqNo || ''),
        procYmd: String(procYmd || ymdNow),
        procHms: String(procHms),
        procUserId: String((process.env.SAP_CSM003_USER || process.env.SAP_CSM001_USER || 'KAI').trim()),
        note: String(proposal.JournalRemark || proposal.Note || '입고취소 역출고'),
        prodList,
      },
    ],
  }
}

export async function postGoodsIssue(postUrl, user, pass, proposal) {
  const url = normalizeHttpUrl(postUrl)
  if (!url) return { ok: false, status: 0, body: 'URL 없음', docNo: null, viaDi: false }
  const payload = proposalToCSM003Body(proposal)
  const { user: u, pass: p } = resolveSapCredentials(user, pass)
  const auth = Buffer.from(`${u}:${p}`, 'utf8').toString('base64')
  const perTryMs = Math.min(
    Math.max(Number(process.env.SAP_GOODS_ISSUE_TRY_TIMEOUT_MS) || 30000, 5000),
    180000
  )
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), perTryMs)
  const tlsInsecure =
    String(process.env.SAP_GOODS_ISSUE_TLS_INSECURE || '')
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
        'X-KAI-Source': 'kai-goods-issue',
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
    const httpResult = parsed?.HttpResult ?? parsed?.httpResult
    const resultList = parsed?.ResultList ?? parsed?.resultList
    const firstResult = Array.isArray(resultList) && resultList[0]
    const cResultOk = httpResult === 'S'
    if (res.ok && cResultOk) {
      return {
        ok: true,
        status: res.status,
        body: text.slice(0, 4000),
        docNo: firstResult?.ProcBundleNo || firstResult?.procBundleNo || firstResult?.IfKey || null,
        usedUrl: url,
        viaDi: false,
        requestBody: payload,
      }
    }
    const errMsg =
      firstResult?.Message ||
      firstResult?.message ||
      parsed?.HttpMessage ||
      parsed?.httpMessage ||
      text.slice(0, 500)
    return {
      ok: false,
      status: res.status,
      body: String(errMsg),
      docNo: null,
      usedUrl: url,
      viaDi: false,
      requestBody: payload,
    }
  } catch (e) {
    clearTimeout(t)
    return {
      ok: false,
      status: 0,
      body: formatFetchError(e),
      docNo: null,
      usedUrl: url,
      viaDi: false,
      requestBody: payload,
    }
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

function expandOneCbp007Url(baseUrl) {
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
    process.env.SAP_CBP007_PORTS ||
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

function cbp007UrlCandidates(baseUrl) {
  const raw = String(baseUrl ?? '').trim()
  if (!raw) return []
  const parts = raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
  const baseUrls = []
  const seenBase = new Set()
  for (const p of parts) {
    for (const c of expandOneCbp007Url(p)) {
      if (!seenBase.has(c)) {
        seenBase.add(c)
        baseUrls.push(c)
      }
    }
  }

  const pathCandidates = (
    process.env.SAP_CBP007_PATH_CANDIDATES ||
    '/CBP007,/api/CBP007,/cbp007,/api/cbp007'
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
        /^\/cbp007$/i.test(originalPath) ||
        /^\/api\/cbp007$/i.test(originalPath))
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

function normalizeCbp007OutcomeCode(v) {
  return String(v ?? '').trim().toUpperCase()
}

/** CSM001과 동일하게 HttpResult·ResultList[].Result 다양한 표기 수용 */
function isCbp007ResponseSuccess(res, parsed) {
  if (!res?.ok) return false
  const httpResult = normalizeCbp007OutcomeCode(
    parsed?.HttpResult ?? parsed?.httpResult
  )
  if (['E', 'ERROR', 'FAIL', 'FAILED'].includes(httpResult)) return false

  const resultList = parsed?.ResultList ?? parsed?.resultList
  const items = Array.isArray(resultList) ? resultList : []

  const itemCode = (it) =>
    normalizeCbp007OutcomeCode(
      it?.Result ?? it?.result ?? it?.Status ?? it?.status
    )

  const successCodes = ['S', 'SUCCESS', 'OK', 'Y', 'TRUE']
  const failCodes = ['E', 'ERROR', 'FAIL', 'FAILED', 'N', 'FALSE']

  for (const it of items) {
    const c = itemCode(it)
    if (failCodes.includes(c)) return false
  }

  const coded = items.map(itemCode).filter(Boolean)
  if (!coded.length) {
    return !httpResult || successCodes.includes(httpResult)
  }
  return coded.every((c) => successCodes.includes(c))
}

function firstCbp007FailureSnippet(parsed, text) {
  const resultList = parsed?.ResultList ?? parsed?.resultList
  const items = Array.isArray(resultList) ? resultList : []
  const failCodes = ['E', 'ERROR', 'FAIL', 'FAILED', 'N', 'FALSE']
  for (const it of items) {
    const c = normalizeCbp007OutcomeCode(
      it?.Result ?? it?.result ?? it?.Status ?? it?.status
    )
    if (failCodes.includes(c)) {
      return String(
        it?.Message ||
          it?.message ||
          parsed?.HttpMessage ||
          parsed?.httpMessage ||
          text.slice(0, 500)
      )
    }
  }
  const first = items[0]
  return String(
    first?.Message ||
      first?.message ||
      parsed?.HttpMessage ||
      parsed?.httpMessage ||
      text.slice(0, 500)
  )
}

function cbp007NowYmdHms() {
  const now = new Date()
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '').slice(0, 8)
  const hms =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')
  return { ymd, hms }
}

/**
 * 스웨거 `wmsReqNo` — 일부 WMS는 재고이전 문서키로만 조회(erpReqNo와 동일 값 필요).
 * 기본: 랜덤 ifKey와 동일(기존 동작). `SAP_CBP007_WMS_REQ_NO_MODE=erpReq` 또는 `SAP_CBP007_WMS_REQ_NO_SAME_AS_ERPREQ=true`
 */
function resolveCbp007WmsReqNo(erpReqNo, ifKey) {
  const same =
    String(process.env.SAP_CBP007_WMS_REQ_NO_SAME_AS_ERPREQ || '')
      .trim()
      .toLowerCase() === 'true'
  const mode = String(process.env.SAP_CBP007_WMS_REQ_NO_MODE || 'ifKey').trim().toLowerCase()
  if (same || mode === 'erpreq' || mode === 'erp' || mode === 'same') {
    return String(erpReqNo ?? '').trim()
  }
  return ifKey
}

/** CSM003와 동일한 reqList 뼈대 + erpReqNo (서버가 SqlDataReader로 행 조회 시 필요할 수 있음) */
function cbp007Csm003StyleBody(erpReqNos) {
  const ids = Array.isArray(erpReqNos)
    ? erpReqNos.map((s) => String(s).trim()).filter(Boolean)
    : []
  const apikey = String(process.env.SAP_CBP007_APIKEY || process.env.SAP_CSM001_APIKEY || 'emdc')
    .trim()
    .toLowerCase()
  const bizSeq = Number(process.env.SAP_CBP007_BIZSEQ || process.env.SAP_CSM001_BIZSEQ || 1) || 1
  const { ymd, hms } = cbp007NowYmdHms()
  const procUserId = String(
    process.env.SAP_CBP007_USER || process.env.SAP_CSM003_USER || process.env.SAP_CSM001_USER || 'KAI'
  ).trim()
  const etcTypeCd = String(
    process.env.SAP_CBP007_ETC_TYPE_CD || process.env.SAP_CSM003_ETC_TYPE_CD || 'O-300'
  ).trim()
  const fromWh = String(process.env.SAP_DEFAULT_FROM_WAREHOUSE || 'AA120').trim()
  const reqList = ids.map((erpReqNo) => {
    const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    const ifKey = `KAI-C7-${ymd}-${seq}`
    return {
      ifKey,
      etcTypeCd,
      procBundleNo: '',
      wmsReqNo: resolveCbp007WmsReqNo(erpReqNo, ifKey),
      erpReqNo: String(erpReqNo),
      procYmd: ymd,
      procHms: hms,
      procUserId,
      note: String(process.env.SAP_CBP007_NOTE || '재고이전 취소').trim(),
      prodList: [
        {
          ifIdx: '0',
          erpLineNo: 0,
          ifProdId: '',
          frWh: fromWh,
          exQty: 0,
          lotNo: '',
          expYmd: ymd,
          erpBatchNo: '',
        },
      ],
    }
  })
  return { apikey, bizSeq, reqList }
}

/** inwhTypeCd·centerSeq 조합 (스웨거·WMS 코드에 맞게 .env로 확장) */
function cbp007InwhCenterPairs() {
  const rawInwh = String(process.env.SAP_CBP007_INWH_TYPE_CD_CANDIDATES || '').trim()
  const inwhs = rawInwh.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
  const rawCent = String(process.env.SAP_CBP007_CENTER_SEQ_CANDIDATES || '').trim()
  const cents = rawCent
    .split(/[,;]+/)
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n))
  const defInwh = String(
    process.env.SAP_CBP007_INWH_TYPE_CD ||
      process.env.SAP_CBP007_ETC_TYPE_CD ||
      process.env.SAP_CSM003_ETC_TYPE_CD ||
      'O-300'
  ).trim()
  const centerSeqRaw = process.env.SAP_CBP007_CENTER_SEQ
  const defCent =
    centerSeqRaw !== undefined && String(centerSeqRaw).trim() !== ''
      ? Number(centerSeqRaw) || 0
      : 0
  const cap = Math.min(
    Math.max(Number(process.env.SAP_CBP007_MAX_INWH_CENTER_COMBOS) || 16, 1),
    32
  )
  const tryDefaults =
    String(process.env.SAP_CBP007_INWH_CENTER_TRY_DEFAULTS || 'true').trim().toLowerCase() !==
    'false'
  const etc = String(process.env.SAP_CBP007_ETC_TYPE_CD || '').trim()

  /** inwh 후보가 비어 있으면(센터만 지정한 경우 포함) O-300/O-301 등으로 넓힘 */
  let iwList
  if (inwhs.length) {
    iwList = [...inwhs]
  } else if (tryDefaults) {
    const iwSet = new Set(['O-300', 'O-301', defInwh || 'O-300'])
    if (etc) iwSet.add(etc)
    iwList = Array.from(iwSet).filter(Boolean)
  } else {
    iwList = [defInwh || 'O-300']
  }

  let cList
  if (cents.length) {
    cList = [...cents]
    if (tryDefaults) {
      const cs = new Set(cList)
      cs.add(defCent)
      cs.add(0)
      cs.add(1)
      cList = Array.from(cs).filter((n) => Number.isFinite(n))
    }
  } else if (tryDefaults) {
    cList = Array.from(new Set([defCent, 0, 1])).filter((n) => Number.isFinite(n))
  } else {
    cList = [defCent]
  }

  const out = []
  for (const iw of iwList) {
    for (const c of cList) {
      out.push({ inwhTypeCd: iw, centerSeq: c })
      if (out.length >= cap) return out
    }
  }
  return out.length ? out : [{ inwhTypeCd: defInwh || 'O-300', centerSeq: defCent }]
}

/**
 * CBP007 스웨거 샘플 형태: inwhTypeCd·centerSeq (etcTypeCd·prodList 없음)
 * @param {object} [overrides] — { inwhTypeCd, centerSeq, bizSeq }
 */
function cbp007SampleSpecBody(erpReqNos, overrides = {}) {
  const ids = Array.isArray(erpReqNos)
    ? erpReqNos.map((s) => String(s).trim()).filter(Boolean)
    : []
  const apikey = String(process.env.SAP_CBP007_APIKEY || process.env.SAP_CSM001_APIKEY || 'emdc')
    .trim()
    .toLowerCase()
  const bizSeq = Object.prototype.hasOwnProperty.call(overrides, 'bizSeq')
    ? Number(overrides.bizSeq)
    : Number(process.env.SAP_CBP007_BIZSEQ || process.env.SAP_CSM001_BIZSEQ || 1) || 1
  const centerSeqRaw = process.env.SAP_CBP007_CENTER_SEQ
  const centerSeq =
    overrides.centerSeq != null
      ? Number(overrides.centerSeq) || 0
      : centerSeqRaw !== undefined && String(centerSeqRaw).trim() !== ''
        ? Number(centerSeqRaw) || 0
        : 0
  const inwhTypeCd = String(
    overrides.inwhTypeCd != null
      ? overrides.inwhTypeCd
      : process.env.SAP_CBP007_INWH_TYPE_CD ||
          process.env.SAP_CBP007_ETC_TYPE_CD ||
          process.env.SAP_CSM003_ETC_TYPE_CD ||
          'O-300'
  ).trim()
  const { ymd, hms } = cbp007NowYmdHms()
  const procUserId = String(
    process.env.SAP_CBP007_USER || process.env.SAP_CSM003_USER || process.env.SAP_CSM001_USER || 'KAI'
  ).trim()
  const procBundleNoDefault = String(process.env.SAP_CBP007_PROC_BUNDLE_NO || '').trim()
  const reqList = ids.map((erpReqNo) => {
    const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    const ifKey = `KAI-C7S-${ymd}-${seq}`
    return {
      ifKey,
      inwhTypeCd,
      centerSeq,
      wmsReqNo: resolveCbp007WmsReqNo(erpReqNo, ifKey),
      erpReqNo: String(erpReqNo),
      procYmd: ymd,
      procHms: hms,
      procUserId,
      procBundleNo: procBundleNoDefault,
    }
  })
  return { apikey, bizSeq, reqList }
}

/** erpReqNo 문자열 배열(OWTR/OWTQ DocEntry·DocNum 등)로 페이로드 변형 생성 */
function cbp007PayloadVariants(erpReqNos) {
  const ids = Array.isArray(erpReqNos)
    ? erpReqNos.map((s) => String(s).trim()).filter(Boolean)
    : []
  const allNumeric = ids.every((s) => {
    const n = Number(s)
    return Number.isFinite(n) && n > 0
  })
  const numericVals = allNumeric ? ids.map((s) => Number(s)) : []
  const apikey = String(process.env.SAP_CBP007_APIKEY || process.env.SAP_CSM001_APIKEY || 'emdc')
    .trim()
    .toLowerCase()
  const bizSeq = Number(process.env.SAP_CBP007_BIZSEQ || process.env.SAP_CSM001_BIZSEQ || 1) || 1
  const v = []
  const rawExtra = String(process.env.SAP_CBP007_RAW_JSON || '').trim()
  if (rawExtra) {
    try {
      const tpl = JSON.parse(rawExtra)
      const body = JSON.parse(
        JSON.stringify(tpl).replace(/\{\{erpReqNo\}\}/g, String(ids[0] || ''))
      )
      v.push({ label: 'env.SAP_CBP007_RAW_JSON', body })
    } catch {
      /* ignore invalid env JSON */
    }
  }
  if (ids.length) {
    const pairs = cbp007InwhCenterPairs()
    /** bizSeq=0은 일부 CBP007 구현에서 SQL(CommandText) 미설정 오류를 유발 — 기본 끔 */
    const tryBizSeqZero =
      String(process.env.SAP_CBP007_BIZSEQ_TRY_ZERO || 'false').trim().toLowerCase() === 'true'
    for (let pi = 0; pi < pairs.length; pi++) {
      const pair = pairs[pi]
      const spec = cbp007SampleSpecBody(ids, pair)
      const lab = `spec.sample.inwh=${pair.inwhTypeCd}.c=${pair.centerSeq}`
      v.push({ label: lab, body: spec })
      v.push({
        label: `PascalCase.sampleSpec.inwh=${pair.inwhTypeCd}.c=${pair.centerSeq}`,
        body: {
          Apikey: spec.apikey,
          BizSeq: spec.bizSeq,
          ReqList: spec.reqList.map((r) => ({
            IfKey: r.ifKey,
            InwhTypeCd: r.inwhTypeCd,
            CenterSeq: r.centerSeq,
            WmsReqNo: r.wmsReqNo,
            ErpReqNo: r.erpReqNo,
            ProcYmd: r.procYmd,
            ProcHms: r.procHms,
            ProcUserId: r.procUserId,
            ProcBundleNo: r.procBundleNo,
          })),
        },
      })
      if (tryBizSeqZero && spec.bizSeq !== 0) {
        const spec0 = cbp007SampleSpecBody(ids, { ...pair, bizSeq: 0 })
        const lab0 = `${lab}.bizSeq=0`
        v.push({ label: lab0, body: spec0 })
        v.push({
          label: `PascalCase.sampleSpec.inwh=${pair.inwhTypeCd}.c=${pair.centerSeq}.bizSeq=0`,
          body: {
            Apikey: spec0.apikey,
            BizSeq: spec0.bizSeq,
            ReqList: spec0.reqList.map((r) => ({
              IfKey: r.ifKey,
              InwhTypeCd: r.inwhTypeCd,
              CenterSeq: r.centerSeq,
              WmsReqNo: r.wmsReqNo,
              ErpReqNo: r.erpReqNo,
              ProcYmd: r.procYmd,
              ProcHms: r.procHms,
              ProcUserId: r.procUserId,
              ProcBundleNo: r.procBundleNo,
            })),
          },
        })
      }
    }
    const csm3 = cbp007Csm003StyleBody(ids)
    v.push({ label: 'csm003Like.fullHeader+erpReqNo', body: csm3 })
    const { ymd, hms } = cbp007NowYmdHms()
    const procUserId = String(
      process.env.SAP_CBP007_USER || process.env.SAP_CSM001_USER || 'KAI'
    ).trim()
    v.push({
      label: 'PascalCase.CSM003Like',
      body: {
        APIKEY: csm3.apikey,
        BizSeq: csm3.bizSeq,
        ReqList: csm3.reqList.map((r) => ({
          IfKey: r.ifKey,
          EtcTypeCd: r.etcTypeCd,
          ProcBundleNo: r.procBundleNo,
          WmsReqNo: r.wmsReqNo,
          ErpReqNo: r.erpReqNo,
          ProcYmd: r.procYmd,
          ProcHms: r.procHms,
          ProcUserId: r.procUserId,
          Note: r.note,
          ProdList: r.prodList.map((p) => ({
            IfIdx: p.ifIdx,
            ErpLineNo: p.erpLineNo,
            IfProdId: p.ifProdId,
            FrWh: p.frWh,
            ExQty: p.exQty,
            LotNo: p.lotNo,
            ExpYmd: p.expYmd,
            ErpBatchNo: p.erpBatchNo,
          })),
        })),
      },
    })
    v.push({
      label: 'csm003Like.prodListEmpty',
      body: {
        apikey,
        bizSeq,
        reqList: ids.map((erpReqNo) => {
          const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
          const ifKey = `KAI-C7E-${ymd}-${seq}`
          return {
            ifKey,
            etcTypeCd: String(
              process.env.SAP_CBP007_ETC_TYPE_CD || process.env.SAP_CSM003_ETC_TYPE_CD || 'O-300'
            ).trim(),
            procBundleNo: '',
            wmsReqNo: resolveCbp007WmsReqNo(erpReqNo, ifKey),
            erpReqNo: String(erpReqNo),
            procYmd: ymd,
            procHms: hms,
            procUserId,
            note: String(process.env.SAP_CBP007_NOTE || '재고이전 취소').trim(),
            prodList: [],
          }
        }),
      },
    })
  }
  v.push({
    label: 'reqList.erpReqNo',
    body: { apikey, bizSeq, reqList: ids.map((erpReqNo) => ({ erpReqNo: String(erpReqNo) })) },
  })
  v.push({
    label: 'ReqList.ErpReqNo',
    body: {
      APIKEY: apikey,
      BizSeq: bizSeq,
      ReqList: ids.map((erpReqNo) => ({ ErpReqNo: String(erpReqNo) })),
    },
  })
  if (allNumeric && numericVals.length === ids.length) {
    v.push({
      label: 'reqList.docEntry',
      body: { apikey, bizSeq, reqList: numericVals.map((n) => ({ docEntry: n })) },
    })
    v.push({
      label: 'ReqList.DocEntry',
      body: { APIKEY: apikey, BizSeq: bizSeq, ReqList: numericVals.map((n) => ({ DocEntry: n })) },
    })
  }
  return v
}

/**
 * 요청 옵션에서 SQL 밖의 erpReq 후보(예: 관계맵·비고의 OWTQ DocEntry)를 전략 앞에 붙임.
 * @param {object} opts — `erpReqExtra` | `erpReqExtras` | `erpReqByOwtrEntry`
 */
function buildCbp007ExtraStrategiesFromOpts(opts, owtrEntries) {
  if (!opts || !Array.isArray(owtrEntries) || !owtrEntries.length) return []
  const rows = []

  const byMap = opts.erpReqByOwtrEntry || opts.cbp007ErpReqByOwtrEntry
  if (byMap && typeof byMap === 'object' && !Array.isArray(byMap)) {
    const row = owtrEntries.map((de) => {
      const v = byMap[String(de)] ?? byMap[de]
      return v != null ? String(v).trim() : ''
    })
    if (row.every(Boolean)) rows.push(row)
  }

  const ex =
    opts.erpReqExtra !== undefined
      ? opts.erpReqExtra
      : opts.erpReqExtras !== undefined
        ? opts.erpReqExtras
        : opts.cbp007ErpReqExtra

  if (ex != null && owtrEntries.length === 1) {
    const vals = Array.isArray(ex) ? ex : [ex]
    for (const v of vals) {
      const s = String(v ?? '').trim()
      if (s) rows.push([s])
    }
  } else if (ex != null && owtrEntries.length > 1) {
    const arr = Array.isArray(ex) ? ex : null
    if (arr && arr.length === owtrEntries.length) {
      const row = arr.map((x) => String(x ?? '').trim())
      if (row.every(Boolean)) rows.push(row)
    }
  }

  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (row.length !== owtrEntries.length) continue
    const k = row.join('|')
    if (seen.has(k)) continue
    seen.add(k)
    out.push(row)
  }
  return out
}

export async function postStockTransferCancelCbp007(postUrl, user, pass, docEntries, opts = {}) {
  const urls = cbp007UrlCandidates(postUrl)
  if (!urls.length) {
    return { ok: false, status: 0, body: 'CBP007 URL 없음', usedUrl: null }
  }
  const owtrEntries = Array.isArray(docEntries)
    ? Array.from(
        new Set(
          docEntries
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        )
      ).slice(0, 200)
    : []
  if (!owtrEntries.length) {
    return { ok: false, status: 0, body: 'DocEntry 없음', usedUrl: null, requestBody: null }
  }

  let lookupRows = []
  let lookupNotes = []
  let strategies =
    Array.isArray(opts?.erpReqStrategies) && opts.erpReqStrategies.length
      ? opts.erpReqStrategies
      : null
  if (!strategies) {
    const resolved = await resolveCbp007ErpReqStrategiesForOwtr(owtrEntries, {
      auxiliaryText: opts.auxiliaryText || opts.question || '',
    })
    strategies = resolved.strategies || []
    lookupRows = resolved.lookupRows || []
    lookupNotes = Array.isArray(resolved.lookupNotes) ? resolved.lookupNotes : []
  }

  let prependedErpReqStrategies = []
  const extraStrategies = buildCbp007ExtraStrategiesFromOpts(opts, owtrEntries)
  if (extraStrategies.length) {
    const seen = new Set((strategies || []).map((s) => s.join('|')))
    const merged = []
    for (const row of extraStrategies) {
      const k = row.join('|')
      if (!seen.has(k)) {
        seen.add(k)
        merged.push(row)
      }
    }
    prependedErpReqStrategies = merged
    strategies = [...merged, ...strategies]
  }

  strategies = strategies.filter(
    (s) =>
      Array.isArray(s) &&
      s.length === owtrEntries.length &&
      s.every((x) => String(x ?? '').trim())
  )
  if (!strategies.length) {
    strategies = [owtrEntries.map((n) => String(n))]
  }
  const maxStrat = Math.min(
    Math.max(Number(process.env.SAP_CBP007_MAX_STRATEGIES) || 20, 1),
    36
  )
  strategies = strategies.slice(0, maxStrat)

  const { user: u, pass: p } = resolveSapCredentials(user, pass)
  const auth = Buffer.from(`${u}:${p}`, 'utf8').toString('base64')
  const perTryMs = Math.min(
    Math.max(Number(process.env.SAP_CBP007_TRY_TIMEOUT_MS) || 20000, 5000),
    180000
  )
  /** 전략×페이로드×URL 순차 호출이 길어지면 클라이언트만 타임아웃되는 문제 방지 */
  const rawBudget = String(process.env.SAP_CBP007_TOTAL_BUDGET_MS ?? '').trim()
  const totalBudgetMs =
    rawBudget === ''
      ? 90000
      : (() => {
          const n = Number(rawBudget)
          if (!Number.isFinite(n) || n <= 0) return 0
          return Math.min(Math.max(n, 5000), 600000)
        })()
  const rawMaxHttp = String(process.env.SAP_CBP007_MAX_HTTP_ATTEMPTS ?? '').trim()
  const maxHttpAttempts =
    rawMaxHttp === ''
      ? 72
      : (() => {
          const n = Number(rawMaxHttp)
          if (!Number.isFinite(n) || n <= 0) return 0
          return Math.min(Math.max(Math.floor(n), 1), 500)
        })()
  const tlsInsecure =
    String(process.env.SAP_CBP007_TLS_INSECURE || process.env.SAP_STOCK_TRANSFER_TLS_INSECURE || '')
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

  const attempts = []
  const failSnippets = []
  let lastStatus = 0
  let lastUrl = urls[0] || null
  let lastRequestBody = null

  const t0 = Date.now()
  let httpAttemptCount = 0

  cbp007Loop: for (let si = 0; si < strategies.length; si++) {
    const strategy = strategies[si]
    const keysJoined = strategy.join('|')
    const keysTag =
      keysJoined.length > 72 ? `${keysJoined.slice(0, 70)}…` : keysJoined
    const stratTag = `[#${si + 1}/${strategies.length}][keys:${keysTag}]`
    const variants = cbp007PayloadVariants(strategy)
    if (!variants.length || !variants[0]?.body) continue

    for (let vi = 0; vi < variants.length; vi++) {
      const variant = variants[vi]
      const bodyStr = JSON.stringify(variant.body)
      lastRequestBody = variant.body
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i]
        lastUrl = url
        if (totalBudgetMs > 0 && Date.now() - t0 > totalBudgetMs) {
          failSnippets.push(
            `[시간 상한] CBP007 전체 시도 ${totalBudgetMs}ms 초과(경과 ${Date.now() - t0}ms). ` +
              '클라이언트가 응답 대기만 하는 현상을 줄이기 위한 상한입니다. `SAP_CBP007_TOTAL_BUDGET_MS`(0=무제한), `SAP_CBP007_TRY_TIMEOUT_MS`, `SAP_CBP007_MAX_HTTP_ATTEMPTS`, `SAP_CBP007_MAX_INWH_CENTER_COMBOS`를 조정하세요.'
          )
          break cbp007Loop
        }
        if (maxHttpAttempts > 0 && httpAttemptCount >= maxHttpAttempts) {
          failSnippets.push(
            `[시도 횟수] HTTP ${maxHttpAttempts}회 상한 도달. ` +
              '`SAP_CBP007_MAX_HTTP_ATTEMPTS`(0=무제한)·`SAP_CBP007_MAX_STRATEGIES`·inwh·center 조합 수를 줄이세요.'
          )
          break cbp007Loop
        }
        httpAttemptCount += 1
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), perTryMs)
        try {
          const fetchOpts = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/plain;q=0.9',
              Authorization: `Basic ${auth}`,
              'X-KAI-Source': 'kai-stock-transfer-cancel',
            },
            body: bodyStr,
            signal: ctrl.signal,
          }
          if (url.startsWith('https:') && dispatcher) fetchOpts.dispatcher = dispatcher
          const res = await fetch(url, fetchOpts)
          clearTimeout(t)
          lastStatus = res.status
          const text = await res.text()
          let parsed = null
          try {
            parsed = JSON.parse(text)
          } catch (_) {}
          const ok = isCbp007ResponseSuccess(res, parsed)
          attempts.push(
            `POST ${url} ${stratTag}[${variant.label}] → HTTP ${res.status}`
          )
          if (ok) {
            return {
              ok: true,
              status: res.status,
              body: text.slice(0, 4000),
              usedUrl: url,
              requestBody: variant.body,
              payloadVariant: variant.label,
              erpReqStrategy: strategy,
              strategyIndex: si,
              owtrDocEntries: owtrEntries,
              cbp007LookupRows: lookupRows,
              cbp007LookupNotes: lookupNotes,
              cbp007PrependedStrategies: prependedErpReqStrategies.length
                ? prependedErpReqStrategies
                : undefined,
            }
          }
          const errLine =
            firstCbp007FailureSnippet(parsed, text) ||
            (String(text || '').trim() ? text.trim().slice(0, 200) : '(본문 없음)')
          failSnippets.push(`${stratTag}[${variant.label}] ${errLine}`)
          if (i < urls.length - 1) continue
        } catch (e) {
          clearTimeout(t)
          const detail = formatFetchError(e)
          attempts.push(`${url} ${stratTag}[${variant.label}]: ${detail}`)
          failSnippets.push(`${stratTag}[${variant.label}] ${detail}`)
          if (i < urls.length - 1 && isRetryableNetworkError(e)) continue
        }
      }
    }
  }

  const uniqFails = Array.from(new Set(failSnippets.filter(Boolean)))
  const inwhComboN = cbp007InwhCenterPairs().length
  const head =
    `시도한 erpReq 키 ${strategies.length}개 · inwh·center 조합 ${inwhComboN}가지 · OWTR DocEntry: ${owtrEntries.join(', ')}\n`
  const failBody =
    uniqFails.length > 24
      ? head +
        uniqFails.slice(0, 24).join('\n') +
        `\n… 외 ${uniqFails.length - 24}개 동일/유사 행 생략`
      : head + uniqFails.join('\n')

  const failJoined = uniqFails.join('\n')
  const hasTransportErr = /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|ECONNRESET/i.test(
    failJoined
  )
  const hasWmsAppErr =
    /SqlDataReader|Invalid attempt to read when no data|CommandText has not been initialized/i.test(
      failJoined
    )
  const transportOnly = hasTransportErr && !hasWmsAppErr

  const transportHint =
    '**네트워크 연결 실패**(`ECONNREFUSED`·`ETIMEDOUT` 등): WMS HTTP에 **도달하지 못했습니다.** SqlDataReader/no data와는 별개입니다. ' +
    '`SAP_CBP007_URL`·`SAP_CBP007_PORTS`·`SAP_CBP007_PATH_CANDIDATES`·호스트/포트·VPN·방화벽·WMS·게이트웨이 기동을 확인하고, **KAI 서버가 실행되는 환경**에서 해당 URL로 접근 가능한지 먼저 점검하세요.'

  const wmsKeyHint =
    'SqlDataReader **no data** 는 WMS 조회 0행입니다. `cbp007LookupRows`·`cbp007LookupNotes`를 확인하세요. ' +
    '관계맵·비고의 **재고이전요청(OWTQ) DocEntry**가 있으면 요청 본문 `erpReqExtra`(또는 질문에 `재고이전요청 70186` 형태)로 넘기면 OWTR DocEntry 대신 먼저 시도합니다. ' +
    '`bizSeq=0`은 서버에서 CommandText 오류를 낼 수 있어 기본 비활성입니다(`SAP_CBP007_BIZSEQ_TRY_ZERO=true`로만 시도). ' +
    '`SAP_CBP007_ERPREQ_EXTRA`·`SAP_CBP007_RAW_JSON`으로 WMS 키를 맞추세요. ' +
    '응답이 너무 늦으면 `SAP_CBP007_TOTAL_BUDGET_MS`·`SAP_CBP007_MAX_HTTP_ATTEMPTS`·`SAP_CBP007_TRY_TIMEOUT_MS`를 확인하세요.'

  let hint = '\n힌트: '
  if (transportOnly) {
    hint += transportHint
  } else {
    if (hasTransportErr) {
      hint += transportHint + ' '
    }
    hint += wmsKeyHint
  }
  return {
    ok: false,
    status: lastStatus || 200,
    body: (failBody || 'CBP007 응답 없음') + hint,
    usedUrl: lastUrl,
    requestBody: lastRequestBody,
    attempts: attempts.join('\n'),
    erpReqStrategiesTried: strategies,
    owtrDocEntries: owtrEntries,
    cbp007LookupRows: lookupRows,
    cbp007LookupNotes: lookupNotes,
    cbp007PrependedStrategies: prependedErpReqStrategies.length
      ? prependedErpReqStrategies
      : undefined,
  }
}
