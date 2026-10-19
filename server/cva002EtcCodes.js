/**
 * ZSM108 사용자 정의 유형 — 회사별 Code 체계 (예: O-900 기타출고, I-201 소분입고).
 * - **출하유형코드가 OB91·OB93** 이면 **기타출하**로 보낸다: `erpReqTypCd` → OWTQ, `EtcOutbizTypeCd` 채움 → C# **OIGE** 분기.
 * - ZSM108 **O-*** (예: O-900 기타출고) 도 동일한 기타출하(OIGE) 경로.
 * - **I-201** 은 ZSM108에서 소분**입고** 유형(입고 API 쪽); CVA002 출하의 "기타출고"와 동일하지 않음.
 * @see add/Controllers/CVA002.cs (EtcOutbizTypeCd == "I-201" 시 가격리스트 분기)
 */

/**
 * 레거시 출하유형 — **OB91·OB93 은 기타출하(OIGE)** 로 처리 (`isEtcOutbizOwtqCode` 참고).
 */
export const CVA002_LEGACY_OB_CODES = ['OB91', 'OB93']

/** 하위 호환 export 이름 */
export const CVA002_OUTBIZ_OWtq_U_LINETYPE_CODES = CVA002_LEGACY_OB_CODES

/**
 * OWTQ+비어있지 않은 Etc → OIGE(기타출하)로 보낼 수 있는 Outbiz/Etc 코드인지.
 * - **`OB91`, `OB93`** : 출하유형이 이 값이면 기타출하(OIGE) (`CVA002_LEGACY_OB_CODES`)
 * - `O-\d{2,4}` : ZSM108 출고 유형 (예: O-900 기타출고, O-300 소분출고)
 * - `OB\d{2,4}` : 그 외 구 OB 패턴
 * - `KAI_CVA002_ETC_OUTBIZ_CODES` 추가 목록
 */
export function isEtcOutbizOwtqCode(outbizTypeCd) {
  const s = String(outbizTypeCd || '')
    .trim()
    .toUpperCase()
  if (!s) return false
  if (/^O-\d{2,4}$/.test(s)) return true
  if (/^OB\d{2,4}$/.test(s)) return true
  if (CVA002_LEGACY_OB_CODES.includes(s)) return true
  const env = String(process.env.KAI_CVA002_ETC_OUTBIZ_CODES || '')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean)
  return env.includes(s)
}

/**
 * 자연어「기타출고」만 있을 때 기본 Etc/Outbiz 코드.
 * 기본 **O-900**(기타출고) — 회사 ZSM108에 맞게 `KAI_CVA002_DEFAULT_ETC_OUTBIZ` 로 변경.
 */
export function defaultEtcOutbizCode() {
  const d = String(process.env.KAI_CVA002_DEFAULT_ETC_OUTBIZ || 'O-900')
    .trim()
    .toUpperCase()
  return isEtcOutbizOwtqCode(d) ? d : 'O-900'
}

/**
 * **기타출고** 시 `EtcOutbizTypeCd` 는 ZSM108 기본(보통 **O-900**, `defaultEtcOutbizCode()`).
 * - `etcOutbizTypeCd` 가 이미 있으면 그대로.
 * - 비어 있고 `outbizTypeCd` 가 레거시 **OB91·OB93** 이거나 Outbiz가 기본 기타코드와 같으면 → `defaultEtcOutbizCode()`.
 * - 그 외 `O-*`(예: O-101 샘플출고)는 Outbiz와 동일하게 채움.
 */
export function fillEtcOutbizTypeCdWhenEmpty(outbizTypeCd, etcOutbizTypeCd) {
  const etc = String(etcOutbizTypeCd ?? '').trim()
  if (etc) return etc
  const ob = String(outbizTypeCd ?? '').trim()
  if (!ob || !isEtcOutbizOwtqCode(ob)) return ''
  const obu = ob.toUpperCase()
  const def = defaultEtcOutbizCode()
  if (CVA002_LEGACY_OB_CODES.includes(obu) || obu === def.toUpperCase()) {
    return def
  }
  return ob
}
