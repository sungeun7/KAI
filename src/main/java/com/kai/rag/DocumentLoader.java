package com.kai.rag;

import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

/**
 * documents 디렉토리에서 텍스트 파일을 로드합니다.
 * 대용량 파일은 잘라서 로드해 메모리 부족을 방지합니다.
 */
public class DocumentLoader {

    private static final int MAX_FILE_CHARS = 2_000; // 극소 힙 대응

    private final Path documentsPath;

    public DocumentLoader(Path documentsPath) {
        this.documentsPath = documentsPath;
    }

    public List<LoadedDocument> loadAll() throws IOException {
        List<LoadedDocument> result = new ArrayList<>();
        if (!Files.isDirectory(documentsPath)) {
            return result;
        }
        try (Stream<Path> walk = Files.walk(documentsPath, 2)) {
            walk.filter(Files::isRegularFile)
                .filter(p -> isTextFile(p))
                .forEach(p -> {
                    try {
                        String content = readLimited(p, MAX_FILE_CHARS);
                        result.add(new LoadedDocument(p.getFileName().toString(), content));
                    } catch (IOException e) {
                        throw new RuntimeException("파일 읽기 실패: " + p, e);
                    }
                });
        }
        return result;
    }

    private static String readLimited(Path p, int maxChars) throws IOException {
        try (var reader = new InputStreamReader(Files.newInputStream(p), StandardCharsets.UTF_8)) {
            var sb = new StringBuilder(Math.min(maxChars, 8192));
            char[] buf = new char[8192];
            int total = 0;
            int n;
            while (total < maxChars && (n = reader.read(buf)) != -1) {
                int toAdd = Math.min(n, maxChars - total);
                sb.append(buf, 0, toAdd);
                total += toAdd;
            }
            return sb.toString();
        }
    }

    private static boolean isTextFile(Path p) {
        String name = p.getFileName().toString().toLowerCase();
        return name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".json")
            || name.endsWith(".csv");
    }

    public static class LoadedDocument {
        private final String source;
        private final String content;

        public LoadedDocument(String source, String content) {
            this.source = source;
            this.content = content;
        }

        public String getSource() {
            return source;
        }

        public String getContent() {
            return content;
        }
    }
}
