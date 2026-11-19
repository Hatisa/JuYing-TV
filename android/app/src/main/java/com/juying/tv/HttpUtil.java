package com.juying.tv;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * 轻量 HTTP 客户端：不依赖第三方库，支持 gzip、重定向、GBK 页面和超时。
 * 所有请求都在 WebView 的 JavaScript 桥接线程里同步执行，不会阻塞界面线程。
 */
final class HttpUtil {

    static final String DEFAULT_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/131.0.0.0 Mobile Safari/537.36";

    private static final int MAX_BODY = 32 * 1024 * 1024;
    private static final Pattern CHARSET = Pattern.compile("charset\\s*=\\s*[\"']?([^;\"']+)", Pattern.CASE_INSENSITIVE);

    private HttpUtil() {
    }

    static final class Response {
        final boolean ok;
        final int status;
        final byte[] body;
        final String contentType;
        final long ms;
        final String error;

        Response(boolean ok, int status, byte[] body, String contentType, long ms, String error) {
            this.ok = ok;
            this.status = status;
            this.body = body == null ? new byte[0] : body;
            this.contentType = contentType == null ? "" : contentType;
            this.ms = ms;
            this.error = error;
        }
    }

    static Response get(String url, int timeoutMs, Map<String, String> headers) {
        return request("GET", url, timeoutMs, headers, null);
    }

    /**
     * 通用请求；method 只接受 GET / POST，body 仅对 POST 生效。
     * AI 对话、Tavily、Serper 等接口都要求 POST JSON。
     */
    static Response request(String method, String url, int timeoutMs, Map<String, String> headers, String body) {
        long start = System.currentTimeMillis();
        int timeout = Math.max(2500, timeoutMs);
        String verb = "POST".equalsIgnoreCase(method) ? "POST" : "GET";
        byte[] payload = verb.equals("POST") && body != null ? body.getBytes(StandardCharsets.UTF_8) : null;
        HttpURLConnection conn = null;
        try {
            String current = url;
            for (int redirects = 0; redirects <= 5; redirects++) {
                if (!isHttp(current)) {
                    return new Response(false, 0, null, "", elapsed(start), "仅支持 http/https 地址");
                }
                conn = (HttpURLConnection) new URL(current).openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(Math.min(10000, timeout));
                conn.setReadTimeout(timeout);
                conn.setRequestMethod(verb);
                conn.setRequestProperty("Accept-Encoding", "gzip");
                if (payload != null) {
                    conn.setDoOutput(true);
                    conn.setFixedLengthStreamingMode(payload.length);
                    if (value(headers, "Content-Type") == null) {
                        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    }
                }
                applyHeaders(conn, headers, current);
                if (payload != null) {
                    java.io.OutputStream output = conn.getOutputStream();
                    try {
                        output.write(payload);
                    } finally {
                        output.close();
                    }
                }

                int status = conn.getResponseCode();
                if (status >= 300 && status < 400 && status != 304) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (location == null || location.trim().isEmpty()) {
                        return new Response(false, status, null, "", elapsed(start), "重定向缺少 Location");
                    }
                    current = new URL(new URL(current), location).toString();
                    // 307/308 保留 POST 与请求体，其余重定向按浏览器行为降级为 GET
                    if (status != 307 && status != 308) {
                        verb = "GET";
                        payload = null;
                    }
                    continue;
                }

                InputStream raw = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                byte[] responseBody = new byte[0];
                if (raw != null) {
                    InputStream stream = raw;
                    String encoding = conn.getHeaderField("Content-Encoding");
                    if (encoding != null && encoding.toLowerCase(Locale.ROOT).contains("gzip")) {
                        stream = new GZIPInputStream(raw);
                    }
                    try {
                        responseBody = readAll(stream);
                    } finally {
                        stream.close();
                    }
                }
                String type = conn.getContentType();
                boolean ok = status >= 200 && status < 300;
                return new Response(ok, status, responseBody, type, elapsed(start), ok ? null : "HTTP " + status);
            }
            return new Response(false, 0, null, "", elapsed(start), "重定向次数过多");
        } catch (java.net.SocketTimeoutException e) {
            return new Response(false, 0, null, "", elapsed(start), "请求超时");
        } catch (Exception e) {
            String message = e.getMessage();
            return new Response(false, 0, null, "", elapsed(start),
                    message == null || message.isEmpty() ? "网络请求失败" : message);
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    static String decode(byte[] body, String contentType) {
        String charset = null;
        if (contentType != null) {
            Matcher m = CHARSET.matcher(contentType);
            if (m.find()) {
                charset = m.group(1).trim();
            }
        }
        if (charset == null) {
            return new String(body, StandardCharsets.UTF_8).replace("\uFEFF", "");
        }
        String normalized = charset.toLowerCase(Locale.ROOT);
        try {
            if (normalized.startsWith("gb") || normalized.contains("gb2312") || normalized.contains("gbk")) {
                return new String(body, Charset.forName("GBK")).replace("\uFEFF", "");
            }
            return new String(body, Charset.forName(charset)).replace("\uFEFF", "");
        } catch (Exception ignored) {
            return new String(body, StandardCharsets.UTF_8).replace("\uFEFF", "");
        }
    }

    static String origin(String url) {
        try {
            URL u = new URL(url);
            int port = u.getPort();
            return u.getProtocol() + "://" + u.getHost() + (port > 0 ? ":" + port : "") + "/";
        } catch (Exception ignored) {
            return "";
        }
    }

    static boolean isHttp(String url) {
        if (url == null) {
            return false;
        }
        String lower = url.toLowerCase(Locale.ROOT);
        return lower.startsWith("http://") || lower.startsWith("https://");
    }

    private static void applyHeaders(HttpURLConnection conn, Map<String, String> headers, String url) {
        String ua = value(headers, "User-Agent");
        String accept = value(headers, "Accept");
        String language = value(headers, "Accept-Language");
        conn.setRequestProperty("User-Agent", ua == null ? DEFAULT_UA : ua);
        conn.setRequestProperty("Accept", accept == null ? "application/json, text/plain, */*" : accept);
        conn.setRequestProperty("Accept-Language", language == null ? "zh-CN,zh;q=0.9,en;q=0.8" : language);
        conn.setRequestProperty("Accept-Encoding", "gzip");
        if (headers != null) {
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                String key = entry.getKey();
                if (key == null || key.trim().isEmpty() || entry.getValue() == null) {
                    continue;
                }
                String lower = key.toLowerCase(Locale.ROOT);
                if (lower.equals("user-agent") || lower.equals("accept") || lower.equals("accept-language")
                        || lower.equals("accept-encoding") || lower.equals("host")
                        || lower.equals("content-length") || lower.equals("connection")) {
                    continue;
                }
                conn.setRequestProperty(key, entry.getValue());
            }
        }
        if (value(headers, "Referer") == null) {
            String origin = origin(url);
            if (!origin.isEmpty()) {
                conn.setRequestProperty("Referer", origin);
            }
        }
    }

    private static String value(Map<String, String> headers, String name) {
        if (headers == null) {
            return null;
        }
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(name)) {
                return entry.getValue();
            }
        }
        return null;
    }

    private static byte[] readAll(InputStream input) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(16 * 1024);
        byte[] buffer = new byte[16 * 1024];
        int total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > MAX_BODY) {
                throw new IOException("响应内容过大");
            }
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    private static long elapsed(long start) {
        return System.currentTimeMillis() - start;
    }
}
