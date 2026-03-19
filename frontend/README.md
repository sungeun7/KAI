# KAI React 프론트엔드

SAP 문서 기반 AI 질의응답용 **React** 단일 페이지 앱입니다. Vite + React 18 기반.

## 실행 방법

1. 백엔드 실행: 프로젝트 루트에서 **run-web.bat** 실행 (API 서버 http://localhost:8080)
2. 의존성 설치: `npm install`
3. 개발 서버: `npm run dev` → http://localhost:5173 접속

## 빌드

- `npm run build` → `dist/` 폴더에 정적 파일 생성
- 배포 시 백엔드(8080)와 같은 호스트에 두거나, API 프록시 설정 필요

## 구조 (리액트 기반)

```
frontend/src/
├── api/
│   └── client.js          # /api/status, /api/query 호출
├── hooks/
│   ├── useApiStatus.js    # API 연결·청크 수 상태
│   └── useChat.js         # 질문 전송, 히스토리, 로딩
├── components/
│   ├── Header.jsx         # 타이틀, 부제, API 상태
│   ├── ChatPanel.jsx      # 메시지 목록 + 로딩
│   ├── MessageBubble.jsx  # 사용자/어시스턴트 말풍선
│   └── QuestionForm.jsx   # 질문 입력 폼
├── App.jsx
├── App.css
├── main.jsx
└── index.css
```

- **컴포넌트**: Header, ChatPanel, MessageBubble, QuestionForm
- **훅**: useApiStatus, useChat
- **스타일**: 인라인 제거, `App.css` + `index.css`로 분리
