# SAP 분개 자동 전기 — KAI 연동

KAI는 자연어를 아래 형태의 **JSON 분개안**으로 만든 뒤, `SAP_JOURNAL_POST_URL`로 **HTTP POST**합니다.

## POST 본문 (기본)

```json
{
  "type": "KAI_JOURNAL_V1",
  "postedAt": "2025-03-18T...",
  "proposal": {
    "bukrs": "1000",
    "budat": "20250318",
    "bktxt": "상품매출",
    "waers": "KRW",
    "lines": [
      { "hkont": "11101001", "debit": 1000000, "credit": 0, "sgtxt": "현금" },
      { "hkont": "43101001", "debit": 0, "credit": 1000000, "sgtxt": "매출" }
    ]
  }
}
```

- `SAP_JOURNAL_POST_RAW=true` 이면 **proposal 객체만** POST합니다.

## ABAP 쪽에서 할 일 (개념)

1. SICF 또는 REST로 HTTP POST 수신.
2. JSON 파싱 후 `proposal.lines`를 루프하며 `BAPI_ACC_DOCUMENT_POST` / `BAPI_ACC_GL_POSTING` 등으로 전표 생성.
3. 성공 시 응답 JSON: `{ "belnr": "5100000123" }` (KAI가 문서번호로 표시).

인증: KAI는 **Basic** (`manager`/`emdc` 또는 `.env`의 `SAP_USER`/`SAP_PASSWORD`)를 보냅니다.

## .env 예시

```env
SAP_JOURNAL_POST_URL=https://saphost/sap/bc/.../kai_journal_post
SAP_COMPANY_CODE=1000
# 테스트용 가짜 전기번호 (실SAP 없을 때)
SAP_JOURNAL_MOCK=true
```

`SAP_JOURNAL_MOCK=true` 이고 URL이 없으면 화면에만 DEMO 전기번호가 나옵니다.

## 사용 예

- 채팅/질문란에 **「상품 100만원 팔린 분개 만들어줘」** 입력 → 분개 JSON 생성 + URL 설정 시 SAP 호출.
