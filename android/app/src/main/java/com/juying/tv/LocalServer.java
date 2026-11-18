package com.juying.tv;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.LruCache;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * 只监听 127.0.0.1 的本地服务：
 * - 静态资源：APK assets/www 里的 Vite 构建产物
 * - /hls：m3u8 自动重写；分片 / FLV 直接流式透传
 * - /bin：二进制透传（支持 Range）
 * - /img：封面代理 + 按宽度缩放 + 内存缓存
 * 除静态资源外都需要启动时生成的随机 token。
 */
final class LocalServer {

    private static final int MAX_IMAGE = 15 * 1024 * 1024;
    private static final String CORS = "Access-Control-Allow-Origin: *\r\n"
            + "Access-Control-Allow-Headers: Range, Content-Type, Accept, Origin\r\n"
            + "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n";

    private final Context context;
    private final LruCache<String, ImageEntry> imageCache = new LruCache<String, ImageEntry>(32 * 1024 * 1024) {
        @Override
        protected int sizeOf(String key, ImageEntry value) {
            return value.data.length;
        }
    };

    private ServerSocket serverSocket;
    private ExecutorService pool;
    private Thread acceptThread;
    private String token = "";
    private int port;

    LocalServer(Context context) {
        this.context = context.getApplicationContext();
    }

    int start() throws IOException {
        token = randomToken();
        serverSocket = new ServerSocket(0, 80, InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        pool = Executors.newFixedThreadPool(32, new ThreadFactory() {
            @Override
            public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, "juying-local-http");
                thread.setDaemon(true);
                return thread;
            }
        });
        acceptThread = new Thread(this::acceptLoop, "juying-local-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        return port;
    }

    String baseUrl() {
        return "http://127.0.0.1:" + port;
    }

    String token() {
        return token;
    }

    void stop() {
        try {
            if (serverSocket != null) {
                serverSocket.close();
            }
        } catch (IOException ignored) {
            // 关闭时忽略
        }
        if (pool != null) {
            pool.shutdownNow();
        }
        if (acceptThread != null) {
            acceptThread.interrupt();
        }
    }

    private void acceptLoop() {
        while (serverSocket != null && !serverSocket.isClosed()) {
            try {
                final Socket socket = serverSocket.accept();
                pool.execute(() -> handleClient(socket));
            } catch (IOException e) {
                if (serverSocket != null && serverSocket.isClosed()) {
                    return;
                }
            }
        }
    }

    private void handleClient(Socket socket) {
        OutputStream out = null;
        try {
            socket.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(socket.getInputStream());
            out = new BufferedOutputStream(socket.getOutputStream());

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.trim().isEmpty()) {
                return;
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                return;
            }
            String method = parts[0].toUpperCase(Locale.ROOT);
            String target = parts[1];

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT),
                            line.substring(colon + 1).trim());
                }
            }

            if (!"GET".equals(method) && !"HEAD".equals(method) && !"OPTIONS".equals(method)) {
                fail(out, 405, "Method Not Allowed", "GET".equals(method) || "HEAD".equals(method));
                return;
            }

            String rawPath = target;
            String rawQuery = null;
            int queryIndex = target.indexOf('?');
            if (queryIndex >= 0) {
                rawPath = target.substring(0, queryIndex);
                rawQuery = target.substring(queryIndex + 1);
            }
            if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
                try {
                    URL absolute = new URL(rawPath);
                    rawPath = absolute.getPath();
                    rawQuery = absolute.getQuery();
                } catch (Exception ignored) {
                    // 使用原始值
                }
            }

            if ("OPTIONS".equals(method)) {
                writeEmpty(out, 204, "No Content", "OPTIONS");
                return;
            }

            if ("/health".equals(rawPath)) {
                byte[] body = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
                writeBytes(out, 200, "OK", "application/json; charset=utf-8", body,
                        "no-store", "HEAD".equals(method));
                return;
            }

            boolean apiPath = rawPath.startsWith("/api/");
            boolean mediaPath = apiPath || "/hls".equals(rawPath) || "/bin".equals(rawPath) || "/img".equals(rawPath);
            if (!mediaPath) {
                serveAsset(out, rawPath, "HEAD".equals(method));
                return;
            }

            Map<String, String> query = parseQuery(rawQuery);
            if (!token.equals(query.get("t"))) {
                fail(out, 403, "Forbidden", "HEAD".equals(method));
                return;
            }
            String upstream = query.get("u");
            if (upstream == null || !HttpUtil.isHttp(upstream)) {
                fail(out, 400, "Invalid url", "HEAD".equals(method));
                return;
            }
            if (apiPath) {
                serveApi(out, rawPath, query, upstream, "HEAD".equals(method));
                return;
            }
            String referer = query.get("r");
            if (referer == null || referer.trim().isEmpty()) {
                referer = HttpUtil.origin(upstream);
            }

            if ("/img".equals(rawPath)) {
                serveImage(out, upstream, query.get("w"), referer, "HEAD".equals(method));
            } else {
                serveMedia(out, upstream, referer, "/hls".equals(rawPath), method,
                        headers.get("range"));
            }
        } catch (Exception ignored) {
            // 浏览器中断连接时很常见，直接结束
        } finally {
            try {
                if (out != null) {
                    out.flush();
                }
            } catch (IOException ignored) {
                // 忽略
            }
            try {
                socket.close();
            } catch (IOException ignored) {
                // 忽略
            }
        }
    }

    private void serveAsset(OutputStream out, String rawPath, boolean head) throws IOException {
        String relative;
        try {
            relative = URLDecoder.decode(rawPath, StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            relative = rawPath;
        }
        while (relative.startsWith("/")) {
            relative = relative.substring(1);
        }
        if (relative.isEmpty()) {
            relative = "index.html";
        }
        if (relative.endsWith("/")) {
            relative += "index.html";
        }
        if (relative.contains("..") || relative.contains("\\") || relative.indexOf('\0') >= 0) {
            fail(out, 403, "Forbidden", head);
            return;
        }
        String path = "www/" + relative;
        byte[] body;
        try {
            body = readAsset(path);
        } catch (IOException e) {
            if (!relative.contains(".")) {
                try {
                    body = readAsset("www/index.html");
                    writeBytes(out, 200, "OK", "text/html; charset=utf-8", body, "no-cache", head);
                    return;
                } catch (IOException ignored) {
                    // 继续返回 404
                }
            }
            fail(out, 404, "Not Found", head);
            return;
        }
        String type = contentType(relative);
        String cache = relative.startsWith("assets/") ? "public, max-age=31536000, immutable"
                : (relative.endsWith("index.html") ? "no-cache" : "public, max-age=86400");
        writeBytes(out, 200, "OK", type, body, cache, head);
    }

    private byte[] readAsset(String path) throws IOException {
        try (InputStream stream = context.getAssets().open(path)) {
            return readAll(stream, 48 * 1024 * 1024);
        }
    }

    private void serveApi(OutputStream out, String path, Map<String, String> query, String upstream,
                          boolean head) throws IOException {
        int timeout = 15000;
        try {
            timeout = Integer.parseInt(query.getOrDefault("timeout", "15000"));
        } catch (Exception ignored) {
            timeout = 15000;
        }
        timeout = Math.max(1000, Math.min(30000, timeout));
        long start = System.currentTimeMillis();
        JSONObject result = new JSONObject();
        try {
            if ("/api/test".equals(path)) {
                serveApiTest(out, upstream, timeout, head);
                return;
            }
            if (!"/api/json".equals(path) && !"/api/text".equals(path)) {
                fail(out, 404, "Unknown api", head);
                return;
            }
            Map<String, String> reqHeaders = parseHeaderJson(query.get("h"));
            HttpUtil.Response response = HttpUtil.get(upstream, timeout, reqHeaders);
            result.put("ok", response.ok);
            result.put("status", response.status);
            result.put("ms", response.ms);
            if (!response.ok) {
                result.put("error", response.error == null ? "HTTP " + response.status : response.error);
            } else {
                String text = HttpUtil.decode(response.body, response.contentType);
                if ("/api/text".equals(path)) {
                    result.put("text", text);
                } else {
                    try {
                        result.put("data", new JSONTokener(text).nextValue());
                    } catch (Exception e) {
                        result.put("ok", false);
                        result.put("error", "返回内容不是 JSON");
                    }
                }
            }
        } catch (Exception e) {
            result = new JSONObject();
            try {
                result.put("ok", false);
                result.put("status", 0);
                result.put("ms", System.currentTimeMillis() - start);
                result.put("error", e.getMessage() == null ? "网络请求失败" : e.getMessage());
            } catch (Exception ignored) {
                // 兜底
            }
        }
        byte[] body = result.toString().getBytes(StandardCharsets.UTF_8);
        writeBytes(out, 200, "OK", "application/json; charset=utf-8", body, "no-store", head);
    }

    private void serveApiTest(OutputStream out, String sourceUrl, int timeout, boolean head) throws IOException {
        long start = System.currentTimeMillis();
        JSONObject result = new JSONObject();
        try {
            String base = sourceUrl.trim();
            while (base.endsWith("/")) {
                base = base.substring(0, base.length() - 1);
            }
            HttpUtil.Response response = HttpUtil.get(base + "?ac=videolist&pg=1", timeout,
                    new LinkedHashMap<String, String>());
            result.put("ok", response.ok);
            result.put("status", response.status);
            result.put("ms", response.ms);
            if (!response.ok) {
                result.put("error", response.error == null ? "请求失败" : response.error);
            } else {
                String text = HttpUtil.decode(response.body, response.contentType);
                JSONObject data = new JSONObject(text);
                JSONArray list = data.optJSONArray("list");
                if (list == null) {
                    result.put("ok", false);
                    result.put("error", "返回格式不是苹果CMS接口（缺少 list）");
                } else {
                    result.put("count", list.length());
                    if (list.length() == 0) {
                        result.put("error", "接口可用，但当前无数据");
                    }
                }
            }
        } catch (Exception e) {
            result = new JSONObject();
            try {
                result.put("ok", false);
                result.put("status", 0);
                result.put("ms", System.currentTimeMillis() - start);
                result.put("error", e.getMessage() == null ? "探活失败" : e.getMessage());
            } catch (Exception ignored) {
                // 兜底
            }
        }
        byte[] body = result.toString().getBytes(StandardCharsets.UTF_8);
        writeBytes(out, 200, "OK", "application/json; charset=utf-8", body, "no-store", head);
    }

    private static Map<String, String> parseHeaderJson(String raw) {
        Map<String, String> headers = new LinkedHashMap<>();
        if (raw == null || raw.trim().isEmpty()) {
            return headers;
        }
        try {
            JSONObject object = new JSONObject(raw);
            java.util.Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (!key.isEmpty()) {
                    headers.put(key, object.optString(key, ""));
                }
            }
        } catch (Exception ignored) {
            // 非法 headers 忽略
        }
        return headers;
    }

    private void serveImage(OutputStream out, String upstream, String widthValue, String referer,
                            boolean head) throws IOException {
        int width = 0;
        try {
            width = Integer.parseInt(widthValue == null ? "0" : widthValue);
        } catch (Exception ignored) {
            width = 0;
        }
        width = Math.max(0, Math.min(1600, width));
        String key = upstream + "|" + width;
        ImageEntry cached = imageCache.get(key);
        if (cached != null) {
            writeBytes(out, 200, "OK", cached.type, cached.data, "public, max-age=86400", head, "hit");
            return;
        }

        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
        headers.put("Referer", referer);
        HttpUtil.Response response = HttpUtil.get(upstream, 15000, headers);
        if (!response.ok) {
            fail(out, 502, "Upstream HTTP " + response.status, head);
            return;
        }
        if (response.body.length == 0) {
            fail(out, 502, "Empty image", head);
            return;
        }
        if (response.body.length > MAX_IMAGE) {
            fail(out, 502, "Image too large", head);
            return;
        }

        ImageEntry image = resizeImage(response.body, response.contentType, width);
        imageCache.put(key, image);
        writeBytes(out, 200, "OK", image.type, image.data, "public, max-age=86400", head, "miss");
    }

    private ImageEntry resizeImage(byte[] raw, String contentType, int width) {
        String type = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
        if (width <= 0 || type.contains("gif")) {
            return new ImageEntry(raw, sniffImage(raw));
        }
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outWidth <= width) {
                return new ImageEntry(raw, sniffImage(raw));
            }
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= width) {
                sample *= 2;
            }
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            options.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap bitmap = BitmapFactory.decodeByteArray(raw, 0, raw.length, options);
            if (bitmap == null) {
                return new ImageEntry(raw, sniffImage(raw));
            }
            int targetHeight = Math.max(1, Math.round(bitmap.getHeight() * (width / (float) bitmap.getWidth())));
            Bitmap scaled = Bitmap.createScaledBitmap(bitmap, width, targetHeight, true);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 82, output);
            if (scaled != bitmap) {
                scaled.recycle();
            }
            bitmap.recycle();
            byte[] data = output.toByteArray();
            return data.length == 0 ? new ImageEntry(raw, sniffImage(raw))
                    : new ImageEntry(data, "image/jpeg");
        } catch (Exception e) {
            return new ImageEntry(raw, sniffImage(raw));
        }
    }

    private void serveMedia(OutputStream out, String target, String referer, boolean isHls,
                            String method, String range) throws IOException {
        Upstream upstream = openUpstream(target, referer, range, "HEAD".equals(method));
        if (upstream == null) {
            fail(out, 502, "Upstream error", "HEAD".equals(method));
            return;
        }
        try {
            if (upstream.status >= 400) {
                fail(out, upstream.status == 403 ? 403 : 502,
                        "Upstream HTTP " + upstream.status, "HEAD".equals(method));
                return;
            }
            String type = upstream.contentType == null ? "" : upstream.contentType;
            boolean audioVideo = type.toLowerCase(Locale.ROOT).startsWith("video/")
                    || type.toLowerCase(Locale.ROOT).startsWith("audio/");
            if (isHls && upstream.status != 206 && !audioVideo
                    && M3u8Rewriter.isPlaylist(upstream.finalUrl, type)) {
                InputStream input = upstream.connection.getInputStream();
                byte[] raw = readAll(input, 4 * 1024 * 1024);
                input.close();
                String text = new String(raw, StandardCharsets.UTF_8);
                final String base = baseUrl();
                final String proxyToken = token;
                final String proxyReferer = referer;
                String rewritten = M3u8Rewriter.rewrite(text, upstream.finalUrl, absolute ->
                        base + "/hls?t=" + proxyToken + "&u=" + enc(absolute) + "&r=" + enc(proxyReferer));
                byte[] body = rewritten.getBytes(StandardCharsets.UTF_8);
                writeBytes(out, 200, "OK", "application/vnd.apple.mpegurl; charset=utf-8", body,
                        "no-cache", "HEAD".equals(method));
                return;
            }
            streamUpstream(out, upstream, method);
        } finally {
            upstream.connection.disconnect();
        }
    }

    private Upstream openUpstream(String target, String referer, String range, boolean head) {
        String current = target;
        for (int redirects = 0; redirects <= 5; redirects++) {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(current).openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(20000);
                conn.setRequestMethod(head ? "HEAD" : "GET");
                conn.setRequestProperty("User-Agent", HttpUtil.DEFAULT_UA);
                conn.setRequestProperty("Accept", "*/*");
                conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
                conn.setRequestProperty("Accept-Encoding", "identity");
                conn.setRequestProperty("Referer", referer);
                if (range != null && !range.isEmpty()) {
                    conn.setRequestProperty("Range", range);
                }
                int status = conn.getResponseCode();
                if (status >= 300 && status < 400 && status != 304) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (location == null || location.trim().isEmpty()) {
                        return null;
                    }
                    current = new URL(new URL(current), location).toString();
                    continue;
                }
                return new Upstream(conn, status, conn.getContentType(), conn.getHeaderField("Content-Range"),
                        conn.getHeaderField("Accept-Ranges"), current);
            } catch (Exception e) {
                if (conn != null) {
                    conn.disconnect();
                }
                return null;
            }
        }
        return null;
    }

    private void streamUpstream(OutputStream out, Upstream upstream, String method) throws IOException {
        String reason = upstream.status == 206 ? "Partial Content" : "OK";
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(upstream.status).append(' ').append(reason).append("\r\n");
        head.append("Content-Type: ")
                .append(upstream.contentType == null || upstream.contentType.isEmpty()
                        ? "application/octet-stream" : upstream.contentType)
                .append("\r\n");
        if (upstream.contentRange != null) {
            head.append("Content-Range: ").append(upstream.contentRange).append("\r\n");
        }
        if (upstream.acceptRanges != null) {
            head.append("Accept-Ranges: ").append(upstream.acceptRanges).append("\r\n");
        } else {
            head.append("Accept-Ranges: bytes\r\n");
        }
        head.append("Cache-Control: no-cache\r\n");
        head.append(CORS);
        head.append("Transfer-Encoding: chunked\r\n");
        head.append("Connection: close\r\n\r\n");
        out.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
        if ("HEAD".equals(method)) {
            out.flush();
            return;
        }

        InputStream input = upstream.connection.getInputStream();
        byte[] buffer = new byte[16 * 1024];
        try {
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (read == 0) {
                    continue;
                }
                out.write(Integer.toHexString(read).getBytes(StandardCharsets.US_ASCII));
                out.write("\r\n".getBytes(StandardCharsets.US_ASCII));
                out.write(buffer, 0, read);
                out.write("\r\n".getBytes(StandardCharsets.US_ASCII));
                out.flush();
            }
            out.write("0\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
            out.flush();
        } finally {
            input.close();
        }
    }

    private void writeBytes(OutputStream out, int status, String reason, String type, byte[] body,
                            String cacheControl, boolean head) throws IOException {
        writeBytes(out, status, reason, type, body, cacheControl, head, null);
    }

    private void writeBytes(OutputStream out, int status, String reason, String type, byte[] body,
                            String cacheControl, boolean head, String cacheHit) throws IOException {
        StringBuilder headText = new StringBuilder();
        headText.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
        headText.append("Content-Type: ").append(type).append("\r\n");
        headText.append("Content-Length: ").append(body.length).append("\r\n");
        headText.append("Cache-Control: ").append(cacheControl).append("\r\n");
        headText.append(CORS);
        if (cacheHit != null) {
            headText.append("X-Img-Cache: ").append(cacheHit).append("\r\n");
        }
        headText.append("Connection: close\r\n\r\n");
        out.write(headText.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (!head) {
            out.write(body);
        }
        out.flush();
    }

    private void writeEmpty(OutputStream out, int status, String reason, String method) throws IOException {
        String headText = "HTTP/1.1 " + status + " " + reason + "\r\n" + CORS
                + "Content-Length: 0\r\nConnection: close\r\n\r\n";
        out.write(headText.getBytes(StandardCharsets.ISO_8859_1));
        out.flush();
    }

    private void fail(OutputStream out, int status, String message, boolean head) throws IOException {
        byte[] body = message.getBytes(StandardCharsets.UTF_8);
        String reason = status == 400 ? "Bad Request" : status == 403 ? "Forbidden"
                : status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : "Bad Gateway";
        writeBytes(out, status, reason, "text/plain; charset=utf-8", body, "no-store", head);
    }

    private static Map<String, String> parseQuery(String rawQuery) {
        Map<String, String> result = new LinkedHashMap<>();
        if (rawQuery == null || rawQuery.isEmpty()) {
            return result;
        }
        for (String pair : rawQuery.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int equals = pair.indexOf('=');
            String key = equals >= 0 ? pair.substring(0, equals) : pair;
            String value = equals >= 0 ? pair.substring(equals + 1) : "";
            result.put(urlDecode(key), urlDecode(value));
        }
        return result;
    }

    private static String urlDecode(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            return value;
        }
    }

    private static String enc(String value) {
        try {
            return URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20");
        } catch (Exception ignored) {
            return value;
        }
    }

    private static String readLine(InputStream input) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(128);
        int read;
        boolean any = false;
        while ((read = input.read()) != -1) {
            any = true;
            if (read == '\n') {
                break;
            }
            if (read != '\r') {
                buffer.write(read);
            }
            if (buffer.size() > 8192) {
                break;
            }
        }
        if (!any && buffer.size() == 0) {
            return null;
        }
        return new String(buffer.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static byte[] readAll(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(16 * 1024);
        byte[] buffer = new byte[16 * 1024];
        int total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > limit) {
                throw new IOException("内容过大");
            }
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private static String sniffImage(byte[] data) {
        if (data.length > 3 && (data[0] & 0xFF) == 0xFF && (data[1] & 0xFF) == 0xD8) {
            return "image/jpeg";
        }
        if (data.length > 8 && (data[0] & 0xFF) == 0x89 && data[1] == 'P') {
            return "image/png";
        }
        if (data.length > 6 && data[0] == 'G' && data[1] == 'I' && data[2] == 'F') {
            return "image/gif";
        }
        if (data.length > 12 && data[0] == 'R' && data[1] == 'I' && data[8] == 'W' && data[9] == 'E') {
            return "image/webp";
        }
        return "application/octet-stream";
    }

    private static String contentType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) {
            return "text/html; charset=utf-8";
        }
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
            return "application/javascript; charset=utf-8";
        }
        if (lower.endsWith(".css")) {
            return "text/css; charset=utf-8";
        }
        if (lower.endsWith(".json")) {
            return "application/json; charset=utf-8";
        }
        if (lower.endsWith(".svg")) {
            return "image/svg+xml";
        }
        if (lower.endsWith(".png")) {
            return "image/png";
        }
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (lower.endsWith(".webp")) {
            return "image/webp";
        }
        if (lower.endsWith(".ico")) {
            return "image/x-icon";
        }
        if (lower.endsWith(".woff2")) {
            return "font/woff2";
        }
        if (lower.endsWith(".woff")) {
            return "font/woff";
        }
        if (lower.endsWith(".ttf")) {
            return "font/ttf";
        }
        return "application/octet-stream";
    }

    private static String randomToken() {
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            out.append(String.format(Locale.ROOT, "%02x", value & 0xFF));
        }
        return out.toString();
    }

    private static final class ImageEntry {
        final byte[] data;
        final String type;

        ImageEntry(byte[] data, String type) {
            this.data = data;
            this.type = type;
        }
    }

    private static final class Upstream {
        final HttpURLConnection connection;
        final int status;
        final String contentType;
        final String contentRange;
        final String acceptRanges;
        final String finalUrl;

        Upstream(HttpURLConnection connection, int status, String contentType, String contentRange,
                 String acceptRanges, String finalUrl) {
            this.connection = connection;
            this.status = status;
            this.contentType = contentType;
            this.contentRange = contentRange;
            this.acceptRanges = acceptRanges;
            this.finalUrl = finalUrl;
        }
    }
}
