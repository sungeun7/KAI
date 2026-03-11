package com.kai.model;

import java.util.List;

/**
 * RAG용 문서 청크 (텍스트 + 임베딩 벡터).
 */
public class DocumentChunk {

    private final String text;
    private final String source;
    private final List<Double> embedding;

    public DocumentChunk(String text, String source, List<Double> embedding) {
        this.text = text;
        this.source = source;
        this.embedding = embedding;
    }

    public String getText() {
        return text;
    }

    public String getSource() {
        return source;
    }

    public List<Double> getEmbedding() {
        return embedding;
    }
}
