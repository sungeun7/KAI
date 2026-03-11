package com.kai;

import com.kai.llm.OpenAiClientWrapper;
import com.kai.llm.OpenAiHttpClient;
import com.kai.service.RagService;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * RAG + LLM 기반 Q&A 콘솔 애플리케이션.
 * - documents 폴더의 텍스트/마크다운 파일을 로드해 벡터 인덱싱
 * - 사용자 질의 시 유사 문서를 검색해 LLM에 컨텍스트로 전달 후 답변 생성
 */
public class Main {

    public static void main(String[] args) throws IOException {
        Path baseDir = Paths.get(System.getProperty("user.dir"));
        Path documentsPath = baseDir.resolve("documents");

        OpenAiClientWrapper openAi = new OpenAiHttpClient();
        RagService rag = new RagService(documentsPath, openAi);

        System.out.println("=== KAI: RAG + LLM 기반 Q&A ===");
        System.out.println("OpenAI API: " + (openAi.isAvailable() ? "연결됨" : "미설정 (OPENAI_API_KEY)"));
        System.out.println("문서 경로: " + documentsPath.toAbsolutePath());

        // 문서 인덱싱은 run.bat 실행 시에만 수행 (OOM 방지). IDE 실행 시에는 생략.
        boolean doIndex = "true".equals(System.getProperty("kai.index", "false"));
        if (doIndex) {
            try {
                rag.indexDocuments();
            } catch (OutOfMemoryError e) {
                System.out.println("(메모리 부족)");
            }
        } else {
            System.out.println("(문서 인덱싱: run.bat으로 실행하면 자동 인덱싱)");
        }
        System.out.println("인덱싱된 청크 수: " + rag.getIndexedChunkCount());
        System.out.println("질문을 입력하세요 (종료: quit)\n");

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(System.in))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String input = line.trim();
                if (input.equalsIgnoreCase("quit") || input.equalsIgnoreCase("exit")) {
                    break;
                }
                if (input.isEmpty()) {
                    continue;
                }
                String answer = rag.query(input);
                System.out.println("답변: " + answer);
                System.out.println();
            }
        }
        System.out.println("종료합니다.");
    }
}
