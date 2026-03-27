/**
 * SAP Business One — 입고(PO) 헤더 OPDN (SQL Server)
 * 예: FROM [SBO_MACRO].[dbo].[OPDN] WHERE DocDate >= @fromDate
 */

import sql from 'mssql'

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
    requestTimeout: 45000,
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
