/**
 * SAP OData/REST 연계
 * DI_SERVER_URL 설정 시 OData는 DI 서버로만 전달 (DI → SAP)
 */

import { diConfigured, forwardOdataThroughDi } from './diClient.js'

const DEFAULT_SAP_USER = 'manager'
const DEFAULT_SAP_PASSWORD = 'emdc'

const DEFAULT_TIMEOUT = 45000

export function resolveSapCredentials(user, pass) {
  const u = (user || '').trim() || (process.env.SAP_USER || '').trim() || DEFAULT_SAP_USER
  const p = (pass || '').trim() || (process.env.SAP_PASSWORD || '').trim() || DEFAULT_SAP_PASSWORD
  return { user: u, pass: p }
}
const DEFAULT_MAX = 12000

function getTimeoutMs() {
  return Math.min(
    Math.max(Number(process.env.SAP_FETCH_TIMEOUT_MS) || DEFAULT_TIMEOUT, 5000),
    120000
  )
}

function getMaxChars() {
  return Math.min(
    Number(process.env.SAP_RESPONSE_MAX_CHARS) || DEFAULT_MAX,
    50000
  )
}

/** http/https만, 길이 제한, 메타데이터 IP 차단 */
export function isAllowedSapUrl(urlStr) {
  if (!urlStr || String(urlStr).length > 2048) return false
  try {
    const u = new URL(String(urlStr).trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    if (h === '169.254.169.254' || h.endsWith('.metadata.google.internal'))
      return false
    return true
  } catch {
    return false
  }
}

async function fetchOdataGet(url, headers) {
  const timeoutMs = getTimeoutMs()
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!res.ok) {
      return { ok: false, text: '', error: `HTTP ${res.status}` }
    }
    const text = await res.text()
    return { ok: true, text: text.slice(0, getMaxChars()), error: null }
  } catch (e) {
    clearTimeout(t)
    const msg = e?.name === 'AbortError' ? '시간 초과' : String(e?.message || e)
    return { ok: false, text: '', error: msg }
  }
}

/**
 * @param {string} url
 * @param {string} [user]
 * @param {string} [pass]
 * @param {string} [authorization] 전체 Authorization 헤더
 */
export async function fetchSapOdataUrl(url, user, pass, authorization) {
  const u = (url || '').trim()
  if (!u) return { ok: false, text: '', error: 'URL 없음' }
  if (diConfigured()) {
    return forwardOdataThroughDi(u, user, pass, authorization)
  }
  const headers = {
    Accept: 'application/json, application/xml;q=0.9, text/plain;q=0.8',
  }
  const auth = (authorization || '').trim()
  if (auth) {
    headers.Authorization = auth
  } else {
    const { user: usr, pass: pwd } = resolveSapCredentials(user, pass)
    headers.Authorization =
      'Basic ' + Buffer.from(`${usr}:${pwd}`, 'utf8').toString('base64')
  }
  return fetchOdataGet(u, headers)
}

export async function fetchSapOdataContext() {
  const url = (process.env.SAP_ODATA_URL || '').trim()
  if (!url) {
    return { ok: false, text: '', error: 'SAP_ODATA_URL 미설정' }
  }
  const custom = (process.env.SAP_AUTHORIZATION || '').trim()
  if (custom) {
    return fetchSapOdataUrl(url, '', '', custom)
  }
  return fetchSapOdataUrl(url, process.env.SAP_USER, process.env.SAP_PASSWORD, null)
}
