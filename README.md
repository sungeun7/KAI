# KAI — SAP 전표·문서 **실제 생성**

**목적은 안내가 아니라 SAP에 반영되는 결과물입니다.** 자연어로 분개를 요청하면 전표 JSON을 만들고 **DI/SAP로 전기**합니다. 일반 질문도 **SAP에 넣을 필드·표 형태** 위주로 답합니다(기본). 절차 매뉴얼식 긴 답은 옵션으로만 켭니다.

`documents/` RAG는 참고 자료용이며, **실제 전기는 `DI_SERVER_URL` 또는 `SAP_JOURNAL_POST_URL`** 연동이 필요합니다.

**웹 UI + API**는 **Java 없이** [Node.js](https://nodejs.org)만 있으면 됩니다 (`server/` 폴더). 콘솔 전용 실행은 기존처럼 Java/Maven을 사용할 수 있습니다.

## 구조

- **RAG**: `documents/` 폴더의 텍스트/마크다운 파일 → 청킹 → 임베딩 → 벡터 스토어 → 질의 시 유사 청크 검색
- **LLM**: 검색된 컨텍스트와 사용자 질문을 OpenAI Chat Completions API에 전달해 답변 생성
- **API 서버 (권장)**: `server/index.js` — Express, 포트 8080
- **재고이전**: 기본 **`http://192.168.0.37/CSM001`** 로 JSON POST (`documents/재고이전_CSM001.md`). `SAP_STOCK_TRANSFER_URL`로 변경 가능.
- **SAP·DI 연계**: 분개는 `DI_SERVER_URL` 등 (`documents/DI_서버_연동.md`, `SAP_연계_가이드.md`)

## 사용법

### 1단계: 요구 사항 확인

| 용도 | 필요 항목 |
|------|-----------|
| **React 웹 + API (권장)** | **Node.js 18+** |
| 콘솔만 (기존) | Java 17+, Maven 3.6+ |

### 2단계: OpenAI API 키 설정 (선택)
- API 키가 있으면 실제 LLM·임베딩이 동작합니다.
- 없으면 실행은 되지만, 답변 품질이 제한됩니다.

**Windows — `run-web.bat` 더블클릭 시**  
PowerShell에만 키를 넣으면 **배치 파일에는 전달되지 않습니다.** 아래 중 하나를 쓰세요.

- **`server/.env` 파일 (권장)**  
  `server/.env.example`을 복사해 `server/.env`로 저장 후 한 줄 추가:  
  `OPENAI_API_KEY=sk-...`  
  (따옴표 없이, 앞뒤 공백 없이)

- **Windows 시스템 환경 변수**에 `OPENAI_API_KEY` 등록 후 PC 재로그인 또는 새 CMD.

**터미널에서만 실행할 때 (PowerShell)**  
`$env:OPENAI_API_KEY = "sk-여기에_키_입력"`

**Linux / macOS**
`export OPENAI_API_KEY="sk-여기에_키_입력"`

### 3단계: 문서 넣기
- `documents/` 폴더에 SAP 매뉴얼, 절차, 분개/전표 정리본 등 질문하고 싶은 내용의 `.txt`, `.md`, `.csv`, `.json` 파일을 넣습니다.
- 실행 시 이 폴더의 파일들이 자동으로 인덱싱됩니다.

### 4단계: 실행

**Maven이 없는 경우 (권장)**  
- **`setup.bat`** 더블클릭 또는 실행 → 인터넷에서 Maven Wrapper를 받아 설치한 뒤 KAI를 실행합니다. (Maven 별도 설치 불필요)

**Maven이 이미 있는 경우**  
- **`run.bat`** 더블클릭 또는 터미널에서 `run.bat` 실행

실행 파일은 `mvnw.cmd`(Maven Wrapper)가 있으면 그것을, 없으면 시스템의 `mvn`을 사용합니다.  
한 번 **setup.bat**을 실행해 두면 이후에는 **run.bat**만으로 실행할 수 있습니다.

**React 웹 UI로 실행 (Java 불필요)**
1. **백엔드**: `run-web.bat` 실행 → 처음 한 번 `server`에 `npm install` 후 Node API가 http://localhost:8080 에 뜹니다.
2. **프론트엔드**: `frontend` 폴더에서 `npm install` 후 `npm run dev` → 브라우저에서 http://localhost:5173 접속.
3. 질문 입력 후 전송하면 API를 통해 문서 기반 답변을 받을 수 있습니다.

**수동으로 Node API만 실행**

```bash
cd server
npm install
npm start
```

인덱싱을 끄려면: `KAI_INDEX=false npm start` (Linux/macOS) 또는 PowerShell에서 `$env:KAI_INDEX="false"; npm start`

**직접 명령어로 실행**
프로젝트 폴더(`KAI`)에서:

```bash
mvn clean compile
mvn exec:java -Dexec.mainClass="com.kai.Main"
```

또는 JAR로 실행:

```bash
mvn package
java -cp target/kai-rag-llm-1.0.0-SNAPSHOT.jar com.kai.Main
```

### 5단계: 질문하기
- 실행되면 `질문을 입력하세요 (종료: quit)` 메시지가 나옵니다.
- 질문을 입력하고 Enter를 누르면, 문서를 참고한 답변이 출력됩니다.
- **종료**: `quit` 또는 `exit` 입력 후 Enter.

---

## 요구 사항

- **웹/API**: Node.js 18+
- **콘솔 CLI (선택)**: Java 17+, Maven 3.6+

## 설정

1. **OpenAI API 키**
   환경변수 `OPENAI_API_KEY`에 API 키를 설정합니다.

   ```bash
   # Windows (PowerShell)
   $env:OPENAI_API_KEY = "sk-..."

   # Linux / macOS
   export OPENAI_API_KEY="sk-..."
   ```

2. **문서 준비**
   `documents/` 폴더에 SAP 관련 `.txt`, `.md`, `.csv`, `.json` 파일을 넣으면 자동으로 인덱싱됩니다.
   API 키가 없어도 실행 가능하며, 이때는 더미 임베딩으로 동작합니다(실제 유사도 검색 품질은 낮음).

## 빌드 및 실행

```bash
# 빌드
mvn clean compile

# 실행 (메인 클래스 지정)
mvn exec:java -Dexec.mainClass="com.kai.Main"
```

또는 JAR 패키징 후 실행:

```bash
mvn package
java -cp target/kai-rag-llm-1.0.0-SNAPSHOT.jar com.kai.Main
```

실행 후 콘솔에 질문을 입력하면, 문서를 참고한 답변이 출력됩니다.
종료하려면 `quit` 또는 `exit`를 입력하세요.

## 프로젝트 구조

```
KAI/
├── run-web.bat         # 웹용 API 서버 (Node.js, Java 불필요)
├── server/             # Node API (Express) — /api/query, /api/status
├── run.bat             # Windows 콘솔 실행 (Java)
├── run.ps1             # PowerShell 실행 (.\run.ps1)
├── frontend/           # React + Vite UI
├── documents/          # 인덱싱할 SAP 관련 문서 (.txt, .md, .csv, .json)
├── src/main/java/com/kai/   # 콘솔용 Java (선택)
│   ├── Main.java                    # 진입점
│   ├── model/
│   │   └── DocumentChunk.java       # 청크 + 임베딩 모델
│   ├── rag/
│   │   ├── DocumentLoader.java      # 문서 로드
│   │   ├── TextChunker.java         # 텍스트 청킹
│   │   ├── EmbeddingService.java    # 임베딩 (OpenAI 또는 더미)
│   │   └── VectorStore.java         # 인메모리 벡터 검색
│   ├── llm/
│   │   ├── OpenAiClientWrapper.java # LLM/임베딩 인터페이스
│   │   └── OpenAiHttpClient.java    # OpenAI REST API 구현
│   └── service/
│       └── RagService.java          # RAG 파이프라인 통합
├── pom.xml
└── README.md
```

## 라이선스

MIT.
