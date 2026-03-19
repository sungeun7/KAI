/**
 * 자연어 → SAP FI 분개안(JSON) → DI 서버 또는 SAP_JOURNAL_POST_URL 로 전기
 */
import { resolveSapCredentials } from './sapContext.js'
import { diJournalEndpoint, postJournalThroughDi } from './diClient.js'

const CHAT = 'https://api.openai.com/v1/chat/completions'

function parseJsonFromAssistant(content) {
  let s = String(content || '').trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/s, '')
  }
  return JSON.parse(s)
}

function validateProposal(p) {
  if (!p || typeof p !== 'object') throw new Error('분개 JSON 형식 오류')
  const lines = p.lines
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error('분개 행이 2개 이상 필요합니다')
  }
  let debit = 0
  let credit = 0
  for (const l of lines) {
    debit += Number(l.debit) || 0
    credit += Number(l.credit) || 0
  }
  if (debit !== credit || debit <= 0) {
    throw new Error(`차변(${debit})과 대변(${credit})이 맞지 않습니다`)
  }
  return p
}

/**
 * @param {string} instruction 예: "상품 100만원 팔린 분개"
 * @param {string} apiKey
 */
export async function generateJournalProposal(instruction, apiKey) {
  const bukrs = (process.env.SAP_COMPANY_CODE || '1000').trim()
  const t = new Date()
  const defDate = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`

  const system = `당신은 SAP FI 회계 전표 설계자입니다.
사용자의 한국어 업무 설명만 보고 **SAP에 넣을 수 있는 분개 초안**을 JSON으로만 출력하세요.

반드시 지킬 것:
- 회사코드 bukrs: "${bukrs}"
- 전기일 budat: YYYYMMDD 형식 (오늘 ${defDate} 사용 가능)
- 통화 waers: "KRW"
- bktxt: 전표 헤더 텍스트 25자 이내
- lines: 배열. 각 원소 { "hkont": "총계정원장(숫자코드 10자리 내)", "debit": 정수원단위, "credit": 정수원단위, "sgtxt": "행 적요" }
- 각 행은 debit 또는 credit 중 하나만 0이 아님. **차변 합계 = 대변 합계** (원 단위, 부가세 별도면 매출·부가세 대변 분리 가능).
- 예: 상품 100만원 현금판매 → 차변 현금 1000000, 대변 매출 1000000 (또는 부가세 분리 시 3행)

다른 설명·마크다운 없이 JSON 객체만 출력.`

  const res = await fetch(CHAT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.15,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `다음 업무에 대한 분개 초안 JSON:\n${instruction}`,
        },
      ],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI 오류 ${res.status}: ${err.slice(0, 200)}`)
  }
  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  const proposal = parseJsonFromAssistant(content)
  return validateProposal(proposal)
}

export async function postJournalToSap(postUrl, user, pass, proposal) {
  const rawOnly = (process.env.SAP_JOURNAL_POST_RAW || '').trim() === 'true'
  const payload = rawOnly
    ? proposal
    : {
        type: 'KAI_JOURNAL_V1',
        proposal,
        postedAt: new Date().toISOString(),
      }

  if (diJournalEndpoint()) {
    return postJournalThroughDi(user, pass, payload)
  }

  const url = (postUrl || '').trim()
  if (!url) {
    return {
      ok: false,
      status: 0,
      body: 'SAP_JOURNAL_POST_URL 또는 DI_SERVER_URL 필요',
      parsed: null,
      belnr: null,
    }
  }

  const { user: u, pass: p } = resolveSapCredentials(user, pass)
  const auth = Buffer.from(`${u}:${p}`, 'utf8').toString('base64')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 60000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain;q=0.9',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    const text = await res.text()
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch (_) {}
    return {
      ok: res.ok,
      status: res.status,
      body: text.slice(0, 4000),
      parsed,
      belnr:
        parsed?.belnr ||
        parsed?.documentNumber ||
        parsed?.Belnr ||
        null,
    }
  } catch (e) {
    clearTimeout(t)
    return {
      ok: false,
      status: 0,
      body: String(e?.message || e),
      parsed: null,
      belnr: null,
    }
  }
}
