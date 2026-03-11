package com.kai.llm;

import java.util.List;

/**
 * OpenAI API 호출 래퍼 (Chat + Embeddings).
 * 환경변수 OPENAI_API_KEY가 있으면 실제 API를, 없으면 더미 동작을 사용합니다.
 */
public interface OpenAiClientWrapper {

    boolean isAvailable();

    /**
     * 채팅 완성 (LLM 응답)
     */
    String chat(String systemPrompt, String userMessage);

    /**
     * 텍스트 임베딩 벡터 생성
     */
    List<Double> createEmbedding(String text);
}
