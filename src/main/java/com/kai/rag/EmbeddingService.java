package com.kai.rag;

import com.kai.llm.OpenAiClientWrapper;
import com.kai.model.DocumentChunk;

import java.util.ArrayList;
import java.util.List;

/**
 * OpenAI Embeddings API를 사용해 텍스트를 벡터로 변환합니다.
 * API 키가 없으면 더미 벡터를 반환해 로컬 테스트가 가능합니다.
 */
public class EmbeddingService {

    private static final int EMBEDDING_DIM = 64; // 더미 벡터 크기 축소 (OOM 방지)

    private final OpenAiClientWrapper openAi;

    public EmbeddingService(OpenAiClientWrapper openAi) {
        this.openAi = openAi;
    }

    public List<Double> embed(String text) {
        if (openAi.isAvailable()) {
            List<Double> vec = openAi.createEmbedding(text);
            if (vec != null) {
                return vec;
            }
        }
        return dummyEmbedding(text);
    }

    public List<DocumentChunk> embedChunks(List<String> chunks, String source) {
        List<DocumentChunk> result = new ArrayList<>();
        for (String chunk : chunks) {
            List<Double> vec = embed(chunk);
            result.add(new DocumentChunk(chunk, source, vec));
        }
        return result;
    }

    private static List<Double> dummyEmbedding(String text) {
        List<Double> vec = new ArrayList<>(EMBEDDING_DIM);
        int hash = text.hashCode();
        for (int i = 0; i < EMBEDDING_DIM; i++) {
            vec.add(Math.sin(hash * (i + 1)) * 0.1);
        }
        return vec;
    }

    public int getDimension() {
        return EMBEDDING_DIM;
    }
}
