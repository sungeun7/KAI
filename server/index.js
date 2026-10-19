/**
 * KAI REST API — Java KaiServer와 동일한 엔드포인트/동작 (Node.js)
 * POST /api/query  { "question": "..." }
 * GET  /api/status
 */
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import {
  fetchSapOdataContext,
  fetchSapOdataUrl,
  isAllowedSapUrl,
} from './sapContext.js'
import { isEtcOutbizOwtqCode } from './cva002EtcCodes.js'
import {
  generateJournalProposal,
  postJournalToSap,
} from './sapJournal.js'
import { diConfigured } from './diClient.js'
import {
  applyStockTransferDefaults,
  generateStockTransferProposal,
  tryParseStockTransferPayloadFromInstruction,
  extractBatchNo,
  extractProcYmd,
  extractProcHms,
  mergeWtq1IntoProposal,
  postGoodsIssue,
  postStockTransferCancelCbp007,
  extractCbp007ErpReqHintsFromText,
  proposalToCSM001Body,
  postStockTransfer,
  normalizeHttpUrl,
  getStockTransferEtcOutboundDisplayLine,
  applySalesTypeFromInstructionToProposal,
} from './stockTransfer.js'
import {
  generateInboundProcessingProposal,
  buildInboundRequestBody,
  postInboundProcessing,
  tryParseCBP002RequestFromInstruction,
  normalizeCBP002Request,
} from './inboundProcessing.js'
import {
  buildInboundPendingOdataUrl,
  extractDocEntriesForReturnRequestClose,
  extractDocEntriesFromQuestion,
  isInboundCancelAndIssueIntent,
  isInboundCloseIntent,
  isInboundDocumentListIntent,
  isInboundScheduleCancelIntent,
  isOutboundScheduleCancelIntent,
  isCva003DeliveryCancelIntent,
  inferOutboundScheduleDocRole,
  extractPickingAbsEntryFromQuestion,
  isReturnCloseCancelIntent,
  isReturnDocumentProcessingIntent,
  isReturnRequestCloseIntent,
} from './sapInboundPending.js'
import {
  buildStockTransferProposalFromPdnLines,
  cancelInboundScheduleByDocEntries,
  cancelOutboundScheduleByDocEntries,
  cancelOwtrByDocEntries,
  cancelReturnCloseByDocEntries,
  cancelOpdnByDocEntries,
  closeOrrrByDocEntries,
  closeOwtqByDocEntries,
  resolveOwtqDocEntriesFromOwtrStrict,
  closeOpdnByDocEntries,
  enrichPdn1LinesWithStockBatch,
  fetchOpdnSql,
  fetchPdn1LinesForDocEntries,
  fetchRrr1LinesForDocEntries,
  fetchWtq1LinesForDocEntries,
  fetchRdr1LinesForOrdrDocEntries,
  fetchWtq1LinesForOwtqDocEntries,
  isSboSqlConfigured,
  resolveCbp006RequestBodyBatches,
  enrichCva002OrdrRequestIfNeeded,
  diagnoseCva002OigeReadiness,
  fetchOdlNUdfForOrdrCancel,
} from './sboOpdnSql.js'
import {
  buildReturnRequestBody,
  generateReturnProcessingProposal,
  extractDocEntriesFromCbp006Request,
  mergeRrr1BatchIntoCbp006Body,
  mergeRrr1IntoProposal,
  normalizeCBP006Request,
  postReturnProcessing,
  tryParseCBP006RequestFromInstruction,
} from './returnProcessing.js'
import {
  tryParseCva002RequestFromInstruction,
  applyCva002Defaults,
  postCva002,
  isCva002OutboundPayloadQuestion,
  toDotNetCva002Payload,
  parseOrdrOutboundCva002Instruction,
  buildCva002OrdrDraft,
  mergeRdr1RowsIntoCva002Draft,
  mergeWtq1RowsIntoCva002Draft,
  cva002ReqHasRunnableProdList,
} from './cva002Outbound.js'
import { postCva003, buildCva003OrdrDeliveryCancelDraft } from './cva003Outbound.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DOCUMENTS_DIR = path.join(ROOT, 'documents')

/** dotenv 패키지 없이 .env 로드 (루트 → server, 나중 파일이 같은 키 덮어씀) */
function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq < 1) continue
    const key = s.slice(0, eq).trim()
    let val = s.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
}
loadEnvFromFile(path.join(ROOT, '.env'))
loadEnvFromFile(path.join(__dirname, '.env'))

const PORT = Number(process.env.PORT) || 8080
const MAX_FILE_CHARS = 2000
const MAX_DOCS = 20
const MAX_CHUNKS_PER_DOC = 5
const CHUNK_SIZE = 500
const CHUNK_OVERLAP = 50
const TOP_K = 5
const EMBEDDING_DIM = 64
const CHAT_MODEL = 'gpt-4o-mini'
const EMBEDDING_MODEL = 'text-embedding-3-small'
const BUILD_TAG = 'opdn-sql-close-v1'

const apiKey = (process.env.OPENAI_API_KEY || '').trim()
const apiConfigured = Boolean(apiKey)
const sapOdataConfigured = Boolean((process.env.SAP_ODATA_URL || '').trim())
const sapInboundPendingOdataConfigured = Boolean(
  (process.env.SAP_ODATA_INBOUND_PENDING_URL || '').trim()
)
const sapJournalPostUrl = (process.env.SAP_JOURNAL_POST_URL || '').trim()
const sapJournalMock = process.env.SAP_JOURNAL_MOCK === 'true'
const journalViaDiOrSap = diConfigured() || Boolean(sapJournalPostUrl)
/** 재고이전 CSM001 (기본 192.168.0.37/CSM001) */
const stockTransferUrl = normalizeHttpUrl(
  (process.env.SAP_STOCK_TRANSFER_URL || 'http://192.168.0.37/CSM001').trim()
)
const goodsIssueUrl = normalizeHttpUrl(
  (process.env.SAP_GOODS_ISSUE_URL || 'https://localhost:44346/CSM003').trim()
)
const cbp007Url = normalizeHttpUrl(
  (process.env.SAP_CBP007_URL || 'https://localhost:44346/CBP007').trim()
)

/** 입고처리 CBP002 (기본 192.168.0.37/CBP002) */
const inboundProcessingUrl = normalizeHttpUrl(
  (process.env.SAP_INBOUND_PROCESS_URL || 'http://192.168.0.37/CBP002').trim()
)
/** 반품마감 CBP006 — ORDN 생성 + ORRR Close */
const cbp006Url = normalizeHttpUrl(
  (process.env.SAP_CBP006_URL || 'http://192.168.0.37/CBP006').trim()
)
/** 출하처리 CVA002 (ODLN / OWTR / OIGE) — 비우면 질의에서 전송 안 함 */
const cva002Url = normalizeHttpUrl((process.env.SAP_CVA002_URL || '').trim())
/** 출하처리 취소 CVA003 (납품 ODLN / OWTR 등 DI 취소) — 비우면 질의에서 전송 안 함 */
const cva003Url = normalizeHttpUrl((process.env.SAP_CVA003_URL || '').trim())
const SAP_CONTEXT_MAX = 20000

/** 선택 시만: 교육용 절차 안내문 (기본은 실제 SAP 반영용 짧은 출력) */
const SAP_GUIDE_DOCUMENT_MODE = `
[출력 모드: 절차 안내 문서]
매뉴얼 형식의 긴 문서를 작성하세요(제목, 단계, 주의사항 등).
`

const SAP_ACTION_FIRST_INSTRUCTIONS = `
[본 프로그램 목적: 실제 SAP 반영]
- 답변은 **SAP에 바로 쓸 수 있는 형태**를 최우선으로 하세요(필드값, 전표 라인, JSON 표, 복사 가능한 표 형태 등).
- **교육용 장문·매뉴얼식 안내는 피하세요.** 필요한 최소 설명만 덧붙이세요.
- 참고 자료에 없는 계정·T-Code·수치는 만들지 말고 "자료 없음"이라고 하세요.
`

/** Java String.hashCode 호환 (더미 임베딩 일관성) */
function javaHashCode(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return h
}

function dummyEmbedding(text) {
  const hash = javaHashCode(text)
  const vec = []
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    vec.push(Math.sin(hash * (i + 1)) * 0.1)
  }
  return vec
}

function isTextFile(filePath) {
  const n = path.basename(filePath).toLowerCase()
  return /\.(txt|md|json|csv)$/.test(n)
}

function walkTextFiles(dir, out = []) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return out
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walkTextFiles(full, out)
    else if (st.isFile() && isTextFile(full)) out.push(full)
  }
  return out
}

function readLimited(filePath, maxChars) {
  const raw = fs.readFileSync(filePath, 'utf8')
  return raw.length <= maxChars ? raw : raw.slice(0, maxChars)
}

function chunkText(text) {
  if (!text || !String(text).trim()) return []
  const take = Math.min(text.length, 2000)
  let buf = ''
  let needSpace = false
  for (let i = 0; i < take; i++) {
    const c = text[i]
    if (/\s/.test(c)) {
      needSpace = buf.length > 0
    } else {
      if (needSpace && buf.length) buf += ' '
      buf += c
      needSpace = false
    }
  }
  buf = buf.replace(/\s+$/g, '')
  const len = buf.length
  const MIN_CHUNK_LEN = 15
  const maxChunks = 5
  const chunks = []
  let start = 0
  while (start < len && chunks.length < maxChunks) {
    const end = Math.min(start + CHUNK_SIZE, len)
    if (end - start >= MIN_CHUNK_LEN) chunks.push(buf.slice(start, end))
    start = CHUNK_OVERLAP > 0 ? end - CHUNK_OVERLAP : end
  }
  return chunks
}

function cosineSimilarity(a, b) {
  if (!a.length || a.length !== b.length) return 0
  let dot = 0,
    normA = 0,
    normB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i],
      y = b[i]
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function createEmbedding(text) {
  if (!apiConfigured) return null
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  })
  if (!res.ok) {
    let body = ''
    try {
      body = (await res.text()).slice(0, 800)
    } catch (_) {}
    console.error(
      '[OpenAI embeddings 오류]',
      res.status,
      body || '(본문 없음)'
    )
    return null
  }
  const json = await res.json()
  const emb = json?.data?.[0]?.embedding
  if (!Array.isArray(emb)) return null
  return emb.map(Number)
}

/** API 키 없을 때만 더미. 키가 있으면 실패 시 null (더미로 섞이면 차원 불일치로 검색 깨짐) */
async function embedForStore(text) {
  if (!apiConfigured) return dummyEmbedding(text)
  return createEmbedding(text)
}

async function embedForQuery(text) {
  if (!apiConfigured) return dummyEmbedding(text)
  const v = await createEmbedding(text)
  return v
}

async function chat(systemPrompt, userMessage, chatOpts = {}) {
  const maxTok = chatOpts.maxTokens ?? (chatOpts.sapDocument ? 3072 : 1024)
  if (!apiConfigured) {
    const hasContext =
      systemPrompt &&
      (systemPrompt.includes('참고') || systemPrompt.includes('자료')) &&
      systemPrompt.length > 100
    if (hasContext) {
      return '문서에서 관련 내용을 찾았습니다. OPENAI_API_KEY를 설정하시면 이 내용을 바탕으로 더 자세한 답변을 받을 수 있습니다.'
    }
    return '질문을 확인했습니다. OPENAI_API_KEY를 설정하시면 문서 기반 답변을 받을 수 있습니다.'
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: maxTok,
      messages: [
        ...(systemPrompt
          ? [{ role: 'system', content: systemPrompt }]
          : []),
        { role: 'user', content: userMessage },
      ],
    }),
  })
  if (!res.ok) {
    let body = ''
    try {
      body = (await res.text()).slice(0, 600)
    } catch (_) {}
    console.error('[OpenAI chat 오류]', res.status, body)
    return `[채팅 API 오류 ${res.status}] 터미널 로그를 확인하세요.`
  }
  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  return content != null ? String(content) : ''
}

/** @type {{ text: string, source: string, embedding: number[] }[]} */
let chunks = []

async function indexDocuments() {
  chunks = []
  const files = walkTextFiles(DOCUMENTS_DIR)
  console.log(
    `documents: 텍스트 파일 ${files.length}개 (최대 ${MAX_DOCS}개까지 처리)`
  )
  let docCount = 0
  let embedFail = 0
  for (const filePath of files) {
    if (docCount >= MAX_DOCS) break
    const source = path.basename(filePath)
    const content = readLimited(filePath, MAX_FILE_CHARS)
    const parts = chunkText(content)
    const limit = Math.min(parts.length, MAX_CHUNKS_PER_DOC)
    if (limit > 0) {
      console.log(`  → ${source} (청크 ${limit}개${apiConfigured ? ', 임베딩 요청 중…' : ''})`)
    }
    for (let i = 0; i < limit; i++) {
      const vec = await embedForStore(parts[i])
      if (vec) {
        chunks.push({ text: parts[i], source, embedding: vec })
      } else if (apiConfigured) {
        embedFail++
      }
    }
    docCount++
  }
  if (apiConfigured && files.length > 0 && chunks.length === 0) {
    console.error(
      '\n>>> API 키는 인식됐지만 임베딩이 전부 실패했습니다.'
    )
    console.error(
      '    키가 맞는지, OpenAI 결제/크레딧, VPN·방화벽을 확인하세요.'
    )
    console.error(
      '    키는 server\\.env 파일에 OPENAI_API_KEY=... 형태로 넣는 것을 권장합니다.\n'
    )
  } else if (apiConfigured && embedFail > 0) {
    console.warn(
      `임베딩 실패 ${embedFail}건 — 일부 문서만 인덱싱됐을 수 있습니다.`
    )
  }
}

async function queryRag(userQuestion, options = {}) {
  const includeSapOdata = Boolean(options.includeSapOdata)
  let sapExtra = ''
  const rawSapCtx = options.sapContext
  if (rawSapCtx != null && String(rawSapCtx).trim()) {
    sapExtra +=
      '\n\n[SAP·외부에서 전달된 데이터 (API sapContext)]\n' +
      String(rawSapCtx).trim().slice(0, SAP_CONTEXT_MAX)
  }
  const clientSapUrl = (options.sapOdataUrl || '').trim()
  const blockClientOdata = process.env.KAI_BLOCK_CLIENT_ODATA === 'true'
  if (clientSapUrl && !blockClientOdata) {
    if (!isAllowedSapUrl(clientSapUrl)) {
      sapExtra +=
        '\n\n[SAP OData URL 오류: http(s) 형식의 전체 주소를 입력하세요.]'
    } else {
      const sap = await fetchSapOdataUrl(
        clientSapUrl,
        options.sapOdataUser,
        options.sapOdataPassword,
        null
      )
      if (sap.ok) {
        sapExtra +=
          '\n\n[SAP OData 조회 (요청에 포함된 URL)]\n' + sap.text
      } else {
        sapExtra += '\n\n[SAP OData 조회 실패: ' + sap.error + ']'
      }
    }
  } else if (clientSapUrl && blockClientOdata) {
    sapExtra += '\n\n[SAP OData: 서버에서 요청별 URL 사용이 비활성화됨]'
  }
  if (includeSapOdata && sapOdataConfigured) {
    const sap = await fetchSapOdataContext()
    if (sap.ok) {
      sapExtra +=
        '\n\n[SAP OData 실시간 조회 결과 (서버 SAP_ODATA_URL)]\n' + sap.text
    } else {
      sapExtra += '\n\n[SAP OData 조회 실패: ' + sap.error + ']'
    }
  } else if (
    includeSapOdata &&
    !sapOdataConfigured &&
    !clientSapUrl
  ) {
    sapExtra +=
      '\n\n[SAP OData: .env 의 SAP_ODATA_URL 없음. 화면에서 OData URL을 직접 입력하세요.]'
  }

  const queryEmbedding = await embedForQuery(userQuestion)
  if (apiConfigured && !queryEmbedding) {
    return (
      '질문 임베딩에 실패했습니다. OPENAI_API_KEY·결제·네트워크를 확인하고, ' +
      '서버를 켠 터미널에 붉은 [OpenAI embeddings 오류] 로그가 있는지 보세요.'
    )
  }
  const dim = queryEmbedding.length
  const pool = chunks.filter((c) => c.embedding.length === dim)
  if (chunks.length > 0 && pool.length === 0) {
    return (
      '문서 인덱스와 질의 임베딩 차원이 다릅니다. API 키를 켠 상태에서 서버를 다시 시작해 ' +
      '문서를 다시 인덱싱하세요. (이전에 키 없이 띄운 뒤 키만 넣은 경우 자주 발생합니다.)'
    )
  }
  const scored = pool.map((c) => ({
    c,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  }))
  scored.sort((a, b) => b.score - a.score)
  const relevant = scored.slice(0, TOP_K).map((s) => s.c)
  const docContext = relevant.map((c) => c.text).join('\n\n---\n\n')
  const merged =
    (docContext.trim() || '(로컬 문서에서 관련 청크 없음)') + sapExtra

  let systemPrompt =
    SAP_ACTION_FIRST_INSTRUCTIONS +
    '\n\n[참고 자료]\n' +
    merged
  const guideDocMode = options.sapDocument === true
  if (guideDocMode) {
    systemPrompt += '\n' + SAP_GUIDE_DOCUMENT_MODE
  }
  return chat(systemPrompt, userQuestion, {
    sapDocument: guideDocMode,
    maxTokens: guideDocMode ? 3072 : 1800,
  })
}

const app = express()
const SIMPLE_UI_PATH = path.join(__dirname, 'simple-ui.html')

app.get('/', (_req, res) => {
  try {
    res.type('html').send(fs.readFileSync(SIMPLE_UI_PATH, 'utf8'))
  } catch {
    res.type('html').send(
      '<!DOCTYPE html><meta charset="utf-8"><p>simple-ui.html 없음</p>'
    )
  }
})

app.use(express.json({ limit: '2mb' }))

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

/** 테스트 경로: 재고이전 — GET 시 안내, POST 시 JSON 수신 후 테스트 응답 */
app.get('/api/csm001', (_req, res) => {
  res.json({
    ok: true,
    test: true,
    message: '재고이전(CSM001) 테스트 수신기',
    usage: 'POST /api/csm001 (Body: JSON, type: KAI_STOCK_TRANSFER_V1, proposal: {...})',
    env: 'SAP_STOCK_TRANSFER_URL=http://localhost:8080/api/csm001 로 설정하면 여기로 전송됨',
  })
})
app.post('/api/csm001', (req, res) => {
  const body = req.body || {}
  const proposal = body.proposal || body
  console.log('[CSM001 테스트 수신]', JSON.stringify(proposal).slice(0, 300))
  res.status(200).json({
    docNo: `TEST-${Date.now().toString(36).toUpperCase()}`,
    message: 'KAI 테스트 수신 성공 (실제 B1 연동은 192.168.0.37 에 API 배포 후 URL 변경)',
  })
})

/** 테스트 경로 목록 */
app.get('/api/test', (_req, res) => {
  res.json({
    message: 'KAI 테스트용 경로',
    endpoints: [
      { method: 'GET', path: '/api/test', description: '이 목록' },
      { method: 'GET', path: '/api/csm001', description: '재고이전 테스트 수신기 안내' },
      { method: 'POST', path: '/api/csm001', description: '재고이전 JSON 수신 → docNo TEST-xxx 반환' },
      { method: 'GET', path: '/api/status', description: 'API·청크·DI·재고이전 URL 상태' },
    ],
  })
})

app.get('/api/status', (_req, res) => {
  res.json({
    buildTag: BUILD_TAG,
    apiConfigured,
    chunkCount: chunks.length,
    sapOdataConfigured,
    sapInboundPendingOdataConfigured,
    sboSqlConfigured: isSboSqlConfigured(),
    sapJournalPostConfigured: Boolean(sapJournalPostUrl),
    diServerConfigured: diConfigured(),
    sapJournalMock,
    stockTransferUrl: stockTransferUrl.replace(/\/\/[^@]+@/, '//***@'),
    cbp006Url: cbp006Url.replace(/\/\/[^@]+@/, '//***@'),
    cva002Url: cva002Url
      ? cva002Url.replace(/\/\/[^@]+@/, '//***@')
      : null,
    cva003Url: cva003Url
      ? cva003Url.replace(/\/\/[^@]+@/, '//***@')
      : null,
  })
})

function isStockTransferIntent(q) {
  if (!q || q.length < 3) return false
  /** 출하처리는 WMS CVA002 전용 — 재고이전(CSM001)으로 보내지 않음 */
  if (/출하\s*처리|출하처리/i.test(q)) return false
  /** '재고이전'은 입고창고 등 문맥의 '입고'보다 먼저 판별 */
  if (/재고\s*이전|재고이전/i.test(q)) return true
  // 입고라는 말이 있으면 재고이전(CSM001) 대신 입고처리(CBP002)로
  if (/입고/i.test(q)) return false
  if (/뭐야|무엇|설명만|가이드|매뉴얼/.test(q)) return false
  if (
    /이동전표|저장위치.*이동|플랜트.*이동|자재.*옮/.test(q) &&
    /만들|생성|해줘|줘|처리|실행|요청|해 주|진행|넣어|어떻게/.test(q)
  ) {
    return true
  }
  return false
}

function isStockTransferCancelIntent(q) {
  const s = String(q || '').trim()
  if (!s) return false
  if (isOutboundScheduleCancelIntent(s)) return false
  const hasTransfer = /재고\s*이전|재고이전|OWTR|OWTQ|stock\s*transfer/i.test(s)
  const hasCancel = /취소|cancel/i.test(s)
  return hasTransfer && hasCancel
}

async function runStockTransferPipelineFromProposal(proposal, instruction) {
  proposal = applySalesTypeFromInstructionToProposal(proposal, instruction)
  // 날짜(procYmd): 사용자가 명시한 경우에만 그 날짜를 사용. 명시 안 했으면 "오늘"로 강제(LLM이 옛날 날짜를 넣어도 무시)
  const ymd = extractProcYmd(instruction)
  if (ymd) {
    const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
    proposal.PostingDate = iso
    proposal.DocDate = iso
  } else {
    delete proposal.PostingDate
    delete proposal.DocDate
  }
  // 배치/일련번호: 사용자가 명시했으면 강제로 proposal에 주입 (LLM이 놓쳐도 전송 바디에 반영)
  const batchNo = extractBatchNo(instruction)
  if (batchNo) {
    if (Array.isArray(proposal.Lines) && proposal.Lines.length) {
      proposal.Lines = proposal.Lines.map((ln) => ({
        ...ln,
        ErpBatchNo: String(ln.ErpBatchNo || ln.erpBatchNo || batchNo),
        LotNo: String(ln.LotNo || ln.lotNo || ''),
      }))
    } else {
      proposal.Lines = [
        {
          ItemCode: proposal.matnr || proposal.ItemCode || '',
          Quantity: Number(proposal.menge || proposal.Quantity || 0) || 0,
          ItemDescription: '',
          ErpBatchNo: batchNo,
          LotNo: '',
          ExpYmd: '',
        },
      ]
    }
    // 하위 호환 키
    proposal.ErpBatchNo = batchNo
  }
  // 처리시간(procHms): 사용자가 "170255" 또는 "17:02:55" 등으로 명시하면 그 값 사용
  const hms = extractProcHms(instruction)
  if (hms) {
    proposal.ProcHms = hms
  } else {
    // 사용자가 시간 입력을 안 했으면 LLM이 넣은 임의 시간을 무시하고 현재 시간으로 고정
    delete proposal.ProcHms
    delete proposal.procHms
  }
  // 스웨거(CSM001) 포맷 강제: 플래그가 없더라도 CSM001용 APIKEY를 설정했으면 스웨거 포맷으로 전송/표시
  const useCSM001Format =
    process.env.SAP_STOCK_TRANSFER_CSM001_FORMAT === 'true' ||
    Boolean((process.env.SAP_CSM001_APIKEY || '').trim())
  const requestBody = useCSM001Format ? proposalToCSM001Body(proposal) : proposal
  if (process.env.SAP_STOCK_TRANSFER_MOCK === 'true') {
    return {
      proposal,
      requestBody,
      posted: true,
      demo: true,
      docNo: `DEMO-ST-${Date.now().toString(36).toUpperCase().slice(-8)}`,
      error: null,
    }
  }
  const r = await postStockTransfer(
    stockTransferUrl,
    process.env.SAP_USER,
    process.env.SAP_PASSWORD,
    proposal
  )
  return {
    proposal,
    requestBody,
    posted: r.ok,
    demo: false,
    docNo: r.docNo,
    error: r.ok ? null : String(r.body || '') + (r.errorHint ? r.errorHint : ''),
    usedUrl: r.usedUrl,
    viaDi: r.viaDi === true,
  }
}

async function runStockTransferPipeline(instruction) {
  const directSt = tryParseStockTransferPayloadFromInstruction(instruction)
  const proposal = directSt
    ? applyStockTransferDefaults(directSt)
    : await generateStockTransferProposal(instruction, apiKey)
  let merged = proposal
  let wtq1Fetch = null
  let docEntries = []
  if (isSboSqlConfigured()) {
    docEntries = extractDocEntriesFromQuestion(instruction)
    if (docEntries.length) {
      wtq1Fetch = await fetchWtq1LinesForDocEntries(docEntries)
      if (wtq1Fetch?.ok && wtq1Fetch.rows?.length) {
        merged = mergeWtq1IntoProposal(proposal, wtq1Fetch.rows)
      }
    }
  }
  const r = await runStockTransferPipelineFromProposal(merged, instruction)
  /** OWTR(CSM001) 전송 성공 후, 질문의 OWTQ DocEntry + WTQ1 조회가 있었으면 요청서 마감 */
  let owtqClose = null
  const autoCloseOwtq =
    String(process.env.KAI_SBO_CLOSE_OWTQ_AFTER_STOCK_TRANSFER || 'true')
      .trim()
      .toLowerCase() !== 'false'
  if (
    r.posted &&
    !r.demo &&
    autoCloseOwtq &&
    isSboSqlConfigured() &&
    docEntries.length &&
    wtq1Fetch?.ok &&
    wtq1Fetch.rows?.length
  ) {
    owtqClose = await closeOwtqByDocEntries(docEntries)
  }
  return { ...r, wtq1: wtq1Fetch, owtqClose }
}

async function prepareCva002Normalized(parsed) {
  const n = applyCva002Defaults(parsed)
  return enrichCva002OrdrRequestIfNeeded(n)
}

async function executeCva002Post(normalized) {
  if (process.env.SAP_CVA002_MOCK === 'true') {
    return {
      requestBody: toDotNetCva002Payload(normalized),
      posted: true,
      demo: true,
      docNo: `DEMO-CVA002-${Date.now().toString(36).toUpperCase().slice(-10)}`,
      error: null,
      usedUrl: cva002Url,
    }
  }
  const r = await postCva002(
    cva002Url,
    process.env.SAP_USER,
    process.env.SAP_PASSWORD,
    normalized
  )
  return {
    requestBody: r.requestBody,
    posted: r.ok,
    demo: false,
    docNo: r.docNo,
    error: r.ok ? null : String(r.body || ''),
    usedUrl: r.usedUrl,
  }
}

function isInboundProcessingIntent(q) {
  if (!q || q.length < 3) return false
  if (/취소|취소처리|취소\s*요청/i.test(q)) return false
  /** 미처리 입고 문서 조회는 CBP002가 아님 */
  if (isInboundDocumentListIntent(q)) return false
  /** OPDN 마감(SQL)은 CBP002가 아님 */
  if (isInboundCloseIntent(q)) return false
  /** 입고 예정 취소(OPOR/OPDN 연동)는 CBP002가 아님 */
  if (isInboundScheduleCancelIntent(q)) return false
  if (isOutboundScheduleCancelIntent(q)) return false
  /** '입고' 라는 단어가 나오면 무조건 입고처리 폼 사용 */
  return /입고/i.test(q)
}

async function runInboundProcessingPipeline(instruction) {
  // 사용자가 CBP002 JSON을 그대로 붙여넣으면 LLM 단계를 건너뛰고 그대로 전송
  const directReq = tryParseCBP002RequestFromInstruction(instruction)
  let proposal
  let requestBody
  if (directReq) {
    proposal = directReq
    requestBody = normalizeCBP002Request(directReq)
  } else {
    proposal = await generateInboundProcessingProposal(instruction, apiKey)
    requestBody = buildInboundRequestBody(instruction, proposal)
  }

  // 전기 전에 필수 값 검증: CBP002는 ErpReqNo/ErpLineNo 쿼리를 하므로 "빈값/더미"면 바로 SqlDataReader에서 오류가 납니다.
  const header = requestBody?.reqList?.[0]
  const prod = header?.prodList?.[0]
  const placeholder = (v) =>
    typeof v === 'string' && v.trim().toLowerCase() === 'string'
  let extractedBatch = /(?:배치|batch|lot)\s*[:=]?\s*([A-Za-z0-9@._\-\/]+)/i.exec(
    instruction
  )?.[1]
  if (!extractedBatch) {
    extractedBatch = /erpBatchNo\s*[:=]\s*([A-Za-z0-9@._\-\/]+)/i.exec(
      instruction
    )?.[1]
  }
  const hasBatchInText = Boolean(extractedBatch)
  const hasLineInText = /erpLineNo|라인|line\s*no|LineNum/i.test(instruction)
  const missing = []
  if (!header || !header.inwhTypeCd || placeholder(header.inwhTypeCd))
    missing.push('inwhTypeCd(입고유형, 예 IW01)')
  if (!header || !header.erpReqNo || placeholder(header.erpReqNo))
    missing.push('erpReqNo(원천 PO DocEntry)')
  if (!header || !header.inwhTypeDtlCd || placeholder(header.inwhTypeDtlCd))
    missing.push('inwhTypeDtlCd(입고유형세부)')
  if (!prod || !prod.ifProdId || placeholder(prod.ifProdId))
    missing.push('ifProdId(품목번호)')
  if (!prod || !prod.towh || placeholder(prod.towh))
    missing.push('towh(입고창고)')
  if (!(Number(prod?.exQty) > 0)) missing.push('exQty(수량)')
  if (hasBatchInText) {
    if (!prod || !prod.erpBatchNo || placeholder(prod.erpBatchNo))
      missing.push('erpBatchNo(배치번호)')
  }
  // erpLineNo는 값이 0이어도 유효할 수 있으므로 "텍스트 존재"가 아니라 "값 존재"로 판단
  const lineNoVal = prod?.erpLineNo
  const hasLineValue =
    lineNoVal !== undefined &&
    lineNoVal !== null &&
    !(typeof lineNoVal === 'string' && placeholder(lineNoVal)) &&
    Number.isFinite(Number(lineNoVal))
  if (!hasLineValue) missing.push('erpLineNo(원천 PO 라인번호)')
  if (missing.length) {
    return {
      proposal,
      requestBody,
      posted: false,
      demo: false,
      docNo: null,
      error:
        '필수값 부족: ' +
        missing.join(', ') +
        '. (Swagger 예시의 `\"string\"` 값은 그대로 넣지 마세요.)',
      usedUrl: inboundProcessingUrl,
      viaDi: false,
      validationFailed: true,
    }
  }

  if (process.env.SAP_INBOUND_PROCESS_MOCK === 'true') {
    return {
      proposal,
      requestBody,
      posted: true,
      demo: true,
      docNo: `DEMO-IN-${Date.now().toString(36).toUpperCase().slice(-8)}`,
      error: null,
      usedUrl: inboundProcessingUrl,
      viaDi: false,
    }
  }

  const r = await postInboundProcessing(
    inboundProcessingUrl,
    process.env.SAP_USER,
    process.env.SAP_PASSWORD,
    requestBody
  )

  // "Invalid attempt to read when no data is present" / DI Error -2028 등은
  // 대개 PO(erpReqNo) 또는 PO 라인(erpLineNo) 기준 조회/매칭이 0건인 경우입니다.
  // 원천 라인번호(erpLineNo)가 0이 아닐 수 있으니, 소량 범위로 자동 재시도.
  if (
    !r.ok &&
    typeof (r.body || '') === 'string' &&
    (/Invalid attempt to read when no data is present/i.test(r.body || '') ||
      /-2028/.test(r.body || '') ||
      /일치하는 레코드가 없습니다/i.test(r.body || ''))
  ) {
    const curLine = Number(requestBody?.reqList?.[0]?.prodList?.[0]?.erpLineNo)
    const candidates = [0, 1, 2, 3, 4, 5, 6, 7].filter((x) => x !== curLine)
    for (const ln of candidates) {
      const tryBody = JSON.parse(JSON.stringify(requestBody))
      if (tryBody?.reqList?.[0]?.prodList?.[0]) {
        tryBody.reqList[0].prodList[0].erpLineNo = ln
      }
      const rr = await postInboundProcessing(
        inboundProcessingUrl,
        process.env.SAP_USER,
        process.env.SAP_PASSWORD,
        tryBody
      )
      if (rr.ok) {
        return {
          proposal,
          requestBody: tryBody,
          posted: true,
          demo: false,
          docNo: rr.docNo,
          resultMessage: rr.resultMessage,
          error: null,
          usedUrl: rr.usedUrl,
          viaDi: rr.viaDi === true,
        }
      }
    }
    // 재시도해도 실패면 아래 에러에 힌트를 남김
    r.errorHint =
      '\n(힌트) 원천 PO DocEntry(erpReqNo) 또는 원천 라인번호(erpLineNo)가 SAP에서 조회되는 값과 다를 수 있습니다. KAI가 erpLineNo 0~7 자동 재시도 후에도 실패했습니다.'
  }

  return {
    proposal,
    requestBody,
    posted: r.ok,
    demo: false,
    docNo: r.docNo,
    resultMessage: r.resultMessage || null,
    error: r.ok ? null : r.body,
    errorHint: r.errorHint || null,
    usedUrl: r.usedUrl,
    viaDi: r.viaDi === true,
  }
}

function isReturnProcessingIntent(q) {
  if (!q || q.length < 4) return false
  if (isStockTransferIntent(q)) return false
  if (isInboundProcessingIntent(q)) return false
  if (isInboundScheduleCancelIntent(q)) return false
  if (isOutboundScheduleCancelIntent(q)) return false
  return isReturnDocumentProcessingIntent(q)
}

async function runReturnProcessingPipeline(instruction) {
  const directReq = tryParseCBP006RequestFromInstruction(instruction)
  let proposal
  let requestBody
  let rrr1Fetch = null

  if (directReq) {
    proposal = directReq
    requestBody = normalizeCBP006Request(directReq)
  } else {
    if (!apiKey) {
      return {
        proposal: null,
        requestBody: null,
        posted: false,
        demo: false,
        docNo: null,
        error:
          'OPENAI_API_KEY 필요 (반품마감 JSON 생성). 또는 CBP006 요청 JSON을 질문에 그대로 붙여넣으세요.',
        usedUrl: cbp006Url,
        viaDi: false,
        validationFailed: true,
        rrr1: null,
        batchResolve: [],
      }
    }
    proposal = await generateReturnProcessingProposal(instruction, apiKey)
    if (isSboSqlConfigured()) {
      const docEntries = extractDocEntriesFromQuestion(instruction)
      if (docEntries.length) {
        rrr1Fetch = await fetchRrr1LinesForDocEntries(docEntries)
        if (rrr1Fetch?.ok && rrr1Fetch.rows?.length) {
          proposal = mergeRrr1IntoProposal(proposal, rrr1Fetch.rows)
        }
      }
    }
    requestBody = buildReturnRequestBody(instruction, proposal)
  }

  if (isSboSqlConfigured()) {
    const fromBody = extractDocEntriesFromCbp006Request(requestBody)
    const fromQ = extractDocEntriesFromQuestion(instruction)
    const seenDe = new Set()
    const docEntries = []
    for (const n of [...fromBody, ...fromQ]) {
      if (Number.isFinite(n) && n > 0 && !seenDe.has(n)) {
        seenDe.add(n)
        docEntries.push(n)
      }
    }
    if (
      docEntries.length &&
      (!rrr1Fetch || !rrr1Fetch.ok || !rrr1Fetch.rows?.length)
    ) {
      rrr1Fetch = await fetchRrr1LinesForDocEntries(docEntries)
    }
    if (rrr1Fetch?.ok && rrr1Fetch.rows?.length) {
      requestBody = mergeRrr1BatchIntoCbp006Body(requestBody, rrr1Fetch.rows)
    }
  }

  const header = requestBody?.reqList?.[0]
  const prod = header?.prodList?.[0]
  const placeholder = (v) =>
    typeof v === 'string' && v.trim().toLowerCase() === 'string'
  const missing = []
  if (!header || !header.erpReqNo || placeholder(header.erpReqNo)) {
    missing.push('erpReqNo(반품요청 ORRR DocEntry)')
  }
  if (!prod || !prod.ifProdId || placeholder(prod.ifProdId)) {
    missing.push('ifProdId(품목번호)')
  }
  if (!prod || !prod.towh || placeholder(prod.towh)) {
    missing.push('towh(입고창고)')
  }
  if (!(Number(prod?.exQty) > 0)) missing.push('exQty(수량)')
  const expYmd = String(prod?.expYmd ?? '').replace(/\D/g, '')
  if (expYmd.length !== 8) missing.push('expYmd(YYYYMMDD)')
  if (!prod || !String(prod.erpBatchNo ?? '').trim() || placeholder(prod.erpBatchNo)) {
    missing.push('erpBatchNo(배치번호)')
  }
  const lineNoVal = prod?.erpLineNo
  const hasLineValue =
    lineNoVal !== undefined &&
    lineNoVal !== null &&
    !(typeof lineNoVal === 'string' && placeholder(lineNoVal)) &&
    Number.isFinite(Number(lineNoVal))
  if (!hasLineValue) missing.push('erpLineNo(원천 라인번호)')

  if (missing.length) {
    return {
      proposal,
      requestBody,
      posted: false,
      demo: false,
      docNo: null,
      error:
        '필수값 부족: ' +
        missing.join(', ') +
        '. `KAI_SBO_SQL_*` 설정 시 질문에 ORRR DocEntry를 넣으면 RRR1로 보강됩니다.',
      usedUrl: cbp006Url,
      viaDi: false,
      validationFailed: true,
      rrr1: rrr1Fetch,
      batchResolve: [],
    }
  }

  let requestBodyForPost = requestBody
  let batchResolve = []
  if (isSboSqlConfigured()) {
    const br = await resolveCbp006RequestBodyBatches(requestBody)
    if (br?.body) requestBodyForPost = br.body
    batchResolve = br?.resolved || []
  }

  if (
    process.env.SAP_CBP006_MOCK === 'true' ||
    process.env.SAP_RETURN_PROCESS_MOCK === 'true'
  ) {
    return {
      proposal,
      requestBody: requestBodyForPost,
      posted: true,
      demo: true,
      docNo: `DEMO-RT-${Date.now().toString(36).toUpperCase().slice(-8)}`,
      error: null,
      usedUrl: cbp006Url,
      viaDi: false,
      rrr1: rrr1Fetch,
      batchResolve,
    }
  }

  const r = await postReturnProcessing(
    cbp006Url,
    process.env.SAP_USER,
    process.env.SAP_PASSWORD,
    requestBodyForPost
  )
  return {
    proposal,
    requestBody: requestBodyForPost,
    posted: r.ok,
    demo: false,
    docNo: r.docNo,
    status: r.status ?? 0,
    resultMessage: r.resultMessage || null,
    error: r.ok ? null : r.body,
    attempts: r.attempts || null,
    usedUrl: r.usedUrl,
    viaDi: false,
    rrr1: rrr1Fetch,
    batchResolve,
  }
}

function isJournalIntent(q) {
  if (!q || q.length < 6) return false
  if (/매뉴얼|문서\s*형식|설명만|절차\s*알려|가이드|어떻게\s*해/.test(q)) return false
  const has = /분개|전표|회계\s*전표|전기/.test(q)
  const act = /만들|생성|작성|해줘|해 주|줘|전기해|넣어|만들어/.test(q)
  return has && act
}

async function runInboundPendingDocumentsQuery(question) {
  const { url, fromFallback, weekAgo, today } = buildInboundPendingOdataUrl()
  const parts = []

  let sqlMeta = null
  if (isSboSqlConfigured()) {
    sqlMeta = await fetchOpdnSql(question)
    if (sqlMeta.ok) {
      parts.push(
        `[SAP B1 SQL ${sqlMeta.table}]\n` +
          `조건: DocDate >= ${sqlMeta.fromDateISO} (최대 ${sqlMeta.rowCount}행)\n` +
          sqlMeta.text
      )
    } else {
      parts.push(`[SAP B1 SQL 오류]\n${sqlMeta.error}`)
    }
  }

  const useOdata =
    Boolean(url) &&
    (!isSboSqlConfigured() ||
      !sqlMeta?.ok ||
      process.env.KAI_SBO_SQL_AND_ODATA === 'true')

  if (useOdata) {
    const sap = await fetchSapOdataUrl(
      url,
      process.env.SAP_USER,
      process.env.SAP_PASSWORD,
      null
    )
    const prefix = fromFallback
      ? `(참고: SAP_ODATA_INBOUND_PENDING_URL 이 없어 SAP_ODATA_URL 을 사용했습니다. 날짜 치환: ${weekAgo} ~ ${today})\n`
      : `(날짜 치환: ${weekAgo} ~ ${today})\n`
    if (sap.ok) {
      parts.push('[SAP OData: 미처리·입고 문서 조회]\n' + prefix + sap.text)
    } else {
      parts.push(
        '[SAP OData 조회 실패: ' +
          sap.error +
          ']\n' +
          prefix +
          '(요청 URL 앞부분: ' +
          url.slice(0, 400) +
          (url.length > 400 ? '…' : '') +
          ')\n'
      )
    }
  }

  if (parts.length === 0) {
    parts.push(
      '[SAP 미연계]\n' +
        '입고(OPDN)을 DB에서 보려면 `server/.env`에 `KAI_SBO_SQL_CONNECTION_STRING` 또는 `KAI_SBO_SQL_SERVER`+`KAI_SBO_SQL_USER`+`KAI_SBO_SQL_PASSWORD`+`KAI_SBO_SQL_DATABASE`(기본 SBO_MACRO)를 설정하세요. ' +
        'OData만 쓸 경우 `SAP_ODATA_INBOUND_PENDING_URL` 또는 `SAP_ODATA_URL`을 설정하세요. ' +
        '질문에 `2026-03-01`처럼 날짜가 있으면 `DocDate >= 해당일` 기준으로 조회합니다(없으면 최근 7일).'
    )
  }

  // SQL 결과가 있으면 LLM 해석 단계를 거치지 않고 그대로 반환 (자료 없음 오판 방지)
  if (sqlMeta?.ok) {
    const answer =
      '### 미처리 입고 문서 조회 결과 (SQL)\n\n' +
      `- 기준 테이블: \`${sqlMeta.table}\`\n` +
      `- 기준 조건: \`DocDate >= ${sqlMeta.fromDateISO}\`\n` +
      `- 조회 건수: **${sqlMeta.rowCount}건**\n\n` +
      '```json\n' +
      (sqlMeta.text || '[]') +
      '\n```'
    return {
      answer,
      usedUrl: url,
      fromFallback,
      weekAgo,
      today,
      sql: {
        ok: sqlMeta.ok,
        table: sqlMeta.table,
        fromDateISO: sqlMeta.fromDateISO,
        rowCount: sqlMeta.rowCount,
        error: sqlMeta.error || null,
      },
    }
  }

  const answer =
    '### 미처리 입고 문서 조회 결과\n\n' +
    parts.map((p) => `\`\`\`\n${p}\n\`\`\``).join('\n\n')
  return {
    answer,
    usedUrl: url,
    fromFallback,
    weekAgo,
    today,
    sql: sqlMeta
      ? {
          ok: sqlMeta.ok,
          table: sqlMeta.table,
          fromDateISO: sqlMeta.fromDateISO,
          rowCount: sqlMeta.rowCount,
          error: sqlMeta.error || null,
        }
      : null,
  }
}

async function runJournalPipeline(instruction) {
  const proposal = await generateJournalProposal(instruction, apiKey)
  if (sapJournalMock) {
    return {
      proposal,
      posted: true,
      demo: true,
      belnr: `DEMO-${Date.now().toString(36).toUpperCase().slice(-8)}`,
      sapError: null,
      viaDi: false,
    }
  }
  if (!journalViaDiOrSap) {
    return {
      proposal,
      posted: false,
      demo: false,
      belnr: null,
      sapError: null,
      viaDi: false,
    }
  }
  const r = await postJournalToSap(
    sapJournalPostUrl,
    process.env.SAP_USER,
    process.env.SAP_PASSWORD,
    proposal
  )
  return {
    proposal,
    posted: r.ok,
    demo: false,
    belnr: r.belnr,
    sapError: r.ok ? null : r.body,
    viaDi: diConfigured(),
  }
}

/**
 * 반품마감 취소 CBP007: 질문에 OWTR(70164)와 WMS용 번호(70194)가 함께 있으면
 * DocEntry가 둘 다 잡혀 `70164|70194` 복합 erpReq 키로 호출되는 문제를 막음.
 * — `erpReqExtra`에 들어간 숫자는 OWTR 행에서 제외하고, 남은 게 여러 개면 질문에 먼저 나온 번호 한 건만 사용(본문에 docEntries 2개 이상이면 생략).
 */
function narrowOwtrDocEntriesForReturnCloseCbp007(
  owtrOnlyEntries,
  question,
  cbpOpts,
  req,
  hintNumsFromQuestion = null
) {
  let entries = Array.isArray(owtrOnlyEntries)
    ? owtrOnlyEntries
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
    : []
  if (entries.length <= 1) return entries

  const explicitMultiBody =
    Array.isArray(req.body?.docEntries) && req.body.docEntries.length > 1

  const erpList = []
  if (cbpOpts?.erpReqExtra != null) {
    const raw = Array.isArray(cbpOpts.erpReqExtra)
      ? cbpOpts.erpReqExtra
      : [cbpOpts.erpReqExtra]
    for (const x of raw) {
      const n = Number(x)
      if (Number.isFinite(n) && n > 0) erpList.push(n)
    }
  }
  if (Array.isArray(hintNumsFromQuestion)) {
    for (const n of hintNumsFromQuestion) {
      if (Number.isFinite(n) && n > 0) erpList.push(n)
    }
  }
  if (!explicitMultiBody && entries.length > 1 && erpList.length) {
    const drop = new Set(erpList)
    const next = entries.filter((de) => !drop.has(de))
    if (next.length === 1) entries = next
    else if (next.length === 0) entries = [entries[0]]
  }

  const allowMulti =
    String(process.env.KAI_SBO_RETURN_CLOSE_CBP007_MULTI_OWTR || '')
      .trim()
      .toLowerCase() === 'true'
  if (!allowMulti && !explicitMultiBody && entries.length > 1) {
    const ordered = extractDocEntriesFromQuestion(String(question || ''))
    const hit = ordered.find((n) => entries.includes(n))
    if (hit != null) entries = [hit]
    else entries = [entries[0]]
  }
  return entries
}

app.post('/api/query', async (req, res) => {
  try {
    const question = (req.body?.question ?? '').trim()
    if (!question) {
      return res.status(400).json({ error: 'question required' })
    }

    if (isOutboundScheduleCancelIntent(question)) {
      if (!isSboSqlConfigured()) {
        return res.json({
          answer:
            '### 출하 예정 취소\n\n`server/.env`에 SQL 연결(`KAI_SBO_SQL_*`)과 `KAI_SBO_SQL_ALLOW_UPDATE=true`를 설정한 뒤 다시 시도하세요.',
          outboundScheduleCancel: { ok: false, error: 'SQL 미설정' },
        })
      }
      const fromBody = Array.isArray(req.body?.docEntries)
        ? req.body.docEntries
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        : []
      const seen = new Set()
      const docEntries = []
      for (const n of [...extractDocEntriesFromQuestion(question), ...fromBody]) {
        if (!seen.has(n)) {
          seen.add(n)
          docEntries.push(n)
        }
      }
      let pickingAbsEntry = extractPickingAbsEntryFromQuestion(question)
      if (pickingAbsEntry == null && req.body?.pickingAbsEntry != null) {
        const a = Number(req.body.pickingAbsEntry)
        if (Number.isFinite(a) && a > 0) pickingAbsEntry = a
      }
      if (pickingAbsEntry == null && req.body?.erpPickingNo != null) {
        const a = Number(req.body.erpPickingNo)
        if (Number.isFinite(a) && a > 0) pickingAbsEntry = a
      }
      const fromTyp = String(req.body?.erpReqTypCd || '').trim().toUpperCase()
      let preferRole
      if (fromTyp === 'OWTQ' || fromTyp === '1250000001') preferRole = 'OWTQ'
      else if (fromTyp === 'ORDR' || fromTyp === '17') preferRole = 'ORDR'
      else preferRole = inferOutboundScheduleDocRole(question) || undefined
      const sch = await cancelOutboundScheduleByDocEntries(docEntries, {
        pickingAbsEntry,
        preferRole,
      })
      const odlNote =
        '\n\n> **납품(ODLN) 취소:** 이 API는 **출하 예정**만 처리합니다(PKL1·`U_WMSNY` 등). **납품 문서 전기·역분개는 포함하지 않습니다.** 납품을 없애려면 WMS **CVA003**(출하처리 취소) 또는 SAP B1에서 납품 취소를 별도 진행하세요.\n'
      const odlDiag =
        Array.isArray(sch.ordrLinkedDeliveries) &&
        sch.ordrLinkedDeliveries.length
          ? '\n\n### 판매오더에 연결된 납품(ODLN) 조회\n\n' +
            '아래 납품이 있으면 **예정 취소만으로 납품이 사라지지 않는 것이 정상**입니다.\n\n```json\n' +
            JSON.stringify(sch.ordrLinkedDeliveries, null, 2) +
            '\n```\n'
          : ''
      const answer = sch.ok
        ? '### 출하 예정 취소 (ORDR / OWTQ)\n\n' +
          '- 규칙: **ORDR** — PKL1 해당 라인 삭제 후 `U_WMSNY`→`' +
          (process.env.KAI_SBO_ORDR_LINK_VALUE_N || 'N') +
          '` · **재고이전요청(OWTQ)** — 문서 **마감**(`DocStatus=C`), `U_WMSNY`→`' +
          (process.env.KAI_SBO_OUTBOUND_OWTQ_LINK_VALUE ||
            process.env.KAI_SBO_OPOR_LINK_VALUE_C ||
            'C') +
          '`\n' +
          `- 처리 DocEntry: \`${(sch.entries || []).join(', ') || '(없음)'}\`${Array.isArray(sch.inputDocKeys) && sch.inputDocKeys.join(',') !== (sch.entries || []).join(',') ? ` (입력 번호: \`${sch.inputDocKeys.join(', ')}\`)` : ''}${sch.docNumResolved?.length ? ` · DocNum→DocEntry: ${JSON.stringify(sch.docNumResolved)}` : ''}${sch.pickingAbsEntry != null ? ` · 피킹 AbsEntry: \`${sch.pickingAbsEntry}\`` : ''}${sch.preferRole ? ` · 문서유형 힌트: \`${sch.preferRole}\`` : ''}\n\n` +
          '```json\n' +
          JSON.stringify(sch.results || sch, null, 2) +
          '\n```' +
          odlNote +
          odlDiag
        : '### 출하 예정 취소 실패\n\n' + String(sch.error || sch)
      return res.json({
        answer,
        outboundScheduleCancel: sch,
      })
    }

    /** 납품(ODLN) 취소 — WMS CVA003 (출하 예정 취소 SQL과 별도) */
    if (
      isCva003DeliveryCancelIntent(question) ||
      req.body?.cva003DeliveryCancel === true
    ) {
      if (!cva003Url) {
        return res.json({
          answer:
            '### 납품(ODLN) 취소 (CVA003)\n\n`SAP_CVA003_URL`을 `server/.env`에 설정하세요. (예: `https://호스트/CVA003`) · Basic `SAP_USER` / `SAP_PASSWORD`\n',
          cva003DeliveryCancel: { ok: false, error: 'SAP_CVA003_URL 미설정' },
        })
      }
      const fromBody = Array.isArray(req.body?.docEntries)
        ? req.body.docEntries
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        : []
      const seen = new Set()
      const docEntries = []
      for (const n of [...extractDocEntriesFromQuestion(question), ...fromBody]) {
        if (!seen.has(n)) {
          seen.add(n)
          docEntries.push(n)
        }
      }
      if (!docEntries.length) {
        return res.json({
          answer:
            '### 납품(ODLN) 취소 (CVA003)\n\n판매오더 **DocEntry** 또는 **문서번호**를 넣어 주세요. 예: `납품 취소 DocEntry 1651807`\n',
          cva003DeliveryCancel: { ok: false, error: 'docEntries 없음' },
        })
      }
      const de = docEntries[0]
      let wmsReqNo = String(
        req.body?.wmsReqNo ?? req.body?.WmsReqNo ?? ''
      ).trim()
      let procBundleNo = String(
        req.body?.procBundleNo ?? req.body?.ProcBundleNo ?? ''
      ).trim()
      let udf = { ok: false }
      if (!wmsReqNo || !procBundleNo) {
        if (!isSboSqlConfigured()) {
          return res.json({
            answer:
              '### 납품(ODLN) 취소 (CVA003)\n\n`wmsReqNo`·`procBundleNo`(납품 `U_WMSDOCNUM`·`U_WMSNUM`)가 없으면 SQL(`KAI_SBO_SQL_*`)로 ODLN을 조회해야 합니다. 본문에 두 값을 넣거나 SQL을 설정하세요.\n',
            cva003DeliveryCancel: {
              ok: false,
              error: 'wmsReqNo/procBundleNo 없음·SQL 미설정',
            },
          })
        }
        udf = await fetchOdlNUdfForOrdrCancel(de)
        if (udf.ok) {
          wmsReqNo = udf.wmsReqNo
          procBundleNo = udf.procBundleNo
        }
      } else if (isSboSqlConfigured()) {
        udf = await fetchOdlNUdfForOrdrCancel(de)
      }
      if (!wmsReqNo || !procBundleNo) {
        const diag =
          Array.isArray(udf.linkedDeliveries) && udf.linkedDeliveries.length
            ? '\n\n### SQL 진단 (판매오더 연결 납품)\n\n```json\n' +
              JSON.stringify(udf.linkedDeliveries, null, 2) +
              '\n```\n\n' +
              '`U_WMSDOCNUM`·`U_WMSNUM`이 비어 있으면 WMS 화면의 출하번호·묶음번호를 확인해 `wmsReqNo`·`procBundleNo`로 **직접** 넣거나, B1 헤더에 UDF를 채운 뒤 다시 시도하세요.\n'
            : ''
        return res.json({
          answer:
            '### 납품(ODLN) 취소 실패\n\n' +
            String(udf.error || 'U_WMSDOCNUM/U_WMSNUM 없음') +
            '\n\nCVA003은 납품을 **U_WMSDOCNUM + U_WMSNUM** 으로만 찾습니다. 값이 없으면 API 본문에 수동 입력이 필요합니다.' +
            diag,
          cva003DeliveryCancel: { ok: false, udf },
        })
      }
      const ordrNo = String(udf.ordrDocEntry ?? de)
      const draft = buildCva003OrdrDeliveryCancelDraft({
        erpReqNo: ordrNo,
        wmsReqNo,
        procBundleNo,
        procYmd: req.body?.procYmd,
        procHms: req.body?.procHms,
        ifKey: req.body?.ifKey,
        outbizTypeCd: req.body?.outbizTypeCd,
        centerSeq: req.body?.centerSeq,
        erpPickingNo: req.body?.erpPickingNo,
        procUserId: req.body?.procUserId,
      })
      const cv = await postCva003(
        cva003Url,
        process.env.SAP_USER,
        process.env.SAP_PASSWORD,
        draft
      )
      const listJson =
        Array.isArray(cv.resultList) && cv.resultList.length
          ? JSON.stringify(cv.resultList, null, 2)
          : String(cv.body || '').slice(0, 2500)
      const answer = cv.ok
        ? '### 납품(ODLN) 취소 (CVA003)\n\n' +
          `- 전송: \`POST ${cv.usedUrl || cva003Url}\`\n` +
          (udf.ok && udf.odlDocEntry
            ? `- 조회된 납품 DocEntry: \`${udf.odlDocEntry}\`\n`
            : '') +
          '\n```json\n' +
          listJson +
          '\n```\n'
        : '### 납품(ODLN) 취소 실패\n\n' +
          `- 시도한 전송: \`POST ${cv.usedUrl || cva003Url}\`\n\n` +
          String(cv.body || '')
      return res.json({
        answer,
        cva003DeliveryCancel: {
          ok: cv.ok,
          posted: cv.ok,
          usedUrl: cv.usedUrl,
          udf:
            udf && (udf.ok || udf.ordrDocEntry != null) ? udf : undefined,
          requestBody: cv.requestBody,
          error: cv.ok ? null : String(cv.body || ''),
        },
      })
    }

    /** 출하처리(CVA002): `재고이전`·입고·반품 등보다 먼저 판별 (질문에 `출하처리` 포함 시 우선) */
    if (cva002Url) {
      try {
        let cvaParsed = tryParseCva002RequestFromInstruction(question)
        let rdr1Fetch = null
        let wtq1Fetch = null
        if (!cvaParsed) {
          const ordrHint = parseOrdrOutboundCva002Instruction(question)
          if (ordrHint) {
            let draft = buildCva002OrdrDraft(ordrHint)
            const owtqFlow =
              String(ordrHint.erpReqTypCd || '').toUpperCase() === 'OWTQ'
            if (isSboSqlConfigured()) {
              if (owtqFlow) {
                wtq1Fetch = await fetchWtq1LinesForOwtqDocEntries([
                  Number(ordrHint.erpReqNo),
                ])
                if (wtq1Fetch?.ok && wtq1Fetch.rows?.length) {
                  const h = draft.reqList[0]
                  const canon = Number(
                    wtq1Fetch.resolvedOwtqDocEntry ??
                      wtq1Fetch.rows[0]?.DocEntry ??
                      wtq1Fetch.rows[0]?.docentry
                  )
                  if (Number.isFinite(canon) && canon > 0) {
                    const orig = String(h.erpReqNo || '').trim()
                    h.erpReqNo = String(canon)
                    if (
                      wtq1Fetch.docNumResolved &&
                      orig &&
                      orig !== String(canon)
                    ) {
                      h.wmsReqNo = orig
                    } else {
                      h.wmsReqNo = String(canon)
                    }
                    const procYmd = String(h.procYmd || h.ProcYmd || '').trim()
                    if (procYmd) h.ifKey = `KAI-OWTQ-${canon}-${procYmd}`
                  }
                  draft = mergeWtq1RowsIntoCva002Draft(draft, wtq1Fetch.rows)
                }
              } else {
                rdr1Fetch = await fetchRdr1LinesForOrdrDocEntries([
                  Number(ordrHint.erpReqNo),
                ])
                if (rdr1Fetch?.ok && rdr1Fetch.rows?.length) {
                  const h = draft.reqList[0]
                  const canon = Number(
                    rdr1Fetch.resolvedOrdrDocEntry ??
                      rdr1Fetch.rows[0]?.DocEntry ??
                      rdr1Fetch.rows[0]?.docentry
                  )
                  if (Number.isFinite(canon) && canon > 0) {
                    const orig = String(h.erpReqNo || '').trim()
                    h.erpReqNo = String(canon)
                    if (
                      rdr1Fetch.docNumResolved &&
                      orig &&
                      orig !== String(canon)
                    ) {
                      h.wmsReqNo = orig
                    } else {
                      h.wmsReqNo = String(canon)
                    }
                    const procYmd = String(h.procYmd || h.ProcYmd || '').trim()
                    if (procYmd) h.ifKey = `KAI-ORDR-${canon}-${procYmd}`
                  }
                  draft = mergeRdr1RowsIntoCva002Draft(draft, rdr1Fetch.rows)
                }
              }
            }
            cvaParsed = draft
          }
        }
        if (cvaParsed && isCva002OutboundPayloadQuestion(question, cvaParsed)) {
          const normalized = await prepareCva002Normalized(cvaParsed)
          if (!cva002ReqHasRunnableProdList(normalized)) {
            const payload = toDotNetCva002Payload(normalized)
            const headTyp = String(
              normalized?.reqList?.[0]?.erpReqTypCd ?? ''
            ).toUpperCase()
            const owtqCva = headTyp === 'OWTQ'
            const hintSql = !isSboSqlConfigured()
              ? owtqCva
                ? '`KAI_SBO_SQL_*` 미설정이라 WTQ1(재고이전요청 라인)을 읽지 못했습니다.'
                : '`KAI_SBO_SQL_*` 미설정이라 RDR1(판매오더 라인)을 읽지 못했습니다.'
              : owtqCva
                ? !wtq1Fetch
                  ? 'WTQ1 조회를 실행하지 않았습니다.'
                  : !wtq1Fetch.ok
                    ? `WTQ1 조회 실패: ${String(wtq1Fetch.error || '').slice(0, 400)}`
                    : !wtq1Fetch.rows?.length
                      ? `WTQ1에 DocEntry \`${(wtq1Fetch.entries || []).join(', ')}\` 해당 행이 없습니다.`
                      : '라인은 있으나 품목·수량으로 채울 수 있는 행이 없습니다.'
                : !rdr1Fetch
                  ? 'RDR1 조회를 실행하지 않았습니다.'
                  : !rdr1Fetch.ok
                    ? `RDR1 조회 실패: ${String(rdr1Fetch.error || '').slice(0, 400)}`
                    : !rdr1Fetch.rows?.length
                      ? `RDR1에 DocEntry \`${(rdr1Fetch.entries || []).join(', ')}\` 해당 행이 없습니다.`
                      : '라인은 있으나 품목·미출고 수량(OpenQty/Quantity)으로 채울 수 있는 행이 없습니다.'
            const guideOrd =
              '판매오더(ORDR) 출하는 **RDR1**에서 품목·`OpenQty` 등을 읽어 `prodList`를 채운 뒤 전송합니다. '
            const guideOwtq =
              '출하유형 **O-900·OB91 등(기타출하)** 는 **재고이전요청(OWTQ)** 기준이며 **WTQ1**에서 라인을 읽습니다(납품 ORDR·RDR1 아님). '
            const answer =
              '### 출하처리 (CVA002) — **라인·수량 자료 없음**\n\n' +
              (owtqCva ? guideOwtq : guideOrd) +
              '아래는 초안이며 **실제 전송 전** Swagger에 맞게 `prodList`·배치·피킹 등을 보완하세요.\n\n' +
              `**원인:** ${hintSql}\n\n` +
              '```json\n' +
              JSON.stringify(payload, null, 2) +
              '\n```\n\n' +
              (owtqCva
                ? '> `KAI_SBO_WTQ1_TABLE`·`KAI_SBO_OWTQ_TABLE` 지정. **문서번호(DocNum)** 는 OWTQ에서 **DocEntry** 로 자동 매핑(끄기: `KAI_SBO_WTQ1_RESOLVE_DOCNUM=false`).\n' +
                  '> 질문에 **판매오더** 번호만 넣으면 그 숫자는 **ORDR** 기준일 수 있습니다. ZSM108 **O-***·기타출하는 **재고이전요청(OWTQ)** 의 DocEntry/문서번호를 넣어야 합니다(납품이면 출하유형 OB03 등·ORDR 경로).\n'
                : '> `KAI_SBO_RDR1_TABLE`·`KAI_SBO_ORDR_TABLE` 로 회사 DB 테이블을 지정할 수 있습니다. 번호가 **문서번호(DocNum)** 이면 ORDR에서 **DocEntry** 로 자동 매핑합니다(끄기: `KAI_SBO_RDR1_RESOLVE_DOCNUM=false`).\n') +
              '> `자료없음`만 적힌 질문은 무시됩니다.\n'
            return res.json({
              answer,
              cva002Outbound: {
                skippedNoLines: true,
                requestBody: payload,
                rdr1: rdr1Fetch,
                wtq1: wtq1Fetch,
              },
            })
          }
          const cv = await executeCva002Post(normalized)
          let answer =
            '### 출하처리 (CVA002)\n\n' +
            'ORDR→ODLN · OWTQ+Etc빈값→OWTR · OWTQ+EtcOutbizTypeCd→OIGE 등 **WMS CVA002** 본문.\n\n```json\n' +
            JSON.stringify(cv.requestBody || {}, null, 2) +
            '\n```\n\n' +
            `**전송:** \`POST ${cv.usedUrl || cva002Url}\` · Basic \`SAP_USER\`/\`SAP_PASSWORD\`\n`
          if (rdr1Fetch?.ok && rdr1Fetch.rows?.length) {
            answer +=
              `- **RDR1:** 테이블 \`${rdr1Fetch.table}\` · 라인 **${rdr1Fetch.rows.length}**건 반영` +
              (rdr1Fetch.docNumResolved
                ? ` · 판매오더 **문서번호(DocNum)→DocEntry** 매핑 · \`ErpReqNo\`=\`${rdr1Fetch.resolvedOrdrDocEntry ?? ''}\`\n`
                : '\n')
          }
          if (wtq1Fetch?.ok && wtq1Fetch.rows?.length) {
            answer +=
              `- **WTQ1:** 테이블 \`${wtq1Fetch.table}\` · 라인 **${wtq1Fetch.rows.length}**건 반영` +
              (wtq1Fetch.docNumResolved
                ? ` · OWTQ **문서번호(DocNum)→DocEntry** 매핑 · \`ErpReqNo\`=\`${wtq1Fetch.resolvedOwtqDocEntry ?? ''}\`\n`
                : '\n')
          }
          const cvaH = normalized?.reqList?.[0]
          const outbizU = String(
            cvaH?.outbizTypeCd ?? cvaH?.OutbizTypeCd ?? ''
          )
            .trim()
            .toUpperCase()
          if (
            cvaH &&
            String(cvaH.erpReqTypCd ?? cvaH.ErpReqTypCd ?? '')
              .toUpperCase() === 'OWTQ' &&
            isEtcOutbizOwtqCode(outbizU)
          ) {
            answer +=
              '> **기타출하(ZSM108 `O-`·레거시 `OB91` 등):** `EtcOutbizTypeCd`가 비어 있으면 KAI가 `OutbizTypeCd`를 복사해 **OIGE** 분기로 보냅니다(`CVA002` 서버 코드는 수정하지 않음).\n'
          }
          if (cv.posted) {
            answer += cv.demo
              ? `**시뮬** \`SAP_CVA002_MOCK\` — \`${cv.docNo}\`\n`
              : `**CVA002 응답** — \`${cv.docNo || '본문 확인'}\`${cv.usedUrl ? ` (\`${cv.usedUrl}\`)` : ''}\n`
          } else {
            let oigeDiag = ''
            const errStr = String(cv.error || '')
            if (
              isSboSqlConfigured() &&
              /invalid\s*attempt\s*to\s*read\s*when\s*no\s*data\s*is\s*present/i.test(
                errStr
              )
            ) {
              const h = normalized?.reqList?.[0]
              const typ = String(
                h?.erpReqTypCd ?? h?.ErpReqTypCd ?? ''
              ).toUpperCase()
              const etc = String(
                h?.etcOutbizTypeCd ?? h?.EtcOutbizTypeCd ?? ''
              ).trim()
              const ob = String(
                h?.outbizTypeCd ?? h?.OutbizTypeCd ?? ''
              ).trim()
              const etcCode = etc || ob
              if (typ === 'OWTQ' && isEtcOutbizOwtqCode(etcCode)) {
                const pl = h?.prodList || h?.ProdList || []
                const item = String(
                  pl[0]?.ifProdId ?? pl[0]?.IfProdId ?? ''
                ).trim()
                const de = Number(h?.erpReqNo ?? h?.ErpReqNo)
                try {
                  const diag = await diagnoseCva002OigeReadiness({
                    docEntry: de,
                    etcOutbizTypeCd: etcCode,
                    itemCode: item,
                  })
                  if (diag.hints?.length) {
                    oigeDiag =
                      '\n> **KAI SQL 진단(기타출고 OIGE 경로):** WMS CVA002는 **OWTQ Comments**·**ZSM108 계정** 등 SQL 결과 행이 없으면 위 오류가 납니다. WTQ1에 라인이 있어도 **DB·연결·마스터**가 다르면 0행입니다.\n' +
                      diag.hints
                        .map((t) => '> - ' + String(t).replace(/\n/g, ' '))
                        .join('\n') +
                      '\n'
                  }
                } catch (_diagErr) {
                  // 진단 생략
                }
              }
            }
            answer +=
              `**전송 실패:** ${String(cv.error || '').slice(0, 1200)}\n` +
              oigeDiag +
              '> 로컬 HTTPS: `SAP_CVA002_TLS_INSECURE=true` · 주소는 Swagger와 동일하게 `SAP_CVA002_URL`.\n'
          }
          return res.json({
            answer,
            cva002Outbound: cv,
            rdr1: rdr1Fetch || undefined,
            wtq1: wtq1Fetch || undefined,
          })
        }
      } catch (ce) {
        console.warn('[CVA002 출하 실패, 일반 질의로]', ce)
      }
    }

    if (isInboundScheduleCancelIntent(question)) {
      if (!isSboSqlConfigured()) {
        return res.json({
          answer:
            '### 입고 예정 취소\n\n`server/.env`에 SQL 연결(`KAI_SBO_SQL_*`)을 설정한 뒤 다시 시도하세요.',
          inboundScheduleCancel: { ok: false, error: 'SQL 미설정' },
        })
      }
      const docEntries = extractDocEntriesFromQuestion(question)
      const sch = await cancelInboundScheduleByDocEntries(docEntries)
      const answer = sch.ok
        ? '### 입고 예정 취소 (OPOR/OPDN/ORRR/OWTQ)\n\n' +
          `- 규칙: **OPOR** 연동 \`${process.env.KAI_SBO_OPOR_LINK_VALUE_C || 'C'}\` + 닫기, **OPDN** \`U_WMSNY\` \`${process.env.KAI_SBO_OPDN_LINK_VALUE_N || 'N'}\`, **ORRR·OWTQ** \`U_WMSNY\` \`${process.env.KAI_SBO_OPOR_LINK_VALUE_C || 'C'}\` + \`DocStatus=C\`\n` +
          `- 처리 DocEntry: \`${(sch.entries || []).join(', ') || '(없음)'}\`\n\n` +
          '```json\n' +
          JSON.stringify(sch.results || sch, null, 2) +
          '\n```'
        : '### 입고 예정 취소 실패\n\n' + String(sch.error || sch)
      return res.json({
        answer,
        inboundScheduleCancel: sch,
      })
    }

    if (isReturnCloseCancelIntent(question)) {
      if (!isSboSqlConfigured()) {
        return res.json({
          answer:
            '### 반품마감 취소\n\n`server/.env`에 SQL 연결(`KAI_SBO_SQL_*`)과 `KAI_SBO_SQL_ALLOW_UPDATE=true`를 설정한 뒤 다시 시도하세요.',
          returnCloseCancel: { ok: false, error: 'SQL 미설정' },
        })
      }
      const fromBody = Array.isArray(req.body?.docEntries)
        ? req.body.docEntries
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        : []
      const seen = new Set()
      const docEntries = []
      for (const n of [
        ...extractDocEntriesForReturnRequestClose(question),
        ...fromBody,
      ]) {
        if (!seen.has(n)) {
          seen.add(n)
          docEntries.push(n)
        }
      }
      const sch = await cancelReturnCloseByDocEntries(docEntries)
      const forceCbp007 =
        req.body?.forceCbp007 === true || /강제|force/i.test(String(question || ''))
      /** false(기본): SQL상 이미 취소여도 WMS 동기화를 위해 CBP007 호출. true면 예전처럼 생략 */
      let skipCbp007WhenAlreadyCanceled
      if (typeof req.body?.skipCbp007WhenOwtrCanceled === 'boolean') {
        skipCbp007WhenAlreadyCanceled = req.body.skipCbp007WhenOwtrCanceled
      } else {
        skipCbp007WhenAlreadyCanceled =
          String(
            process.env.KAI_SBO_CBP007_SKIP_WHEN_OWTR_ALREADY_CANCELED ?? 'false'
          )
            .trim()
            .toLowerCase() === 'true'
      }
      const owtrOnlyEntries = Array.isArray(sch?.results)
        ? sch.results
            .filter((r) => r && r.role === 'OWTR_CANCEL_ONLY' && Number(r.docEntry) > 0)
            .map((r) => Number(r.docEntry))
        : []
      const owtrAlreadyCanceled = Array.isArray(sch?.results)
        ? sch.results
            .filter((r) => r && r.role === 'OWTR_CANCEL_ONLY')
            .every((r) => String(r?.status || '').toUpperCase() === 'ALREADY_CANCELED')
        : false
      if (owtrOnlyEntries.length) {
        if (owtrAlreadyCanceled && !forceCbp007 && skipCbp007WhenAlreadyCanceled) {
          sch.ok = true
          sch.via = 'OWTR_ALREADY_CANCELED'
          sch.results = [
            ...(Array.isArray(sch.results) ? sch.results : []),
            {
              role: 'CBP007_CANCEL',
              ok: true,
              skipped: true,
              reason: 'OWTR 문서가 이미 CANCELED=Y 상태여서 CBP007 호출 생략',
              docEntries: owtrOnlyEntries,
            },
          ]
          const closeOwtqWhenAlready =
            String(
              process.env.KAI_SBO_CLOSE_OWTQ_WHEN_OWTR_ALREADY_CANCELED || 'true'
            )
              .trim()
              .toLowerCase() !== 'false'
          if (closeOwtqWhenAlready) {
            const owtqOnly = await resolveOwtqDocEntriesFromOwtrStrict(owtrOnlyEntries)
            if (owtqOnly.length) {
              const owtqSch = await closeOwtqByDocEntries(owtqOnly)
              sch.owtqClose = owtqSch
              sch.results = [
                ...(Array.isArray(sch.results) ? sch.results : []),
                ...(Array.isArray(owtqSch.results) ? owtqSch.results : []).map((r) => ({
                  ...r,
                  context: 'RETURN_CLOSE_CANCEL',
                })),
              ]
              if (!owtqSch.ok) {
                sch.ok = false
                sch.error =
                  (sch.error ? String(sch.error) + ' ' : '') +
                  '연계 재고이전요청(OWTQ) 마감 중 오류가 있었습니다.'
              } else {
                sch.via = 'OWTR_ALREADY_CANCELED_OWTQ_CLOSED'
              }
            }
          }
        } else {
        const cbpOpts = { auxiliaryText: String(question || '') }
        if (req.body?.erpReqExtra != null) cbpOpts.erpReqExtra = req.body.erpReqExtra
        else if (req.body?.erpReqExtras != null) cbpOpts.erpReqExtra = req.body.erpReqExtras
        if (req.body?.erpReqByOwtrEntry != null) {
          cbpOpts.erpReqByOwtrEntry = req.body.erpReqByOwtrEntry
        }
        const fromQ = extractCbp007ErpReqHintsFromText(question, owtrOnlyEntries)
        /** 질문 힌트는 auxiliaryText→SQL resolver에만 넣고, erpReqExtra prepend는 하지 않음(70194가 OWTR 70164보다 먼저 시도되는 문제 방지) */
        const cbpOwtrTargets = narrowOwtrDocEntriesForReturnCloseCbp007(
          owtrOnlyEntries,
          question,
          cbpOpts,
          req,
          fromQ || undefined
        )
        const cbp = await postStockTransferCancelCbp007(
          cbp007Url,
          process.env.SAP_USER,
          process.env.SAP_PASSWORD,
          cbpOwtrTargets,
          cbpOpts
        )
        if (cbp.ok) {
          sch.ok = true
          sch.via = 'CBP007_FROM_RETURN_CANCEL'
          sch.cbp007 = {
            ok: true,
            usedUrl: cbp.usedUrl,
            requestBody: cbp.requestBody,
            responseBody: cbp.body,
            cbp007LookupRows: cbp.cbp007LookupRows,
            cbp007LookupNotes: cbp.cbp007LookupNotes,
            cbp007PrependedStrategies: cbp.cbp007PrependedStrategies,
          }
          sch.results = [
            ...(Array.isArray(sch.results) ? sch.results : []),
            {
              role: 'CBP007_CANCEL',
              ok: true,
              owtrDocEntries: cbp.owtrDocEntries,
              erpReqStrategy: cbp.erpReqStrategy,
              usedUrl: cbp.usedUrl,
              cbp007LookupRows: cbp.cbp007LookupRows,
              cbp007LookupNotes: cbp.cbp007LookupNotes,
            },
          ]
          const closeOwtqAfterCbpWhenNotSkipped =
            owtrAlreadyCanceled &&
            !skipCbp007WhenAlreadyCanceled &&
            String(
              process.env.KAI_SBO_CLOSE_OWTQ_WHEN_OWTR_ALREADY_CANCELED || 'true'
            )
              .trim()
              .toLowerCase() !== 'false'
          if (closeOwtqAfterCbpWhenNotSkipped) {
            const owtqOnly = await resolveOwtqDocEntriesFromOwtrStrict(owtrOnlyEntries)
            if (owtqOnly.length) {
              const owtqSch = await closeOwtqByDocEntries(owtqOnly)
              sch.owtqClose = owtqSch
              sch.results = [
                ...(Array.isArray(sch.results) ? sch.results : []),
                ...(Array.isArray(owtqSch.results) ? owtqSch.results : []).map((r) => ({
                  ...r,
                  context: 'RETURN_CLOSE_CANCEL',
                })),
              ]
              if (!owtqSch.ok) {
                sch.ok = false
                sch.error =
                  (sch.error ? String(sch.error) + ' ' : '') +
                  '연계 재고이전요청(OWTQ) 마감 중 오류가 있었습니다.'
              } else {
                sch.via = 'CBP007_FROM_RETURN_CANCEL_OWTQ_CLOSED'
              }
            }
          }
        } else {
          sch.ok = false
          sch.cbp007 = {
            ok: false,
            usedUrl: cbp.usedUrl,
            requestBody: cbp.requestBody,
            error: cbp.body,
            status: cbp.status,
            attempts: cbp.attempts,
            erpReqStrategiesTried: cbp.erpReqStrategiesTried,
            owtrDocEntries: cbp.owtrDocEntries,
            cbp007LookupRows: cbp.cbp007LookupRows,
            cbp007LookupNotes: cbp.cbp007LookupNotes,
            cbp007PrependedStrategies: cbp.cbp007PrependedStrategies,
          }
          sch.results = [
            ...(Array.isArray(sch.results) ? sch.results : []),
            {
              role: 'CBP007_CANCEL',
              ok: false,
              owtrDocEntries: cbp.owtrDocEntries,
              erpReqStrategiesTried: cbp.erpReqStrategiesTried,
              cbp007LookupRows: cbp.cbp007LookupRows,
              cbp007LookupNotes: cbp.cbp007LookupNotes,
              status: cbp.status,
              error: cbp.body,
            },
          ]
          const allowOwtrSqlFallback =
            String(process.env.KAI_SBO_RETURN_CLOSE_SQL_OWTR_FALLBACK ?? 'true')
              .trim()
              .toLowerCase() !== 'false'
          if (allowOwtrSqlFallback && owtrOnlyEntries.length) {
            const sqlFallback = await cancelOwtrByDocEntries(owtrOnlyEntries)
            sch.owtrSqlFallback = sqlFallback
            sch.results = [
              ...(Array.isArray(sch.results) ? sch.results : []),
              ...(Array.isArray(sqlFallback.results) ? sqlFallback.results : []).map((r) => ({
                ...r,
                context: 'RETURN_CLOSE_CANCEL_SQL_FALLBACK',
              })),
            ]
            if (sqlFallback.ok) {
              sch.ok = true
              sch.via = 'RETURN_CLOSE_SQL_OWTR_FALLBACK'
              sch.error = undefined
            } else {
              sch.via = 'CBP007_REQUIRED'
              sch.error =
                'CBP007 정식 취소 실패 후 OWTR SQL fallback도 실패했습니다. SAP 취소 상태로 반영되지 않을 수 있습니다.'
            }
          } else {
            sch.via = 'CBP007_REQUIRED'
            sch.error =
              'CBP007 정식 취소가 실패했습니다. SAP 취소 상태로 반영되지 않을 수 있습니다.'
          }
        }
        }
      }
      /** DocEntry별 마지막 OWTR 스냅샷으로 판정(앞의 OWTR_CANCEL_ONLY는 취소 전 상태라 무시) */
      const cancelRows = Array.isArray(sch?.results)
        ? sch.results.filter((r) => r && (r.role === 'OWTR_CANCEL' || r.role === 'OWTR_CANCEL_ONLY'))
        : []
      const byOwtrDe = new Map()
      for (const r of cancelRows) {
        const de = Number(r.docEntry)
        if (!Number.isFinite(de) || de <= 0) continue
        if (!byOwtrDe.has(de)) byOwtrDe.set(de, [])
        byOwtrDe.get(de).push(r)
      }
      let owtrFullyCanceled = 0
      let owtrNotCanceled = 0
      for (const [, rows] of byOwtrDe) {
        const last = rows[rows.length - 1]
        const statuses = Array.isArray(last?.owtrStatus) ? last.owtrStatus : []
        const everyY =
          statuses.length > 0 &&
          statuses.every((s) => String(s?.CANCELED ?? 'N').trim().toUpperCase() === 'Y')
        if (everyY) owtrFullyCanceled++
        else owtrNotCanceled++
      }
      sch.finalStatus =
        byOwtrDe.size === 0
          ? 'SAP_OWTR_STATUS_UNKNOWN'
          : owtrNotCanceled === 0
            ? 'SAP_OWTR_CANCELED'
            : owtrFullyCanceled > 0
              ? 'SAP_OWTR_PARTIAL'
              : 'SAP_OWTR_NOT_CANCELED'

      const answer = sch.ok
        ? '### 반품마감 취소 (ORRR 기준 롤백)\n\n' +
          '- 규칙: **ORRR** 원천에 연결된 **모든 ORDN·OWTR** SQL 취소 후 ORRR `U_WMSNY`→`N`. 입력이 **OWTR**만이면 CBP007 우선, 실패 시 기본적으로 OWTR SQL fallback(`KAI_SBO_RETURN_CLOSE_SQL_OWTR_FALLBACK=true`). SQL상 OWTR이 이미 취소여도 **기본은 CBP007 호출**(WMS 동기화); 생략: `KAI_SBO_CBP007_SKIP_WHEN_OWTR_ALREADY_CANCELED=true`. 연계 OWTQ SQL 마감: `KAI_SBO_CLOSE_OWTQ_WHEN_OWTR_ALREADY_CANCELED`.\n' +
          `- 처리 경로(via): \`${sch.via || '-'}\`${sch.owtqClose ? ` · OWTQ 마감: ${sch.owtqClose.ok ? 'ok' : '오류'}` : ''}\n` +
          `- 최종 SAP 판정(finalStatus): \`${sch.finalStatus}\`\n` +
          `- 처리 DocEntry: \`${(sch.entries || []).join(', ') || '(없음)'}\`\n\n` +
          '```json\n' +
          JSON.stringify(sch.results || sch, null, 2) +
          '\n```'
        : '### 반품마감 취소 실패\n\n' +
          (sch.error
            ? String(sch.error)
            : '```json\n' + JSON.stringify(sch, null, 2) + '\n```') +
          (sch.cbp007 &&
          Array.isArray(sch.cbp007.erpReqStrategiesTried) &&
          sch.cbp007.erpReqStrategiesTried.length
            ? (() => {
                const s = JSON.stringify(sch.cbp007.erpReqStrategiesTried, null, 2)
                return (
                  '\n\n**실제 시도 키 (`erpReqStrategiesTried`)**\n\n```json\n' +
                  (s.length > 2800 ? s.slice(0, 2800) + '\n…' : s) +
                  '\n```'
                )
              })()
            : '') +
          (sch.cbp007 && sch.cbp007.ok === false && sch.cbp007.error
            ? '\n\n**CBP007 응답 요약**\n\n```\n' +
              String(sch.cbp007.error).slice(0, 3500) +
              '\n```'
            : '') +
          (sch.cbp007 && Array.isArray(sch.cbp007.cbp007LookupRows) && sch.cbp007.cbp007LookupRows.length
            ? (() => {
                const s = JSON.stringify(sch.cbp007.cbp007LookupRows, null, 2)
                return (
                  '\n\n**SQL 조회 요약 (`cbp007LookupRows`)**\n\n```json\n' +
                  (s.length > 2800 ? s.slice(0, 2800) + '\n…' : s) +
                  '\n```'
                )
              })()
            : '') +
          (sch.cbp007 &&
          Array.isArray(sch.cbp007.cbp007LookupNotes) &&
          sch.cbp007.cbp007LookupNotes.length
            ? '\n\n**SQL 조회 안내**\n\n' +
              sch.cbp007.cbp007LookupNotes.map((n) => `- ${n}`).join('\n')
            : '')
      return res.json({
        answer,
        returnCloseCancel: sch,
      })
    }

    if (isStockTransferCancelIntent(question)) {
      if (!isSboSqlConfigured()) {
        return res.json({
          answer:
            '### 재고이전 취소\n\n`server/.env`에 SQL 연결(`KAI_SBO_SQL_*`)과 `KAI_SBO_SQL_ALLOW_UPDATE=true`를 설정한 뒤 다시 시도하세요.',
          stockTransferCancel: { ok: false, error: 'SQL 미설정' },
        })
      }
      const fromBody = Array.isArray(req.body?.docEntries)
        ? req.body.docEntries
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        : []
      const seen = new Set()
      const docEntries = []
      for (const n of [...extractDocEntriesFromQuestion(question), ...fromBody]) {
        if (!seen.has(n)) {
          seen.add(n)
          docEntries.push(n)
        }
      }
      let sch = null
      let usedCbp007 = false
      if (docEntries.length) {
        const cbpOpts = { auxiliaryText: String(question || '') }
        if (req.body?.erpReqExtra != null) cbpOpts.erpReqExtra = req.body.erpReqExtra
        else if (req.body?.erpReqExtras != null) cbpOpts.erpReqExtra = req.body.erpReqExtras
        if (req.body?.erpReqByOwtrEntry != null) {
          cbpOpts.erpReqByOwtrEntry = req.body.erpReqByOwtrEntry
        }
        const cbp = await postStockTransferCancelCbp007(
          cbp007Url,
          process.env.SAP_USER,
          process.env.SAP_PASSWORD,
          docEntries,
          cbpOpts
        )
        if (cbp.ok) {
          usedCbp007 = true
          sch = {
            ok: true,
            entries: docEntries,
            erpReqStrategy: cbp.erpReqStrategy,
            owtrDocEntries: cbp.owtrDocEntries,
            via: 'CBP007',
            usedUrl: cbp.usedUrl,
            requestBody: cbp.requestBody,
            responseBody: cbp.body,
            results: [
              {
                role: 'CBP007_CANCEL',
                ok: true,
                usedUrl: cbp.usedUrl,
              },
            ],
          }
        }
      }
      if (!sch) {
        const sqlFallback = await cancelOwtrByDocEntries(docEntries)
        sch = {
          ...sqlFallback,
          via: 'SQL_FALLBACK',
        }
      }
      const answer = sch.ok
        ? '### 재고이전 취소 (OWTR)\n\n' +
          '- 규칙: **CBP007(DocEntry only)** 우선 호출, 실패 시 SQL fallback\n' +
          `- 처리 방식: \`${sch.via || (usedCbp007 ? 'CBP007' : 'SQL_FALLBACK')}\`\n` +
          `- 처리 DocEntry: \`${(sch.entries || []).join(', ') || '(없음)'}\`\n\n` +
          '```json\n' +
          JSON.stringify(sch.results || sch, null, 2) +
          '\n```'
        : '### 재고이전 취소 실패\n\n' +
          (sch.error
            ? String(sch.error)
            : '```json\n' + JSON.stringify(sch, null, 2) + '\n```') +
          (sch.cbp007 &&
          Array.isArray(sch.cbp007.erpReqStrategiesTried) &&
          sch.cbp007.erpReqStrategiesTried.length
            ? (() => {
                const s = JSON.stringify(sch.cbp007.erpReqStrategiesTried, null, 2)
                return (
                  '\n\n**실제 시도 키 (`erpReqStrategiesTried`)**\n\n```json\n' +
                  (s.length > 2800 ? s.slice(0, 2800) + '\n…' : s) +
                  '\n```'
                )
              })()
            : '')
      return res.json({
        answer,
        stockTransferCancel: sch,
      })
    }

    if (isReturnProcessingIntent(question)) {
      const directCbp006 = tryParseCBP006RequestFromInstruction(question)
      if (!apiConfigured && !directCbp006) {
        return res.json({
          answer:
            '### 반품마감(CBP006)\n\n`OPENAI_API_KEY`가 없으면 **CBP006 요청 JSON**(`reqList`, `erpReqNo`, `prodList`…)을 질문에 그대로 붙여넣으세요.',
          returnProcessing: { ok: false, error: 'OPENAI_API_KEY 필요' },
        })
      }
      try {
        const rt = await runReturnProcessingPipeline(question)
        let answer =
          '### 반품마감 (CBP006 — ORDN 생성 + ORRR Close)\n\n```json\n' +
          JSON.stringify(rt.requestBody || rt.proposal, null, 2) +
          '\n```\n\n'
        const finalBatch =
          rt.requestBody?.reqList?.[0]?.prodList?.[0]?.erpBatchNo ||
          rt.requestBody?.ReqList?.[0]?.ProdList?.[0]?.ErpBatchNo ||
          ''
        if (finalBatch) {
          answer += `- **최종 erpBatchNo:** \`${finalBatch}\`\n`
        }
        if (rt.rrr1?.ok && rt.rrr1?.rows?.length) {
          answer +=
            `- **RRR1:** DocEntry \`${(rt.rrr1.entries || []).join(', ')}\` · \`${rt.rrr1.table}\` · **${rt.rrr1.rows.length}**건 반영` +
            (rt.rrr1.batchEnrich
              ? ` · 배치 보강 \`${rt.rrr1.batchEnrich}\`\n`
              : '\n')
        }
        if (Array.isArray(rt.batchResolve) && rt.batchResolve.length) {
          answer +=
            `- **배치 치환:** ` +
            rt.batchResolve
              .map((x) =>
                `\`${x.from}\` → \`${x.to}\`${x.via ? ` (${x.via})` : ''}`
              )
              .join(', ') +
            '\n'
        }
        answer += `**전송:** \`POST ${rt.usedUrl || cbp006Url}\` · Basic \`manager\`/\`emdc\`\n`
        if (rt.posted) {
          answer += rt.demo
            ? `**시뮬** \`SAP_CBP006_MOCK\` / \`SAP_RETURN_PROCESS_MOCK\` — \`${rt.docNo}\`\n`
            : `**CBP006 응답** — \`${rt.docNo || rt.resultMessage || '본문 확인'}\`\n`
        } else {
          answer += `**전송 실패:** ${String(rt.error || '').slice(0, 1200)}\n`
          if (Number.isFinite(Number(rt.status)) && Number(rt.status) > 0) {
            answer += `- HTTP 상태: \`${rt.status}\`\n`
          }
          if (rt.attempts) {
            answer += '- 시도 로그:\n```text\n' + String(rt.attempts).slice(0, 1200) + '\n```\n'
          }
          if (rt.validationFailed) {
            answer +=
              '\n> `KAI_SBO_SQL_*` 설정 후 질문에 **ORRR DocEntry**를 넣으면 **RRR1**에서 품목·창고·배치를 채울 수 있습니다.\n'
          }
        }
        return res.json({ answer, returnProcessing: rt })
      } catch (re) {
        console.warn('[반품마감 실패]', re)
        return res.json({
          answer:
            '### 반품마감(CBP006) 오류\n\n' + String(re?.message || re),
          returnProcessing: { ok: false, error: String(re?.message || re) },
        })
      }
    }

    if (isReturnRequestCloseIntent(question)) {
      if (!isSboSqlConfigured()) {
        return res.json({
          answer:
            '### 반품요청(ORRR) 마감\n\n`server/.env`에 SQL 연결(`KAI_SBO_SQL_*`)과 `KAI_SBO_SQL_ALLOW_UPDATE=true`를 설정한 뒤 다시 시도하세요.',
          orrrClose: { ok: false, error: 'SQL 미설정' },
        })
      }
      const fromBody = Array.isArray(req.body?.docEntries)
        ? req.body.docEntries
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        : []
      const seen = new Set()
      const docEntries = []
      for (const n of [
        ...extractDocEntriesForReturnRequestClose(question),
        ...fromBody,
      ]) {
        if (!seen.has(n)) {
          seen.add(n)
          docEntries.push(n)
        }
      }
      const sch = await closeOrrrByDocEntries(docEntries)
      const orrrFlowNote =
        '\n\n> **업무 순서(정식 반품마감, 예: CBP006):** **반품문서(ORDN)** 를 DI로 **먼저** 만들고, 그다음 **반품요청(ORRR)** 을 종료합니다. “마감” 한 번에 반품문서가 생기는 것이 아니라, **반품 전표(ORDN)가 생성된 뒤** 요청이 닫히는 흐름입니다.\n' +
        '> **이 KAI 동작:** SQL로 **ORRR** 만 갱신합니다. **ORDN(반품문서)은 생성하지 않습니다.** 반품 전표가 필요하면 같은 서버에서 **반품마감**(CBP006, `SAP_CBP006_URL`) 질의를 쓰세요.\n'
      const answer = sch.ok
        ? '### 반품요청(ORRR) 마감\n\n' +
          `- 규칙: **ORRR** \`U_WMSNY\` \`${process.env.KAI_SBO_OPOR_LINK_VALUE_C || 'C'}\` + \`DocStatus=C\`\n` +
          `- 처리 DocEntry: \`${(sch.entries || []).join(', ') || '(없음)'}\`\n\n` +
          '```json\n' +
          JSON.stringify(sch.results || sch, null, 2) +
          '\n```' +
          orrrFlowNote
        : '### 반품요청(ORRR) 마감 실패\n\n' +
          String(sch.error || '') +
          orrrFlowNote +
          (docEntries.length === 0
            ? '\n\n> **DocEntry 필요:** SAP B1 **반품요청(ORRR)** 의 **DocEntry** 를 넣으세요.\n' +
              '> - 문장: `DocEntry 12345 반품 요청 마감`\n' +
              '> - JSON: `"header": { "docEntry": 12345, ... }`\n' +
              '> - 본문: `{ "question": "...", "docEntries": [12345] }`\n'
            : '')
      return res.json({
        answer,
        orrrClose: sch,
      })
    }

    if (isInboundCancelAndIssueIntent(question)) {
      const docEntries = extractDocEntriesFromQuestion(question)
      let pdnFetch = null
      if (isSboSqlConfigured()) {
        pdnFetch = await fetchPdn1LinesForDocEntries(docEntries)
        if (pdnFetch?.ok && pdnFetch.rows?.length) {
          const enriched = await enrichPdn1LinesWithStockBatch(pdnFetch.rows)
          pdnFetch = {
            ...pdnFetch,
            rows: enriched.rows || pdnFetch.rows,
            batchSource: enriched.source || null,
            batchError: enriched.ok ? null : enriched.error || null,
          }
        }
      }
      const cancel = isSboSqlConfigured()
        ? await cancelOpdnByDocEntries(docEntries)
        : {
            ok: false,
            error:
              'SQL 미설정: KAI_SBO_SQL_* 설정 후 사용하세요. (입고 PO 취소 단계)',
            affected: 0,
            entries: docEntries,
            table: '[dbo].[OPDN]',
          }

      let gi = null
      if (pdnFetch?.ok && pdnFetch.rows?.length) {
        let prop = buildStockTransferProposalFromPdnLines(
          pdnFetch.rows,
          docEntries
        )
        prop = applyStockTransferDefaults(prop)
        gi = await postGoodsIssue(
          goodsIssueUrl,
          process.env.SAP_USER,
          process.env.SAP_PASSWORD,
          prop
        )
      }

      let answer =
        '### 입고처리 취소 처리 결과\n\n' +
        '요청 규칙: **입고PO 문서 취소 후 출고문서 생성**\n\n' +
        '#### 0) 입고 라인 조회(PDN1, 취소 전)\n' +
        (pdnFetch?.ok
          ? `- 테이블: \`${pdnFetch.table}\` · 라인 **${pdnFetch.rows?.length || 0}건**\n`
          : `- 조회 실패 또는 생략: ${pdnFetch?.error || 'SQL 미설정'}\n`) +
        (pdnFetch?.ok && pdnFetch.rows?.length
          ? '```json\n' + JSON.stringify(pdnFetch.rows, null, 2) + '\n```\n\n'
          : '\n') +
        '#### 1) 입고PO 취소(SQL)\n' +
        `- 테이블: \`${cancel.table}\`\n` +
        `- 요청 DocEntry: \`${(cancel.entries || []).join(', ') || '(없음)'}\`\n` +
        `- 처리 건수: **${cancel.affected || 0}건**\n` +
        `${cancel.ok ? '' : `- 오류: ${cancel.error}\n`}` +
        '\n```json\n' +
        JSON.stringify(cancel.rows || [], null, 2) +
        '\n```\n\n' +
        '#### 2) 출고문서 생성(CSM003)\n' +
        (pdnFetch?.ok && pdnFetch.rows?.length
          ? '- 품목·수량·창고는 위 PDN1 라인 기준으로 전송했습니다.\n'
          : '- PDN1 라인이 없어 출고 생성은 생략했습니다.\n')

      if (gi) {
        answer +=
          '```json\n' +
          JSON.stringify(gi.requestBody || {}, null, 2) +
          '\n```\n\n' +
          `- 전송: \`POST ${gi.usedUrl || goodsIssueUrl}\`\n` +
          (gi.ok
            ? `- 결과: 전송 성공 · 문서 \`${gi.docNo || '본문 확인'}\`\n`
            : `- 결과: 전송 실패 · ${(gi.body || '').slice(0, 500)}\n`)
      } else {
        answer += '- 결과: 출고 생성 생략(PDN1 라인 미조회)\n'
      }

      return res.json({
        answer,
        inboundCancel: cancel,
        pdn1: pdnFetch,
        goodsIssue: gi,
      })
    }

    if (isInboundCloseIntent(question) && isSboSqlConfigured()) {
      const docEntries = extractDocEntriesFromQuestion(question)
      const close = await closeOpdnByDocEntries(docEntries)
      const answer = close.ok
        ? '### 입고 문서 마감(SQL)\n\n' +
          `- 테이블: \`${close.table}\`\n` +
          `- 요청 DocEntry: \`${close.entries.join(', ')}\`\n` +
          `- 마감 건수: **${close.affected}건**\n\n` +
          '```json\n' +
          JSON.stringify(close.rows || [], null, 2) +
          '\n```'
        : '### 입고 문서 마감 실패(SQL)\n\n' +
          `- 테이블: \`${close.table}\`\n` +
          `- 요청 DocEntry: \`${(close.entries || []).join(', ') || '(없음)'}\`\n` +
          `- 오류: ${close.error}`
      return res.json({
        answer,
        sapInboundClose: close,
      })
    }

    if (isInboundDocumentListIntent(question)) {
      try {
        const ibq = await runInboundPendingDocumentsQuery(question)
        return res.json({
          answer: ibq.answer,
          sapInboundPending: {
            usedUrl: ibq.usedUrl
              ? String(ibq.usedUrl).replace(/\/\/[^@/]+@/, '//***@')
              : null,
            fromFallback: ibq.fromFallback,
            weekAgo: ibq.weekAgo,
            today: ibq.today,
            sql: ibq.sql,
          },
        })
      } catch (pe) {
        console.warn('[미처리 입고 문서 조회 실패, 일반 질의로]', pe)
      }
    }

    if (apiConfigured && isStockTransferIntent(question)) {
      try {
        const st = await runStockTransferPipeline(question)
        const etcOutboundLine = getStockTransferEtcOutboundDisplayLine(question)
        let answer =
          '### 재고이전 (CSM001 반영용 JSON)\n\n```json\n' +
          JSON.stringify(st.requestBody || st.proposal, null, 2) +
          '\n```\n\n'
        if (etcOutboundLine) answer += etcOutboundLine
        if (st.wtq1?.ok && st.wtq1?.rows?.length) {
          answer +=
            `- **OWTQ/WTQ1:** DocEntry \`${(st.wtq1.entries || []).join(', ')}\` · 테이블 \`${st.wtq1.table}\` · 라인 **${st.wtq1.rows.length}**건 반영` +
            (st.wtq1.batchEnrich
              ? ` · 배치 BTQ1+OBTN \`${st.wtq1.batchEnrich}\`\n`
              : '\n')
        }
        const viaDiNote = st.viaDi ? ' (DI 경유)' : ''
        answer += `**전송:** \`POST ${st.usedUrl || stockTransferUrl}\` · Basic \`manager\`/\`emdc\`${viaDiNote}\n`
        if (st.posted) {
          answer += st.demo
            ? `**시뮬** \`SAP_STOCK_TRANSFER_MOCK\` — 문서: \`${st.docNo}\`\n`
            : `**CSM001 응답** — \`${st.docNo || '본문 확인'}\`${st.viaDi ? ' (DI 경유)' : ''}${st.usedUrl ? ` \`${st.usedUrl}\`` : ''}\n`
          if (st.owtqClose) {
            const oc = st.owtqClose
            answer +=
              oc.ok
                ? `**OWTQ 마감(SQL):** 연동값 \`${oc.oporLinkValue || 'C'}\` · DocEntry \`${(oc.entries || []).join(', ') || '(없음)'}\`\n\`\`\`json\n${JSON.stringify(oc.results || oc, null, 2)}\n\`\`\`\n`
                : `**OWTQ 마감(SQL) 실패:** ${String(oc.error || '')}\n`
          }
        } else {
          const errText = (st.error || st.body || '').slice(0, 800)
          answer += `**전송 실패:** ${errText}\n`
          if (st.viaDi) {
            answer +=
              '**→ DI 서버 경유 실패.** DI_SERVER_URL·DI_STOCK_TRANSFER_PATH, DI 인증 확인. DI 쪽에서 SAP/CSM001로 전달하는지 확인하세요.\n'
          } else if (/Cannot POST|404|Not Found|no route/i.test(errText)) {
            answer +=
              '**→ 서버에는 연결됐지만, 이 경로(/CSM001)에 POST를 받는 API가 없습니다.**\n' +
              '192.168.0.37 쪽 URL 확인하거나, DI 경유 사용 시 .env에 DI_SERVER_URL·DI_STOCK_TRANSFER_PATH 설정.\n'
          } else {
            answer +=
              '힌트: ECONNREFUSED면 URL에 포트 포함. 방화벽·망 확인.\n'
          }
          answer +=
            '\n> **알람(필수 입력 5가지):** 품목·배치·출고창고·입고창고·수량. `KAI_SBO_SQL_*` 설정 시 질문에 **OWTQ DocEntry**(예: `DocEntry 7510`)를 넣으면 **WTQ1**에서 위 값을 채웁니다.\n' +
            '> 1) 품목번호(예: `11411-053`)\n' +
            '> 2) 배치번호(예: `11411-053@260422`)\n' +
            '> 3) 출고창고(예: `AA120`)\n' +
            '> 4) 입고창고(예: `AA100`)\n' +
            '> 5) 수량(예: `4`)\n'
        }
        return res.json({ answer, stockTransfer: st })
      } catch (se) {
        console.warn('[재고이전 실패, 일반 질의로]', se)
      }
    }

    if (apiConfigured && isInboundProcessingIntent(question)) {
      try {
        const ib = await runInboundProcessingPipeline(question)
        let answer =
          '### 입고처리 (CBP002 반영용 JSON)\n\n```json\n' +
          JSON.stringify(ib.requestBody || ib.proposal, null, 2) +
          '\n```\n\n'
        const viaDiNote = ib.viaDi ? ' (DI 경유)' : ''
        answer += `**전송:** \`POST ${ib.usedUrl || inboundProcessingUrl}\` · Basic \`manager\`/\`emdc\`${viaDiNote}\n`
        if (ib.posted) {
          answer += ib.demo
            ? `**시뮬** \`SAP_INBOUND_PROCESS_MOCK\` — 문서: \`${ib.docNo}\`\n`
            : `**CBP002 응답** — ${ib.docNo ? `문서: \`${ib.docNo}\`` : (ib.resultMessage ? `\`${ib.resultMessage}\`` : '본문 확인')}${
                ib.usedUrl ? ` (연결: \`${ib.usedUrl}\`)` : ''
              }\n`
        } else {
          const errText = (ib.error || ib.body || '').slice(0, 800)
          answer += `**전송 실패:** ${errText || '(응답 본문 없음)'}\n`
          if (ib.usedUrl) answer += `**시도 URL:** \`${ib.usedUrl}\`\n`
          if (ib.errorHint) answer += ib.errorHint + '\n'
          if (!errText || errText.length < 3) {
            answer += '\n> **힌트:** Swagger에서 사용하는 **주소·포트·프로토콜(https)** 과 동일하게 server/.env 의 `SAP_INBOUND_PROCESS_URL` 에 넣으세요. 예: `https://192.168.0.37:44346/CBP002`\n'
          }
          const isNoDataError = /Invalid attempt to read when no data is present|일치하는 레코드가 없습니다|-2028/i.test(String(ib.error || ''))
          if (ib.validationFailed) {
            answer +=
              '\n> **알람(필수 입력):** 입고처리(CBP002)는 `erpReqNo`(원천 PO DocEntry)와 `erpLineNo`(원천 라인번호)가 없으면 SAP에서 조회가 실패합니다.\n' +
              '> 또한 Swagger 예시의 `\"string\"`을 그대로 넣으면 실패합니다.\n'
          } else if (isNoDataError) {
            answer +=
              '\n> **원인:** `erpReqNo`(PO DocEntry) 또는 `erpLineNo`(PO 라인번호)로 SAP/DB 조회 시 **0건**이라 발생한 오류입니다.\n' +
              '> **조치:** SAP(B1)에서 해당 PO 문서의 DocEntry·라인번호를 확인한 뒤, 요청 JSON의 `erpReqNo`·`erpLineNo`를 그 값으로 맞춰 주세요. (라인은 보통 0이 아닌 1부터 시작할 수 있음)\n'
          } else {
            answer +=
              '\n> **알람(필수 입력):** 입고처리는 아래 값이 필요합니다. 특히 `erpReqNo`(원천 PO DocEntry)와 `erpLineNo`(원천 라인번호)는 반드시 넣어 주세요.\n' +
              '> 1) 품목번호(ifProdId)\n' +
              '> 2) 배치번호(erpBatchNo, 배치관리 품목일 때)\n' +
              '> 3) 입고창고(towh)\n' +
              '> 4) 수량(exQty)\n' +
              '> 5) 입고유형(inwhTypeCd, inwhTypeDtlCd)\n' +
              '> 6) 원천 PO 문서번호(erpReqNo) + 원천 라인번호(erpLineNo)\n'
          }
        }
        return res.json({ answer, inbound: ib })
      } catch (ie) {
        console.warn('[입고처리 실패, 일반 질의로]', ie)
      }
    }

    if (apiConfigured && isJournalIntent(question)) {
      try {
        const jr = await runJournalPipeline(question)
        let answer =
          '### 분개 초안 (SAP 반영용 JSON)\n\n```json\n' +
          JSON.stringify(jr.proposal, null, 2) +
          '\n```\n\n'
        if (jr.posted) {
          answer += jr.demo
            ? `**시뮬 전기** — \`${jr.belnr}\` (\`SAP_JOURNAL_MOCK\`)\n`
            : jr.viaDi
              ? `**DI 서버 경유 전기 요청 완료** — 문서번호/응답: \`${jr.belnr || 'DI 응답 확인'}\`\n`
              : `**SAP 전기 요청 완료** — \`${jr.belnr || jr.sapError || '응답 확인'}\`\n`
        } else {
          answer +=
            '**실제 SAP 전표는 아직 생성되지 않았습니다.** 전기하려면 `server/.env`에 **`DI_SERVER_URL`**(권장) 또는 **`SAP_JOURNAL_POST_URL`** 필수. 위 JSON이 그대로 DI/SAP로 전달됩니다. 테스트만: `SAP_JOURNAL_MOCK=true` → documents/DI_서버_연동.md\n'
        }
        return res.json({ answer, journal: jr })
      } catch (je) {
        console.warn('[분개 의도 처리 실패, 일반 질의로]', je)
      }
    }

    const includeSapOdata = Boolean(req.body?.includeSapOdata)
    const sapContext =
      req.body?.sapContext != null ? String(req.body.sapContext) : ''
    const sapOdataUrl =
      req.body?.sapOdataUrl != null ? String(req.body.sapOdataUrl) : ''
    const sapOdataUser =
      req.body?.sapOdataUser != null ? String(req.body.sapOdataUser) : ''
    const sapOdataPassword =
      req.body?.sapOdataPassword != null
        ? String(req.body.sapOdataPassword)
        : ''
    const sapDocument = req.body?.sapDocument === true
    const answer = await queryRag(question, {
      includeSapOdata,
      sapContext,
      sapOdataUrl,
      sapOdataUser,
      sapOdataPassword,
      sapDocument,
    })
    res.json({ answer })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

/**
 * SAP 분개 전기: 자연어 → 분개 JSON → SAP_JOURNAL_POST_URL POST (또는 모의 전기)
 * body: { instruction: "상품 100만원 팔린 분개" }
 */
app.post('/api/sap/stock-transfer', async (req, res) => {
  try {
    const instruction = (req.body?.instruction ?? '').trim()
    if (!instruction) {
      return res
        .status(400)
        .json({ error: 'instruction 필수 (예: 자재 A 플랜트1000에서 2000으로 10EA 이동)' })
    }
    if (!apiConfigured) {
      return res.status(400).json({ error: 'OPENAI_API_KEY 필요' })
    }
    const st = await runStockTransferPipeline(instruction)
    return res.json({
      ok: st.posted,
      demo: st.demo,
      docNo: st.docNo,
      proposal: st.proposal,
      requestBody: st.requestBody,
      wtq1: st.wtq1,
      owtqClose: st.owtqClose,
      url: stockTransferUrl,
      error: st.error,
    })
  } catch (e) {
    console.error('[stock-transfer]', e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

app.post('/api/sap/journal', async (req, res) => {
  try {
    const instruction = (req.body?.instruction ?? '').trim()
    if (!instruction) {
      return res.status(400).json({ error: 'instruction 필수 (예: 상품 100만원 팔린 분개)' })
    }
    if (!apiConfigured) {
      return res
        .status(400)
        .json({ error: 'OPENAI_API_KEY 가 필요합니다 (분개안 생성)' })
    }
    const jr = await runJournalPipeline(instruction)
    if (jr.demo) {
      return res.json({
        ok: true,
        posted: true,
        demoMode: true,
        belnr: jr.belnr,
        proposal: jr.proposal,
        message: '시뮬 전기. 실전: DI_SERVER_URL 또는 SAP_JOURNAL_POST_URL',
      })
    }
    if (!jr.posted && !journalViaDiOrSap) {
      return res.json({
        ok: true,
        posted: false,
        proposal: jr.proposal,
        message:
          '분개안만 생성. DI_SERVER_URL 또는 SAP_JOURNAL_POST_URL → documents/DI_서버_연동.md',
        hint: 'SAP_JOURNAL_MOCK=true',
      })
    }
    if (jr.posted) {
      return res.json({
        ok: true,
        posted: true,
        belnr: jr.belnr,
        proposal: jr.proposal,
        sapResponse: jr.sapError,
      })
    }
    return res.status(502).json({
      ok: false,
      posted: false,
      proposal: jr.proposal,
      error: 'DI/SAP 전기 요청 실패',
      sapResponse: jr.sapError,
    })
  } catch (e) {
    console.error('[sap/journal]', e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

const doIndex = process.env.KAI_INDEX !== 'false'

function openBrowserOnce() {
  if (process.env.KAI_OPEN_BROWSER === '0' || process.env.KAI_OPEN_BROWSER === 'false')
    return
  const url = `http://127.0.0.1:${PORT}/`
  try {
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`, { windowsHide: true })
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`)
    } else {
      exec(`xdg-open "${url}"`)
    }
  } catch (_) {}
}

async function main() {
  console.log('')
  console.log('KAI Node API 기동…')
  if (!apiConfigured) {
    console.log(
      '(OPENAI_API_KEY 없음 → server\\.env 권장. 없어도 서버는 뜹니다.)\n'
    )
  }

  app.listen(PORT, () => {
    console.log('')
    console.log(
      '┌────────────────────────────────────────────────────────────'
    )
    console.log(
      '│  질문은 "웹 브라우저"에서만 입력합니다.'
    )
    console.log(
      '│  이 검정 CMD 창에는 입력할 수 없습니다. (서버만 실행 중)'
    )
    console.log(
      '└────────────────────────────────────────────────────────────'
    )
    console.log('')
    console.log(`  브라우저 주소:  http://localhost:${PORT}/`)
    console.log(`  React UI:      frontend → npm run dev → http://localhost:5173`)
    console.log('')
    openBrowserOnce()

    if (doIndex) {
      console.log(
        '문서 인덱싱을 백그라운드에서 진행합니다. API 키 사용 시 1~2분 걸릴 수 있으며,'
      )
      console.log(
        '그동안에도 브라우저에서 질문 가능합니다. (문서 청크는 인덱싱 후 반영)'
      )
      console.log('')
      indexDocuments()
        .then(() => {
          console.log(`인덱싱 완료: 청크 ${chunks.length}개`)
        })
        .catch((e) => console.error('인덱싱 오류:', e))
    } else {
      console.log(`현재 청크 ${chunks.length}개 (인덱싱 생략 KAI_INDEX=false)`)
    }
    console.log(
      `OpenAI ${apiConfigured ? '키 있음' : '키 없음'} · 재고이전 → ${stockTransferUrl} · DI ${diConfigured() ? 'O' : 'X'} · 분개 ${journalViaDiOrSap ? 'O' : sapJournalMock ? 'MOCK' : 'X'}`
    )
    console.log('')
  })
}

main()
