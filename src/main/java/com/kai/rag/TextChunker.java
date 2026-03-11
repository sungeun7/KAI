package com.kai.rag;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 텍스트를 고정 크기/오버랩 기반 청크로 분할합니다.
 * 고정 크기 char[] 버퍼만 사용해 메모리 사용을 최소화합니다.
 */
public class TextChunker {

    private static final Pattern SENTENCE_BOUNDARY = Pattern.compile("(?<=[.!?\\n])\\s+");
    private static final int MAX_CHARS = 2_000; // 극소 힙 대응
    private static final int MIN_CHUNK_LEN = 15;

    private final int chunkSize;
    private final int chunkOverlap;

    public TextChunker(int chunkSize, int chunkOverlap) {
        this.chunkSize = Math.max(200, chunkSize);
        this.chunkOverlap = Math.max(0, Math.min(chunkOverlap, chunkSize / 2));
    }

    public TextChunker() {
        this(500, 50);
    }

    public List<String> chunk(String text) {
        if (text == null || text.isBlank()) return List.of();

        int take = Math.min(text.length(), MAX_CHARS);
        char[] buf = new char[take];
        int len = 0;
        boolean needSpace = false;
        for (int i = 0; i < take; i++) {
            char c = text.charAt(i);
            if (Character.isWhitespace(c)) {
                needSpace = (len > 0);
            } else {
                if (needSpace && len > 0) {
                    buf[len++] = ' ';
                }
                buf[len++] = c;
                needSpace = false;
            }
        }
        while (len > 0 && buf[len - 1] == ' ') len--;

        List<String> chunks = new ArrayList<>(4);
        int start = 0;
        int maxChunks = 5;
        while (start < len && chunks.size() < maxChunks) {
            int end = Math.min(start + chunkSize, len);
            if (end - start >= MIN_CHUNK_LEN) {
                chunks.add(new String(buf, start, end - start));
            }
            start = chunkOverlap > 0 ? end - chunkOverlap : end;
        }
        return chunks;
    }

    public List<String> chunkBySentences(String text) {
        if (text == null || text.isBlank()) return List.of();
        int take = Math.min(text.length(), MAX_CHARS);
        StringBuilder limited = new StringBuilder(take);
        for (int i = 0; i < take; i++) limited.append(text.charAt(i));
        String normalized = limited.toString().replaceAll("\\s+", " ").trim();
        String[] sentences = SENTENCE_BOUNDARY.split(normalized);
        List<String> chunks = new ArrayList<>();
        StringBuilder current = new StringBuilder(600);
        for (String s : sentences) {
            if (current.length() + s.length() > chunkSize && current.length() > 0) {
                chunks.add(current.toString().trim());
                String overlap = current.length() > chunkOverlap
                    ? current.substring(current.length() - chunkOverlap) : "";
                current.setLength(0);
                current.append(overlap);
            }
            if (current.length() > 0) current.append(' ');
            current.append(s);
        }
        if (current.length() > 0) chunks.add(current.toString().trim());
        return chunks;
    }
}
