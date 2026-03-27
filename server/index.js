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
import {
  generateJournalProposal,
  postJournalToSap,
} from './sapJournal.js'
import { diConfigured } from './diClient.js'
import {
  generateStockTransferProposal,
  extractBatchNo,
  extractProcYmd,
  extractProcHms,
  proposalToCSM001Body,
  postStockTransfer,
  normalizeHttpUrl,
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
  isInboundDocumentListIntent,
} from './sapInboundPending.js'
import { fetchOpdnSql, isSboSqlConfigured } from './sboOpdnSql.js'

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

/** 입고처리 CBP002 (기본 192.168.0.37/CBP002) */
const inboundProcessingUrl = normalizeHttpUrl(
  (process.env.SAP_INBOUND_PROCESS_URL || 'http://192.168.0.37/CBP002').trim()
)
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
    apiConfigured,
    chunkCount: chunks.length,
    sapOdataConfigured,
    sapInboundPendingOdataConfigured,
    sboSqlConfigured: isSboSqlConfigured(),
    sapJournalPostConfigured: Boolean(sapJournalPostUrl),
    diServerConfigured: diConfigured(),
    sapJournalMock,
    stockTransferUrl: stockTransferUrl.replace(/\/\/[^@]+@/, '//***@'),
  })
})

function isStockTransferIntent(q) {
  if (!q || q.length < 3) return false
  // 입고라는 말이 있으면 재고이전(CSM001) 대신 입고처리(CBP002)로
  if (/입고/i.test(q)) return false
  /** '재고이전' 또는 '재고 이전' 이 들어가면 항상 CSM001 경로 */
  if (/재고\s*이전|재고이전/i.test(q)) return true
  if (/뭐야|무엇|설명만|가이드|매뉴얼/.test(q)) return false
  if (
    /이동전표|저장위치.*이동|플랜트.*이동|자재.*옮/.test(q) &&
    /만들|생성|해줘|줘|처리|실행|요청|해 주|진행|넣어|어떻게/.test(q)
  ) {
    return true
  }
  return false
}

async function runStockTransferPipeline(instruction) {
  const proposal = await generateStockTransferProposal(instruction, apiKey)
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

function isInboundProcessingIntent(q) {
  if (!q || q.length < 3) return false
  if (/취소|취소처리|취소\s*요청/i.test(q)) return false
  /** 미처리 입고 문서 조회는 CBP002가 아님 */
  if (isInboundDocumentListIntent(q)) return false
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

app.post('/api/query', async (req, res) => {
  try {
    const question = (req.body?.question ?? '').trim()
    if (!question) {
      return res.status(400).json({ error: 'question required' })
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
        let answer =
          '### 재고이전 (CSM001 반영용 JSON)\n\n```json\n' +
          JSON.stringify(st.requestBody || st.proposal, null, 2) +
          '\n```\n\n'
        const viaDiNote = st.viaDi ? ' (DI 경유)' : ''
        answer += `**전송:** \`POST ${st.usedUrl || stockTransferUrl}\` · Basic \`manager\`/\`emdc\`${viaDiNote}\n`
        if (st.posted) {
          answer += st.demo
            ? `**시뮬** \`SAP_STOCK_TRANSFER_MOCK\` — 문서: \`${st.docNo}\`\n`
            : `**CSM001 응답** — \`${st.docNo || '본문 확인'}\`${st.viaDi ? ' (DI 경유)' : ''}${st.usedUrl ? ` \`${st.usedUrl}\`` : ''}\n`
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
            '\n> **알람(필수 입력 5가지):** 재고이전은 아래 5가지를 채팅 문장에 모두 넣어야 전기 성공률이 올라갑니다.\n' +
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
