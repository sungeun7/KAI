/**
 * 비고·질문에서 CBP007용 OWTQ/erpReq 숫자 후보 추출 (WMS 키가 OWTR DocEntry와 다를 때).
 */

/** 전각 숫자(０-９) → ASCII */
export function normalizeWideDigitsToAscii(s) {
  return String(s || '').replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)
  )
}

const PATTERNS = [
  /기준\s*재고\s*이전\s*요청\s*[:#]?\s*(\d{4,10})/gi,
  /기준\s*재고이전요청\s*[:#]?\s*(\d{4,10})/gi,
  /(?:기준\s*)?재고\s*이전\s*요청\s*[:#]?\s*(\d{4,10})/gi,
  /(?:기준\s*)?재고이전요청\s*[:#]?\s*(\d{4,10})/gi,
  /재고이전요청\s*[:#]?\s*(\d{4,10})/gi,
  /OWTQ\s*(?:DocEntry|문서)?\s*[:#]?\s*(\d{4,10})/gi,
  /erpReqExtra\s*[:=]\s*(\d{4,10})/gi,
]

/** @returns {number[]} */
export function extractCbp007ErpReqCandidatesFromText(text) {
  const s = normalizeWideDigitsToAscii(String(text || ''))
  const seen = new Set()
  const out = []
  for (const p of PATTERNS) {
    p.lastIndex = 0
    let m
    while ((m = p.exec(s)) !== null) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
        seen.add(n)
        out.push(n)
      }
    }
  }
  return out
}

/** @returns {number[] | null} */
export function extractCbp007ErpReqExtraFromText(text) {
  const arr = extractCbp007ErpReqCandidatesFromText(text)
  return arr.length ? arr : null
}

/** @returns {number[]} */
export function extractLooseErpReqDigitsFromText(text, excludeNums = []) {
  const s = normalizeWideDigitsToAscii(String(text || ''))
  const exclude = new Set(
    (Array.isArray(excludeNums) ? excludeNums : [])
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0)
  )
  const re = /\b(\d{5,8})\b/g
  const out = []
  const seen = new Set()
  let m
  while ((m = re.exec(s)) !== null) {
    const n = Number(m[1])
    if (!Number.isFinite(n) || n <= 0 || exclude.has(n) || seen.has(n)) continue
    if (n >= 2000 && n <= 2039) continue
    seen.add(n)
    out.push(n)
    if (out.length >= 16) break
  }
  return out
}

/** @returns {number[] | null} */
export function extractCbp007ErpReqHintsFromText(text, excludeNums = []) {
  const keyword = extractCbp007ErpReqCandidatesFromText(text)
  const baseExclude = [
    ...(Array.isArray(excludeNums) ? excludeNums : []).map((x) => Number(x)),
    ...keyword,
  ].filter((n) => Number.isFinite(n) && n > 0)
  const loose = extractLooseErpReqDigitsFromText(text, baseExclude)
  const out = [...keyword, ...loose]
  return out.length ? out : null
}
