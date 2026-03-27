/**
 * 미처리·입고 문서 조회 의도 → SAP OData GET
 * SAP_ODATA_INBOUND_PENDING_URL 우선, 없으면 SAP_ODATA_URL (날짜 치환은 동일)
 */

function formatYmd(d) {
  return d.toISOString().slice(0, 10)
}

/**
 * @returns {{ url: string | null, fromFallback: boolean, weekAgo: string, today: string }}
 */
export function buildInboundPendingOdataUrl() {
  const now = new Date()
  const today = formatYmd(now)
  const d7 = new Date(now.getTime())
  d7.setDate(d7.getDate() - 7)
  const weekAgo = formatYmd(d7)

  const template = (process.env.SAP_ODATA_INBOUND_PENDING_URL || '').trim()
  const fallback = (process.env.SAP_ODATA_URL || '').trim()
  const raw = template || fallback

  if (!raw) {
    return { url: null, fromFallback: false, weekAgo, today }
  }

  let url = raw
    .replace(/\{DATE_TODAY\}/g, today)
    .replace(/\{DATE_7D_AGO\}/g, weekAgo)
    .replace(/\{DATE_WEEK_AGO\}/g, weekAgo)

  return { url, fromFallback: !template && Boolean(fallback), weekAgo, today }
}

/**
 * "일주일 전까지 미처리된 입고 문서 보여줘" 등 — SAP에서 목록 조회 의도.
 * CBP002 전기(입고 처리해줘)와 구분.
 */
export function isInboundDocumentListIntent(q) {
  const s = String(q || '').trim()
  if (s.length < 4) return false
  const hasInboundWord = /입고|입하|GRN|goods\s*receipt/i.test(s)
  const hasSqlInboundHint =
    /\bOPDN\b|docdate|docentry|docnum|\[SBO_[A-Za-z0-9_]+\]\.\[dbo\]\.\[OPDN\]/i.test(
      s
    )
  if (!hasInboundWord && !hasSqlInboundHint) return false

  // JSON 직접 붙여넣기 등 CBP002 실행
  if (/\{[\s\S]*"reqList"[\s\S]*\}/i.test(s) && /erpReqNo|ReqList/i.test(s))
    return false

  const wantsList =
    /보여|조회|목록|검색|리스트|알려|찾아|현황|문서|내역|전표|뭐가|있는|어떤|출력|display|list|show|search/i.test(
      s
    )
  const pendingOrUnprocessed =
    /미처리|미처리된|처리안|처리\s*안|대기|백로그|미결|pending|unprocessed/i.test(s)
  const timeRef =
    /일주일|1주일|7\s*일|주일|주간|이번\s*주|지난주|며칠|기간|오늘|어제|까지|전까지|from|until/i.test(
      s
    )
  const docContext = /문서|내역|전표|건|리스트|목록|현황/i.test(s)

  // 입고 처리만 (조회 아님)
  if (
    /입고\s*처리\s*(?:해|줘|해줘|요청|해\s*주)/i.test(s) &&
    !/미처리|문서|목록|보여|조회|검색|리스트|현황|대기|pending|미결|전표|내역/i.test(
      s
    )
  ) {
    return false
  }

  if (hasSqlInboundHint && /show|조회|검색|목록|보여|where|from|select|문서|내역|결과/i.test(s)) {
    return true
  }
  if (wantsList && docContext && (hasInboundWord || hasSqlInboundHint)) return true
  if (wantsList && (pendingOrUnprocessed || timeRef) && (hasInboundWord || hasSqlInboundHint))
    return true
  if (pendingOrUnprocessed && docContext && (hasInboundWord || hasSqlInboundHint)) return true
  return false
}
