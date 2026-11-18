package com.juying.tv;

import java.net.URL;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 把 m3u8 中的子播放列表、分片、密钥、init 段全部重写为本地代理地址。 */
final class M3u8Rewriter {

    private static final Pattern URI_ATTR = Pattern.compile("URI=([\"'])(.*?)\\1");

    private M3u8Rewriter() {
    }

    static boolean isPlaylist(String url, String contentType) {
        String type = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
        if (type.contains("mpegurl")) {
            return true;
        }
        try {
            String path = new URL(url).getPath().toLowerCase(Locale.ROOT);
            return path.endsWith(".m3u8") || path.endsWith(".m3u");
        } catch (Exception ignored) {
            String lower = url == null ? "" : url.toLowerCase(Locale.ROOT);
            return lower.contains(".m3u8") || lower.contains(".m3u");
        }
    }

    static String rewrite(String text, String baseUrl, ProxyBuilder builder) {
        if (text == null) {
            return "";
        }
        String[] lines = text.split("\n", -1);
        StringBuilder out = new StringBuilder(text.length() + 256);
        for (int i = 0; i < lines.length; i++) {
            if (i > 0) {
                out.append('\n');
            }
            String line = lines[i];
            if (line.endsWith("\r")) {
                line = line.substring(0, line.length() - 1);
            }
            String trimmed = line.trim();
            if (trimmed.isEmpty()) {
                out.append(line);
                continue;
            }
            if (trimmed.startsWith("#")) {
                out.append(rewriteAttributes(line, baseUrl, builder));
            } else {
                out.append(builder.build(resolve(trimmed, baseUrl)));
            }
        }
        return out.toString();
    }

    private static String rewriteAttributes(String line, String baseUrl, ProxyBuilder builder) {
        Matcher matcher = URI_ATTR.matcher(line);
        if (!matcher.find()) {
            return line;
        }
        StringBuffer out = new StringBuffer(line.length() + 128);
        do {
            String uri = matcher.group(2);
            if (uri == null || uri.isEmpty() || uri.startsWith("data:") || uri.startsWith("skd:")) {
                continue;
            }
            String quote = matcher.group(1);
            String replacement = "URI=" + quote + builder.build(resolve(uri, baseUrl)) + quote;
            matcher.appendReplacement(out, Matcher.quoteReplacement(replacement));
        } while (matcher.find());
        matcher.appendTail(out);
        return out.toString();
    }

    static String resolve(String uri, String baseUrl) {
        try {
            return new URL(new URL(baseUrl), uri).toString();
        } catch (Exception ignored) {
            return uri;
        }
    }

    interface ProxyBuilder {
        String build(String absoluteUrl);
    }
}
