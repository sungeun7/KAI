package com.kai.rag;

import com.kai.model.DocumentChunk;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 인메모리 벡터 스토어. 코사인 유사도로 유사 청크를 검색합니다.
 */
public class VectorStore {

    private final List<DocumentChunk> chunks = new CopyOnWriteArrayList<>();

    public void addAll(List<DocumentChunk> newChunks) {
        chunks.addAll(newChunks);
    }

    public List<DocumentChunk> search(List<Double> queryEmbedding, int topK) {
        if (chunks.isEmpty()) {
            return List.of();
        }
        List<ScoredChunk> scored = new ArrayList<>();
        for (DocumentChunk c : chunks) {
            double sim = cosineSimilarity(queryEmbedding, c.getEmbedding());
            scored.add(new ScoredChunk(c, sim));
        }
        return scored.stream()
            .sorted(Comparator.comparingDouble(ScoredChunk::getScore).reversed())
            .limit(topK)
            .map(ScoredChunk::getChunk)
            .toList();
    }

    public int size() {
        return chunks.size();
    }

    private static double cosineSimilarity(List<Double> a, List<Double> b) {
        if (a.size() != b.size()) {
            return 0;
        }
        double dot = 0, normA = 0, normB = 0;
        for (int i = 0; i < a.size(); i++) {
            double x = a.get(i), y = b.get(i);
            dot += x * y;
            normA += x * x;
            normB += y * y;
        }
        if (normA == 0 || normB == 0) {
            return 0;
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private static class ScoredChunk {
        private final DocumentChunk chunk;
        private final double score;

        ScoredChunk(DocumentChunk chunk, double score) {
            this.chunk = chunk;
            this.score = score;
        }

        DocumentChunk getChunk() {
            return chunk;
        }

        double getScore() {
            return score;
        }
    }
}
