package com.kai.service;

import com.kai.llm.OpenAiClientWrapper;
import com.kai.model.DocumentChunk;
import com.kai.rag.DocumentLoader;
import com.kai.rag.EmbeddingService;
import com.kai.rag.TextChunker;
import com.kai.rag.VectorStore;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;

/**
 * RAG(Retrieval-Augmented Generation) 파이프라인:
 * 문서 로드 → 청킹 → 임베딩 → 벡터 저장 → 질의 시 유사 청크 검색 → LLM에 컨텍스트와 함께 질의.
 */
public class RagService {

    private final DocumentLoader documentLoader;
    private final TextChunker chunker;
    private final EmbeddingService embeddingService;
    private final VectorStore vectorStore;
    private final OpenAiClientWrapper llm;

    private static final int TOP_K = 5;
    private static final String SYSTEM_TEMPLATE =
        "당신은 주어진 참고 문서를 바탕으로 질문에 답하는 도우미입니다. "
        + "아래 [참고 문서] 내용만을 근거로 답변하고, 문서에 없는 내용은 추측하지 마세요. "
        + "문서에 정보가 없으면 '제공된 문서에서 해당 정보를 찾을 수 없습니다.'라고 답하세요.\n\n[참고 문서]\n%s";

    public RagService(Path documentsPath, OpenAiClientWrapper llm) {
        this.documentLoader = new DocumentLoader(documentsPath);
        this.chunker = new TextChunker(500, 50);
        this.embeddingService = new EmbeddingService(llm);
        this.vectorStore = new VectorStore();
        this.llm = llm;
    }

    /**
     * documents 디렉토리의 파일을 로드하고 벡터 스토어에 인덱싱합니다.
     */
    private static final int MAX_DOCS = 20;
    private static final int MAX_CHUNKS_PER_DOC = 5;

    public void indexDocuments() throws IOException {
        List<DocumentLoader.LoadedDocument> docs = documentLoader.loadAll();
        int docCount = 0;
        for (DocumentLoader.LoadedDocument doc : docs) {
            if (docCount >= MAX_DOCS) break;
            List<String> chunks = chunker.chunk(doc.getContent());
            int limit = Math.min(chunks.size(), MAX_CHUNKS_PER_DOC);
            for (int i = 0; i < limit; i++) {
                List<DocumentChunk> one = embeddingService.embedChunks(
                    List.of(chunks.get(i)), doc.getSource());
                vectorStore.addAll(one);
            }
            docCount++;
        }
    }

    /**
     * 질의에 대해 RAG 기반 답변을 생성합니다.
     */
    public String query(String userQuestion) {
        List<Double> queryEmbedding = embeddingService.embed(userQuestion);
        List<DocumentChunk> relevant = vectorStore.search(queryEmbedding, TOP_K);

        String context = relevant.stream()
            .map(DocumentChunk::getText)
            .collect(Collectors.joining("\n\n---\n\n"));

        String systemPrompt = context.isBlank()
            ? "참고 문서가 없습니다. 사용자에게 문서를 추가한 뒤 다시 질문하라고 안내하세요."
            : String.format(SYSTEM_TEMPLATE, context);

        return llm.chat(systemPrompt, userQuestion);
    }

    public int getIndexedChunkCount() {
        return vectorStore.size();
    }
}
