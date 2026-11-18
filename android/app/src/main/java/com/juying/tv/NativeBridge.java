package com.juying.tv;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 暴露给 WebView 的原生能力。方法全部同步返回字符串，前端 bridge.ts 直接 JSON.parse。
 * WebView 会在独立的 JavaBridge 线程调用这些方法，因此网络请求不会卡住 UI。
 */
public final class NativeBridge {

    private static final String STORE_KEY = "app_data";
    private static final Object STORE_LOCK = new Object();

    private final MainActivity activity;
    private final LocalServer server;
    private final SharedPreferences prefs;

    NativeBridge(MainActivity activity, LocalServer server) {
        this.activity = activity;
        this.server = server;
        this.prefs = activity.getSharedPreferences("juying_store", 0);
    }

    @JavascriptInterface
    public String proxyInfo() {
        try {
            JSONObject out = new JSONObject();
            out.put("base", server.baseUrl());
            out.put("token", server.token());
            out.put("enabled", true);
            return out.toString();
        } catch (Exception e) {
            return "{\"base\":\"\",\"token\":\"\",\"enabled\":false}";
        }
    }

    @JavascriptInterface
    public String storeRead() {
        synchronized (STORE_LOCK) {
            String raw = prefs.getString(STORE_KEY, "{}");
            return raw == null || raw.trim().isEmpty() ? "{}" : raw;
        }
    }

    @JavascriptInterface
    public boolean storeWrite(String key, String value) {
        if (key == null || key.isEmpty() || value == null) {
            return false;
        }
        try {
            Object parsed = new JSONTokener(value).nextValue();
            synchronized (STORE_LOCK) {
                JSONObject root;
                try {
                    root = new JSONObject(prefs.getString(STORE_KEY, "{}"));
                } catch (Exception ignored) {
                    root = new JSONObject();
                }
                root.put(key, parsed);
                return prefs.edit().putString(STORE_KEY, root.toString()).commit();
            }
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public String netJson(String url, int timeoutMs, String headersJson) {
        long start = System.currentTimeMillis();
        try {
            HttpUtil.Response response = HttpUtil.get(url, timeoutMs, parseHeaders(headersJson));
            JSONObject out = new JSONObject();
            out.put("ok", response.ok);
            out.put("status", response.status);
            out.put("ms", response.ms);
            if (!response.ok) {
                out.put("error", response.error == null ? "HTTP " + response.status : response.error);
                return out.toString();
            }
            String text = HttpUtil.decode(response.body, response.contentType);
            try {
                out.put("data", new JSONTokener(text).nextValue());
            } catch (Exception e) {
                out.put("ok", false);
                out.put("error", "返回内容不是 JSON：" + snippet(text));
            }
            return out.toString();
        } catch (Exception e) {
            return errorJson(e, start, "网络请求失败");
        }
    }

    @JavascriptInterface
    public String netText(String url, int timeoutMs, String headersJson) {
        long start = System.currentTimeMillis();
        try {
            HttpUtil.Response response = HttpUtil.get(url, timeoutMs, parseHeaders(headersJson));
            JSONObject out = new JSONObject();
            out.put("ok", response.ok);
            out.put("status", response.status);
            out.put("ms", response.ms);
            String text = HttpUtil.decode(response.body, response.contentType);
            out.put("text", text);
            if (!response.ok) {
                out.put("error", response.error == null ? "HTTP " + response.status : response.error);
            }
            return out.toString();
        } catch (Exception e) {
            return errorJson(e, start, "网络请求失败");
        }
    }

    @JavascriptInterface
    public String sourceTest(String url) {
        long start = System.currentTimeMillis();
        JSONObject out = new JSONObject();
        try {
            if (url == null || !HttpUtil.isHttp(url.trim())) {
                out.put("ok", false);
                out.put("ms", 0);
                out.put("error", "无效的源地址（需以 http/https 开头）");
                return out.toString();
            }
            String base = url.trim();
            while (base.endsWith("/")) {
                base = base.substring(0, base.length() - 1);
            }
            HttpUtil.Response response = HttpUtil.get(base + "?ac=videolist&pg=1", 8000,
                    new LinkedHashMap<String, String>());
            out.put("ms", response.ms);
            if (!response.ok) {
                out.put("ok", false);
                out.put("error", response.error == null ? "请求失败" : response.error);
                return out.toString();
            }
            String text = HttpUtil.decode(response.body, response.contentType);
            JSONObject data = new JSONObject(text);
            JSONArray list = data.optJSONArray("list");
            if (list == null) {
                out.put("ok", false);
                out.put("error", "返回格式不是苹果CMS接口（缺少 list）");
                return out.toString();
            }
            out.put("ok", true);
            out.put("count", list.length());
            if (list.length() == 0) {
                out.put("error", "接口可用，但当前无数据");
            }
            return out.toString();
        } catch (Exception e) {
            try {
                out.put("ok", false);
                out.put("ms", System.currentTimeMillis() - start);
                out.put("error", e.getMessage() == null ? "探活失败" : e.getMessage());
            } catch (Exception ignored) {
                return "{\"ok\":false,\"ms\":0,\"error\":\"探活失败\"}";
            }
            return out.toString();
        }
    }

    @JavascriptInterface
    public String appInfo() {
        try {
            JSONObject out = new JSONObject();
            String version = "1.0.0";
            try {
                PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
                version = info.versionName == null ? version : info.versionName;
            } catch (Exception ignored) {
                // 使用默认版本号
            }
            String chrome = "-";
            try {
                String ua = WebSettings.getDefaultUserAgent(activity);
                int index = ua.indexOf("Chrome/");
                if (index >= 0) {
                    int end = ua.indexOf(' ', index);
                    chrome = end > index ? ua.substring(index + 7, end) : ua.substring(index + 7);
                }
            } catch (Exception ignored) {
                // 忽略
            }
            out.put("version", version);
            out.put("electron", "-");
            out.put("chrome", chrome);
            out.put("platform", "android");
            out.put("userData", activity.getFilesDir().getAbsolutePath());
            return out.toString();
        } catch (Exception e) {
            return "{\"version\":\"1.0.0\",\"electron\":\"-\",\"chrome\":\"-\",\"platform\":\"android\",\"userData\":\"-\"}";
        }
    }

    @JavascriptInterface
    public void openExternal(String url) {
        if (url == null) {
            return;
        }
        String lower = url.toLowerCase(Locale.ROOT);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception ignored) {
                // 没有可用的浏览器
            }
        });
    }

    @JavascriptInterface
    public void quit() {
        activity.runOnUiThread(() -> {
            try {
                activity.finishAffinity();
            } catch (Exception ignored) {
                activity.finish();
            }
        });
    }

    private static Map<String, String> parseHeaders(String json) {
        Map<String, String> headers = new LinkedHashMap<>();
        if (json == null || json.trim().isEmpty() || "{}".equals(json.trim())) {
            return headers;
        }
        try {
            JSONObject object = new JSONObject(json);
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = object.optString(key, "");
                if (!key.isEmpty()) {
                    headers.put(key, value);
                }
            }
        } catch (Exception ignored) {
            // 非法 headers 直接忽略
        }
        return headers;
    }

    private static String snippet(String text) {
        String cleaned = text == null ? "" : text.replaceAll("\\s+", " ").trim();
        return cleaned.length() > 100 ? cleaned.substring(0, 100) : cleaned;
    }

    private static String errorJson(Exception e, long start, String fallback) {
        try {
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("status", 0);
            out.put("ms", System.currentTimeMillis() - start);
            out.put("error", e.getMessage() == null ? fallback : e.getMessage());
            return out.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"status\":0,\"error\":\"" + fallback + "\"}";
        }
    }
}
