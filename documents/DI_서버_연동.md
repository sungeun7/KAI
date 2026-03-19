# DI 서버 연동 (KAI → DI → SAP)

`DI_SERVER_URL` 이 있으면 **OData 조회**와 **분개 전기**는 SAP가 아니라 **DI 서버로만** 전달됩니다.

## .env 예시

```env
# DI 베이스 URL (끝 슬래시 없음)
DI_SERVER_URL=https://di.company.com

# 선택 — 기본값 아래와 같음
# DI_JOURNAL_PATH=/kai/journal
# DI_ODATA_PATH=/kai/odata
# 재고이전(CSM001) DI 경유 시 (설정하면 SAP_STOCK_TRANSFER_URL 대신 DI로만 전송)
# DI_STOCK_TRANSFER_PATH=/kai/stock-transfer
# DI_STOCK_TRANSFER_WRAP=true

# DI가 KAI 호출을 검증할 때 (선택)
# DI_API_KEY=Bearer 토큰
# 또는
# DI_KAI_USER=
# DI_KAI_PASSWORD=

# 분개 바디를 { source, journalRequest } 로 감싸기 (DI 스펙에 맞출 때)
# DI_JOURNAL_WRAP=true
```

## 1. 분개 전기 — `POST {DI_SERVER_URL}{DI_JOURNAL_PATH}`

기본 경로: **`/kai/journal`**

본문(JSON) 예:

```json
{
  "type": "KAI_JOURNAL_V1",
  "postedAt": "2025-03-18T12:00:00.000Z",
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

- 헤더: `Authorization` — 미설정 시 `manager`/`emdc` Basic (또는 `DI_API_KEY` / `DI_KAI_*`).
- 헤더: `X-KAI-Source: kai-journal`
- 성공 응답에 **`belnr`**(또는 `documentNumber`) 포함 권장.

`DI_JOURNAL_WRAP=true` 이면 한 겹 감싼 형태로 전송됩니다.

## 2. OData 프록시 — `POST {DI_SERVER_URL}{DI_ODATA_PATH}`

기본 경로: **`/kai/odata`**

요청 본문:

```json
{
  "method": "GET",
  "sapOdataUrl": "https://saphost/sap/opu/odata/sap/...?$format=json",
  "sapUser": "manager",
  "sapPassword": "emdc"
}
```

- `sapAuthorization` 이 있으면 Basic 대신 사용 (OData URL만 넘기는 경우).
- DI는 위 URL로 SAP GET 후 **응답 본문**을 KAI에 돌려줍니다.
- 응답: OData 원문 문자열이거나, JSON `{ "body": "..." }` / `{ "data": "..." }` 도 처리됨.

헤더: `X-KAI-Source: kai-rag`

## 3. 재고이전(CSM001) — `POST {DI_SERVER_URL}{DI_STOCK_TRANSFER_PATH}`

기본 경로: **`/kai/stock-transfer`**

`DI_SERVER_URL` 이 있고 **`DI_STOCK_TRANSFER_PATH`** 가 설정되어 있으면(또는 기본값 사용), KAI는 **192.168.0.37/CSM001** 등으로 직접 보내지 않고 **DI 서버로만** POST 합니다. DI 서버가 내부에서 SAP/CSM001(또는 192.168.0.37)로 전달하면 됩니다.

본문(JSON) 예:

```json
{
  "type": "KAI_STOCK_TRANSFER_V1",
  "program": "CSM001",
  "proposal": {
    "FromWarehouse": "AA120",
    "ToWarehouse": "AA100",
    "PostingDate": "2025-03-18",
    "DocDate": "2025-03-18",
    "Series": "주회",
    "JournalRemark": "재고이전",
    "Lines": [{ "ItemCode": "A001", "Quantity": 10, "FromWarehouse": "AA120", "ToWarehouse": "AA100" }]
  },
  "postedAt": "2025-03-18T12:00:00.000Z"
}
```

- 헤더: `Authorization` — DI 인증 (DI_API_KEY 또는 DI_KAI_USER/PASSWORD, 없으면 manager/emdc Basic).
- 헤더: `X-KAI-Source: kai-stock-transfer`
- 성공 응답에 **`docNo`**(또는 `mblnr`, `documentNumber`) 포함 권장.

`DI_STOCK_TRANSFER_WRAP=true` 이면 `{ source: "KAI", stockTransferRequest: 위 JSON }` 형태로 한 겹 감싸서 보냅니다.

DI 쪽 구현: 이 경로에서 위 body를 받아 192.168.0.37/CSM001(또는 실제 SAP B1/재고이전 API)로 포워딩하면 됩니다.

## 4. DI 없을 때

- `DI_SERVER_URL` 비우면 예전처럼 **SAP OData URL 직접 호출**, 분개는 **`SAP_JOURNAL_POST_URL`** 직접 POST, 재고이전은 **`SAP_STOCK_TRANSFER_URL`** 직접 POST.
- 재고이전만 DI로 보내려면 **DI_SERVER_URL** 과 **DI_STOCK_TRANSFER_PATH** 만 설정하고, DI 서버에서 192.168.0.37/CSM001 로 전달하도록 구현하면 됩니다.
