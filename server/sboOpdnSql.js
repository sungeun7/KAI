/**
 * SAP Business One — 입고(PO) 헤더 OPDN (SQL Server)
 * 예: FROM [SBO_MACRO].[dbo].[OPDN] WHERE DocDate >= @fromDate
 */

import sql from 'mssql'
import {
  extractCbp007ErpReqCandidatesFromText,
  extractCbp007ErpReqHintsFromText,
  extractLooseErpReqDigitsFromText,
} from './cbp007ErpReqParse.js'

const DEFAULT_MAX_ROWS = 200

function formatYmd(d) {
  return d.toISOString().slice(0, 10)
}

/** 질문에서 YYYY-MM-DD 또는 YYYYMMDD */
export function parseInboundDocDateFromQuestion(question) {
  const s = String(question || '')
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(s)
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const compact = /\b(20\d{2})(\d{2})(\d{2})\b/.exec(s.replace(/\s/g, ' '))
  if (compact) {
    const d = new Date(
      `${compact[1]}-${compact[2]}-${compact[3]}T00:00:00`
    )
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function defaultFromDate() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  d.setHours(0, 0, 0, 0)
  return d
}

function getSqlConfig() {
  const connStr = (process.env.KAI_SBO_SQL_CONNECTION_STRING || '').trim()
  if (connStr) return connStr

  const server = (process.env.KAI_SBO_SQL_SERVER || '').trim()
  if (!server) return null

  const user = (process.env.KAI_SBO_SQL_USER || '').trim()
  const password = (process.env.KAI_SBO_SQL_PASSWORD || '').trim()
  if (!user) return null

  return {
    server,
    port: Number(process.env.KAI_SBO_SQL_PORT || 1433) || 1433,
    database: (process.env.KAI_SBO_SQL_DATABASE || 'SBO_MACRO').trim(),
    user,
    password,
    options: {
      encrypt: process.env.KAI_SBO_SQL_ENCRYPT !== 'false',
      trustServerCertificate:
        process.env.KAI_SBO_SQL_TRUST_CERT === 'true',
    },
    connectionTimeout: 20000,
    requestTimeout: Math.min(
      Math.max(Number(process.env.KAI_SBO_SQL_REQUEST_TIMEOUT_MS) || 120000, 5000),
      300000
    ),
  }
}

export function isSboSqlConfigured() {
  return getSqlConfig() != null
}

let poolPromise = null

async function getPool() {
  const cfg = getSqlConfig()
  if (!cfg) return null
  if (!poolPromise) {
    poolPromise = sql.connect(cfg).catch((e) => {
      poolPromise = null
      throw e
    })
  }
  return poolPromise
}

function getOpdnTableCandidates() {
  const explicit = (process.env.KAI_SBO_OPDN_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[OPDN]', '[SBO_MACRO].[dbo].[OPDN]']
}

function getPdn1TableCandidates() {
  const explicit = (process.env.KAI_SBO_PDN1_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[PDN1]', '[SBO_MACRO].[dbo].[PDN1]']
}

function getOporTableCandidates() {
  const explicit = (process.env.KAI_SBO_OPOR_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[OPOR]', '[SBO_MACRO].[dbo].[OPOR]']
}

function getOrrrTableCandidates() {
  const explicit = (process.env.KAI_SBO_ORRR_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[ORRR]', '[SBO_MACRO].[dbo].[ORRR]']
}

function getOrdnTableCandidates() {
  const explicit = (process.env.KAI_SBO_ORDN_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[ORDN]', '[SBO_MACRO].[dbo].[ORDN]']
}

function getRdn1TableCandidates() {
  const explicit = (process.env.KAI_SBO_RDN1_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[RDN1]', '[SBO_MACRO].[dbo].[RDN1]']
}

function getOwtrTableCandidates() {
  const explicit = (process.env.KAI_SBO_OWTR_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[OWTR]', '[SBO_MACRO].[dbo].[OWTR]']
}

function getWtr1TableCandidates() {
  const explicit = (process.env.KAI_SBO_WTR1_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[WTR1]', '[SBO_MACRO].[dbo].[WTR1]']
}

function getOwtqTableCandidates() {
  const explicit = (process.env.KAI_SBO_OWTQ_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[OWTQ]', '[SBO_MACRO].[dbo].[OWTQ]']
}

function getOrdrTableCandidates() {
  const explicit = (process.env.KAI_SBO_ORDR_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[ORDR]', '[SBO_MACRO].[dbo].[ORDR]']
}

/** 판매오더 라인 — CVA002(ORDR→ODLN) prodList 매핑용 */
function getRdr1TableCandidates() {
  const explicit = (process.env.KAI_SBO_RDR1_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[RDR1]', '[SBO_MACRO].[dbo].[RDR1]']
}

/** 피킹 리스트 라인 (판매오더 연결) */
function getPkl1TableCandidates() {
  const explicit = (process.env.KAI_SBO_PKL1_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[PKL1]', '[SBO_MACRO].[dbo].[PKL1]']
}

/** 납품 헤더 — 진단용(출하 예정 취소 시 ODLN 존재 여부) */
function getOdlNTableCandidates() {
  const explicit = (process.env.KAI_SBO_ODLN_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[ODLN]', '[SBO_MACRO].[dbo].[ODLN]']
}

/** 납품 라인 — ORDR BaseType=17 연계 조회 */
function getDln1TableCandidates() {
  const explicit = (process.env.KAI_SBO_DLN1_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[DLN1]', '[SBO_MACRO].[dbo].[DLN1]']
}

/**
 * 판매오더 DocEntry에 연결된 납품(ODLN) 목록 — 읽기 전용(BaseType 17)
 * @returns {Promise<{ odlDocEntry: number, odlDocNum: string, canceled: string }[]>}
 */
async function fetchLinkedOdlnsForOrdrDocEntry(pool, ordrDocEntry) {
  const de = Number(ordrDocEntry)
  if (!Number.isFinite(de) || de <= 0) return []
  const oTables = getOdlNTableCandidates()
  const lTables = getDln1TableCandidates()
  for (const oTable of oTables) {
    for (const lTable of lTables) {
      try {
        const r = await pool
          .request()
          .input('be', sql.Int, de)
          .query(
            `SELECT DISTINCT O.DocEntry AS OdlDocEntry, O.DocNum AS OdlDocNum, ISNULL(O.CANCELED,'N') AS Canceled
             FROM ${oTable} O
             INNER JOIN ${lTable} L ON O.DocEntry = L.DocEntry
             WHERE L.BaseType = 17 AND L.BaseEntry = @be`
          )
        if (r.recordset?.length) {
          return r.recordset.map((row) => ({
            odlDocEntry: Number(row.OdlDocEntry ?? row.odlDocEntry),
            odlDocNum: row.OdlDocNum != null ? String(row.OdlDocNum) : '',
            canceled: String(row.Canceled ?? row.canceled ?? 'N').trim(),
          }))
        }
      } catch {
        /* try next */
      }
    }
  }
  return []
}

function getWtq1TableCandidates() {
  const explicit = (process.env.KAI_SBO_WTQ1_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[WTQ1]', '[SBO_MACRO].[dbo].[WTQ1]']
}

function getRrr1TableCandidates() {
  const explicit = (process.env.KAI_SBO_RRR1_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[RRR1]', '[SBO_MACRO].[dbo].[RRR1]']
}

/** 반품요청(ORRR) 라인별 배치 — B1 BTR1 (없으면 BTQ1과 동일 패턴 시도) */
function getBtr1TableCandidates() {
  const explicit = (process.env.KAI_SBO_BTR1_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[BTR1]', '[SBO_MACRO].[dbo].[BTR1]']
}

/** 재고이전요청 라인별 배치(B1 BTQ1 → OBTN.DistNumber) */
function getBtq1TableCandidates() {
  const explicit = (process.env.KAI_SBO_BTQ1_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[BTQ1]', '[SBO_MACRO].[dbo].[BTQ1]']
}

/** 사용자 정의 연동 필드 (예: U_WMSNY) — SQL 식별자 화이트리스트 */
function linkFieldBracket(envKey, def) {
  const n = String(process.env[envKey] || def).trim()
  if (!/^U_[A-Za-z0-9_]+$/.test(n)) return `[${def}]`
  return `[${n}]`
}

function getIbt1TableCandidates() {
  const explicit = (process.env.KAI_SBO_IBT1_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[IBT1]', '[SBO_MACRO].[dbo].[IBT1]']
}

function getObtqTableCandidates() {
  const explicit = (process.env.KAI_SBO_OBTQ_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[OBTQ]', '[SBO_MACRO].[dbo].[OBTQ]']
}

function getObtnTableCandidates() {
  const explicit = (process.env.KAI_SBO_OBTN_TABLE || '').trim()
  if (explicit) return [explicit]
  return ['[dbo].[OBTN]', '[SBO_MACRO].[dbo].[OBTN]']
}

/**
 * 입고(PO) 라인 PDN1 → CSM001용 Lines (취소 후 역출고)
 */
export function buildStockTransferProposalFromPdnLines(rows, docEntries) {
  const toWh = (
    process.env.KAI_SBO_CANCEL_OUTBOUND_TO_WH ||
    process.env.SAP_DEFAULT_TO_WAREHOUSE ||
    'AA100'
  )
    .trim()
    .toUpperCase()
  const fallbackFr = (process.env.SAP_DEFAULT_FROM_WAREHOUSE || 'AA120')
    .trim()
    .toUpperCase()

  const pickCodeFromDesc = (desc) => {
    const s = String(desc || '').trim()
    if (!s) return ''
    const m = s.match(/[A-Za-z0-9][A-Za-z0-9._\-\/]{2,}/)
    return m ? m[0] : ''
  }

  const Lines = (Array.isArray(rows) ? rows : [])
    .filter(
      (r) =>
        r &&
        String(r.ItemCode ?? r.Dscription ?? '').trim() &&
        Number(r.Quantity) > 0
    )
    .map((r) => {
      const wh = String(r.WhsCode ?? r.whsCode ?? '').trim().toUpperCase()
      const batch = String(r.BatchNum ?? r.batchNum ?? '').trim()
      const fallbackCode = pickCodeFromDesc(r.Dscription)
      const code = String(r.ItemCode ?? '').trim() || fallbackCode
      return {
        ItemCode: code,
        Quantity: Number(r.Quantity) || 0,
        ItemDescription: String(r.Dscription ?? '').trim(),
        FromWarehouse: wh || fallbackFr,
        ToWarehouse: toWh,
        ErpBatchNo: batch,
        LotNo: '',
        ExpYmd: '',
      }
    })

  const label = Array.isArray(docEntries) ? docEntries.join(',') : String(docEntries || '')
  return {
    Lines,
    JournalRemark: `입고취소 역출고 OPDN DocEntry ${label}`,
    ItemCode: Lines[0]?.ItemCode,
    matnr: Lines[0]?.ItemCode,
    Quantity: Lines[0]?.Quantity,
    menge: Lines[0]?.Quantity,
  }
}

/**
 * OPDN DocEntry 목록에 대한 PDN1 라인 (품목·수량·창고)
 */
export async function fetchPdn1LinesForDocEntries(docEntries) {
  const tables = getPdn1TableCandidates()
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry 없음',
      rows: [],
      table: tables[0],
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      rows: [],
      table: tables[0],
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      rows: [],
      table: tables[0],
    }
  }

  const placeholders = unique.map((_, i) => `@d${i}`).join(', ')
  const tried = []
  for (const table of tables) {
    try {
      const req = pool.request()
      unique.forEach((v, i) => req.input(`d${i}`, sql.Int, v))
      const q = `
SELECT
  DocEntry,
  LineNum,
  ItemCode,
  Dscription,
  Quantity,
  WhsCode
FROM ${table}
WHERE DocEntry IN (${placeholders})
ORDER BY DocEntry, LineNum
`.trim()
      const result = await req.query(q)
      const rows = result.recordset || []

      // 배치번호는 기본적으로 조회 생략(속도 우선). 필요 시에만 별도 조회.
      const useBatchLookup =
        String(process.env.KAI_SBO_PDN1_FETCH_BATCH || '').trim().toLowerCase() ===
        'true'
      if (!useBatchLookup || !rows.length) {
        return { ok: true, rows, table, entries: unique }
      }

      const ibtTables = getIbt1TableCandidates()
      for (const ibt of ibtTables) {
        try {
          const rq = pool.request()
          unique.forEach((v, i) => rq.input(`d${i}`, sql.Int, v))
          const bq = `
SELECT BaseEntry, BaseLinNum, ItemCode, BatchNum
FROM ${ibt}
WHERE BaseType = 20
  AND BaseEntry IN (${placeholders})
  AND ISNULL(Quantity, 0) > 0
`.trim()
          const br = await rq.query(bq)
          const bRows = br.recordset || []
          const key = (e, l, i) => `${e}|${l}|${i}`
          const map = new Map()
          for (const b of bRows) {
            map.set(
              key(
                Number(b.BaseEntry),
                Number(b.BaseLinNum),
                String(b.ItemCode || '').trim()
              ),
              String(b.BatchNum || '').trim()
            )
          }
          const merged = rows.map((r) => ({
            ...r,
            BatchNum:
              map.get(
                key(
                  Number(r.DocEntry),
                  Number(r.LineNum),
                  String(r.ItemCode || '').trim()
                )
              ) || '',
          }))
          return { ok: true, rows: merged, table, ibtTable: ibt, entries: unique }
        } catch (be) {
          tried.push(`${table} + ${ibt}: ${String(be?.message || be)}`)
        }
      }
      return { ok: true, rows, table, entries: unique }
    } catch (e) {
      tried.push(`${table}: ${String(e?.message || e)}`)
    }
  }
  return {
    ok: false,
    error: tried.join(' | '),
    rows: [],
    table: tables[0],
    entries: unique,
  }
}

/**
 * 재고이전 요청(OWTQ) DocEntry에 대한 WTQ1 라인 — CSM001 prodList 매핑용
 */
export async function fetchWtq1LinesForDocEntries(docEntries) {
  const tables = getWtq1TableCandidates()
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry 없음',
      rows: [],
      table: tables[0],
      entries: [],
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      rows: [],
      table: tables[0],
      entries: unique,
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      rows: [],
      table: tables[0],
      entries: unique,
    }
  }

  const placeholders = unique.map((_, i) => `@d${i}`).join(', ')
  const tried = []
  for (const table of tables) {
    try {
      const req = pool.request()
      unique.forEach((v, i) => req.input(`d${i}`, sql.Int, v))
      const q = `
SELECT *
FROM ${table}
WHERE DocEntry IN (${placeholders})
ORDER BY DocEntry, LineNum
`.trim()
      const result = await req.query(q)
      const rows = result.recordset || []
      if (rows.length) {
        const en = await enrichWtq1LinesWithBatch(rows)
        return {
          ok: true,
          rows: en.rows || rows,
          table,
          entries: unique,
          batchEnrich: en.source || null,
          batchEnrichError: en.ok ? null : en.error || null,
        }
      }
      tried.push(`${table}: 행 없음`)
    } catch (e) {
      tried.push(`${table}: ${String(e?.message || e)}`)
    }
  }
  return {
    ok: false,
    error: tried.join(' | ') || 'WTQ1 없음',
    rows: [],
    table: tables[0],
    entries: unique,
  }
}

/**
 * ORDR 헤더에서 입력 숫자가 DocEntry인지 문서번호(DocNum)인지 해석 → DocEntry 목록
 * (SAP B1 화면에 보이는 번호는 DocNum인 경우가 많음)
 */
async function resolveOrdrDocEntriesViaHeader(pool, ids) {
  const ordrTables = getOrdrTableCandidates()
  const resolved = []
  /** @type {Map<number, number>} 입력값 → DocEntry */
  const inputToDocEntry = new Map()
  for (const n of ids) {
    let de = null
    for (const ot of ordrTables) {
      try {
        const r1 = await pool
          .request()
          .input('n', sql.Int, n)
          .query(`SELECT TOP 1 DocEntry FROM ${ot} WHERE DocEntry = @n`)
        if (r1.recordset?.length) {
          de = Number(r1.recordset[0].DocEntry)
          break
        }
        const r2 = await pool
          .request()
          .input('n', sql.Int, n)
          .query(`SELECT TOP 1 DocEntry FROM ${ot} WHERE DocNum = @n`)
        if (r2.recordset?.length) {
          de = Number(r2.recordset[0].DocEntry)
          break
        }
      } catch {
        /* 다음 테이블 */
      }
    }
    if (Number.isFinite(de) && de > 0) {
      resolved.push(de)
      inputToDocEntry.set(n, de)
    }
  }
  const uniqueDe = Array.from(new Set(resolved))
  return { uniqueDocEntries: uniqueDe, inputToDocEntry }
}

/**
 * CVA003 납품(ODLN) 취소용 — 판매오더 DocEntry/문서번호에 묶인 **미취소** 납품 헤더 `U_WMSDOCNUM`·`U_WMSNUM`
 * @param {number|string} inputKey — ORDR DocEntry 또는 DocNum
 */
export async function fetchOdlNUdfForOrdrCancel(inputKey) {
  const n = Number(inputKey)
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'DocEntry/문서번호가 없습니다.' }
  }
  if (!isSboSqlConfigured()) {
    return { ok: false, error: 'SQL 미설정(KAI_SBO_SQL_*)' }
  }
  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
  if (!pool) return { ok: false, error: 'SQL 연결 없음' }

  const { uniqueDocEntries, inputToDocEntry } =
    await resolveOrdrDocEntriesViaHeader(pool, [n])
  const ordrDe = uniqueDocEntries[0]
  if (!Number.isFinite(ordrDe) || ordrDe <= 0) {
    return { ok: false, error: 'ORDR에서 DocEntry/문서번호를 찾지 못했습니다.' }
  }

  const oTables = getOdlNTableCandidates()
  const lTables = getDln1TableCandidates()

  /** DLN1·ORDR 연결 납품 목록(진단) — 최대 10행 */
  async function queryLinkedOdlns(includeCanceled) {
    const rows = []
    const cancelClause = includeCanceled
      ? ''
      : ` AND ISNULL(O.CANCELED,'N')='N' `
    for (const oTable of oTables) {
      for (const lTable of lTables) {
        try {
          const r = await pool
            .request()
            .input('be', sql.Int, ordrDe)
            .query(
              `SELECT TOP 10 O.DocEntry AS OdlDocEntry, O.DocNum AS OdlDocNum,
                ISNULL(O.CANCELED,'N') AS Canceled,
                LTRIM(RTRIM(CAST(O.[U_WMSDOCNUM] AS NVARCHAR(200)))) AS U_WMSDOCNUM,
                LTRIM(RTRIM(CAST(O.[U_WMSNUM] AS NVARCHAR(200)))) AS U_WMSNUM
               FROM ${oTable} O
               INNER JOIN ${lTable} L ON O.DocEntry = L.DocEntry
               WHERE L.BaseType = 17 AND L.BaseEntry = @be ${cancelClause}
               ORDER BY O.DocEntry DESC`
            )
          if (r.recordset?.length) {
            for (const row of r.recordset) {
              rows.push({
                odlDocEntry: Number(row.OdlDocEntry ?? row.odlDocEntry),
                odlDocNum:
                  row.OdlDocNum != null ? String(row.OdlDocNum) : '',
                canceled: String(row.Canceled ?? row.canceled ?? 'N').trim(),
                u_WMSDOCNUM: String(row.U_WMSDOCNUM ?? row.u_WMSDOCNUM ?? '').trim(),
                u_WMSNUM: String(row.U_WMSNUM ?? row.u_WMSNUM ?? '').trim(),
              })
            }
            return rows
          }
        } catch {
          /* try next */
        }
      }
    }
    return []
  }

  for (const oTable of oTables) {
    for (const lTable of lTables) {
      try {
        const r = await pool
          .request()
          .input('be', sql.Int, ordrDe)
          .query(
            `SELECT TOP 1 O.DocEntry AS OdlDocEntry,
              LTRIM(RTRIM(CAST(O.[U_WMSDOCNUM] AS NVARCHAR(200)))) AS WmsDocNum,
              LTRIM(RTRIM(CAST(O.[U_WMSNUM] AS NVARCHAR(200)))) AS WmsNum
             FROM ${oTable} O
             INNER JOIN ${lTable} L ON O.DocEntry = L.DocEntry
             WHERE L.BaseType = 17 AND L.BaseEntry = @be AND ISNULL(O.CANCELED,'N')='N'
             ORDER BY O.DocEntry DESC`
          )
        if (r.recordset?.length) {
          const row = r.recordset[0]
          const wmsReqNo = String(row.WmsDocNum ?? row.wmsDocNum ?? '').trim()
          const procBundleNo = String(row.WmsNum ?? row.wmsNum ?? '').trim()
          if (wmsReqNo && procBundleNo) {
            return {
              ok: true,
              ordrDocEntry: ordrDe,
              odlDocEntry: Number(row.OdlDocEntry ?? row.odlDocEntry),
              wmsReqNo,
              procBundleNo,
              docNumResolvedFrom: inputToDocEntry.has(n) ? n : null,
              via: 'ordr_dln1',
            }
          }
        }
      } catch {
        /* try next */
      }
    }
  }

  /** ORDR→DLN1 조인이 비는 경우: 숫자를 **납품(ODLN) DocEntry/DocNum** 으로 직접 조회 후 DLN1에서 판매오더(BaseType=17) 확인 */
  const tryKeys = Array.from(
    new Set(
      [n, ordrDe].filter((x) => Number.isFinite(x) && x > 0)
    )
  )
  for (const tryK of tryKeys) {
    for (const oTable of oTables) {
      try {
        const r = await pool
          .request()
          .input('k', sql.Int, tryK)
          .query(
            `SELECT TOP 1 O.DocEntry AS OdlDocEntry,
              LTRIM(RTRIM(CAST(O.[U_WMSDOCNUM] AS NVARCHAR(200)))) AS U_WMSDOCNUM,
              LTRIM(RTRIM(CAST(O.[U_WMSNUM] AS NVARCHAR(200)))) AS U_WMSNUM
             FROM ${oTable} O
             WHERE (O.DocEntry = @k OR O.DocNum = @k) AND ISNULL(O.CANCELED,'N')='N'
             ORDER BY O.DocEntry DESC`
          )
        if (!r.recordset?.length) continue
        const row = r.recordset[0]
        const w1 = String(row.U_WMSDOCNUM ?? row.u_WMSDOCNUM ?? '').trim()
        const w2 = String(row.U_WMSNUM ?? row.u_WMSNUM ?? '').trim()
        if (!w1 || !w2) continue
        const odlDocEntry = Number(row.OdlDocEntry ?? row.odlDocEntry)
        let ordrFromLine = null
        for (const lTable of lTables) {
          try {
            const r2 = await pool
              .request()
              .input('de', sql.Int, odlDocEntry)
              .query(
                `SELECT TOP 1 BaseType, BaseEntry FROM ${lTable} WHERE DocEntry = @de ORDER BY LineNum`
              )
            const br = r2.recordset?.[0]
            const bt = Number(br?.BaseType ?? br?.basetype)
            const be = Number(br?.BaseEntry ?? br?.baseentry)
            if (bt === 17 && Number.isFinite(be) && be > 0) {
              ordrFromLine = be
              break
            }
          } catch {
            /* try next */
          }
        }
        if (!ordrFromLine) continue
        return {
          ok: true,
          ordrDocEntry: ordrFromLine,
          odlDocEntry,
          wmsReqNo: w1,
          procBundleNo: w2,
          docNumResolvedFrom: inputToDocEntry.has(n) ? n : null,
          via: 'odl_header_direct',
        }
      } catch {
        /* try next */
      }
    }
  }

  const linkedOpen = await queryLinkedOdlns(false)
  const linkedAny =
    linkedOpen.length > 0 ? linkedOpen : await queryLinkedOdlns(true)

  let errorMsg =
    '미취소 납품(ODLN)이 없거나 U_WMSDOCNUM/U_WMSNUM이 비어 있습니다. B1 납품 헤더를 확인하세요.'
  if (linkedOpen.length === 0 && linkedAny.length === 0) {
    errorMsg =
      '판매오더(DocEntry=' +
      ordrDe +
      ')에 DLN1로 연결된 납품이 없고, 같은 숫자를 **납품(ODLN) DocEntry/DocNum** 으로 직접 조회해도 미취소 납품·U_WMSDOCNUM/U_WMSNUM을 찾지 못했습니다. ' +
      '입력이 **납품 문서번호**인지 **판매오더**인지 구분해 보거나, `KAI_SBO_ODLN_TABLE`·`KAI_SBO_DLN1_TABLE` 이 실제 회사 DB와 맞는지 확인하세요.'
  } else if (linkedOpen.length) {
    const emptyUdf = linkedOpen.filter(
      (x) => !x.u_WMSDOCNUM || !x.u_WMSNUM
    )
    if (emptyUdf.length) {
      errorMsg =
        '미취소 납품은 있으나 **헤더 U_WMSDOCNUM / U_WMSNUM** 이 비어 있습니다. CVA003은 이 두 필드로 납품을 찾습니다. B1에서 사용자정의 필드를 채우거나, WMS에 등록된 출하번호·묶음번호를 알아 **`POST /api/query` body**에 `wmsReqNo`, `procBundleNo` 로 넘기세요.'
    }
  } else if (linkedAny.length && linkedAny.every((x) => x.canceled === 'Y')) {
    errorMsg =
      '이 판매오더에 연결된 납품은 **이미 취소**(CANCELED=Y)로 보입니다.'
  }

  return {
    ok: false,
    error: errorMsg,
    ordrDocEntry: ordrDe,
    linkedDeliveries: linkedAny.length ? linkedAny : undefined,
  }
}

/** OWTQ 헤더 — DocEntry 또는 DocNum → DocEntry */
async function resolveOwtqDocEntriesViaHeader(pool, ids) {
  const owtqTables = getOwtqTableCandidates()
  const resolved = []
  /** @type {Map<number, number>} */
  const inputToDocEntry = new Map()
  for (const n of ids) {
    let de = null
    for (const ot of owtqTables) {
      try {
        const r1 = await pool
          .request()
          .input('n', sql.Int, n)
          .query(`SELECT TOP 1 DocEntry FROM ${ot} WHERE DocEntry = @n`)
        if (r1.recordset?.length) {
          de = Number(r1.recordset[0].DocEntry)
          break
        }
        const r2 = await pool
          .request()
          .input('n', sql.Int, n)
          .query(`SELECT TOP 1 DocEntry FROM ${ot} WHERE DocNum = @n`)
        if (r2.recordset?.length) {
          de = Number(r2.recordset[0].DocEntry)
          break
        }
      } catch {
        /* 다음 테이블 */
      }
    }
    if (Number.isFinite(de) && de > 0) {
      resolved.push(de)
      inputToDocEntry.set(n, de)
    }
  }
  const uniqueDe = Array.from(new Set(resolved))
  return { uniqueDocEntries: uniqueDe, inputToDocEntry }
}

/**
 * OB91·OB93 기타출하용 WTQ1/OWTQ 조회 실패 시 — 번호가 판매오더인지 OWTQ인지 안내
 */
async function diagnoseCva002OwtqNumberMismatch(pool, n) {
  const num = Number(n)
  if (!Number.isFinite(num) || num <= 0) return ''
  let inOrdr = false
  let inOwtq = false
  for (const ot of getOrdrTableCandidates()) {
    try {
      const r = await pool
        .request()
        .input('n', sql.Int, num)
        .query(
          `SELECT TOP 1 1 AS x FROM ${ot} WHERE DocEntry = @n OR DocNum = @n`
        )
      if (r.recordset?.length) {
        inOrdr = true
        break
      }
    } catch {
      /* 다음 테이블 */
    }
  }
  for (const ot of getOwtqTableCandidates()) {
    try {
      const r = await pool
        .request()
        .input('n', sql.Int, num)
        .query(
          `SELECT TOP 1 1 AS x FROM ${ot} WHERE DocEntry = @n OR DocNum = @n`
        )
      if (r.recordset?.length) {
        inOwtq = true
        break
      }
    } catch {
      /* 다음 테이블 */
    }
  }
  if (inOrdr && !inOwtq) {
    return (
      ' **진단:** 이 번호는 **판매오더(ORDR)** 에는 있으나 **재고이전요청(OWTQ)** 에는 없습니다. ' +
      'OB91·기타출하는 **OWTQ** 의 DocEntry/문서번호를 입력하세요. ' +
      '납품(판매오더 출고)이면 출하유형을 **OB03** 등으로 두고 ORDR·RDR1 경로로 질문하세요.'
    )
  }
  if (!inOrdr && inOwtq) {
    return (
      ' **진단:** OWTQ 헤더는 있는데 WTQ1이 비었거나 다른 DB를 보고 있을 수 있습니다. ' +
      '요청 취소·마감 여부와 `KAI_SBO_WTQ1_TABLE` 을 확인하세요.'
    )
  }
  if (!inOrdr && !inOwtq) {
    return (
      ' **진단:** ORDR·OWTQ 어느 쪽에도 DocEntry/DocNum이 없습니다. ' +
      '번호 오타·다른 회사 DB(`KAI_SBO_SQL_DATABASE`)·`KAI_SBO_ORDR_TABLE`/`KAI_SBO_OWTQ_TABLE` 지정을 확인하세요.'
    )
  }
  return ''
}

/**
 * @returns {{ ok: true, rows: any[], table: string, tried: string[] } | { ok: false, tried: string[] }}
 */
async function tryRdr1QueryAcrossTables(pool, tables, entries) {
  const tried = []
  if (!entries.length) return { ok: false, tried: ['조회 DocEntry 없음'] }
  const placeholders = entries.map((_, i) => `@d${i}`).join(', ')
  for (const table of tables) {
    try {
      const req = pool.request()
      entries.forEach((v, i) => req.input(`d${i}`, sql.Int, v))
      const q = `
SELECT *
FROM ${table}
WHERE DocEntry IN (${placeholders})
ORDER BY DocEntry, LineNum
`.trim()
      const result = await req.query(q)
      const rows = result.recordset || []
      if (rows.length) return { ok: true, rows, table, tried }
      tried.push(`${table}: 행 없음`)
    } catch (e) {
      tried.push(`${table}: ${String(e?.message || e)}`)
    }
  }
  return { ok: false, tried }
}

/**
 * @returns {{ ok: true, rows: any[], table: string, tried: string[] } | { ok: false, tried: string[] }}
 */
async function tryWtq1QueryAcrossTables(pool, tables, entries) {
  const tried = []
  if (!entries.length) return { ok: false, tried: ['조회 DocEntry 없음'] }
  const placeholders = entries.map((_, i) => `@d${i}`).join(', ')
  for (const table of tables) {
    try {
      const req = pool.request()
      entries.forEach((v, i) => req.input(`d${i}`, sql.Int, v))
      const q = `
SELECT *
FROM ${table}
WHERE DocEntry IN (${placeholders})
ORDER BY DocEntry, LineNum
`.trim()
      const result = await req.query(q)
      const rows = result.recordset || []
      if (rows.length) return { ok: true, rows, table, tried }
      tried.push(`${table}: 행 없음`)
    } catch (e) {
      tried.push(`${table}: ${String(e?.message || e)}`)
    }
  }
  return { ok: false, tried }
}

function intSetsEqualSorted(a, b) {
  const sa = [...new Set(a)].sort((x, y) => x - y)
  const sb = [...new Set(b)].sort((x, y) => x - y)
  if (sa.length !== sb.length) return false
  return sa.every((v, i) => v === sb[i])
}

/**
 * 판매오더(ORDR) DocEntry에 대한 RDR1 라인 — CVA002 ORDR·ODLN prodList 매핑용
 * RDR1에 행이 없으면 ORDR에서 DocNum으로 DocEntry를 찾아 재조회합니다.
 */
export async function fetchRdr1LinesForOrdrDocEntries(docEntries) {
  const tables = getRdr1TableCandidates()
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry 없음',
      rows: [],
      table: tables[0],
      entries: [],
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      rows: [],
      table: tables[0],
      entries: unique,
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      rows: [],
      table: tables[0],
      entries: unique,
    }
  }

  const first = await tryRdr1QueryAcrossTables(pool, tables, unique)
  if (first.ok) {
    const firstDe = Number(first.rows[0]?.DocEntry ?? first.rows[0]?.docentry)
    return {
      ok: true,
      rows: first.rows,
      table: first.table,
      entries: unique,
      resolvedOrdrDocEntry: Number.isFinite(firstDe) ? firstDe : undefined,
      docNumResolved: false,
    }
  }
  let tried = first.tried

  const allowDocNum =
    String(process.env.KAI_SBO_RDR1_RESOLVE_DOCNUM || 'true')
      .trim()
      .toLowerCase() !== 'false'
  if (!allowDocNum) {
    return {
      ok: false,
      error: tried.join(' | ') || 'RDR1 없음',
      rows: [],
      table: tables[0],
      entries: unique,
    }
  }

  const { uniqueDocEntries, inputToDocEntry } = await resolveOrdrDocEntriesViaHeader(
    pool,
    unique
  )
  if (!uniqueDocEntries.length) {
    return {
      ok: false,
      error:
        (tried.join(' | ') || 'RDR1 없음') +
        ' ORDR에서 DocEntry/DocNum 매칭 실패(회사 DB·`KAI_SBO_ORDR_TABLE`·번호 확인).',
      rows: [],
      table: tables[0],
      entries: unique,
      docNumLookupTried: true,
    }
  }
  if (intSetsEqualSorted(uniqueDocEntries, unique)) {
    return {
      ok: false,
      error:
        tried.join(' | ') ||
        'RDR1 없음(ORDR 헤더는 있으나 라인 없음·오더 상태 확인)',
      rows: [],
      table: tables[0],
      entries: unique,
      docNumLookupTried: true,
    }
  }

  const second = await tryRdr1QueryAcrossTables(pool, tables, uniqueDocEntries)
  if (second.ok) {
    const firstDe = Number(second.rows[0]?.DocEntry ?? second.rows[0]?.docentry)
    const mapped =
      unique.length === 1 ? inputToDocEntry.get(unique[0]) : undefined
    return {
      ok: true,
      rows: second.rows,
      table: second.table,
      entries: unique,
      resolvedOrdrDocEntry: Number.isFinite(firstDe) ? firstDe : mapped,
      docNumResolved: true,
      resolvedDocEntries: uniqueDocEntries,
    }
  }
  tried = [...tried, ...second.tried]

  return {
    ok: false,
    error: tried.join(' | ') || 'RDR1 없음',
    rows: [],
    table: tables[0],
    entries: unique,
    docNumLookupTried: true,
    resolvedDocEntries: uniqueDocEntries,
  }
}

/**
 * 재고이전요청(OWTQ) DocEntry에 대한 WTQ1 — CVA002 기타출하·OB91/93(OIGE) prodList 자동 채움
 * (DocNum→DocEntry 해석은 `KAI_SBO_WTQ1_RESOLVE_DOCNUM`, 기본 true)
 */
export async function fetchWtq1LinesForOwtqDocEntries(docEntries) {
  const tables = getWtq1TableCandidates()
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry 없음',
      rows: [],
      table: tables[0],
      entries: [],
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      rows: [],
      table: tables[0],
      entries: unique,
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      rows: [],
      table: tables[0],
      entries: unique,
    }
  }

  const first = await tryWtq1QueryAcrossTables(pool, tables, unique)
  if (first.ok) {
    const en = await enrichWtq1LinesWithBatch(first.rows)
    const rows = en.rows || first.rows
    const firstDe = Number(rows[0]?.DocEntry ?? rows[0]?.docentry)
    return {
      ok: true,
      rows,
      table: first.table,
      entries: unique,
      resolvedOwtqDocEntry: Number.isFinite(firstDe) ? firstDe : undefined,
      docNumResolved: false,
      batchEnrich: en.source || null,
      batchEnrichError: en.ok ? null : en.error || null,
    }
  }
  let tried = first.tried

  const allowDocNum =
    String(process.env.KAI_SBO_WTQ1_RESOLVE_DOCNUM || 'true')
      .trim()
      .toLowerCase() !== 'false'
  if (!allowDocNum) {
    return {
      ok: false,
      error: tried.join(' | ') || 'WTQ1 없음',
      rows: [],
      table: tables[0],
      entries: unique,
    }
  }

  const { uniqueDocEntries, inputToDocEntry } = await resolveOwtqDocEntriesViaHeader(
    pool,
    unique
  )
  if (!uniqueDocEntries.length) {
    const hint =
      unique.length === 1
        ? await diagnoseCva002OwtqNumberMismatch(pool, unique[0])
        : ''
    return {
      ok: false,
      error:
        (tried.join(' | ') || 'WTQ1 없음') +
        ' OWTQ에서 DocEntry/DocNum 매칭 실패(회사 DB·`KAI_SBO_OWTQ_TABLE`·번호 확인).' +
        hint,
      rows: [],
      table: tables[0],
      entries: unique,
      docNumLookupTried: true,
    }
  }
  if (intSetsEqualSorted(uniqueDocEntries, unique)) {
    return {
      ok: false,
      error:
        tried.join(' | ') ||
        'WTQ1 없음(OWTQ 헤더는 있으나 라인 없음·요청 상태 확인)',
      rows: [],
      table: tables[0],
      entries: unique,
      docNumLookupTried: true,
    }
  }

  const second = await tryWtq1QueryAcrossTables(pool, tables, uniqueDocEntries)
  if (second.ok) {
    const en = await enrichWtq1LinesWithBatch(second.rows)
    const rows = en.rows || second.rows
    const firstDe = Number(rows[0]?.DocEntry ?? rows[0]?.docentry)
    const mapped =
      unique.length === 1 ? inputToDocEntry.get(unique[0]) : undefined
    return {
      ok: true,
      rows,
      table: second.table,
      entries: unique,
      resolvedOwtqDocEntry: Number.isFinite(firstDe) ? firstDe : mapped,
      docNumResolved: true,
      resolvedDocEntries: uniqueDocEntries,
      batchEnrich: en.source || null,
      batchEnrichError: en.ok ? null : en.error || null,
    }
  }
  tried = [...tried, ...second.tried]

  return {
    ok: false,
    error: tried.join(' | ') || 'WTQ1 없음',
    rows: [],
    table: tables[0],
    entries: unique,
    docNumLookupTried: true,
    resolvedDocEntries: uniqueDocEntries,
  }
}

/**
 * 반품요청(ORRR) DocEntry에 대한 RRR1 라인 — CBP006 prodList 매핑용
 */
export async function fetchRrr1LinesForDocEntries(docEntries) {
  const tables = getRrr1TableCandidates()
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry 없음',
      rows: [],
      table: tables[0],
      entries: [],
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      rows: [],
      table: tables[0],
      entries: unique,
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      rows: [],
      table: tables[0],
      entries: unique,
    }
  }

  const placeholders = unique.map((_, i) => `@d${i}`).join(', ')
  const tried = []
  for (const table of tables) {
    try {
      const req = pool.request()
      unique.forEach((v, i) => req.input(`d${i}`, sql.Int, v))
      const q = `
SELECT *
FROM ${table}
WHERE DocEntry IN (${placeholders})
ORDER BY DocEntry, LineNum
`.trim()
      const result = await req.query(q)
      const rows = result.recordset || []
      if (rows.length) {
        const en = await enrichRrr1LinesWithBatch(rows)
        return {
          ok: true,
          rows: en.rows || rows,
          table,
          entries: unique,
          batchEnrich: en.source || null,
          batchEnrichError: en.ok ? null : en.error || null,
        }
      }
      tried.push(`${table}: 행 없음`)
    } catch (e) {
      tried.push(`${table}: ${String(e?.message || e)}`)
    }
  }
  return {
    ok: false,
    error: tried.join(' | ') || 'RRR1 없음',
    rows: [],
    table: tables[0],
    entries: unique,
  }
}

/**
 * erpBatchNo가 숫자만 길게(OBTN.AbsEntry 후보)일 때 → OBTN.DistNumber 로 치환.
 * CBP006 DI는 BatchNumbers.BatchNumber 에 DistNumber(예: 11411-053@260906) 가 필요함.
 */
async function lookupObtnDistNumberByAbsEntry(pool, absStr) {
  const n = Number(absStr)
  if (!Number.isFinite(n) || n <= 0) return null
  for (const ot of getObtnTableCandidates()) {
    for (const typ of [sql.BigInt, sql.Int]) {
      try {
        if (typ === sql.Int && n > 2147483647) continue
        const r = await pool
          .request()
          .input('a', typ, Math.floor(n))
          .query(`SELECT TOP 1 DistNumber FROM ${ot} WHERE AbsEntry = @a`)
        const dn = r.recordset?.[0]?.DistNumber
        if (dn != null && String(dn).trim()) return String(dn).trim()
      } catch {
        /* try next type/table */
      }
    }
  }
  return null
}

/**
 * 반품요청(ORRR) DocEntry + 라인 → BTR1 또는 BTQ1 + OBTN.DistNumber (DI BatchNumber용)
 * AbsEntry 단독 조회가 실패할 때 라인 단위가 더 정확함.
 */
async function lookupDistFromOrrrLineBatchTables(pool, docEntry, lineNum, itemCode) {
  if (!Number.isFinite(docEntry) || docEntry <= 0) return null
  const base = Number.isFinite(Number(lineNum)) ? Number(lineNum) : 0
  const lineCandidates = Array.from(
    new Set(
      [base, base + 1, base - 1].filter((x) => Number.isFinite(x) && x >= 0)
    )
  )
  const ic = String(itemCode ?? '').trim()
  const lineTables = [...getBtr1TableCandidates(), ...getBtq1TableCandidates()]
  const obtnTables = getObtnTableCandidates()

  const tryQuery = async (withItem, ln) => {
    for (const lt of lineTables) {
      for (const tn of obtnTables) {
        for (const joinCol of ['AbsEntry', 'MdAbsEntry']) {
          try {
            const rq = pool
              .request()
              .input('de', sql.Int, docEntry)
              .input('ln', sql.Int, ln)
            let q = `
SELECT TOP 1 n.DistNumber AS DistNum
FROM ${lt} b
INNER JOIN ${tn} n ON n.AbsEntry = b.${joinCol}
WHERE b.DocEntry = @de AND (b.LineNum = @ln OR b.VisOrder = @ln)
`.trim()
            if (withItem && ic) {
              rq.input('ic', sql.NVarChar(200), ic)
              q += ` AND b.ItemCode = @ic`
            }
            const r = await rq.query(q)
            const dn = r.recordset?.[0]?.DistNum ?? r.recordset?.[0]?.DistNumber
            if (dn != null && String(dn).trim()) return String(dn).trim()
          } catch {
            /* next */
          }
        }
      }
    }
    return null
  }

  for (const ln of lineCandidates) {
    let d = await tryQuery(true, ln)
    if (!d && ic) d = await tryQuery(false, ln)
    if (d) return d
  }
  return null
}

/**
 * 판매오더(ORDR) 라인 → BTQ1+OBTN DistNumber (CVA002 ODLN `ErpBatchNo`).
 * DocType/ObjType 17 우선, 실패 시 DocType 조건 없이 조회(동일 DocEntry 혼선 가능·최후 수단).
 */
async function lookupDistFromOrdrLineBatchTables(pool, docEntry, lineNum, itemCode) {
  if (!Number.isFinite(docEntry) || docEntry <= 0) return null
  const base = Number.isFinite(Number(lineNum)) ? Number(lineNum) : 0
  const lineCandidates = Array.from(
    new Set(
      [base, base + 1, base - 1].filter((x) => Number.isFinite(x) && x >= 0)
    )
  )
  const ic = String(itemCode ?? '').trim()
  const lineTables = getBtq1TableCandidates()
  const obtnTables = getObtnTableCandidates()
  const docTypeWheres = [
    'AND (b.DocType = 17)',
    'AND (b.ObjType = 17)',
    '',
  ]

  const tryQuery = async (withItem, ln, dtWhere) => {
    for (const lt of lineTables) {
      for (const tn of obtnTables) {
        for (const joinCol of ['MdAbsEntry', 'AbsEntry']) {
          try {
            const rq = pool
              .request()
              .input('de', sql.Int, docEntry)
              .input('ln', sql.Int, ln)
            let q = `
SELECT TOP 1 n.DistNumber AS DistNum
FROM ${lt} b
INNER JOIN ${tn} n ON n.AbsEntry = b.${joinCol}
WHERE b.DocEntry = @de AND (b.LineNum = @ln OR b.VisOrder = @ln)
${dtWhere}
`.trim()
            if (withItem && ic) {
              rq.input('ic', sql.NVarChar(200), ic)
              q += ` AND b.ItemCode = @ic`
            }
            const r = await rq.query(q)
            const dn = r.recordset?.[0]?.DistNum ?? r.recordset?.[0]?.DistNumber
            if (dn != null && String(dn).trim()) return String(dn).trim()
          } catch {
            /* 컬럼 없음·스키마 차이 */
          }
        }
      }
    }
    return null
  }

  for (const ln of lineCandidates) {
    for (const dtWhere of docTypeWheres) {
      let d = await tryQuery(true, ln, dtWhere)
      if (!d && ic) d = await tryQuery(false, ln, dtWhere)
      if (d) return d
    }
  }
  return lookupDistFromOrrrLineBatchTables(pool, docEntry, lineNum, itemCode)
}

/** 창고+품목 재고(OBTQ)에서 DistNumber — BTQ1 실패 시 CVA002 배치 대체 */
async function lookupObtqDistForItemWhs(pool, itemCode, whsCode) {
  const ic = String(itemCode || '').trim()
  const wh = String(whsCode || '').trim().toUpperCase()
  if (!ic || !wh) return null
  const obtqTables = getObtqTableCandidates()
  const obtnTables = getObtnTableCandidates()
  for (const tq of obtqTables) {
    for (const tn of obtnTables) {
      for (const joinCol of ['MdAbsEntry', 'AbsEntry']) {
        try {
          const q = `
SELECT TOP 1 n.DistNumber AS DistNum
FROM ${tq} q
INNER JOIN ${tn} n ON n.AbsEntry = q.${joinCol}
WHERE q.ItemCode = @ic
  AND UPPER(LTRIM(RTRIM(q.WhsCode))) = @wh
  AND ISNULL(q.Quantity, 0) > 0
ORDER BY q.Quantity DESC
`.trim()
          const r = await pool
            .request()
            .input('ic', sql.NVarChar(200), ic)
            .input('wh', sql.NVarChar(50), wh)
            .query(q)
          const dn = r.recordset?.[0]?.DistNum ?? r.recordset?.[0]?.DistNumber
          if (dn != null && String(dn).trim()) return String(dn).trim()
        } catch {
          /* next */
        }
      }
    }
  }
  return null
}

/**
 * CVA002 ORDR prodList 라인에 `erpBatchNo`(OBTN DistNumber) 보강 — DI 480000112 방지
 */
export async function enrichCva002OrdrProdListBatches(docEntry, prodList) {
  const de = Number(docEntry)
  const src = Array.isArray(prodList) ? prodList : []
  if (!Number.isFinite(de) || de <= 0 || !src.length) {
    return { ok: true, prodList: src, resolved: [], source: 'skip' }
  }
  if (
    String(process.env.KAI_SBO_CVA002_RESOLVE_BATCH || 'true')
      .trim()
      .toLowerCase() === 'false'
  ) {
    return { ok: true, prodList: src, resolved: [], source: 'skipped' }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return { ok: false, prodList: src, error: String(e?.message || e), resolved: [] }
  }
  if (!pool) return { ok: false, prodList: src, error: 'SQL 연결 설정 없음', resolved: [] }

  const resolved = []
  const out = []
  for (const p of src) {
    const prev = String(p.erpBatchNo ?? p.ErpBatchNo ?? '').trim()
    const lineNum = Number(p.erpLineNo ?? p.ErpLineNo ?? 0)
    const itemCode = String(p.ifProdId ?? p.IfProdId ?? '').trim()
    const whs = String(p.frWh ?? p.FrWh ?? '').trim()
    let dist = prev
    let via = ''
    if (!dist) {
      dist = await lookupDistFromOrdrLineBatchTables(pool, de, lineNum, itemCode)
      if (dist) via = 'BTQ1+OBTN(ORDR)'
    }
    if (!dist && itemCode && whs) {
      dist = await lookupObtqDistForItemWhs(pool, itemCode, whs)
      if (dist) via = 'OBTQ+OBTN(재고)'
    }
    if (via && dist) {
      resolved.push({ erpLineNo: lineNum, itemCode, via, to: dist })
    }
    out.push({
      ...p,
      erpBatchNo: dist || prev,
      ...(p.ErpBatchNo !== undefined ? { ErpBatchNo: dist || prev } : {}),
    })
  }
  return {
    ok: true,
    prodList: out,
    resolved,
    source: resolved.length ? 'enriched' : 'none',
  }
}

/**
 * applyCva002Defaults 직후 — ORDR 요청만 prodList 배치 보강
 */
export async function enrichCva002OrdrRequestIfNeeded(normalized) {
  if (!normalized || typeof normalized !== 'object') return normalized
  const list = normalized.reqList || normalized.ReqList
  if (!Array.isArray(list) || !list[0]) return normalized
  const h = list[0]
  if (String(h.erpReqTypCd ?? h.ErpReqTypCd ?? '').toUpperCase() !== 'ORDR') {
    return normalized
  }
  const de = Number(h.erpReqNo ?? h.ErpReqNo)
  const prodList = h.prodList || h.ProdList
  if (!Number.isFinite(de) || de <= 0 || !Array.isArray(prodList) || !prodList.length) {
    return normalized
  }
  const r = await enrichCva002OrdrProdListBatches(de, prodList)
  if (!r.ok || !Array.isArray(r.prodList)) return normalized
  const newH = { ...h, prodList: r.prodList }
  return { ...normalized, reqList: [newH, ...list.slice(1)] }
}

/**
 * CVA002 기타출고(OIGE·OB91/93) 전송 실패 시 — WMS C#이 실행하는 SQL과 유사하게 OWTQ·ZSM108 존재 여부만 진단 (CVA002 수정 없음).
 * @returns {{ ok: boolean, owtqOk: boolean, zsm108RowCount: number, zsmAcctPresent: boolean, hints: string[] }}
 */
export async function diagnoseCva002OigeReadiness(opts) {
  const off =
    String(process.env.KAI_SBO_CVA002_DIAG_OIGE || 'true')
      .trim()
      .toLowerCase() === 'false'
  if (off) {
    return {
      ok: false,
      owtqOk: false,
      zsm108RowCount: 0,
      zsmAcctPresent: false,
      hints: [],
      skipped: true,
    }
  }
  const de = Number(opts?.docEntry)
  const code = String(opts?.etcOutbizTypeCd || '').trim()
  const item = String(opts?.itemCode || '').trim()
  const hints = []
  let owtqOk = false
  let zsmRows = 0
  let zsmAcctPresent = false

  if (!Number.isFinite(de) || de <= 0) {
    return {
      ok: false,
      owtqOk: false,
      zsm108RowCount: 0,
      zsmAcctPresent: false,
      hints: ['DocEntry 없음'],
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      owtqOk: false,
      zsm108RowCount: 0,
      zsmAcctPresent: false,
      hints: [],
      error: String(e?.message || e),
    }
  }
  if (!pool) {
    return {
      ok: false,
      owtqOk: false,
      zsm108RowCount: 0,
      zsmAcctPresent: false,
      hints: [],
    }
  }

  for (const ot of getOwtqTableCandidates()) {
    try {
      const r = await pool
        .request()
        .input('de', sql.Int, de)
        .query(`SELECT TOP 1 DocEntry FROM ${ot} WHERE DocEntry = @de`)
      if (r.recordset?.length) {
        owtqOk = true
        break
      }
    } catch {
      /* 다음 테이블 */
    }
  }
  if (!owtqOk) {
    hints.push(
      `KAI SQL DB에서 **OWTQ DocEntry ${de}** 행을 찾지 못했습니다. WMS **DefaultConnection**과 KAI **KAI_SBO_SQL_DATABASE**·**OWTQ 테이블**이 같은 회사 DB인지 확인하세요.`
    )
  }

  if (code && item) {
    const qFull = `
SELECT TOP 15 ZSM108L.U_AcctCode AS Acct, OITM.AvgPrice AS AvgP
FROM [dbo].[@ZSM108H] ZSM108H
LEFT JOIN [dbo].[@ZSM108L] ZSM108L ON ZSM108H.Code = ZSM108L.Code
LEFT JOIN [dbo].[OITB] OITB ON OITB.ItmsGrpCod = ZSM108L.U_ItemGCod
LEFT JOIN [dbo].[OITM] OITM ON OITM.ItemCode = @item AND OITM.ItmsGrpCod = ZSM108L.U_ItemGCod
WHERE ZSM108H.Code = @code
`.trim()
    try {
      const rFull = await pool
        .request()
        .input('item', sql.NVarChar(200), item)
        .input('code', sql.NVarChar(50), code)
        .query(qFull)
      const rows = rFull.recordset || []
      zsmRows = rows.length
      for (const row of rows) {
        const acct = row.Acct ?? row.U_AcctCode
        if (acct != null && String(acct).trim() !== '') {
          zsmAcctPresent = true
          break
        }
      }

      if (zsmRows === 0) {
        let headerCnt = -1
        let lineCnt = -1
        try {
          const h1 = await pool
            .request()
            .input('code', sql.NVarChar(50), code)
            .query(
              `SELECT COUNT(1) AS c FROM [dbo].[@ZSM108H] WHERE Code = @code`
            )
          headerCnt = Number(h1.recordset?.[0]?.c ?? 0)
        } catch {
          headerCnt = -1
        }
        try {
          const h2 = await pool
            .request()
            .input('code', sql.NVarChar(50), code)
            .query(
              `SELECT COUNT(1) AS c FROM [dbo].[@ZSM108L] WHERE Code = @code`
            )
          lineCnt = Number(h2.recordset?.[0]?.c ?? 0)
        } catch {
          lineCnt = -1
        }

        if (headerCnt === 0) {
          let sampleCodes = ''
          try {
            const sc = await pool.request()
              .query(`SELECT TOP 8 Code FROM [dbo].[@ZSM108H] ORDER BY Code`)
            const arr = (sc.recordset || [])
              .map((x) => x.Code)
              .filter(Boolean)
            if (arr.length) sampleCodes = ` DB에 있는 Code 예: \`${arr.join('`, `')}\`.`
          } catch {
            /* 테이블 없음 등 */
          }
          hints.push(
            `**[@ZSM108H]** 에 \`Code='${code}'\` 행이 **없습니다**. 출고(OIGE)가 만들어지려면 B1 **사용자 정의 테이블** ZSM108 헤더에 **${code}** 가 있어야 합니다.${sampleCodes} \`EtcOutbizTypeCd\`·\`OutbizTypeCd\`를 실제 마스터 코드에 맞추거나 **${code}** 를 등록하세요.`
          )
        } else if (headerCnt < 0) {
          hints.push(
            '`[@ZSM108H]` COUNT 조회 실패 — 테이블·스키마·권한·DB 선택을 확인하세요.'
          )
        } else if (lineCnt === 0) {
          hints.push(
            `**[@ZSM108H]** 에 \`${code}\` 는 있으나 **[@ZSM108L]** 라인이 **0건**입니다. 품목군별 **U_AcctCode** 를 ZSM108 라인에 추가하세요.`
          )
        } else {
          hints.push(
            `조인 결과만 0행(헤더 ${headerCnt}, 라인 ${lineCnt}). WMS **DefaultConnection** DB와 KAI **KAI_SBO_SQL_DATABASE** 가 **동일 회사 DB**인지 확인하세요.`
          )
        }
      } else if (!zsmAcctPresent) {
        hints.push(
          `ZSM108 행은 ${zsmRows}건이나 **U_AcctCode** 가 비어 있습니다. 해당 품목군 줄에 계정을 넣으세요.`
        )
      }
    } catch (e) {
      hints.push(
        `ZSM108 진단 SQL 실패: ${String(e?.message || e).slice(0, 240)}. 테이블·DB·스키마를 확인하세요.`
      )
    }
  } else {
    hints.push('EtcOutbizTypeCd·품목코드가 없어 ZSM108 진단을 생략했습니다.')
  }

  const ok = owtqOk && zsmRows > 0 && zsmAcctPresent
  return {
    ok,
    owtqOk,
    zsm108RowCount: zsmRows,
    zsmAcctPresent,
    hints,
  }
}

function looksLikeObtnAbsEntryBatchString(s) {
  const t = String(s ?? '').trim()
  if (!t || /[a-z@]/i.test(t)) return false
  if (!/^\d+$/.test(t)) return false
  const minLen = Math.max(
    8,
    Math.min(20, Number(process.env.KAI_SBO_OBTN_ABS_ENTRY_MIN_LEN) || 10)
  )
  return t.length >= minLen
}

/**
 * @returns {{ ok: boolean, body: object, resolved: Array<{ from: string, to: string }>, error?: string }}
 */
export async function resolveCbp006RequestBodyBatches(requestBody) {
  const off =
    String(process.env.KAI_SBO_CBP006_RESOLVE_OBTN_BATCH || 'true')
      .trim()
      .toLowerCase() === 'false'
  if (off || !requestBody || typeof requestBody !== 'object') {
    return { ok: true, body: requestBody, resolved: [] }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return { ok: false, body: requestBody, resolved: [], error: String(e?.message || e) }
  }
  if (!pool) {
    return { ok: false, body: requestBody, resolved: [], error: 'SQL 연결 없음' }
  }

  const resolved = []
  const newBody = JSON.parse(JSON.stringify(requestBody))
  const list = newBody.reqList || newBody.ReqList
  if (!Array.isArray(list)) return { ok: true, body: newBody, resolved: [] }

  const lineFirst =
    String(process.env.KAI_SBO_CBP006_RESOLVE_LINE_FIRST || 'true')
      .trim()
      .toLowerCase() !== 'false'

  for (const req of list) {
    const docEntry = Number(req.erpReqNo ?? req.ErpReqNo ?? NaN)
    const prods = req.prodList || req.ProdList
    if (!Array.isArray(prods)) continue
    for (const p of prods) {
      const prev = String(p.erpBatchNo ?? p.ErpBatchNo ?? '').trim()
      const lineNum = Number(p.erpLineNo ?? p.ErpLineNo ?? 0)
      const itemCode = String(p.ifProdId ?? p.IfProdId ?? '').trim()

      let dist = null
      let via = ''
      if (lineFirst && Number.isFinite(docEntry) && docEntry > 0) {
        dist = await lookupDistFromOrrrLineBatchTables(
          pool,
          docEntry,
          lineNum,
          itemCode
        )
        if (dist) via = 'BTR1/BTQ1+OBTN(라인)'
      }
      if (!dist && prev && looksLikeObtnAbsEntryBatchString(prev)) {
        dist = await lookupObtnDistNumberByAbsEntry(pool, prev)
        if (dist) via = 'OBTN(AbsEntry)'
      }

      if (dist) {
        p.erpBatchNo = dist
        if (p.ErpBatchNo !== undefined) p.ErpBatchNo = dist
        resolved.push({
          from: prev || '(없음)',
          to: dist,
          via,
        })
      }
    }
  }

  return { ok: true, body: newBody, resolved }
}

function rrrRowHasBatch(r) {
  if (!r || typeof r !== 'object') return false
  const keys = [
    r.BatchNum,
    r.batchNum,
    r.DistNumber,
    r.distNumber,
    r.VBatchNum,
    r.SubCatNum,
    r.U_Batch,
    r.U_ErpBatch,
    r.ErpBatchNo,
    r.BatchNumber,
  ]
  for (const v of keys) {
    if (String(v ?? '').trim()) return true
  }
  return false
}

function applyBatchMapToRrrRows(src, map, mapLoose) {
  return src.map((row) => {
    if (rrrRowHasBatch(row)) return row
    const de = Number(row.DocEntry ?? row.docentry)
    const ln = Number(row.LineNum ?? row.linenum)
    const ic = String(row.ItemCode ?? row.itemcode ?? '').trim()
    let bn =
      map.get(wtqLineKey(de, ln, ic)) ||
      map.get(wtqLineKey(de, ln + 1, ic)) ||
      map.get(wtqLineKey(de, ln - 1, ic)) ||
      mapLoose.get(wtqItemKey(de, ic)) ||
      ''
    bn = String(bn || '').trim()
    if (!bn) return row
    return { ...row, BatchNum: bn, DistNumber: bn }
  })
}

/**
 * RRR1에 배치가 비어 있을 때: BTR1+OBTN → BTQ1+OBTN(ORRR DocEntry 동일)
 */
export async function enrichRrr1LinesWithBatch(rows) {
  const src = Array.isArray(rows) ? rows : []
  if (!src.length) return { ok: true, rows: src, source: 'none' }
  if (!src.some((r) => !rrrRowHasBatch(r))) {
    return { ok: true, rows: src, source: 'already' }
  }
  if (String(process.env.KAI_SBO_RRR1_BATCH_ENRICH || '').trim().toLowerCase() === 'false') {
    return { ok: true, rows: src, source: 'skipped' }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return { ok: false, rows: src, error: String(e?.message || e), source: 'pool' }
  }
  if (!pool) return { ok: false, rows: src, error: 'SQL 연결 설정 없음', source: 'pool' }

  const docSet = new Set()
  for (const r of src) {
    const de = Number(r.DocEntry ?? r.docentry)
    if (Number.isFinite(de) && de > 0) docSet.add(de)
  }
  const unique = Array.from(docSet).slice(0, 200)
  if (!unique.length) return { ok: true, rows: src, source: 'no-doc' }

  const placeholders = unique.map((_, i) => `@d${i}`).join(', ')
  const obtnTables = getObtnTableCandidates()
  const btqTables = getBtq1TableCandidates()
  const btrTables = getBtr1TableCandidates()
  const tried = []
  let merged = src.map((r) => ({ ...r }))

  const tryJoin = async (lineTable, label) => {
    for (const bt of lineTable) {
      for (const tn of obtnTables) {
        for (const joinCol of ['AbsEntry', 'MdAbsEntry']) {
          try {
            const req = pool.request()
            unique.forEach((v, i) => req.input(`d${i}`, sql.Int, v))
            const q = `
SELECT
  b.DocEntry,
  b.LineNum,
  b.ItemCode,
  n.DistNumber AS BatchNum
FROM ${bt} b
INNER JOIN ${tn} n ON n.AbsEntry = b.${joinCol}
WHERE b.DocEntry IN (${placeholders})
`.trim()
            const result = await req.query(q)
            const bRows = result.recordset || []
            if (!bRows.length) {
              tried.push(`${label}${bt}+${tn}: 행 없음`)
              continue
            }
            const map = new Map()
            const mapLoose = new Map()
            for (const b of bRows) {
              const bn = String(b.BatchNum || '').trim()
              if (!bn) continue
              const k1 = wtqLineKey(b.DocEntry, b.LineNum, b.ItemCode)
              if (!map.has(k1)) map.set(k1, bn)
              const k2 = wtqItemKey(b.DocEntry, b.ItemCode)
              if (!mapLoose.has(k2)) mapLoose.set(k2, bn)
            }
            merged = applyBatchMapToRrrRows(merged, map, mapLoose)
            if (merged.every(rrrRowHasBatch)) {
              return `${label}${bt}+${tn}+${joinCol}`
            }
            tried.push(`${label}${bt}+${tn}: 일부만`)
          } catch (e) {
            tried.push(`${label}${bt}: ${String(e?.message || e)}`)
          }
        }
      }
    }
    return null
  }

  let srcTag = await tryJoin(btrTables, 'BTR1:')
  if (!srcTag) srcTag = await tryJoin(btqTables, 'BTQ1:')

  if (merged.every(rrrRowHasBatch)) {
    return { ok: true, rows: merged, source: srcTag || 'joined' }
  }
  return {
    ok: true,
    rows: merged,
    source: srcTag || tried.join(' | ') || 'partial',
  }
}

function wtqRowHasBatch(r) {
  if (!r || typeof r !== 'object') return false
  const v = String(
    r.BatchNum ??
      r.batchNum ??
      r.DistNumber ??
      r.distNumber ??
      r.VBatchNum ??
      ''
  ).trim()
  return Boolean(v)
}

function wtqLineKey(de, line, item) {
  return `${Number(de)}|${Number(line)}|${String(item || '').trim()}`
}

function wtqItemKey(de, item) {
  return `${Number(de)}|${String(item || '').trim()}`
}

function getOwtqIbt1BaseType() {
  const raw = (process.env.KAI_SBO_OWTQ_IBT1_BASE_TYPE || '1250000001').trim()
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return n
  return 1250000001
}

function applyBatchMapToRows(src, map, mapLoose) {
  return src.map((r) => {
    if (wtqRowHasBatch(r)) return r
    const de = Number(r.DocEntry ?? r.docentry)
    const ln = Number(r.LineNum ?? r.linenum)
    const ic = String(r.ItemCode ?? r.itemcode ?? '').trim()
    let bn =
      map.get(wtqLineKey(de, ln, ic)) ||
      map.get(wtqLineKey(de, ln + 1, ic)) ||
      map.get(wtqLineKey(de, ln - 1, ic)) ||
      mapLoose.get(wtqItemKey(de, ic)) ||
      ''
    bn = String(bn || '').trim()
    if (!bn) return r
    return { ...r, BatchNum: bn, DistNumber: bn }
  })
}

/**
 * WTQ1에 배치가 비어 있을 때: BTQ1+OBTN → IBT1(OWTQ BaseType)+OBTN → 출고창고+품목 OBTQ+OBTN
 */
export async function enrichWtq1LinesWithBatch(rows) {
  const src = Array.isArray(rows) ? rows : []
  if (!src.length) return { ok: true, rows: src, source: 'none' }
  if (!src.some((r) => !wtqRowHasBatch(r))) {
    return { ok: true, rows: src, source: 'already' }
  }
  if (String(process.env.KAI_SBO_WTQ1_BATCH_ENRICH || '').trim().toLowerCase() === 'false') {
    return { ok: true, rows: src, source: 'skipped' }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return { ok: false, rows: src, error: String(e?.message || e), source: 'pool' }
  }
  if (!pool) return { ok: false, rows: src, error: 'SQL 연결 설정 없음', source: 'pool' }

  const docSet = new Set()
  for (const r of src) {
    const de = Number(r.DocEntry ?? r.docentry)
    if (Number.isFinite(de) && de > 0) docSet.add(de)
  }
  const unique = Array.from(docSet).slice(0, 200)
  if (!unique.length) return { ok: true, rows: src, source: 'no-doc' }

  const placeholders = unique.map((_, i) => `@d${i}`).join(', ')
  const btqTables = getBtq1TableCandidates()
  const obtnTables = getObtnTableCandidates()
  const ibtTables = getIbt1TableCandidates()
  const obtqTables = getObtqTableCandidates()
  const tried = []
  let merged = src.map((r) => ({ ...r }))
  const owtqBt = getOwtqIbt1BaseType()

  const tryBtq1Obtn = async () => {
    for (const bt of btqTables) {
      for (const tn of obtnTables) {
        for (const joinCol of ['AbsEntry', 'MdAbsEntry']) {
          try {
            const req = pool.request()
            unique.forEach((v, i) => req.input(`d${i}`, sql.Int, v))
            const q = `
SELECT
  b.DocEntry,
  b.LineNum,
  b.ItemCode,
  n.DistNumber AS BatchNum
FROM ${bt} b
INNER JOIN ${tn} n ON n.AbsEntry = b.${joinCol}
WHERE b.DocEntry IN (${placeholders})
`.trim()
            const result = await req.query(q)
            const bRows = result.recordset || []
            if (!bRows.length) {
              tried.push(`${bt}+${tn}+${joinCol}: 행 없음`)
              continue
            }
            const map = new Map()
            const mapLoose = new Map()
            for (const b of bRows) {
              const bn = String(b.BatchNum || '').trim()
              if (!bn) continue
              const k1 = wtqLineKey(b.DocEntry, b.LineNum, b.ItemCode)
              if (!map.has(k1)) map.set(k1, bn)
              const k2 = wtqItemKey(b.DocEntry, b.ItemCode)
              if (!mapLoose.has(k2)) mapLoose.set(k2, bn)
            }
            merged = applyBatchMapToRows(merged, map, mapLoose)
            if (merged.every(wtqRowHasBatch)) {
              return `${bt}+${tn}+${joinCol}`
            }
            tried.push(`${bt}+${tn}+${joinCol}: 일부만`)
          } catch (e) {
            tried.push(`${bt}+${tn}+${joinCol}: ${String(e?.message || e)}`)
          }
        }
      }
    }
    return null
  }

  const tryIbt1Obtn = async () => {
    for (const it of ibtTables) {
      for (const tn of obtnTables) {
        for (const lineCol of ['BaseLine', 'BaseLinNum']) {
          try {
            const req = pool.request()
            req.input('bt', sql.Int, owtqBt)
            unique.forEach((v, i) => req.input(`d${i}`, sql.Int, v))
            const q = `
SELECT
  i.BaseEntry AS DocEntry,
  i.${lineCol} AS LineNum,
  i.ItemCode,
  n.DistNumber AS BatchNum
FROM ${it} i
INNER JOIN ${tn} n ON n.AbsEntry = i.MdAbsEntry
WHERE i.BaseType = @bt
  AND i.BaseEntry IN (${placeholders})
`.trim()
            const result = await req.query(q)
            const bRows = result.recordset || []
            if (!bRows.length) {
              tried.push(`${it}+${tn}+${lineCol}: 행 없음`)
              continue
            }
            const map = new Map()
            const mapLoose = new Map()
            for (const b of bRows) {
              const bn = String(b.BatchNum || '').trim()
              if (!bn) continue
              const k1 = wtqLineKey(b.DocEntry, b.LineNum, b.ItemCode)
              if (!map.has(k1)) map.set(k1, bn)
              const k2 = wtqItemKey(b.DocEntry, b.ItemCode)
              if (!mapLoose.has(k2)) mapLoose.set(k2, bn)
            }
            merged = applyBatchMapToRows(merged, map, mapLoose)
            if (merged.every(wtqRowHasBatch)) {
              return `${it}+${tn}+IBT1@${lineCol}`
            }
            tried.push(`${it}+${tn}+${lineCol}: 일부만`)
          } catch (e) {
            tried.push(`${it}+${tn}+${lineCol}: ${String(e?.message || e)}`)
          }
        }
      }
    }
    return null
  }

  const tryObtqStock = async () => {
    if (
      String(process.env.KAI_SBO_WTQ1_STOCK_BATCH_FALLBACK || '')
        .trim()
        .toLowerCase() === 'false'
    ) {
      return null
    }
    for (const tq of obtqTables) {
      for (const tn of obtnTables) {
        try {
          const q = `
SELECT q.ItemCode, q.WhsCode, n.DistNumber AS BatchNum, q.Quantity
FROM ${tq} q
JOIN ${tn} n ON n.AbsEntry = q.MdAbsEntry
WHERE ISNULL(q.Quantity, 0) > 0
ORDER BY q.ItemCode, q.WhsCode, q.Quantity DESC
`.trim()
          const result = await pool.request().query(q)
          const bRows = result.recordset || []
          const map = new Map()
          for (const b of bRows) {
            const key = `${String(b.ItemCode || '').trim()}|${String(b.WhsCode || '').trim().toUpperCase()}`
            if (!map.has(key) && String(b.BatchNum || '').trim()) {
              map.set(key, String(b.BatchNum || '').trim())
            }
          }
          merged = merged.map((r) => {
            if (wtqRowHasBatch(r)) return r
            const wh = String(
              r.FromWhsCod ?? r.FromWhsCode ?? r.WhsCode ?? ''
            )
              .trim()
              .toUpperCase()
            const ic = String(r.ItemCode ?? r.itemcode ?? '').trim()
            const bn = map.get(`${ic}|${wh}`) || ''
            if (!bn) return r
            return { ...r, BatchNum: bn, DistNumber: bn }
          })
          if (merged.every(wtqRowHasBatch)) {
            return `${tq}+${tn}+stock`
          }
          tried.push(`${tq}+${tn}+stock: 일부만`)
        } catch (e) {
          tried.push(`${tq}+${tn}+stock: ${String(e?.message || e)}`)
        }
      }
    }
    return null
  }

  let source = await tryBtq1Obtn()
  if (!merged.some((r) => !wtqRowHasBatch(r))) {
    return { ok: true, rows: merged, source: source || 'btq1' }
  }

  const srcIbt = await tryIbt1Obtn()
  if (srcIbt) source = srcIbt
  if (!merged.some((r) => !wtqRowHasBatch(r))) {
    return { ok: true, rows: merged, source: source || 'ibt1' }
  }

  const srcSt = await tryObtqStock()
  if (srcSt) source = srcSt
  if (!merged.some((r) => !wtqRowHasBatch(r))) {
    return { ok: true, rows: merged, source: source || 'obtq-stock' }
  }

  return {
    ok: true,
    rows: merged,
    error: tried.join(' | '),
    source: merged.some(wtqRowHasBatch) ? `${source || 'partial'}-partial` : 'batch-miss',
  }
}

/**
 * PDN1 라인 중 BatchNum이 비어 있으면 현재 재고(OBTQ/OBTN)에서 창고+품목 기준 배치를 보강
 */
export async function enrichPdn1LinesWithStockBatch(rows) {
  const src = Array.isArray(rows) ? rows : []
  if (!src.length) return { ok: true, rows: src, source: 'none' }
  const need = src.some((r) => !String(r.BatchNum || '').trim())
  if (!need) return { ok: true, rows: src, source: 'already' }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return { ok: false, rows: src, error: String(e?.message || e), source: 'pool' }
  }
  if (!pool) return { ok: false, rows: src, error: 'SQL 연결 설정 없음', source: 'pool' }

  const obtqTables = getObtqTableCandidates()
  const obtnTables = getObtnTableCandidates()
  const tried = []
  for (const tq of obtqTables) {
    for (const tn of obtnTables) {
      try {
        const q = `
SELECT q.ItemCode, q.WhsCode, n.DistNumber AS BatchNum, q.Quantity
FROM ${tq} q
JOIN ${tn} n ON n.AbsEntry = q.MdAbsEntry
WHERE ISNULL(q.Quantity, 0) > 0
ORDER BY q.ItemCode, q.WhsCode, q.Quantity DESC
`.trim()
        const result = await pool.request().query(q)
        const bRows = result.recordset || []
        const map = new Map()
        for (const b of bRows) {
          const key = `${String(b.ItemCode || '').trim()}|${String(b.WhsCode || '').trim().toUpperCase()}`
          if (!map.has(key) && String(b.BatchNum || '').trim()) {
            map.set(key, String(b.BatchNum || '').trim())
          }
        }
        const merged = src.map((r) => {
          const hasBatch = String(r.BatchNum || '').trim()
          if (hasBatch) return r
          const key = `${String(r.ItemCode || '').trim()}|${String(r.WhsCode || '').trim().toUpperCase()}`
          return { ...r, BatchNum: map.get(key) || '' }
        })
        return { ok: true, rows: merged, source: `${tq}+${tn}` }
      } catch (e) {
        tried.push(`${tq}+${tn}: ${String(e?.message || e)}`)
      }
    }
  }
  return { ok: false, rows: src, error: tried.join(' | '), source: 'batch' }
}

function getMaxRows() {
  const n = Number(process.env.KAI_SBO_OPDN_MAX_ROWS || DEFAULT_MAX_ROWS)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_ROWS
  return Math.min(Math.floor(n), 2000)
}

function getExtraWhere() {
  const w = (process.env.KAI_SBO_OPDN_EXTRA_WHERE || '').trim()
  if (!w) return ''
  if (!/^AND\s+/i.test(w)) return ' AND ' + w
  return ' ' + w
}

function onlyOpenEnabled() {
  const v = String(process.env.KAI_SBO_OPDN_ONLY_OPEN || 'true')
    .trim()
    .toLowerCase()
  return v !== 'false'
}

/**
 * @param {string} question
 * @returns {Promise<{ ok: boolean, text?: string, error?: string, fromDateISO: string, rowCount: number, table: string }>}
 */
export async function fetchOpdnSql(question) {
  const tables = getOpdnTableCandidates()
  const table = tables[0]
  const fromDate = parseInboundDocDateFromQuestion(question) || defaultFromDate()
  const fromDateISO = formatYmd(fromDate)
  const maxRows = getMaxRows()
  const extraWhere = getExtraWhere()
  const onlyOpen = onlyOpenEnabled()

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      fromDateISO,
      rowCount: 0,
      table,
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      fromDateISO,
      rowCount: 0,
      table,
    }
  }

  const makeQuery = (tableRef) => `
SELECT TOP (@topN)
  DocEntry,
  DocNum,
  DocDate,
  DocDueDate,
  CardCode,
  CardName,
  Comments,
  DocStatus,
  CANCELED,
  InvntSttus,
  DocCur,
  DocTotal,
  JrnlMemo,
  NumAtCard,
  CreateDate,
  UpdateDate
FROM ${tableRef}
WHERE DocDate >= @fromDate
${onlyOpen ? "AND ISNULL(CANCELED, 'N') = 'N' AND ISNULL(DocStatus, '') = 'O'" : ''}
${extraWhere}
ORDER BY DocDate DESC, DocEntry DESC
`.trim()

  try {
    let picked = null
    const tried = []
    for (const t of tables) {
      try {
        const result = await pool
          .request()
          .input('fromDate', sql.Date, fromDate)
          .input('topN', sql.Int, maxRows)
          .query(makeQuery(t))
        const rows = result.recordset || []
        tried.push(`${t}:${rows.length}`)
        if (!picked || rows.length > 0) {
          picked = { table: t, rows }
        }
        if (rows.length > 0) break
      } catch (te) {
        tried.push(`${t}:ERR`)
      }
    }

    const rows = picked?.rows || []
    const usedTable = picked?.table || table
    const summary =
      `총 ${rows.length}건 (DocDate >= ${fromDateISO})` +
      (onlyOpen ? ', 미처리(개방/O) + 미취소(N) 기준' : '')
    const text =
      summary + `\n테이블: ${usedTable}\n시도: ${tried.join(', ')}\n` + JSON.stringify(rows, null, 2)
    const maxChars = Math.min(
      Number(process.env.KAI_SBO_SQL_RESPONSE_MAX_CHARS) || 18000,
      50000
    )
    return {
      ok: true,
      text:
        text.length > maxChars
          ? text.slice(0, maxChars) +
            `\n\n… (${text.length - maxChars}자 생략, KAI_SBO_SQL_RESPONSE_MAX_CHARS 조정)`
          : text,
      fromDateISO,
      rowCount: rows.length,
      table: usedTable,
    }
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      fromDateISO,
      rowCount: 0,
      table,
    }
  }
}

function allowSqlUpdate() {
  return String(process.env.KAI_SBO_SQL_ALLOW_UPDATE || '')
    .trim()
    .toLowerCase() === 'true'
}

/**
 * 입고 예정 취소: OPOR 연동값 + 문서 닫기(DocStatus=C), OPDN 연동값 'N'.
 * OPDN 연동상태 컬럼은 고정: [U_WMSNY]. OPOR은 KAI_SBO_OPOR_LINK_FIELD(기본 U_WMSNY).
 * ORRR·OWTQ: [U_WMSNY]='C', DocStatus='C'(마감/취소 처리에 준함).
 * DocEntry가 OPDN이면 PDN1.BaseEntry(PO)로 OPOR 갱신. OPOR이면 연결된 OPDN 일괄 'N'.
 */
export async function cancelInboundScheduleByDocEntries(docEntries) {
  const opdnF = '[U_WMSNY]'
  const oporF = linkFieldBracket('KAI_SBO_OPOR_LINK_FIELD', 'U_WMSNY')
  const oporVal = String(process.env.KAI_SBO_OPOR_LINK_VALUE_C || 'C').slice(0, 20)
  const opdnVal = String(process.env.KAI_SBO_OPDN_LINK_VALUE_N || 'N').slice(0, 20)

  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!allowSqlUpdate()) {
    return {
      ok: false,
      error: 'SQL 업데이트 비활성화: KAI_SBO_SQL_ALLOW_UPDATE=true 필요',
      entries: unique,
      results: [],
    }
  }
  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry가 없습니다. 예: DocEntry 14623 입고 예정 취소',
      entries: [],
      results: [],
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      entries: unique,
      results: [],
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      entries: unique,
      results: [],
    }
  }

  const results = []
  for (const de of unique) {
    let opdnTableFound = null
    for (const ot of getOpdnTableCandidates()) {
      try {
        const r = await pool
          .request()
          .input('de', sql.Int, de)
          .query(`SELECT TOP 1 DocEntry FROM ${ot} WHERE DocEntry=@de`)
        if (r.recordset?.length) {
          opdnTableFound = ot
          break
        }
      } catch {
        /* try next */
      }
    }

    if (opdnTableFound) {
      let poEntry = null
      for (const pt of getPdn1TableCandidates()) {
        try {
          const r2 = await pool
            .request()
            .input('de', sql.Int, de)
            .query(
              `SELECT TOP 1 BaseEntry FROM ${pt} WHERE DocEntry=@de AND (BaseType=22 OR BaseType IS NULL) ORDER BY LineNum`
            )
          if (r2.recordset?.[0]?.BaseEntry != null) {
            poEntry = Number(r2.recordset[0].BaseEntry)
            break
          }
        } catch {
          /* try next */
        }
      }

      try {
        const u1 = await pool
          .request()
          .input('de', sql.Int, de)
          .input('v', sql.NVarChar(20), opdnVal)
          .query(
            `UPDATE ${opdnTableFound} SET ${opdnF} = @v WHERE DocEntry=@de AND ISNULL(CANCELED,'N')='N'`
          )
        const affOpdn = (u1.rowsAffected || [0])[0] || 0
        let oporUpdated = false
        let oporTableUsed = null
        if (poEntry != null) {
          for (const ort of getOporTableCandidates()) {
            try {
              const u2 = await pool
                .request()
                .input('pe', sql.Int, poEntry)
                .input('v', sql.NVarChar(20), oporVal)
                .query(
                  `UPDATE ${ort} SET ${oporF} = @v, DocStatus = 'C' WHERE DocEntry=@pe AND ISNULL(CANCELED,'N')='N'`
                )
              const aff = (u2.rowsAffected || [0])[0] || 0
              if (aff > 0) {
                oporUpdated = true
                oporTableUsed = ort
                break
              }
            } catch {
              /* try next OPOR table */
            }
          }
        }
        results.push({
          docEntry: de,
          role: 'OPDN',
          opdnTable: opdnTableFound,
          opdnRows: affOpdn,
          poDocEntry: poEntry,
          oporUpdated,
          oporTable: oporTableUsed,
        })
      } catch (e) {
        results.push({
          docEntry: de,
          role: 'OPDN',
          ok: false,
          error: String(e?.message || e),
        })
      }
      continue
    }

    let oporFound = null
    for (const ort of getOporTableCandidates()) {
      try {
        const r = await pool
          .request()
          .input('de', sql.Int, de)
          .query(`SELECT TOP 1 DocEntry FROM ${ort} WHERE DocEntry=@de`)
        if (r.recordset?.length) {
          oporFound = ort
          break
        }
      } catch {
        /* try next */
      }
    }

    if (oporFound) {
      try {
        const u1 = await pool
          .request()
          .input('de', sql.Int, de)
          .input('v', sql.NVarChar(20), oporVal)
          .query(
            `UPDATE ${oporFound} SET ${oporF} = @v, DocStatus = 'C' WHERE DocEntry=@de AND ISNULL(CANCELED,'N')='N'`
          )
        const affOpor = (u1.rowsAffected || [0])[0] || 0
        let opdnAffected = 0
        for (const pt of getPdn1TableCandidates()) {
          for (const odt of getOpdnTableCandidates()) {
            try {
              const u3 = await pool
                .request()
                .input('pe', sql.Int, de)
                .input('v', sql.NVarChar(20), opdnVal)
                .query(
                  `UPDATE ${odt} SET ${opdnF} = @v WHERE DocEntry IN (SELECT DISTINCT DocEntry FROM ${pt} WHERE BaseEntry=@pe AND BaseType=22) AND ISNULL(CANCELED,'N')='N'`
                )
              opdnAffected += (u3.rowsAffected || [0])[0] || 0
            } catch {
              /* try next combo */
            }
          }
        }
        results.push({
          docEntry: de,
          role: 'OPOR',
          oporTable: oporFound,
          oporRows: affOpor,
          linkedOpdnRowsUpdated: opdnAffected,
        })
      } catch (e) {
        results.push({
          docEntry: de,
          role: 'OPOR',
          ok: false,
          error: String(e?.message || e),
        })
      }
      continue
    }

    let orrrFound = null
    for (const rt of getOrrrTableCandidates()) {
      try {
        const r = await pool
          .request()
          .input('de', sql.Int, de)
          .query(`SELECT TOP 1 DocEntry FROM ${rt} WHERE DocEntry=@de`)
        if (r.recordset?.length) {
          orrrFound = rt
          break
        }
      } catch {
        /* try next */
      }
    }

    if (orrrFound) {
      try {
        let aff = 0
        try {
          const u = await pool
            .request()
            .input('de', sql.Int, de)
            .input('v', sql.NVarChar(20), oporVal)
            .query(
              `UPDATE ${orrrFound} SET [U_WMSNY] = @v, DocStatus = 'C' WHERE DocEntry=@de AND ISNULL(CANCELED,'N')='N'`
            )
          aff = (u.rowsAffected || [0])[0] || 0
        } catch {
          const u2 = await pool
            .request()
            .input('de', sql.Int, de)
            .input('v', sql.NVarChar(20), oporVal)
            .query(
              `UPDATE ${orrrFound} SET [U_WMSNY] = @v, DocStatus = 'C' WHERE DocEntry=@de`
            )
          aff = (u2.rowsAffected || [0])[0] || 0
        }
        results.push({
          docEntry: de,
          role: 'ORRR',
          orrrTable: orrrFound,
          rows: aff,
        })
      } catch (e) {
        results.push({
          docEntry: de,
          role: 'ORRR',
          ok: false,
          error: String(e?.message || e),
        })
      }
      continue
    }

    let owtqFound = null
    for (const wt of getOwtqTableCandidates()) {
      try {
        const r = await pool
          .request()
          .input('de', sql.Int, de)
          .query(`SELECT TOP 1 DocEntry FROM ${wt} WHERE DocEntry=@de`)
        if (r.recordset?.length) {
          owtqFound = wt
          break
        }
      } catch {
        /* try next */
      }
    }

    if (owtqFound) {
      try {
        let aff = 0
        try {
          const u = await pool
            .request()
            .input('de', sql.Int, de)
            .input('v', sql.NVarChar(20), oporVal)
            .query(
              `UPDATE ${owtqFound} SET [U_WMSNY] = @v, DocStatus = 'C' WHERE DocEntry=@de AND ISNULL(CANCELED,'N')='N'`
            )
          aff = (u.rowsAffected || [0])[0] || 0
        } catch {
          const u2 = await pool
            .request()
            .input('de', sql.Int, de)
            .input('v', sql.NVarChar(20), oporVal)
            .query(
              `UPDATE ${owtqFound} SET [U_WMSNY] = @v, DocStatus = 'C' WHERE DocEntry=@de`
            )
          aff = (u2.rowsAffected || [0])[0] || 0
        }
        results.push({
          docEntry: de,
          role: 'OWTQ',
          owtqTable: owtqFound,
          rows: aff,
        })
      } catch (e) {
        results.push({
          docEntry: de,
          role: 'OWTQ',
          ok: false,
          error: String(e?.message || e),
        })
      }
      continue
    }

    results.push({
      docEntry: de,
      ok: false,
      error: 'OPDN/OPOR/ORRR/OWTQ에서 DocEntry를 찾지 못함',
    })
  }

  const ok = !results.some(
    (r) =>
      r.error === 'OPDN/OPOR/ORRR/OWTQ에서 DocEntry를 찾지 못함'
  )
  return {
    ok,
    entries: unique,
    results,
    opdnLinkField: opdnF,
    oporLinkField: oporF,
    opdnLinkValue: opdnVal,
    oporLinkValue: oporVal,
  }
}

/**
 * 출하 예정 취소 (WMS CVA001 규칙과 동일 SQL 경로)
 * 1) ORDR: PKL1에서 해당 판매오더 라인 삭제 후 ORDR [U_WMSNY]→미연동(기본 N)
 * 2) OWTQ: DocStatus=C(마감), [U_WMSNY]→연동종료(기본 C)
 *
 * @param {number[]} docEntries — ORDR 또는 OWTQ **DocEntry** 또는 화면 **문서번호(DocNum)** (헤더에서 DocEntry로 해석)
 * @param {{ pickingAbsEntry?: number | null, preferRole?: 'OWTQ' | 'ORDR' | string }} [opts]
 *   — 피킹(AbsEntry)이 있으면 PKL1을 AbsEntry+OrderEntry로 한정 삭제.
 *   재고이전요청만 처리할 때 `preferRole: 'OWTQ'`(동일 DocEntry가 ORDR에 있어도 OWTQ만 갱신)
 */
export async function cancelOutboundScheduleByDocEntries(docEntries, opts) {
  const ordrF = linkFieldBracket('KAI_SBO_ORDR_LINK_FIELD', 'U_WMSNY')
  const ordrVal = String(process.env.KAI_SBO_ORDR_LINK_VALUE_N || 'N').slice(
    0,
    20
  )
  const owtqLinkVal = String(
    process.env.KAI_SBO_OUTBOUND_OWTQ_LINK_VALUE ||
      process.env.KAI_SBO_OPOR_LINK_VALUE_C ||
      'C'
  ).slice(0, 20)

  const pr = String(opts?.preferRole || '').trim().toUpperCase()
  const preferRole =
    pr === 'OWTQ' || pr === '1250000001'
      ? 'OWTQ'
      : pr === 'ORDR' || pr === '17'
        ? 'ORDR'
        : ''

  const absRaw =
    opts && opts.pickingAbsEntry != null ? Number(opts.pickingAbsEntry) : NaN
  const pickingAbsEntry =
    Number.isFinite(absRaw) && absRaw > 0 ? absRaw : null

  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!allowSqlUpdate()) {
    return {
      ok: false,
      error: 'SQL 업데이트 비활성화: KAI_SBO_SQL_ALLOW_UPDATE=true 필요',
      entries: unique,
      pickingAbsEntry,
      preferRole,
      results: [],
    }
  }
  if (!unique.length) {
    return {
      ok: false,
      error:
        'DocEntry가 없습니다. 예: DocEntry 8841 출하 예정 취소 (피킹 AbsEntry가 있으면 질문에 피킹 2 형태로 포함)',
      entries: [],
      pickingAbsEntry,
      preferRole,
      results: [],
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      entries: unique,
      pickingAbsEntry,
      preferRole,
      results: [],
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      entries: unique,
      pickingAbsEntry,
      preferRole,
      results: [],
    }
  }

  /** 입력 숫자가 DocNum(화면 문서번호)인 경우 ORDR/OWTQ DocEntry로 해석 */
  async function resolveOneOutboundKey(n) {
    if (preferRole === 'OWTQ') {
      const r = await resolveOwtqDocEntriesViaHeader(pool, [n])
      return r.inputToDocEntry.get(n) ?? n
    }
    if (preferRole === 'ORDR') {
      const r = await resolveOrdrDocEntriesViaHeader(pool, [n])
      return r.inputToDocEntry.get(n) ?? n
    }
    const r1 = await resolveOrdrDocEntriesViaHeader(pool, [n])
    if (r1.inputToDocEntry.has(n)) return r1.inputToDocEntry.get(n)
    const r2 = await resolveOwtqDocEntriesViaHeader(pool, [n])
    if (r2.inputToDocEntry.has(n)) return r2.inputToDocEntry.get(n)
    return n
  }

  const docNumResolved = []
  const uniqueResolved = []
  const seenResolved = new Set()
  for (const n of unique) {
    const de = await resolveOneOutboundKey(n)
    if (n !== de) docNumResolved.push({ input: n, docEntry: de })
    if (!seenResolved.has(de)) {
      seenResolved.add(de)
      uniqueResolved.push(de)
    }
  }

  const results = []
  for (const de of uniqueResolved) {
    let ordrFound = null
    if (preferRole !== 'OWTQ') {
      for (const ot of getOrdrTableCandidates()) {
        try {
          const r = await pool
            .request()
            .input('de', sql.Int, de)
            .query(`SELECT TOP 1 DocEntry FROM ${ot} WHERE DocEntry=@de`)
          if (r.recordset?.length) {
            ordrFound = ot
            break
          }
        } catch {
          /* try next */
        }
      }
    }

    if (ordrFound) {
      try {
        let pklDeleted = 0
        for (const pt of getPkl1TableCandidates()) {
          try {
            if (pickingAbsEntry != null) {
              const d1 = await pool
                .request()
                .input('abs', sql.Int, pickingAbsEntry)
                .input('ord', sql.Int, de)
                .query(
                  `DELETE FROM ${pt} WHERE AbsEntry=@abs AND OrderEntry=@ord`
                )
              pklDeleted += (d1.rowsAffected || [0])[0] || 0
            } else {
              const d2 = await pool
                .request()
                .input('ord', sql.Int, de)
                .query(`DELETE FROM ${pt} WHERE OrderEntry=@ord`)
              pklDeleted += (d2.rowsAffected || [0])[0] || 0
            }
          } catch {
            /* try next PKL1 table */
          }
        }

        let affOrdr = 0
        try {
          const u = await pool
            .request()
            .input('de', sql.Int, de)
            .input('v', sql.NVarChar(20), ordrVal)
            .query(
              `UPDATE ${ordrFound} SET ${ordrF} = @v WHERE DocEntry=@de AND ISNULL(CANCELED,'N')='N'`
            )
          affOrdr = (u.rowsAffected || [0])[0] || 0
        } catch {
          const u2 = await pool
            .request()
            .input('de', sql.Int, de)
            .input('v', sql.NVarChar(20), ordrVal)
            .query(`UPDATE ${ordrFound} SET ${ordrF} = @v WHERE DocEntry=@de`)
          affOrdr = (u2.rowsAffected || [0])[0] || 0
        }

        results.push({
          docEntry: de,
          role: 'ORDR',
          ordrTable: ordrFound,
          pkl1RowsDeleted: pklDeleted,
          ordrRows: affOrdr,
          ordrLinkField: ordrF,
          ordrLinkValue: ordrVal,
          pickingAbsEntry,
        })
      } catch (e) {
        results.push({
          docEntry: de,
          role: 'ORDR',
          ok: false,
          error: String(e?.message || e),
        })
      }
      continue
    }

    if (preferRole === 'ORDR') {
      results.push({
        docEntry: de,
        ok: false,
        error: 'ORDR에서 DocEntry를 찾지 못함',
      })
      continue
    }

    let owtqFound = null
    for (const wt of getOwtqTableCandidates()) {
      try {
        const r = await pool
          .request()
          .input('de', sql.Int, de)
          .query(`SELECT TOP 1 DocEntry FROM ${wt} WHERE DocEntry=@de`)
        if (r.recordset?.length) {
          owtqFound = wt
          break
        }
      } catch {
        /* try next */
      }
    }

    if (owtqFound) {
      try {
        let aff = 0
        try {
          const u = await pool
            .request()
            .input('de', sql.Int, de)
            .input('v', sql.NVarChar(20), owtqLinkVal)
            .query(
              `UPDATE ${owtqFound} SET [U_WMSNY] = @v, DocStatus = 'C' WHERE DocEntry=@de AND ISNULL(CANCELED,'N')='N'`
            )
          aff = (u.rowsAffected || [0])[0] || 0
        } catch {
          const u2 = await pool
            .request()
            .input('de', sql.Int, de)
            .input('v', sql.NVarChar(20), owtqLinkVal)
            .query(
              `UPDATE ${owtqFound} SET [U_WMSNY] = @v, DocStatus = 'C' WHERE DocEntry=@de`
            )
          aff = (u2.rowsAffected || [0])[0] || 0
        }
        results.push({
          docEntry: de,
          role: 'OWTQ',
          owtqTable: owtqFound,
          rows: aff,
          owtqLinkValue: owtqLinkVal,
          docStatus: 'C',
          note: '재고이전요청 마감(DocStatus=C) 및 U_WMSNY 연동종료',
        })
      } catch (e) {
        results.push({
          docEntry: de,
          role: 'OWTQ',
          ok: false,
          error: String(e?.message || e),
        })
      }
      continue
    }

    results.push({
      docEntry: de,
      ok: false,
      error:
        preferRole === 'OWTQ'
          ? 'OWTQ에서 DocEntry를 찾지 못함'
          : 'ORDR/OWTQ에서 DocEntry를 찾지 못함',
    })
  }

  const ok = !results.some(
    (r) =>
      r.error === 'ORDR/OWTQ에서 DocEntry를 찾지 못함' ||
      r.error === 'ORDR에서 DocEntry를 찾지 못함' ||
      r.error === 'OWTQ에서 DocEntry를 찾지 못함'
  )

  /** 납품(ODLN)은 출하 예정 취소로 삭제되지 않음 — 연결 납품이 있으면 응답에만 표시 */
  let ordrLinkedDeliveries = []
  if (
    ok &&
    pool &&
    String(process.env.KAI_SBO_ODLN_DIAG || 'true').trim().toLowerCase() !==
      'false'
  ) {
    for (const r of results) {
      if (r.role === 'ORDR' && r.docEntry != null && !r.error) {
        try {
          const d = await fetchLinkedOdlnsForOrdrDocEntry(pool, r.docEntry)
          if (d.length) {
            ordrLinkedDeliveries.push({
              ordrDocEntry: r.docEntry,
              deliveries: d,
            })
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  return {
    ok,
    entries: uniqueResolved,
    inputDocKeys: unique,
    ...(docNumResolved.length
      ? { docNumResolved }
      : {}),
    pickingAbsEntry,
    preferRole: preferRole || null,
    results,
    ordrLinkField: ordrF,
    ordrLinkValue: ordrVal,
    owtqLinkValue: owtqLinkVal,
    ...(ordrLinkedDeliveries.length ? { ordrLinkedDeliveries } : {}),
  }
}

/**
 * 반품요청(ORRR)만 마감: [U_WMSNY]=연동값(기본 C), DocStatus=C.
 * 정식 흐름은 CBP006과 같이 ORDN(반품문서) Add 후 ORRR Close — 이 함수는 ORDN을 만들지 않고 ORRR만 SQL 갱신.
 * `입고 예정 취소`의 ORRR 분기와 동일한 UPDATE 규칙.
 */
export async function closeOrrrByDocEntries(docEntries) {
  const oporVal = String(process.env.KAI_SBO_OPOR_LINK_VALUE_C || 'C').slice(0, 20)
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!allowSqlUpdate()) {
    return {
      ok: false,
      error: 'SQL 업데이트 비활성화: KAI_SBO_SQL_ALLOW_UPDATE=true 필요',
      entries: unique,
      results: [],
      oporLinkValue: oporVal,
    }
  }
  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry가 없습니다.',
      entries: [],
      results: [],
      oporLinkValue: oporVal,
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      entries: unique,
      results: [],
      oporLinkValue: oporVal,
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      entries: unique,
      results: [],
      oporLinkValue: oporVal,
    }
  }

  const results = []
  for (const de of unique) {
    let orrrFound = null
    for (const rt of getOrrrTableCandidates()) {
      try {
        const r = await pool
          .request()
          .input('de', sql.Int, de)
          .query(`SELECT TOP 1 DocEntry FROM ${rt} WHERE DocEntry=@de`)
        if (r.recordset?.length) {
          orrrFound = rt
          break
        }
      } catch {
        /* try next */
      }
    }

    if (!orrrFound) {
      results.push({
        docEntry: de,
        ok: false,
        error: 'ORRR에서 DocEntry를 찾지 못함',
      })
      continue
    }
    try {
      let aff = 0
      try {
        const u = await pool
          .request()
          .input('de', sql.Int, de)
          .input('v', sql.NVarChar(20), oporVal)
          .query(
            `UPDATE ${orrrFound} SET [U_WMSNY] = @v, DocStatus = 'C' WHERE DocEntry=@de AND ISNULL(CANCELED,'N')='N'`
          )
        aff = (u.rowsAffected || [0])[0] || 0
      } catch {
        const u2 = await pool
          .request()
          .input('de', sql.Int, de)
          .input('v', sql.NVarChar(20), oporVal)
          .query(
            `UPDATE ${orrrFound} SET [U_WMSNY] = @v, DocStatus = 'C' WHERE DocEntry=@de`
          )
        aff = (u2.rowsAffected || [0])[0] || 0
      }
      results.push({
        docEntry: de,
        role: 'ORRR',
        orrrTable: orrrFound,
        rows: aff,
      })
    } catch (e) {
      results.push({
        docEntry: de,
        role: 'ORRR',
        ok: false,
        error: String(e?.message || e),
      })
    }
  }

  const ok = !results.some((r) => r.error)
  return {
    ok,
    entries: unique,
    results,
    oporLinkValue: oporVal,
  }
}

/**
 * 반품마감 취소:
 * 1) 원천 ORRR에 연결된 **모든** ORDN(반품)·OWTR(재고이전) SQL 취소(CANCELED='Y', DocStatus='C')
 *    — ORDN: RDN1.BaseEntry=ORRR DocEntry / OWTR: WTR1.BaseEntry=ORRR DocEntry
 * 2) 원천 ORRR 연동상태 [U_WMSNY] 를 'N'으로 복원
 */
export async function cancelReturnCloseByDocEntries(docEntries) {
  const linkResetVal = String(process.env.KAI_SBO_OPDN_LINK_VALUE_N || 'N').slice(0, 20)
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!allowSqlUpdate()) {
    return {
      ok: false,
      error: 'SQL 업데이트 비활성화: KAI_SBO_SQL_ALLOW_UPDATE=true 필요',
      entries: unique,
      results: [],
      linkResetValue: linkResetVal,
    }
  }
  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry가 없습니다.',
      entries: [],
      results: [],
      linkResetValue: linkResetVal,
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      entries: unique,
      results: [],
      linkResetValue: linkResetVal,
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      entries: unique,
      results: [],
      linkResetValue: linkResetVal,
    }
  }

  const results = []
  const baseTypes = String(process.env.KAI_SBO_RETURN_BASE_TYPES || '234000031,234,16')
    .split(/[,\s]+/)
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n))
    .slice(0, 10)

  for (const de of unique) {
    let orrrFound = null
    for (const rt of getOrrrTableCandidates()) {
      try {
        const r = await pool
          .request()
          .input('de', sql.Int, de)
          .query(`SELECT TOP 1 DocEntry FROM ${rt} WHERE DocEntry=@de`)
        if (r.recordset?.length) {
          orrrFound = rt
          break
        }
      } catch {
        /* try next */
      }
    }
    if (!orrrFound) {
      // 입력 DocEntry가 ORRR이 아닐 수 있으므로 OWTR에서 먼저 취소 시도합니다.
      const owtrFoundTables = []
      for (const wt of getOwtrTableCandidates()) {
        try {
          const r = await pool
            .request()
            .input('de', sql.Int, de)
            .query(`SELECT TOP 1 DocEntry FROM ${wt} WHERE DocEntry=@de`)
          if (r.recordset?.length) {
            owtrFoundTables.push(wt)
          }
        } catch {
          /* try next */
        }
      }

      if (owtrFoundTables.length) {
        try {
          /** dbo·SBO_MACRO 등 복수 테이블에 동일 DocEntry가 있으면 값이 어긋날 수 있음 → 기본은 한 테이블만으로 CANCELED 판단 */
          const useAllTablesForStatus =
            String(process.env.KAI_SBO_OWTR_STATUS_USE_ALL_TABLES || '')
              .trim()
              .toLowerCase() === 'true'
          const explicitOwtr = String(process.env.KAI_SBO_OWTR_TABLE || '').trim()
          const tablesForStatus =
            explicitOwtr || useAllTablesForStatus || owtrFoundTables.length <= 1
              ? owtrFoundTables
              : [owtrFoundTables[0]]
          const statuses = []
          for (const owtrTable of tablesForStatus) {
            const vq = await pool
              .request()
              .input('de', sql.Int, de)
              .query(
                `SELECT DocEntry, DocStatus, CANCELED FROM ${owtrTable} WHERE DocEntry=@de`
              )
            for (const row of vq.recordset || []) {
              statuses.push({ ...row, SourceTable: owtrTable })
            }
          }
          const multiTableNote =
            !explicitOwtr &&
            owtrFoundTables.length > 1 &&
            !useAllTablesForStatus &&
            tablesForStatus.length === 1
              ? 'OWTR이 여러 테이블에서 발견되어 **취소 여부는 첫 테이블(' +
                tablesForStatus[0] +
                ')만** 사용했습니다. SAP 화면과 다르면 실제 회사 DB에 맞게 `KAI_SBO_OWTR_TABLE`을 지정하거나 `KAI_SBO_OWTR_STATUS_USE_ALL_TABLES=true`로 비교하세요.'
              : null
          results.push({
            ...(function () {
              const notCanceled = statuses.filter(
                (x) => String(x?.CANCELED ?? 'N').trim().toUpperCase() !== 'Y'
              )
              if (notCanceled.length) {
                return {
                  docEntry: de,
                  role: 'OWTR_CANCEL_ONLY',
                  ok: true,
                  message:
                    'OWTR 문서가 미취소 상태입니다. CBP007 취소 호출이 필요합니다.',
                  status: 'NEED_CBP007',
                  owtrTable: owtrFoundTables[0],
                  owtrTables: owtrFoundTables,
                  owtrStatusReadFrom: tablesForStatus,
                  owtrStatusNote: multiTableNote,
                  owtrCanceledRows: 0,
                  owtrEntries: [de],
                  owtrStatus: statuses,
                }
              }
              return {
                docEntry: de,
                role: 'OWTR_CANCEL_ONLY',
                ok: true,
                message:
                  (multiTableNote ? multiTableNote + ' ' : '') +
                  'OWTR 문서가 이미 취소 상태(CANCELED=Y)입니다.',
                status: 'ALREADY_CANCELED',
                owtrTable: owtrFoundTables[0],
                owtrTables: owtrFoundTables,
                owtrStatusReadFrom: tablesForStatus,
                owtrStatusNote: multiTableNote,
                owtrCanceledRows: 0,
                owtrEntries: [de],
                owtrStatus: statuses,
              }
            })(),
          })
          continue
        } catch (e) {
          results.push({
            docEntry: de,
            role: 'OWTR_CANCEL_ONLY',
            ok: false,
            error: String(e?.message || e),
          })
          continue
        }
      }

      results.push({
        docEntry: de,
        ok: false,
        error: 'ORRR/OWTR에서 DocEntry를 찾지 못함',
      })
      continue
    }
    let orrrDocNum = ''
    try {
      const hd = await pool
        .request()
        .input('de', sql.Int, de)
        .query(
          `SELECT TOP 1 CAST(DocNum AS NVARCHAR(100)) AS DocNumTxt FROM ${orrrFound} WHERE DocEntry=@de`
        )
      orrrDocNum = String(hd.recordset?.[0]?.DocNumTxt ?? '').trim()
    } catch {
      orrrDocNum = ''
    }

    let ordnCanceled = 0
    const ordnEntries = []
    let ordnStatusRows = []
    let ordnTableUsed = null
    for (const ordnTable of getOrdnTableCandidates()) {
      for (const rdn1Table of getRdn1TableCandidates()) {
        try {
          const req = pool.request().input('de', sql.Int, de)
          const btClause = baseTypes.length
            ? `AND ISNULL(l.BaseType, -1) IN (${baseTypes.map((_, i) => `@bt${i}`).join(', ')})`
            : ''
          const docNumClause = orrrDocNum
            ? `
  OR LTRIM(RTRIM(ISNULL(CAST(l.BaseRef AS NVARCHAR(100)), ''))) = @docNum
  OR LTRIM(RTRIM(ISNULL(CAST(h.NumAtCard AS NVARCHAR(100)), ''))) = @docNum
`
            : ''
          baseTypes.forEach((bt, i) => req.input(`bt${i}`, sql.Int, bt))
          if (orrrDocNum) req.input('docNum', sql.NVarChar(100), orrrDocNum)
          const rs = await req.query(
            `
SELECT DISTINCT h.DocEntry
FROM ${ordnTable} h
JOIN ${rdn1Table} l ON l.DocEntry = h.DocEntry
WHERE (
  (l.BaseEntry = @de
  ${btClause})
  ${docNumClause}
)
`.trim()
          )
          let linked = (rs.recordset || [])
            .map((x) => Number(x.DocEntry))
            .filter((n) => Number.isFinite(n) && n > 0)
          if (!linked.length) {
            const req2 = pool.request().input('de', sql.Int, de)
            if (orrrDocNum) req2.input('docNum', sql.NVarChar(100), orrrDocNum)
            const docNumClause2 = orrrDocNum
              ? `
  OR LTRIM(RTRIM(ISNULL(CAST(l.BaseRef AS NVARCHAR(100)), ''))) = @docNum
  OR LTRIM(RTRIM(ISNULL(CAST(h.NumAtCard AS NVARCHAR(100)), ''))) = @docNum
`
              : ''
            const rs2 = await req2.query(
              `
SELECT DISTINCT h.DocEntry
FROM ${ordnTable} h
JOIN ${rdn1Table} l ON l.DocEntry = h.DocEntry
WHERE (
  l.BaseEntry = @de
  ${docNumClause2}
)
`.trim()
            )
            linked = (rs2.recordset || [])
              .map((x) => Number(x.DocEntry))
              .filter((n) => Number.isFinite(n) && n > 0)
          }
          if (!linked.length) continue

          const placeholders = linked.map((_, i) => `@d${i}`).join(', ')
          const up = pool.request()
          linked.forEach((n, i) => up.input(`d${i}`, sql.Int, n))
          const upd = await up.query(
            `
UPDATE ${ordnTable}
SET CANCELED = 'Y',
    DocStatus = 'C'
WHERE DocEntry IN (${placeholders})
  AND ISNULL(CANCELED, 'N') = 'N';
`.trim()
          )
          ordnCanceled += (upd.rowsAffected || [0])[0] || 0
          ordnEntries.push(...linked)
          ordnTableUsed = ordnTable
          const vr = pool.request()
          linked.forEach((n, i) => vr.input(`vd${i}`, sql.Int, n))
          const vq = await vr.query(
            `
SELECT DocEntry, DocStatus, CANCELED
FROM ${ordnTable}
WHERE DocEntry IN (${linked.map((_, i) => `@vd${i}`).join(', ')})
ORDER BY DocEntry
`.trim()
          )
          ordnStatusRows.push(...(vq.recordset || []))
        } catch {
          /* try next table combo */
        }
      }
    }

    /** ORRR DocEntry를 원천(Base)으로 거는 WTR1 → 연결 OWTR 전부 취소 */
    const maxOwtrLinked = Math.min(
      Math.max(Number(process.env.KAI_SBO_RETURN_LINKED_OWTR_MAX) || 50, 1),
      200
    )
    let owtrLinkedEntries = []
    const collectOwtrFromOrrr = async (useBaseType) => {
      const out = []
      for (const wt of getWtr1TableCandidates()) {
        try {
          const req = pool.request().input('de', sql.Int, de)
          let btClause = ''
          if (useBaseType && baseTypes.length) {
            btClause = `AND ISNULL(BaseType,-1) IN (${baseTypes.map((_, i) => `@bt${i}`).join(', ')})`
            baseTypes.forEach((bt, i) => req.input(`bt${i}`, sql.Int, bt))
          }
          const rs = await req.query(
            `
SELECT DISTINCT TOP ${maxOwtrLinked} CAST(DocEntry AS INT) AS DE
FROM ${wt}
WHERE BaseEntry = @de
  AND BaseEntry IS NOT NULL
  AND DocEntry IS NOT NULL
  AND CAST(DocEntry AS INT) <> CAST(BaseEntry AS INT)
${btClause}
`.trim()
          )
          for (const row of rs.recordset || []) {
            const d = Number(row.DE)
            if (Number.isFinite(d) && d > 0 && d !== de) out.push(d)
          }
          if (out.length) break
        } catch {
          /* try next */
        }
      }
      return out
    }
    let fromWtr = await collectOwtrFromOrrr(true)
    if (!fromWtr.length) fromWtr = await collectOwtrFromOrrr(false)
    owtrLinkedEntries = Array.from(new Set(fromWtr)).sort((a, b) => a - b)

    let owtrCanceled = 0
    const owtrStatusRows = []
    let owtrTableUsed = null
    if (owtrLinkedEntries.length) {
      const owtrTables = Array.from(new Set(getOwtrTableCandidates()))
      const placeholders = owtrLinkedEntries.map((_, i) => `@ow${i}`).join(', ')
      const updatedTables = []
      for (const ot of owtrTables) {
        try {
          const up = pool.request()
          owtrLinkedEntries.forEach((n, i) => up.input(`ow${i}`, sql.Int, n))
          const upd = await up.query(
            `
UPDATE ${ot}
SET CANCELED = 'Y',
    DocStatus = 'C'
WHERE DocEntry IN (${placeholders})
  AND ISNULL(CANCELED, 'N') = 'N';
`.trim()
          )
          const aff = (upd.rowsAffected || [0])[0] || 0
          owtrCanceled += aff
          if (aff > 0) updatedTables.push(ot)
        } catch {
          /* try next OWTR table */
        }
      }
      for (const ot of owtrTables) {
        try {
          const vr = pool.request()
          owtrLinkedEntries.forEach((n, i) => vr.input(`ow${i}`, sql.Int, n))
          const vq = await vr.query(
            `
SELECT DocEntry, DocStatus, CANCELED
FROM ${ot}
WHERE DocEntry IN (${placeholders})
ORDER BY DocEntry
`.trim()
          )
          for (const row of vq.recordset || []) {
            owtrStatusRows.push({ ...row, SourceTable: ot })
          }
        } catch {
          /* try next OWTR table */
        }
      }
      if (updatedTables.length) {
        owtrTableUsed = updatedTables.join(', ')
      } else if (owtrStatusRows.length) {
        owtrTableUsed = String(owtrStatusRows[0]?.SourceTable || '')
      }
    }

    if (!ordnEntries.length && !owtrLinkedEntries.length) {
      results.push({
        docEntry: de,
        role: 'ORRR_CANCEL',
        ok: false,
        error:
          '연결된 ORDN·OWTR을 찾지 못해 반품마감 취소를 중단했습니다. ORRR는 원복하지 않았습니다.',
        orrrTable: orrrFound,
        orrrDocNum,
      })
      continue
    }

    try {
      let affOrrr = 0
      try {
        const u = await pool
          .request()
          .input('de', sql.Int, de)
          .input('v', sql.NVarChar(20), linkResetVal)
          .query(
            `UPDATE ${orrrFound} SET [U_WMSNY] = @v WHERE DocEntry=@de AND ISNULL(CANCELED,'N')='N'`
          )
        affOrrr = (u.rowsAffected || [0])[0] || 0
      } catch {
        const u2 = await pool
          .request()
          .input('de', sql.Int, de)
          .input('v', sql.NVarChar(20), linkResetVal)
          .query(`UPDATE ${orrrFound} SET [U_WMSNY] = @v WHERE DocEntry=@de`)
        affOrrr = (u2.rowsAffected || [0])[0] || 0
      }

      results.push({
        docEntry: de,
        role: 'ORRR_CANCEL',
        orrrTable: orrrFound,
        orrrRows: affOrrr,
        linkResetValue: linkResetVal,
        ordnTable: ordnTableUsed,
        ordnCanceledRows: ordnCanceled,
        ordnEntries: Array.from(new Set(ordnEntries)),
        ordnStatus: ordnStatusRows,
        owtrTable: owtrTableUsed,
        owtrCanceledRows: owtrCanceled,
        owtrEntries: owtrLinkedEntries,
        owtrStatus: owtrStatusRows,
      })
    } catch (e) {
      results.push({
        docEntry: de,
        role: 'ORRR_CANCEL',
        ok: false,
        error: String(e?.message || e),
      })
    }
  }

  for (const r of results) {
    if (r.error) continue
    if (r.role === 'OWTR_CANCEL_ONLY') continue
    const ordnNotCanceled = (Array.isArray(r.ordnStatus) ? r.ordnStatus : []).filter(
      (x) => String(x?.CANCELED ?? 'N').trim().toUpperCase() === 'N'
    )
    const owtrNotCanceled = (Array.isArray(r.owtrStatus) ? r.owtrStatus : []).filter(
      (x) => String(x?.CANCELED ?? 'N').trim().toUpperCase() === 'N'
    )
    if (ordnNotCanceled.length || owtrNotCanceled.length) {
      r.ok = false
      r.error =
        '연결 문서 취소 검증 실패(일부 문서가 여전히 CANCELED=N). SAP B1에서는 SQL 직접 취소 대신 DI/Service Layer Cancel이 필요할 수 있음'
      r.ordnNotCanceled = ordnNotCanceled
      r.owtrNotCanceled = owtrNotCanceled
    }
  }

  const ok = !results.some((r) => r.error)
  return {
    ok,
    entries: unique,
    results,
    linkResetValue: linkResetVal,
  }
}

/**
 * 재고이전 취소:
 * - 입력 DocEntry가 OWTR이면 해당 OWTR 취소
 * - 입력 DocEntry가 OWTQ이면 WTR1(BaseEntry)로 연결 OWTR 찾아 취소
 */
export async function cancelOwtrByDocEntries(docEntries) {
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!allowSqlUpdate()) {
    return {
      ok: false,
      error: 'SQL 업데이트 비활성화: KAI_SBO_SQL_ALLOW_UPDATE=true 필요',
      entries: unique,
      results: [],
    }
  }
  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry가 없습니다.',
      entries: [],
      results: [],
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      entries: unique,
      results: [],
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      entries: unique,
      results: [],
    }
  }

  const owtqBaseTypes = String(process.env.KAI_SBO_OWTQ_BASE_TYPES || '1250000001,67')
    .split(/[,\s]+/)
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n))
    .slice(0, 10)

  const results = []
  for (const de of unique) {
    const targetOwtrEntries = new Set()
    const owtrTablesFound = []

    for (const ot of getOwtrTableCandidates()) {
      try {
        const r = await pool
          .request()
          .input('de', sql.Int, de)
          .query(`SELECT TOP 1 DocEntry FROM ${ot} WHERE DocEntry=@de`)
        if (r.recordset?.length) {
          owtrTablesFound.push(ot)
          targetOwtrEntries.add(de)
        }
      } catch {
        /* try next */
      }
    }

    if (!targetOwtrEntries.size) {
      for (const wt of getWtr1TableCandidates()) {
        for (const ot of getOwtrTableCandidates()) {
          try {
            const req = pool.request().input('de', sql.Int, de)
            const btClause = owtqBaseTypes.length
              ? `AND ISNULL(w.BaseType,-1) IN (${owtqBaseTypes.map((_, i) => `@bt${i}`).join(', ')})`
              : ''
            owtqBaseTypes.forEach((bt, i) => req.input(`bt${i}`, sql.Int, bt))
            const rs = await req.query(
              `
SELECT DISTINCT h.DocEntry
FROM ${ot} h
JOIN ${wt} w ON w.DocEntry = h.DocEntry
WHERE w.BaseEntry = @de
  ${btClause}
`.trim()
            )
            const found = (rs.recordset || [])
              .map((x) => Number(x.DocEntry))
              .filter((n) => Number.isFinite(n) && n > 0)
            if (found.length) {
              owtrTablesFound.push(ot)
              found.forEach((n) => targetOwtrEntries.add(n))
            }
          } catch {
            /* try next combo */
          }
        }
      }
    }

    const target = Array.from(targetOwtrEntries)
    if (!target.length) {
      results.push({
        docEntry: de,
        role: 'OWTR_CANCEL',
        ok: false,
        error: 'OWTR(직접/OWTQ연계) DocEntry를 찾지 못함',
      })
      continue
    }

    const uniqueTables = Array.from(new Set(owtrTablesFound))
    let totalAffected = 0
    const updateErrors = []
    for (const table of uniqueTables) {
      try {
        const u = pool.request()
        target.forEach((n, i) => u.input(`u${i}`, sql.Int, n))
        const ur = await u.query(
          `
UPDATE ${table}
SET CANCELED = 'Y',
    DocStatus = 'C'
WHERE DocEntry IN (${target.map((_, i) => `@u${i}`).join(', ')})
  AND ISNULL(CANCELED, 'N') = 'N';
`.trim()
        )
        totalAffected += (ur.rowsAffected || [0])[0] || 0
      } catch (e) {
        updateErrors.push(`${table}: ${String(e?.message || e)}`)
      }
    }

    const statuses = []
    for (const table of uniqueTables) {
      try {
        const v = pool.request()
        target.forEach((n, i) => v.input(`v${i}`, sql.Int, n))
        const vr = await v.query(
          `
SELECT DocEntry, DocStatus, CANCELED
FROM ${table}
WHERE DocEntry IN (${target.map((_, i) => `@v${i}`).join(', ')})
ORDER BY DocEntry
`.trim()
        )
        for (const row of vr.recordset || []) {
          statuses.push({ ...row, SourceTable: table })
        }
      } catch (e) {
        results.push({
          docEntry: de,
          role: 'OWTR_CANCEL',
          ok: false,
          error: String(e?.message || e),
          owtrTable: table,
        })
      }
    }
    if (updateErrors.length) {
      results.push({
        docEntry: de,
        role: 'OWTR_CANCEL',
        ok: false,
        error: updateErrors.join(' | '),
        owtrEntries: target,
        owtrTableCandidates: uniqueTables,
      })
      continue
    }
    const notCanceled = statuses.filter(
      (x) => String(x?.CANCELED ?? 'N').trim().toUpperCase() === 'N'
    )
    if (notCanceled.length) {
      results.push({
        docEntry: de,
        role: 'OWTR_CANCEL',
        ok: true,
        status: 'NEED_CBP007',
        message:
          'OWTR SQL 취소 후에도 일부 문서가 미취소 상태입니다. CBP007 정식 취소가 필요할 수 있습니다.',
        owtrEntries: target,
        owtrCanceledRows: totalAffected,
        owtrStatus: statuses,
      })
      continue
    }
    results.push({
      docEntry: de,
      role: 'OWTR_CANCEL',
      ok: true,
      status: 'ALREADY_CANCELED',
      message:
        totalAffected > 0
          ? 'OWTR SQL fallback 취소 완료(CANCELED=Y).'
          : 'OWTR 문서가 이미 취소 상태(CANCELED=Y)입니다.',
      owtrEntries: target,
      owtrCanceledRows: totalAffected,
      owtrStatus: statuses,
    })
  }

  return {
    ok:
      !results.some((r) => r.error) &&
      !results.some((r) => String(r?.status || '').toUpperCase() === 'NEED_CBP007'),
    entries: unique,
    results,
  }
}

/** OWTR 헤더 UDF에서 CBP007 erpReq 숫자 후보 추출용 — env 화이트리스트 */
function parseCbp007OwtrUdfColumnNames() {
  return String(process.env.SAP_CBP007_OWTR_UDF_ERPREQ || '')
    .split(/[,;]+/)
    .map((s) => String(s).trim())
    .filter((n) => /^U_[A-Za-z0-9_]+$/.test(n))
    .slice(0, 12)
}

function parsePositiveIntErpCandidate(val) {
  if (val == null || val === '') return null
  if (typeof val === 'number' && Number.isFinite(val)) {
    const n = Math.trunc(val)
    return n > 0 ? n : null
  }
  const s = String(val).trim()
  if (!s) return null
  if (/^\d{1,18}$/.test(s)) {
    const n = Number(s)
    return Number.isFinite(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null
  }
  const m = s.match(/\d{3,18}/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * OWTR DocEntry별 CBP007 erpReqNo 후보 수집 (행 순서 = 입력 DocEntry 순서).
 * SqlDataReader "no data"는 조회 0행일 때 흔함 → OWTQ DocEntry·OWTR DocNum·OWTQ DocNum 등 순차 시도.
 * WTR1 BaseEntry=OWTR DocEntry(자기참조)는 OWTQ 링크로 보지 않음. OWTQ·OWTR DocNum은 다를 수 있음(`SAP_CBP007_OWTQ_BY_OWTR_DOCNUM`).
 * @param {{ auxiliaryText?: string, question?: string }} [options] — API 질문 문자열(SQL 비고가 비어 있을 때 erpReq 후보 보강·lookupRows 표시)
 * @returns {{ strategies: string[][], lookupRows: object[], lookupNotes: string[] }}
 */
export async function resolveCbp007ErpReqStrategiesForOwtr(docEntries, options = {}) {
  const auxiliaryText = String(options?.auxiliaryText ?? options?.question ?? '').trim()
  const emptyOut = (arr) => ({
    strategies: arr.length ? [arr.map((n) => String(n))] : [],
    lookupRows: [],
    lookupNotes: [],
  })

  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!unique.length) return { strategies: [], lookupRows: [], lookupNotes: [] }

  let pool
  try {
    pool = await getPool()
  } catch {
    return emptyOut(unique)
  }
  if (!pool) return emptyOut(unique)

  const baseTypes = String(process.env.KAI_SBO_OWTQ_BASE_TYPES || '1250000001,67')
    .split(/[,\s]+/)
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n))
    .slice(0, 10)

  const rows = []
  for (const de of unique) {
    let owtqDe = null
    let baseRefNum = null

    for (const wt of getWtr1TableCandidates()) {
      try {
        const req = pool.request().input('de', sql.Int, de)
        const btClause = baseTypes.length
          ? `AND ISNULL(BaseType,-1) IN (${baseTypes.map((_, i) => `@bt${i}`).join(', ')})`
          : ''
        baseTypes.forEach((bt, i) => req.input(`bt${i}`, sql.Int, bt))
        const rs = await req.query(
          `
SELECT TOP 1
  BaseEntry,
  BaseRef
FROM ${wt}
WHERE DocEntry = @de
  AND BaseEntry IS NOT NULL
  AND BaseEntry <> @de
  ${btClause}
`.trim()
        )
        const row0 = rs.recordset?.[0]
        const be = Number(row0?.BaseEntry)
        if (Number.isFinite(be) && be > 0 && be !== de) {
          owtqDe = be
          const br = Number(String(row0?.BaseRef ?? '').replace(/\D/g, ''))
          if (Number.isFinite(br) && br > 0) baseRefNum = br
          break
        }
      } catch {
        /* try next */
      }
    }

    // BaseType 불일치 시: BaseType 조건 없이 BaseEntry만 조회
    if (owtqDe == null) {
      for (const wt of getWtr1TableCandidates()) {
        try {
          const rs = await pool
            .request()
            .input('de', sql.Int, de)
            .query(
              `
SELECT TOP 1 BaseEntry, BaseRef
FROM ${wt}
WHERE DocEntry = @de
  AND BaseEntry IS NOT NULL
  AND BaseEntry <> @de
`.trim()
            )
          const row0 = rs.recordset?.[0]
          const be = Number(row0?.BaseEntry)
          if (Number.isFinite(be) && be > 0 && be !== de) {
            owtqDe = be
            const br = Number(String(row0?.BaseRef ?? '').replace(/\D/g, ''))
            if (Number.isFinite(br) && br > 0) baseRefNum = br
            break
          }
        } catch {
          /* try next */
        }
      }
    }

    if (owtqDe == null) {
      for (const wt of getWtr1TableCandidates()) {
        try {
          const rs = await pool
            .request()
            .input('de', sql.Int, de)
            .query(
              `
SELECT TOP 1 BaseRef
FROM ${wt}
WHERE DocEntry = @de
  AND ISNULL(LTRIM(RTRIM(CAST(BaseRef AS NVARCHAR(100)))), '') <> ''
`.trim()
            )
          const br = Number(
            String(rs.recordset?.[0]?.BaseRef ?? '').replace(/\D/g, '')
          )
          if (Number.isFinite(br) && br > 0) {
            baseRefNum = br
            break
          }
        } catch {
          /* try next */
        }
      }
    }

    /** WTR1 한 줄이 아니라 여러 BaseEntry(다른 원천요청)가 있을 수 있음 → DISTINCT */
    let owtqBaseEntries = []
    const maxBe = Math.min(
      Math.max(Number(process.env.SAP_CBP007_MAX_OWTQ_BASE_ENTRIES) || 12, 2),
      30
    )
    const collectDistinctBaseEntry = async (useBaseType) => {
      const out = []
      for (const wt of getWtr1TableCandidates()) {
        try {
          const req = pool.request().input('de', sql.Int, de)
          let btClause = ''
          if (useBaseType && baseTypes.length) {
            btClause = `AND ISNULL(BaseType,-1) IN (${baseTypes.map((_, i) => `@bt${i}`).join(', ')})`
            baseTypes.forEach((bt, i) => req.input(`bt${i}`, sql.Int, bt))
          }
          const rs = await req.query(
            `
SELECT TOP ${maxBe} BE
FROM (
  SELECT DISTINCT CAST(BaseEntry AS INT) AS BE
  FROM ${wt}
  WHERE DocEntry = @de
    AND BaseEntry IS NOT NULL
    AND BaseEntry <> @de
    ${btClause}
) t
WHERE BE IS NOT NULL
ORDER BY BE
`.trim()
          )
          for (const row of rs.recordset || []) {
            const be = Number(row.BE)
            if (Number.isFinite(be) && be > 0 && be !== de) out.push(be)
          }
          if (out.length) break
        } catch {
          /* try next table */
        }
      }
      return out
    }
    const withBt = await collectDistinctBaseEntry(true)
    owtqBaseEntries = withBt.length ? withBt : await collectDistinctBaseEntry(false)
    owtqBaseEntries = Array.from(new Set(owtqBaseEntries)).sort((a, b) => a - b)

    /**
     * 역방향 WTR1: BaseEntry=@de → 해당 원천(예: OWTQ)을 Base로 거는 OWTR **헤더** DocEntry.
     * 관계맵에서 재고이전요청 70187 ↔ 재고이전 77158처럼, 입력이 OWTQ 번호와 겹치거나 순방향 링크가 비었을 때 실제 OWTR(77158) 후보를 얻기 위함.
     */
    let owtrDocEntriesByOwtqBaseEntry = []
    const reverseWtr1 =
      String(process.env.SAP_CBP007_REVERSE_WTR1_BASE_LOOKUP || 'true').trim().toLowerCase() !==
      'false'
    if (reverseWtr1) {
      const maxOwtrFromBase = Math.min(
        Math.max(Number(process.env.SAP_CBP007_MAX_OWTR_FROM_OWTQ_BASE) || 12, 2),
        30
      )
      const collectOwtrWhereBaseIsDe = async (useBaseType) => {
        const out = []
        for (const wt of getWtr1TableCandidates()) {
          try {
            const req = pool.request().input('de', sql.Int, de)
            let btClause = ''
            if (useBaseType && baseTypes.length) {
              btClause = `AND ISNULL(BaseType,-1) IN (${baseTypes.map((_, i) => `@bt${i}`).join(', ')})`
              baseTypes.forEach((bt, i) => req.input(`bt${i}`, sql.Int, bt))
            }
            const rs = await req.query(
              `
SELECT TOP ${maxOwtrFromBase} CAST(DocEntry AS INT) AS DE
FROM (
  SELECT DISTINCT CAST(DocEntry AS INT) AS DE
  FROM ${wt}
  WHERE BaseEntry = @de
    AND DocEntry IS NOT NULL
    AND DocEntry <> @de
    ${btClause}
) t
WHERE DE IS NOT NULL
ORDER BY DE
`.trim()
            )
            for (const row of rs.recordset || []) {
              const d = Number(row.DE)
              if (Number.isFinite(d) && d > 0) out.push(d)
            }
            if (out.length) break
          } catch {
            /* try next table */
          }
        }
        return out
      }
      const revBt = await collectOwtrWhereBaseIsDe(true)
      owtrDocEntriesByOwtqBaseEntry = revBt.length
        ? revBt
        : await collectOwtrWhereBaseIsDe(false)
      owtrDocEntriesByOwtqBaseEntry = Array.from(new Set(owtrDocEntriesByOwtqBaseEntry)).sort(
        (a, b) => a - b
      )
    }

    /** WTR1 진단: 링크 배열이 비었을 때 원인(라인 없음 vs BaseEntry 없음/자기참조만) */
    let wtr1Diag = null
    for (const wt of getWtr1TableCandidates()) {
      try {
        const req = pool.request().input('de', sql.Int, de)
        const rs = await req.query(
          `
SELECT
  COUNT(*) AS TotalLines,
  ISNULL(
    SUM(
      CASE
        WHEN BaseEntry IS NOT NULL
          AND CAST(BaseEntry AS INT) <> CAST(DocEntry AS INT) THEN 1
        ELSE 0
      END
    ),
    0
  ) AS LinesWithNonSelfBase
FROM ${wt}
WHERE DocEntry = @de
`.trim()
        )
        const req2 = pool.request().input('de', sql.Int, de)
        const rs2 = await req2.query(
          `
SELECT COUNT(*) AS C
FROM ${wt}
WHERE BaseEntry = @de
  AND DocEntry IS NOT NULL
  AND DocEntry <> @de
`.trim()
        )
        const row0 = rs.recordset?.[0]
        wtr1Diag = {
          table: wt,
          linesForDocEntry: Number(row0?.TotalLines ?? 0),
          linesWithNonSelfBaseEntry: Number(row0?.LinesWithNonSelfBase ?? 0),
          linesWhereBaseEntryIsDe: Number(rs2.recordset?.[0]?.C ?? 0),
        }
        break
      } catch {
        /* try next table */
      }
    }

    let owtrDocNum = ''
    let numAtCard = ''
    let owtrSeries = null
    /** 비고·분개 비고·라인 FreeTxt에서 재고이전요청 DocEntry 등 (dbo/SBO_MACRO 등 **모든** OWTR·WTR1 테이블 병합) */
    let owtrCommentErpReqCandidates = []
    /** 키워드 추출용으로 모은 원문 — 느슨한 숫자 폴백에 사용 */
    const rawTextChunks = []
    let owtrLooseErpReqCandidates = []
    /** API 질문만으로 잡은 후보(SQL에 비고가 없을 때 표시용) */
    let questionAuxiliaryErpReqCandidates = []
    const mergeOwtrCommentCandidates = (blob) => {
      const b = String(blob || '').trim()
      if (b) rawTextChunks.push(b)
      const nums = extractCbp007ErpReqCandidatesFromText(blob)
      if (!nums.length) return
      const seen = new Set(owtrCommentErpReqCandidates)
      for (const n of nums) {
        if (!seen.has(n)) {
          seen.add(n)
          owtrCommentErpReqCandidates.push(n)
        }
      }
    }
    if (auxiliaryText) {
      const qh = extractCbp007ErpReqHintsFromText(auxiliaryText, [de])
      questionAuxiliaryErpReqCandidates = qh || []
      if (qh?.length) {
        rawTextChunks.push(auxiliaryText)
        for (const n of qh) {
          if (!owtrCommentErpReqCandidates.includes(n)) owtrCommentErpReqCandidates.push(n)
        }
      }
    }
    for (const ot of getOwtrTableCandidates()) {
      try {
        let rs
        try {
          rs = await pool
            .request()
            .input('de', sql.Int, de)
            .query(
              `
SELECT TOP 1
  Series,
  LTRIM(RTRIM(CAST(DocNum AS NVARCHAR(100)))) AS DocNumTxt,
  LTRIM(RTRIM(CAST(NumAtCard AS NVARCHAR(100)))) AS NumAtCardTxt,
  LTRIM(RTRIM(CAST(ISNULL(Comments, N'') AS NVARCHAR(max)))) AS CommentsTxt,
  LTRIM(RTRIM(CAST(ISNULL(JrnlMemo, N'') AS NVARCHAR(max)))) AS JrnlMemoTxt
FROM ${ot}
WHERE DocEntry = @de
`.trim()
            )
        } catch {
          rs = await pool
            .request()
            .input('de', sql.Int, de)
            .query(
              `
SELECT TOP 1
  Series,
  LTRIM(RTRIM(CAST(DocNum AS NVARCHAR(100)))) AS DocNumTxt,
  LTRIM(RTRIM(CAST(NumAtCard AS NVARCHAR(100)))) AS NumAtCardTxt
FROM ${ot}
WHERE DocEntry = @de
`.trim()
            )
        }
        const row = rs.recordset?.[0]
        if (!row) continue
        const ser = row?.Series
        if (owtrSeries == null) {
          owtrSeries =
            ser != null && String(ser).trim() !== '' && !Number.isNaN(Number(ser))
              ? Number(ser)
              : null
        }
        if (!owtrDocNum) owtrDocNum = String(row?.DocNumTxt ?? '').trim()
        if (!numAtCard) numAtCard = String(row?.NumAtCardTxt ?? '').trim()
        mergeOwtrCommentCandidates(
          [String(row?.CommentsTxt ?? ''), String(row?.JrnlMemoTxt ?? '')].join('\n')
        )
      } catch {
        /* try next */
      }
    }
    /** WTR1 라인 비고(FreeTxt) — 헤더 비고가 비어 있고 관계맵 문구가 라인에만 있을 때 */
    for (const wt of getWtr1TableCandidates()) {
      try {
        const rs = await pool
          .request()
          .input('de', sql.Int, de)
          .query(
            `
SELECT LTRIM(RTRIM(CAST(ISNULL(FreeTxt, N'') AS NVARCHAR(max)))) AS LineTxt
FROM ${wt}
WHERE DocEntry = @de
  AND ISNULL(LTRIM(RTRIM(CAST(FreeTxt AS NVARCHAR(max)))), N'') <> N''
`.trim()
          )
        for (const lr of rs.recordset || []) {
          mergeOwtrCommentCandidates(String(lr?.LineTxt ?? ''))
        }
      } catch {
        /* try next table / FreeTxt 없음 */
      }
    }

    /** 키워드 없이 `70194`만 적힌 비고·전각 숫자 등 — OWTR DocEntry/DocNum과 다른 5~8자리 숫자를 후보에 추가 */
    const looseOn =
      String(process.env.SAP_CBP007_ERPREQ_LOOSE_DIGITS || 'true').trim().toLowerCase() !==
      'false'
    if (looseOn) {
      const full = rawTextChunks.join('\n')
      const exclude = [de]
      const dn = Number(String(owtrDocNum || '').replace(/\D/g, ''))
      if (Number.isFinite(dn) && dn > 0) exclude.push(dn)
      const nc = Number(String(numAtCard || '').replace(/\D/g, ''))
      if (Number.isFinite(nc) && nc > 0) exclude.push(nc)
      const afterKw = [...owtrCommentErpReqCandidates]
      const loose = extractLooseErpReqDigitsFromText(full, exclude)
      for (const n of loose) {
        if (!owtrCommentErpReqCandidates.includes(n)) owtrCommentErpReqCandidates.push(n)
      }
      owtrLooseErpReqCandidates = owtrCommentErpReqCandidates.filter(
        (n) => !afterKw.includes(n)
      )
    }

    /** OWTR 헤더 UDF(환경변수 화이트리스트)에서 숫자 erpReq 후보 — B1 DocEntry≠WMS키인 경우 대비 */
    let owtrUdfErpReqCandidates = []
    const udfColNames = parseCbp007OwtrUdfColumnNames()
    if (udfColNames.length) {
      const parts = udfColNames.map(
        (name, i) =>
          `LTRIM(RTRIM(CAST([${name}] AS NVARCHAR(200)))) AS udf${i}`
      )
      for (const ot of getOwtrTableCandidates()) {
        try {
          const rs = await pool
            .request()
            .input('de', sql.Int, de)
            .query(
              `
SELECT TOP 1 ${parts.join(', ')}
FROM ${ot}
WHERE DocEntry = @de
`.trim()
            )
          const row = rs.recordset?.[0]
          if (row) {
            for (let i = 0; i < udfColNames.length; i++) {
              const p = parsePositiveIntErpCandidate(row[`udf${i}`])
              if (p != null) owtrUdfErpReqCandidates.push(p)
            }
            owtrUdfErpReqCandidates = Array.from(
              new Set(owtrUdfErpReqCandidates)
            ).sort((a, b) => a - b)
            break
          }
        } catch {
          /* try next table */
        }
      }
    }

    /** OWTR DocNum/NumAtCard → OWTQ.DocNum 일치 행의 DocEntry (WTR1이 비었을 때도 후보 확보).
     * 관계맵으로 연결된 OWTQ·OWTR은 DocNum이 다를 수 있어, 이 매칭은 부정확할 수 있음 → env로 끌 수 있음. */
    let owtqDocEntriesByDocNum = []
    const matchOwtqByOwtrDocNum =
      String(process.env.SAP_CBP007_OWTQ_BY_OWTR_DOCNUM || 'true').trim().toLowerCase() !==
      'false'
    const excludeDocNumSameDe =
      String(process.env.SAP_CBP007_OWTQ_DOCNUM_EXCLUDE_SAME_DE || 'true').trim().toLowerCase() !==
      'false'
    const owtqNumMax = Math.min(
      Math.max(Number(process.env.SAP_CBP007_MAX_OWTQ_BY_DOCNUM) || 12, 1),
      30
    )
    const docNumKeys = new Set()
    if (matchOwtqByOwtrDocNum) {
      if (owtrDocNum) docNumKeys.add(owtrDocNum)
      if (numAtCard) docNumKeys.add(numAtCard)
    }
    if (docNumKeys.size) {
      const vals = Array.from(docNumKeys)
      for (const qt of getOwtqTableCandidates()) {
        try {
          const req = pool.request()
          vals.forEach((v, i) => req.input(`dk${i}`, sql.NVarChar(100), v))
          const rs = await req.query(
            `
SELECT TOP ${owtqNumMax} CAST(DocEntry AS INT) AS DE
FROM ${qt}
WHERE LTRIM(RTRIM(CAST(DocNum AS NVARCHAR(100)))) IN (${vals.map((_, i) => `@dk${i}`).join(', ')})
ORDER BY DocEntry
`.trim()
          )
          for (const row of rs.recordset || []) {
            const d = Number(row.DE)
            if (Number.isFinite(d) && d > 0) owtqDocEntriesByDocNum.push(d)
          }
          if (owtqDocEntriesByDocNum.length) break
        } catch {
          /* try next */
        }
      }
      owtqDocEntriesByDocNum = Array.from(new Set(owtqDocEntriesByDocNum)).sort(
        (a, b) => a - b
      )
      if (excludeDocNumSameDe) {
        owtqDocEntriesByDocNum = owtqDocEntriesByDocNum.filter((x) => Number(x) !== de)
      }
      owtqBaseEntries = Array.from(
        new Set([...owtqBaseEntries, ...owtqDocEntriesByDocNum])
      ).sort((a, b) => a - b)
    }

    let owtqDocNum = ''
    let owtqSeries = null
    if (owtqDe != null) {
      for (const qt of getOwtqTableCandidates()) {
        try {
          const rs = await pool
            .request()
            .input('deq', sql.Int, owtqDe)
            .query(
              `
SELECT TOP 1
  Series,
  LTRIM(RTRIM(CAST(DocNum AS NVARCHAR(100)))) AS DocNumTxt
FROM ${qt}
WHERE DocEntry = @deq
`.trim()
            )
          const row = rs.recordset?.[0]
          const ser = row?.Series
          owtqSeries =
            ser != null && String(ser).trim() !== '' && !Number.isNaN(Number(ser))
              ? Number(ser)
              : null
          owtqDocNum = String(row?.DocNumTxt ?? '').trim()
          if (owtqDocNum || owtqSeries != null) break
        } catch {
          /* try next */
        }
      }
    }

    rows.push({
      de,
      owtqDe,
      owtqBaseEntries,
      owtrDocEntriesByOwtqBaseEntry,
      owtqDocEntriesByDocNum,
      baseRefNum,
      owtrDocNum,
      numAtCard,
      owtqDocNum,
      owtrSeries,
      owtqSeries,
      owtrUdfErpReqCandidates,
      owtrCommentErpReqCandidates,
      owtrLooseErpReqCandidates,
      questionAuxiliaryErpReqCandidates,
      wtr1Diag,
    })
  }

  const strategies = []
  /** CBP007이 erpReqNo를 SQL int로 바인딩하면 `67-70176` 같은 문자열은 변환 오류가 남 */
  const intOnlyErpReq =
    String(process.env.SAP_CBP007_ERPREQ_INT_ONLY || 'true').trim().toLowerCase() !== 'false'
  const allowComposite =
    String(process.env.SAP_CBP007_ERPREQ_ALLOW_COMPOSITE || '').trim().toLowerCase() ===
    'true'

  const add = (arr) => {
    if (!Array.isArray(arr) || arr.length !== unique.length) return
    if (arr.some((x) => !String(x ?? '').trim())) return
    const normalized = arr.map((x) => String(x).trim())
    if (intOnlyErpReq && normalized.some((x) => !/^\d+$/.test(x))) return
    const key = normalized.join('|')
    if (!strategies.some((t) => t.join('|') === key)) strategies.push(normalized)
  }

  const objTypeOwtr = String(
    process.env.SAP_CBP007_ERPREQ_OBJTYPE_OWTR ||
      process.env.SAP_CBP007_ERPREQ_OBJTYPE ||
      '67'
  ).trim()
  const objTypeOwtq = String(
    process.env.SAP_CBP007_ERPREQ_OBJTYPE_OWTQ || '1250000001'
  ).trim()
  const sep = String(process.env.SAP_CBP007_ERPREQ_SERIES_SEP ?? '-').trim() || '-'
  const padLen = Math.min(
    Math.max(Number(process.env.SAP_CBP007_ERPREQ_ZERO_PAD) || 0, 0),
    20
  )

  // 1) 순수 숫자 키 — 단일 OWTR이면 WTR1의 모든 BaseEntry·DocNum 등을 각각 전략으로
  if (unique.length === 1 && rows.length === 1) {
    const r = rows[0]
    const keyOrder = []
    const pushKey = (v) => {
      const s = String(v ?? '').trim()
      if (!s || !/^\d+$/.test(s)) return
      if (!keyOrder.includes(s)) keyOrder.push(s)
    }
    const pushSeriesDocNum = (series, docNum) => {
      const ser = String(series ?? '').trim()
      const dn = String(docNum ?? '').trim()
      if (!/^\d+$/.test(ser) || !/^\d+$/.test(dn)) return
      pushKey(`${ser}${dn}`)
    }
    pushKey(r.de)
    pushKey(r.owtrDocNum)
    pushSeriesDocNum(r.owtrSeries, r.owtrDocNum)
    if (/^\d+$/.test(objTypeOwtr || '')) {
      pushKey(`${objTypeOwtr}${r.de}`)
      if (/^\d+$/.test(String(r.owtrDocNum || '').trim())) {
        pushKey(`${objTypeOwtr}${String(r.owtrDocNum).trim()}`)
      }
    }
    for (const be of r.owtqBaseEntries || []) pushKey(be)
    for (const od of r.owtrDocEntriesByOwtqBaseEntry || []) pushKey(String(od))
    pushKey(r.owtqDe)
    pushKey(r.owtqDocNum)
    pushSeriesDocNum(r.owtqSeries, r.owtqDocNum)
    if (/^\d+$/.test(objTypeOwtq || '')) {
      if (r.owtqDe != null) pushKey(`${objTypeOwtq}${r.owtqDe}`)
      if (/^\d+$/.test(String(r.owtqDocNum || '').trim())) {
        pushKey(`${objTypeOwtq}${String(r.owtqDocNum).trim()}`)
      }
    }
    if (r.baseRefNum != null && r.baseRefNum > 0) pushKey(r.baseRefNum)
    pushKey(r.numAtCard)
    for (const u of r.owtrUdfErpReqCandidates || []) pushKey(String(u))
    const extraErp = String(process.env.SAP_CBP007_ERPREQ_EXTRA || '')
      .split(/[,;]+/)
      .map((s) => Number(String(s).trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
    for (const x of extraErp) pushKey(String(x))
    /** 비고·질문 숫자는 WMS에 없을 수 있어 OWTR DocEntry·B1 연결 키 뒤에 시도 */
    for (const u of r.owtrCommentErpReqCandidates || []) pushKey(String(u))
    for (const k of keyOrder) add([k])
  } else {
    add(rows.map((r) => String(r.owtqDe != null ? r.owtqDe : r.de)))
    add(rows.map((r) => String(r.de)))
    if (rows.every((r) => r.owtrDocNum)) {
      add(rows.map((r) => r.owtrDocNum))
    }
    if (rows.every((r) => r.owtqDocNum)) {
      add(rows.map((r) => r.owtqDocNum))
    }
    if (rows.every((r) => r.numAtCard)) {
      add(rows.map((r) => r.numAtCard))
    }
    if (rows.every((r) => r.baseRefNum != null && r.baseRefNum > 0)) {
      add(rows.map((r) => String(r.baseRefNum)))
    }
  }
  if (padLen > 0) {
    add(rows.map((r) => String(r.de).padStart(padLen, '0')))
    if (rows.every((r) => r.owtrDocNum)) {
      add(rows.map((r) => r.owtrDocNum.padStart(padLen, '0')))
    }
    if (rows.every((r) => r.owtqDe != null)) {
      add(rows.map((r) => String(r.owtqDe).padStart(padLen, '0')))
    }
  }

  // 2) ObjType·Series 복합 키 — erpReqNo가 varchar로 받는 서버 전용 (기본 끔)
  if (allowComposite && !intOnlyErpReq) {
    if (objTypeOwtr) {
      add(rows.map((r) => `${objTypeOwtr}-${r.de}`))
      add(rows.map((r) => `${objTypeOwtr}/${r.de}`))
      if (rows.every((r) => r.owtrDocNum)) {
        add(rows.map((r) => `${objTypeOwtr}-${r.owtrDocNum}`))
      }
    }
    if (objTypeOwtq && rows.every((r) => r.owtqDe != null)) {
      add(rows.map((r) => `${objTypeOwtq}-${r.owtqDe}`))
      if (rows.every((r) => r.owtqDocNum)) {
        add(rows.map((r) => `${objTypeOwtq}-${r.owtqDocNum}`))
      }
    }
    if (rows.every((r) => r.owtrDocNum && r.owtrSeries != null)) {
      add(rows.map((r) => `${r.owtrSeries}${sep}${r.owtrDocNum}`))
    }
    if (rows.every((r) => r.owtqDocNum && r.owtqSeries != null)) {
      add(rows.map((r) => `${r.owtqSeries}${sep}${r.owtqDocNum}`))
    }
  }

  const stratList = strategies.length ? strategies : [unique.map((n) => String(n))]

  const lookupNotes = []
  if (unique.length === 1 && rows.length === 1) {
    const r = rows[0]
    if (r.owtrCommentErpReqCandidates?.length) {
      lookupNotes.push(
        '**Comments/JrnlMemo·WTR1 FreeTxt** 등(복수 OWTR·WTR1 테이블 병합)에서 재고이전요청 관련 숫자 후보: ' +
          r.owtrCommentErpReqCandidates.join(', ') +
          '. (OWTR DocEntry·B1 연결 키 다음 순서로 시도합니다.)'
      )
    }
    if (r.owtrLooseErpReqCandidates?.length) {
      lookupNotes.push(
        '위 목록 중 **키워드 없이** 비고 숫자만으로 잡은 후보: ' +
          r.owtrLooseErpReqCandidates.join(', ') +
          '. 오탐이면 `SAP_CBP007_ERPREQ_LOOSE_DIGITS=false` 또는 본문 `erpReqExtra`로 확정하세요.'
      )
    }
    if (r.questionAuxiliaryErpReqCandidates?.length) {
      lookupNotes.push(
        'API **질문 본문**에서만 추출한 후보(OWTR DocEntry와 다른 숫자): ' +
          r.questionAuxiliaryErpReqCandidates.join(', ') +
          '. SQL 비고가 비어 있어도 CBP007에 반영됩니다.'
      )
    }
    const de = Number(r.de)
    const bases = r.owtqBaseEntries || []
    const byDn = r.owtqDocEntriesByDocNum || []
    const onlySameAsOwtr =
      r.owtqDe == null &&
      bases.length > 0 &&
      bases.every((x) => Number(x) === de) &&
      byDn.length > 0 &&
      byDn.every((x) => Number(x) === de)
    if (onlySameAsOwtr) {
      lookupNotes.push(
        'OWTQ 연결 정보가 모두 OWTR DocEntry(' +
          de +
          ')와 동일한 숫자로만 조회되었습니다. 관계맵으로 묶인 OWTQ·OWTR은 **문서번호(DocNum)가 서로 다를 수 있어**, OWTR DocNum으로 OWTQ를 찾는 방식은 실제 WMS 요청키와 어긋날 수 있습니다. 재고이전요청만 마감(U_WMSNY 등)된 뒤 재고이전(OWTR)이 남은 전형적인 경우, WMS CBP007의 erpReqNo는 B1 DocEntry와 다를 수 있습니다. 담당자에게 WMS 요청키를 확인하거나 `SAP_CBP007_ERPREQ_EXTRA`에 해당 숫자를 추가하세요. DocNum 역매칭을 끄려면 `SAP_CBP007_OWTQ_BY_OWTR_DOCNUM=false`를 설정하세요.'
      )
      if (!parseCbp007OwtrUdfColumnNames().length) {
        lookupNotes.push(
          'OWTR 헤더 사용자필드에 WMS 요청번호가 있다면 `SAP_CBP007_OWTR_UDF_ERPREQ`에 필드명(예: `U_WmsReqNo`)을 쉼표로 넣으면 해당 숫자가 erpReq 후보에 자동 포함됩니다.'
        )
      } else if (
        !(r.owtrUdfErpReqCandidates && r.owtrUdfErpReqCandidates.length)
      ) {
        lookupNotes.push(
          '`SAP_CBP007_OWTR_UDF_ERPREQ`로 지정한 OWTR UDF에서 유효한 숫자를 읽지 못했습니다. 필드명·값 형식을 확인하세요.'
        )
      }
    } else if (
      r.owtqDe == null &&
      bases.length === 0 &&
      byDn.length === 0 &&
      !(r.owtrDocEntriesByOwtqBaseEntry && r.owtrDocEntriesByOwtqBaseEntry.length)
    ) {
      lookupNotes.push(
        'WTR1에서 OWTQ BaseEntry를 찾지 못했고(자기참조 제외), OWTR DocNum→OWTQ.DocNum 역매칭 결과도 없습니다. **WMS erpReqNo는 B1 OWTR DocEntry/DocNum과 다를 수 있어** SQL만으로는 키를 확정하기 어렵습니다. 관계맵·비고에 **재고이전요청(OWTQ) DocEntry**가 보이면 API 본문 `erpReqExtra` 또는 질문에 `기준 재고이전요청 70186` 형태로 넘기면 CBP007이 해당 숫자를 먼저 시도합니다. `SAP_CBP007_ERPREQ_EXTRA`, `SAP_CBP007_OWTR_UDF_ERPREQ`, `SAP_CBP007_RAW_JSON` 또는 WMS 담당자 확인도 가능합니다.'
      )
    }
    const revOwtr = r.owtrDocEntriesByOwtqBaseEntry || []
    if (revOwtr.length) {
      lookupNotes.push(
        'WTR1 **역조회**(BaseEntry=입력 DocEntry)로, 이 번호를 **원천(Base)** 으로 쓰는 **재고이전(OWTR) 헤더** DocEntry가 ' +
          revOwtr.join(', ') +
          ' 로 잡혔습니다. 관계맵에서 재고이전요청 DocEntry와 실제 재고이전(OWTR) DocEntry가 다르게 보일 때, 순방향 WTR1(`DocEntry`=' +
          de +
          ')만 보면 OWTQ 링크가 비어 보일 수 있습니다. WMS `erpReqNo`는 **위 OWTR DocEntry** 일 수 있으니 `cbp007LookupRows.owtrDocEntriesByOwtqBaseEntry`를 확인하세요.'
      )
    }
    const wd = r.wtr1Diag
    if (wd && typeof wd === 'object') {
      const lf = Number(wd.linesForDocEntry ?? 0)
      const ns = Number(wd.linesWithNonSelfBaseEntry ?? 0)
      const br = Number(wd.linesWhereBaseEntryIsDe ?? 0)
      if (lf === 0) {
        lookupNotes.push(
          'WTR1(' +
            String(wd.table || '') +
            ')에 `DocEntry=' +
            de +
            '` 행이 **0건**입니다. B1에서 해당 번호가 OWTR인지·WTR1 라인이 있는지 확인하세요. `KAI_SBO_WTR1_TABLE`·DB 연결이 맞는지도 점검합니다.'
        )
      } else if (ns === 0 && !revOwtr.length) {
        lookupNotes.push(
          'WTR1에는 라인이 있으나 **유효한 BaseEntry**(자기참조가 아닌 원천 DocEntry)가 없어 순방향·역조회 후보가 비었습니다. 역조회 `BaseEntry=' +
            de +
            '` 행 수: ' +
            br +
            '. 비표준 연동·관계맵만 있는 경우 `erpReqExtra`/`SAP_CBP007_ERPREQ_EXTRA`로 WMS 키를 지정하세요.'
        )
      }
    }
  }

  return { strategies: stratList, lookupRows: rows, lookupNotes }
}

/**
 * OWTR DocEntry -> OWTQ BaseEntry 역추적 (CBP007 erpReqNo용).
 * @param {{ fallbackToOwtr?: boolean }} [opts] — `fallbackToOwtr:false`이면 연결 실패 시 OWTR DocEntry를 그대로 넣지 않음(OWTQ 마감용).
 * 찾지 못한 건은 원래 DocEntry를 그대로 반환(fallback 기본 true).
 */
export async function resolveCbp007DocEntriesFromOwtr(docEntries, opts = {}) {
  const fallbackToOwtr = opts.fallbackToOwtr !== false
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)
  if (!unique.length) return []

  let pool
  try {
    pool = await getPool()
  } catch {
    return unique
  }
  if (!pool) return unique

  const baseTypes = String(process.env.KAI_SBO_OWTQ_BASE_TYPES || '1250000001,67')
    .split(/[,\s]+/)
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n))
    .slice(0, 10)

  const mapped = []
  for (const de of unique) {
    let pushed = false
    // 1) WTR1.BaseEntry 우선
    for (const wt of getWtr1TableCandidates()) {
      try {
        const req = pool.request().input('de', sql.Int, de)
        const btClause = baseTypes.length
          ? `AND ISNULL(BaseType,-1) IN (${baseTypes.map((_, i) => `@bt${i}`).join(', ')})`
          : ''
        baseTypes.forEach((bt, i) => req.input(`bt${i}`, sql.Int, bt))
        const rs = await req.query(
          `
SELECT DISTINCT BaseEntry
FROM ${wt}
WHERE DocEntry = @de
  AND BaseEntry IS NOT NULL
  AND BaseEntry <> @de
  ${btClause}
`.trim()
        )
        const bases = (rs.recordset || [])
          .map((x) => Number(x.BaseEntry))
          .filter((n) => Number.isFinite(n) && n > 0 && n !== de)
        if (bases.length) {
          bases.forEach((n) => mapped.push(n))
          pushed = true
          break
        }
      } catch {
        /* try next */
      }
    }
    // 2) BaseType 불일치 대비: WTR1.BaseRef 숫자값 사용
    if (!pushed) {
      for (const wt of getWtr1TableCandidates()) {
        try {
          const rs = await pool
            .request()
            .input('de', sql.Int, de)
            .query(
              `
SELECT DISTINCT BaseRef
FROM ${wt}
WHERE DocEntry = @de
  AND ISNULL(LTRIM(RTRIM(CAST(BaseRef AS NVARCHAR(100)))), '') <> ''
`.trim()
            )
          const refs = (rs.recordset || [])
            .map((x) => Number(String(x.BaseRef ?? '').replace(/\D/g, '')))
            .filter((n) => Number.isFinite(n) && n > 0)
          if (refs.length) {
            refs.forEach((n) => mapped.push(n))
            pushed = true
            break
          }
        } catch {
          /* try next */
        }
      }
    }
    // 3) OWTR 헤더 DocNum/NumAtCard -> OWTQ.DocNum 역매핑
    if (!pushed) {
      const keys = new Set()
      for (const ot of getOwtrTableCandidates()) {
        try {
          const rs = await pool
            .request()
            .input('de', sql.Int, de)
            .query(
              `
SELECT TOP 1
  LTRIM(RTRIM(CAST(DocNum AS NVARCHAR(100)))) AS DocNumTxt,
  LTRIM(RTRIM(CAST(NumAtCard AS NVARCHAR(100)))) AS NumAtCardTxt
FROM ${ot}
WHERE DocEntry = @de
`.trim()
            )
          const row = rs.recordset?.[0]
          const d1 = String(row?.DocNumTxt ?? '').trim()
          const d2 = String(row?.NumAtCardTxt ?? '').trim()
          if (d1) keys.add(d1)
          if (d2) keys.add(d2)
        } catch {
          /* try next */
        }
      }
      if (keys.size) {
        for (const qt of getOwtqTableCandidates()) {
          try {
            const req = pool.request()
            const vals = Array.from(keys)
            vals.forEach((v, i) => req.input(`k${i}`, sql.NVarChar(100), v))
            const rs = await req.query(
              `
SELECT DISTINCT DocEntry
FROM ${qt}
WHERE LTRIM(RTRIM(CAST(DocNum AS NVARCHAR(100)))) IN (${vals.map((_, i) => `@k${i}`).join(', ')})
`.trim()
            )
            const docs = (rs.recordset || [])
              .map((x) => Number(x.DocEntry))
              .filter((n) => Number.isFinite(n) && n > 0)
            if (docs.length) {
              docs.forEach((n) => mapped.push(n))
              pushed = true
              break
            }
          } catch {
            /* try next */
          }
        }
      }
    }
    if (!pushed && fallbackToOwtr) mapped.push(de)
  }
  return Array.from(new Set(mapped))
}

/**
 * OWTR DocEntry에 연결된 OWTQ DocEntry만 반환 (없으면 빈 배열).
 */
export async function resolveOwtqDocEntriesFromOwtrStrict(docEntries) {
  return resolveCbp007DocEntriesFromOwtr(docEntries, { fallbackToOwtr: false })
}

/**
 * 재고이전요청(OWTQ)만 마감: [U_WMSNY]=연동값(기본 C), DocStatus=C.
 * OWTR(재고이전) 생성 후 원천 OWTQ를 종료할 때 사용.
 */
export async function closeOwtqByDocEntries(docEntries) {
  const oporVal = String(process.env.KAI_SBO_OPOR_LINK_VALUE_C || 'C').slice(0, 20)
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!allowSqlUpdate()) {
    return {
      ok: false,
      error: 'SQL 업데이트 비활성화: KAI_SBO_SQL_ALLOW_UPDATE=true 필요',
      entries: unique,
      results: [],
      oporLinkValue: oporVal,
    }
  }
  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry가 없습니다.',
      entries: [],
      results: [],
      oporLinkValue: oporVal,
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      entries: unique,
      results: [],
      oporLinkValue: oporVal,
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      entries: unique,
      results: [],
      oporLinkValue: oporVal,
    }
  }

  const results = []
  for (const de of unique) {
    let owtqFound = null
    for (const wt of getOwtqTableCandidates()) {
      try {
        const r = await pool
          .request()
          .input('de', sql.Int, de)
          .query(`SELECT TOP 1 DocEntry FROM ${wt} WHERE DocEntry=@de`)
        if (r.recordset?.length) {
          owtqFound = wt
          break
        }
      } catch {
        /* try next */
      }
    }

    if (!owtqFound) {
      results.push({
        docEntry: de,
        ok: false,
        error: 'OWTQ에서 DocEntry를 찾지 못함',
      })
      continue
    }

    try {
      let aff = 0
      try {
        const u = await pool
          .request()
          .input('de', sql.Int, de)
          .input('v', sql.NVarChar(20), oporVal)
          .query(
            `UPDATE ${owtqFound} SET [U_WMSNY] = @v, DocStatus = 'C' WHERE DocEntry=@de AND ISNULL(CANCELED,'N')='N'`
          )
        aff = (u.rowsAffected || [0])[0] || 0
      } catch {
        const u2 = await pool
          .request()
          .input('de', sql.Int, de)
          .input('v', sql.NVarChar(20), oporVal)
          .query(
            `UPDATE ${owtqFound} SET [U_WMSNY] = @v, DocStatus = 'C' WHERE DocEntry=@de`
          )
        aff = (u2.rowsAffected || [0])[0] || 0
      }
      results.push({
        docEntry: de,
        role: 'OWTQ',
        owtqTable: owtqFound,
        rows: aff,
      })
    } catch (e) {
      results.push({
        docEntry: de,
        role: 'OWTQ',
        ok: false,
        error: String(e?.message || e),
      })
    }
  }

  const ok = !results.some((r) => r.error)
  return {
    ok,
    entries: unique,
    results,
    oporLinkValue: oporVal,
  }
}

export async function closeOpdnByDocEntries(docEntries) {
  const tableCandidates = getOpdnTableCandidates()
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!allowSqlUpdate()) {
    return {
      ok: false,
      error: 'SQL 업데이트 비활성화: KAI_SBO_SQL_ALLOW_UPDATE=true 필요',
      affected: 0,
      entries: unique,
      table: tableCandidates[0] || '[dbo].[OPDN]',
    }
  }
  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry가 없습니다. 예: DocEntry 14614, 14613 마감',
      affected: 0,
      entries: [],
      table: tableCandidates[0] || '[dbo].[OPDN]',
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      affected: 0,
      entries: unique,
      table: tableCandidates[0] || '[dbo].[OPDN]',
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      affected: 0,
      entries: unique,
      table: tableCandidates[0] || '[dbo].[OPDN]',
    }
  }

  const placeholders = unique.map((_, i) => `@d${i}`).join(', ')
  const tried = []
  for (const table of tableCandidates) {
    try {
      const req = pool.request()
      unique.forEach((v, i) => req.input(`d${i}`, sql.Int, v))
      const q = `
UPDATE ${table}
SET DocStatus = 'C'
WHERE DocEntry IN (${placeholders})
  AND ISNULL(CANCELED, 'N') = 'N'
  AND ISNULL(DocStatus, '') = 'O';

SELECT DocEntry, DocNum, DocDate, CardCode, CardName, DocStatus, CANCELED
FROM ${table}
WHERE DocEntry IN (${placeholders})
ORDER BY DocEntry DESC;
`.trim()
      const rs = await req.query(q)
      const affected = (rs.rowsAffected || [0])[0] || 0
      const rows =
        Array.isArray(rs.recordsets) && rs.recordsets[1]
          ? rs.recordsets[1]
          : rs.recordset || []
      return {
        ok: true,
        affected,
        rows,
        entries: unique,
        table,
      }
    } catch (e) {
      tried.push(`${table}: ${String(e?.message || e)}`)
    }
  }
  return {
    ok: false,
    error: tried.join(' | '),
    affected: 0,
    entries: unique,
    table: tableCandidates[0] || '[dbo].[OPDN]',
  }
}

export async function cancelOpdnByDocEntries(docEntries) {
  const tableCandidates = getOpdnTableCandidates()
  const unique = Array.from(
    new Set(
      (Array.isArray(docEntries) ? docEntries : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  ).slice(0, 200)

  if (!allowSqlUpdate()) {
    return {
      ok: false,
      error: 'SQL 업데이트 비활성화: KAI_SBO_SQL_ALLOW_UPDATE=true 필요',
      affected: 0,
      entries: unique,
      table: tableCandidates[0] || '[dbo].[OPDN]',
    }
  }
  if (!unique.length) {
    return {
      ok: false,
      error: 'DocEntry가 없습니다. 예: DocEntry 14614 취소',
      affected: 0,
      entries: [],
      table: tableCandidates[0] || '[dbo].[OPDN]',
    }
  }

  let pool
  try {
    pool = await getPool()
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      affected: 0,
      entries: unique,
      table: tableCandidates[0] || '[dbo].[OPDN]',
    }
  }
  if (!pool) {
    return {
      ok: false,
      error: 'SQL 연결 설정 없음',
      affected: 0,
      entries: unique,
      table: tableCandidates[0] || '[dbo].[OPDN]',
    }
  }

  const placeholders = unique.map((_, i) => `@d${i}`).join(', ')
  const tried = []
  for (const table of tableCandidates) {
    try {
      const req = pool.request()
      unique.forEach((v, i) => req.input(`d${i}`, sql.Int, v))
      const q = `
UPDATE ${table}
SET CANCELED = 'Y',
    DocStatus = 'C'
WHERE DocEntry IN (${placeholders})
  AND ISNULL(CANCELED, 'N') = 'N';

SELECT DocEntry, DocNum, DocDate, CardCode, CardName, DocStatus, CANCELED
FROM ${table}
WHERE DocEntry IN (${placeholders})
ORDER BY DocEntry DESC;
`.trim()
      const rs = await req.query(q)
      const affected = (rs.rowsAffected || [0])[0] || 0
      const rows =
        Array.isArray(rs.recordsets) && rs.recordsets[1]
          ? rs.recordsets[1]
          : rs.recordset || []
      return {
        ok: true,
        affected,
        rows,
        entries: unique,
        table,
      }
    } catch (e) {
      tried.push(`${table}: ${String(e?.message || e)}`)
    }
  }
  return {
    ok: false,
    error: tried.join(' | '),
    affected: 0,
    entries: unique,
    table: tableCandidates[0] || '[dbo].[OPDN]',
  }
}
