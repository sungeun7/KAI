package com.kai;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.kai.llm.OpenAiClientWrapper;
import com.kai.llm.OpenAiHttpClient;
import com.kai.service.RagService;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

/**
 * KAI REST API 서버. React 등 프론트엔드에서 호출.
 */
public class KaiServer {

    private static final int PORT = 8080;
    private static final Gson GSON = new Gson();

    public static void main(String[] args) throws IOException {
        Path baseDir = Paths.get(System.getProperty("user.dir"));
        Path documentsPath = baseDir.resolve("documents");

        OpenAiClientWrapper openAi = new OpenAiHttpClient();
        RagService rag = new RagService(documentsPath, openAi);

        boolean doIndex = "true".equals(System.getProperty("kai.index", "true"));
        if (doIndex) {
            try {
                rag.indexDocuments();
            } catch (OutOfMemoryError e) {
                System.out.println("(메모리 부족으로 인덱싱 생략)");
            }
        }
        System.out.println("KAI API 서버: 문서 인덱싱 " + rag.getIndexedChunkCount() + " 청크");

        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        server.createContext("/api/query", new CorsHandler(ex -> {
            if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
                sendJson(ex, 405, "{\"error\":\"Method Not Allowed\"}");
                return;
            }
            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            JsonObject req = GSON.fromJson(body, JsonObject.class);
            String question = req != null && req.has("question") ? req.get("question").getAsString() : "";
            if (question.isBlank()) {
                sendJson(ex, 400, "{\"error\":\"question required\"}");
                return;
            }
            String answer = rag.query(question.trim());
            JsonObject res = new JsonObject();
            res.addProperty("answer", answer);
            sendJson(ex, 200, GSON.toJson(res));
        }));

        server.createContext("/api/status", new CorsHandler(ex -> {
            JsonObject o = new JsonObject();
            o.addProperty("apiConfigured", openAi.isAvailable());
            o.addProperty("chunkCount", rag.getIndexedChunkCount());
            sendJson(ex, 200, GSON.toJson(o));
        }));

        server.setExecutor(null);
        server.start();
        System.out.println("KAI API: http://localhost:" + PORT);
        System.out.println("  POST /api/query  body: {\"question\":\"...\"}");
        System.out.println("  GET  /api/status");
    }

    private static void sendJson(HttpExchange ex, int code, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(code, bytes.length);
        try (OutputStream out = ex.getResponseBody()) {
            out.write(bytes);
        }
    }

    private static class CorsHandler implements HttpHandler {
        private final HttpHandler delegate;

        CorsHandler(HttpHandler delegate) {
            this.delegate = delegate;
        }

        @Override
        public void handle(HttpExchange ex) throws IOException {
            ex.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            ex.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            ex.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
            if ("OPTIONS".equalsIgnoreCase(ex.getRequestMethod())) {
                ex.sendResponseHeaders(204, -1);
                return;
            }
            delegate.handle(ex);
        }
    }
}
