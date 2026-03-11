# KAI - RAG + LLM 자바 기반 AI 프로그램

문서 기반 질의응답을 위한 **RAG(Retrieval-Augmented Generation)** 와 **LLM** 연동 Java 애플리케이션입니다.

## 구조

- **RAG**: `documents/` 폴더의 텍스트/마크다운 파일 → 청킹 → 임베딩 → 벡터 스토어 → 질의 시 유사 청크 검색
- **LLM**: 검색된 컨텍스트와 사용자 질문을 OpenAI Chat Completions API에 전달해 답변 생성

## 사용법

### 1단계: 요구 사항 확인
- Java 17 이상, Maven 3.6 이상

### 2단계: OpenAI API 키 설정 (선택)
- API 키가 있으면 실제 LLM·임베딩이 동작합니다.
- 없으면 실행은 되지만, 답변 품질이 제한됩니다.

**Windows (PowerShell)**
`$env:OPENAI_API_KEY = "sk-여기에_키_입력"`

**Linux / macOS**
`export OPENAI_API_KEY="sk-여기에_키_입력"`

### 3단계: 문서 넣기
- `documents/` 폴더에 질문하고 싶은 내용의 `.txt` 또는 `.md` 파일을 넣습니다.
- 실행 시 이 폴더의 파일들이 자동으로 인덱싱됩니다.

### 4단계: 실행

**Maven이 없는 경우 (권장)**  
- **`setup.bat`** 더블클릭 또는 실행 → 인터넷에서 Maven Wrapper를 받아 설치한 뒤 KAI를 실행합니다. (Maven 별도 설치 불필요)

**Maven이 이미 있는 경우**  
- **`run.bat`** 더블클릭 또는 터미널에서 `run.bat` 실행

실행 파일은 `mvnw.cmd`(Maven Wrapper)가 있으면 그것을, 없으면 시스템의 `mvn`을 사용합니다.  
한 번 **setup.bat**을 실행해 두면 이후에는 **run.bat**만으로 실행할 수 있습니다.

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

- Java 17+
- Maven 3.6+

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
   `documents/` 폴더에 `.txt`, `.md` 파일을 넣으면 자동으로 인덱싱됩니다.
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
├── run.bat             # Windows 실행 (더블클릭 또는 run.bat)
├── run.ps1             # PowerShell 실행 (.\run.ps1)
├── documents/          # 인덱싱할 문서 (.txt, .md)
├── src/main/java/com/kai/
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
