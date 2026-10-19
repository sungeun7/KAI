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

export function isInboundCloseIntent(q) {
  const s = String(q || '').trim()
  if (!s) return false
  const hasInbound =
    /입고|입하|입고\s*po|입고po|구매\s*입고|구매오더|OPDN|goods\s*receipt|docentry|docnum|\[SBO_[A-Za-z0-9_]+\]\.\[dbo\]\.\[OPDN\]/i.test(
      s
    )
  const hasClose = /마감|닫기|종결|close|closed/i.test(s)
  return hasInbound && hasClose
}

/**
 * 입고 예정 취소 — OPOR 연동 'C'+닫기, OPDN U_WMSNY 'N'
 */
export function isInboundScheduleCancelIntent(q) {
  const s = String(q || '').trim()
  if (!s) return false
  const hasInbound =
    /입고|입고\s*po|입고po|구매|발주|OPDN|OPOR|po|purchase/i.test(s)
  const hasScheduled = /예정|스케줄|scheduled|입고\s*예정/i.test(s)
  const hasCancel = /취소|cancel/i.test(s)
  return hasInbound && hasScheduled && hasCancel
}

/**
 * 출하 예정 취소 — ORDR+PKL1 / OWTQ 마감(SQL). `재고이전 OWTQ 취소`와 구분하려면 출하·예정·ORDR 등 문맥 필요.
 */
export function isOutboundScheduleCancelIntent(q) {
  const s = String(q || '').trim()
  if (!s) return false
  if (/입고\s*예정|입고예정/i.test(s)) return false
  if (!/취소|cancel/i.test(s)) return false
  if (/출하\s*예정|출하예정/i.test(s)) return true
  if (/출하/i.test(s) && /예정|스케줄/i.test(s)) return true
  if ((/\bORDR\b|판매\s*오더|납품\s*예정|피킹/i.test(s)) && /예정|스케줄/i.test(s))
    return true
  if (/\bOWTQ\b/i.test(s) && /출하|납품|판매/i.test(s)) return true
  if (
    /(재고\s*이전\s*요청|재고이전요청)/i.test(s) &&
    /취소|cancel/i.test(s) &&
    /출하\s*예정|출하예정|납품\s*예정/i.test(s)
  )
    return true
  return false
}

/**
 * 납품(ODLN) 전기 취소 — WMS **CVA003**(출하처리 취소). `출하 예정 취소`(SQL)와 구분.
 * `출하처리 취소` 문구도 여기로 보냄(납품 DI 취소).
 */
export function isCva003DeliveryCancelIntent(q) {
  const s = String(q || '').trim()
  if (!s) return false
  if (!/취소|cancel/i.test(s)) return false
  if (/입고\s*예정|입고예정/i.test(s)) return false
  /** `출하 예정 취소` 와 구분 — 납품/ODLN/출하처리(전기) 취소만 */
  if (/출하\s*처리\s*취소|출하처리\s*취소/i.test(s)) return true
  if (/납품\s*문서|납품\s*전기|\bODLN\b/i.test(s)) return true
  if (/납품\s*취소|취소\s*납품/i.test(s)) return true
  return false
}

/**
 * 출하예정취소 시 원천 문서가 재고이전요청(OWTQ)인지 판매오더(ORDR)인지.
 * `req.body.erpReqTypCd`가 없을 때 질문 키워드로 보조한다.
 * @returns {'OWTQ' | 'ORDR' | null}
 */
export function inferOutboundScheduleDocRole(q) {
  const s = String(q || '').trim()
  if (!s) return null
  if (/\bORDR\b|판매\s*오더|판매오더/i.test(s)) return 'ORDR'
  if (/(재고\s*이전\s*요청|재고이전요청|\bOWTQ\b)/i.test(s)) return 'OWTQ'
  return null
}

/** 질문에서 피킹 리스트 AbsEntry(ErpPickingNo) 추출 */
export function extractPickingAbsEntryFromQuestion(q) {
  const s = String(q || '')
  const patterns = [
    /(?:피킹|피킹리스트|AbsEntry|ErpPickingNo|PickList)\s*[:=#]?\s*(\d{1,10})/i,
    /AbsEntry\s*=\s*(\d{1,10})/i,
  ]
  for (const re of patterns) {
    const m = re.exec(s)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

/**
 * 반품요청(ORRR, B1 obj 915) 마감 — `입고 예정 취소`와 별도 (반품·ORRR 키워드).
 * JSON만 붙여넣은 경우 comments에 "마감" 등이 있어도 인식.
 */
export function isReturnRequestCloseIntent(q) {
  const s = String(q || '').trim()
  if (!s) return false
  const hasCancel = /취소|cancel/i.test(s)
  if (hasCancel) return false
  const looksLikeReturn =
    /반품\s*요청|반품요청|ORRR|return\s*request|RETURN_REQUEST|documentType\s*["']?\s*:\s*["']?915/i.test(
      s
    )
  const hasClose =
    /마감|닫기|종결|close/i.test(s) ||
    /"comments"\s*:\s*"[^"]*(?:마감|닫기|close)/i.test(s)
  return looksLikeReturn && hasClose
}

/**
 * 반품마감 취소(롤백): 원천 ORRR 기준으로 연결 ORDN/OWTR 취소 + ORRR 연동상태 복원(N).
 */
export function isReturnCloseCancelIntent(q) {
  const s = String(q || '').trim()
  if (!s) return false
  const looksLikeReturn =
    /반품\s*요청|반품요청|반품\s*마감|반품마감|ORRR|ORDN|OWTR|return\s*request|RETURN_REQUEST|documentType\s*["']?\s*:\s*["']?915/i.test(
      s
    )
  const hasCancel = /취소|cancel/i.test(s)
  return looksLikeReturn && hasCancel
}

/**
 * RETURN_REQUEST JSON 본문에서 docEntry 추출 (텍스트 DocEntry와 병합용).
 */
export function extractDocEntriesFromReturnRequestPayload(q) {
  const s = String(q || '')
  const out = []
  const seen = new Set()
  const tryPush = (n) => {
    const x = Number(n)
    if (Number.isFinite(x) && x > 0 && !seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  const collect = (j) => {
    if (!j || typeof j !== 'object') return
    if (Array.isArray(j.docEntries)) {
      for (const x of j.docEntries) tryPush(x)
    }
    for (const d of j.documents || []) {
      const h = d && d.header ? d.header : {}
      tryPush(h.docEntry ?? h.DocEntry ?? d.docEntry ?? d.DocEntry)
    }
    tryPush(j.docEntry ?? j.DocEntry)
  }
  const t = s.trim()
  if (t.startsWith('{')) {
    try {
      collect(JSON.parse(t))
    } catch (_) {
      /* ignore */
    }
  }
  const m = s.match(/\{[\s\S]*"documents"\s*:[\s\S]*\}/)
  if (m) {
    try {
      collect(JSON.parse(m[0]))
    } catch (_) {
      /* ignore */
    }
  }
  return out.slice(0, 200)
}

/**
 * 반품문서(ORDN) 생성 — CBP006 반품마감(DI). `반품 요청 마감`(SQL 전용)과 구분.
 * 키워드: 반품문서, 반품마감, ORDN, CBP006, RT01 등
 */
export function isReturnDocumentProcessingIntent(q) {
  const s = String(q || '').trim()
  if (!s) return false
  if (/취소|cancel/i.test(s)) return false
  if (/SQL\s*만|DB\s*만|U_WMSNY\s*만|직접\s*갱신/i.test(s)) return false
  if (
    /반품\s*문서|반품문서|ORDN|CBP006|RT01|반품\s*전표|반품전표|oReturns/i.test(s)
  ) {
    return true
  }
  if (/반품\s*마감|반품마감/i.test(s)) return true
  return false
}

/** 반품요청 마감용: 질문 숫자 + RETURN_REQUEST JSON의 docEntry 합집합 */
export function extractDocEntriesForReturnRequestClose(q) {
  const fromText = extractDocEntriesFromQuestion(q)
  const fromJson = extractDocEntriesFromReturnRequestPayload(q)
  const seen = new Set()
  const out = []
  for (const n of [...fromText, ...fromJson]) {
    if (!seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out.slice(0, 200)
}

export function isInboundCancelAndIssueIntent(q) {
  const s = String(q || '').trim()
  if (!s) return false
  const hasInbound =
    /입고|입하|OPDN|goods\s*receipt|입고po|입고\s*po|purchase\s*delivery/i.test(
      s
    )
  const hasCancel = /취소|cancel|canceled|cancelled/i.test(s)
  const hasIssue = /출고|출하|출고문서|goods\s*issue|oige|issue/i.test(s)
  return hasInbound && hasCancel && hasIssue
}

export function extractDocEntriesFromQuestion(q) {
  const s = String(q || '')
  const out = []
  const seen = new Set()

  const withLabel = s.matchAll(/DocEntry\s*[:=]?\s*(\d{1,10})/gi)
  for (const m of withLabel) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }

  const noLabel = s.matchAll(
    /(?:문서|전표|doc|entry)\s*(?:번호|no\.?)?\s*[:#]?\s*(\d{3,10})/gi
  )
  for (const m of noLabel) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }

  // 라벨이 없으면 긴 숫자 중 OPDN 문서번호 후보를 사용
  const allNums = s.match(/\b\d{4,10}\b/g) || []
  for (const raw of allNums) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out.slice(0, 200)
}
