package com.kai.llm;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * OpenAI REST API를 OkHttp로 호출하는 구현체.
 * OPENAI_API_KEY 환경변수가 설정되어 있으면 실제 API를 사용합니다.
 */
public class OpenAiHttpClient implements OpenAiClientWrapper {

    private static final String CHAT_URL = "https://api.openai.com/v1/chat/completions";
    private static final String EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
    private static final String CHAT_MODEL = "gpt-4o-mini";
    private static final String EMBEDDING_MODEL = "text-embedding-3-small";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final String apiKey;
    private final OkHttpClient http = new OkHttpClient.Builder().build();
    private final Gson gson = new GsonBuilder().create();

    public OpenAiHttpClient() {
        this.apiKey = System.getenv("OPENAI_API_KEY");
    }

    public OpenAiHttpClient(String apiKey) {
        this.apiKey = apiKey;
    }

    @Override
    public boolean isAvailable() {
        return apiKey != null && !apiKey.isBlank();
    }

    @Override
    public String chat(String systemPrompt, String userMessage) {
        if (!isAvailable()) {
            return "[OPENAI_API_KEY가 설정되지 않았습니다. 환경변수를 설정하거나 문서 기반 답변만 사용하세요.]";
        }
        JsonObject body = new JsonObject();
        body.addProperty("model", CHAT_MODEL);
        body.addProperty("max_tokens", 1024);
        JsonArray messages = new JsonArray();
        if (systemPrompt != null && !systemPrompt.isBlank()) {
            JsonObject sys = new JsonObject();
            sys.addProperty("role", "system");
            sys.addProperty("content", systemPrompt);
            messages.add(sys);
        }
        JsonObject user = new JsonObject();
        user.addProperty("role", "user");
        user.addProperty("content", userMessage);
        messages.add(user);
        body.add("messages", messages);

        Request request = new Request.Builder()
            .url(CHAT_URL)
            .addHeader("Authorization", "Bearer " + apiKey)
            .addHeader("Content-Type", "application/json")
            .post(RequestBody.create(body.toString(), JSON))
            .build();

        try (Response response = http.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                return "[API 오류: " + response.code() + "]";
            }
            JsonObject json = gson.fromJson(Objects.requireNonNull(response.body()).string(), JsonObject.class);
            JsonArray choices = json.getAsJsonArray("choices");
            if (choices == null || choices.isEmpty()) {
                return "";
            }
            return choices.get(0).getAsJsonObject()
                .getAsJsonObject("message")
                .get("content").getAsString();
        } catch (IOException e) {
            return "[연결 오류: " + e.getMessage() + "]";
        }
    }

    @Override
    public List<Double> createEmbedding(String text) {
        if (!isAvailable()) {
            return null;
        }
        JsonObject body = new JsonObject();
        body.addProperty("model", EMBEDDING_MODEL);
        body.addProperty("input", text);

        Request request = new Request.Builder()
            .url(EMBEDDINGS_URL)
            .addHeader("Authorization", "Bearer " + apiKey)
            .addHeader("Content-Type", "application/json")
            .post(RequestBody.create(body.toString(), JSON))
            .build();

        try (Response response = http.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                return null;
            }
            JsonObject json = gson.fromJson(Objects.requireNonNull(response.body()).string(), JsonObject.class);
            JsonArray data = json.getAsJsonArray("data");
            if (data == null || data.isEmpty()) {
                return null;
            }
            JsonArray embedding = data.get(0).getAsJsonObject().getAsJsonArray("embedding");
            List<Double> list = new ArrayList<>(embedding.size());
            for (int i = 0; i < embedding.size(); i++) {
                list.add(embedding.get(i).getAsDouble());
            }
            return list;
        } catch (IOException e) {
            return null;
        }
    }
}
