package com.comik.reader;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.webkit.WebViewAssetLoader;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.core.content.ContextCompat;

import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import org.json.JSONObject;
import org.json.JSONArray;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import android.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final int FILE_PICKER_REQUEST = 41;
    private static final int MAX_HTML_BYTES = 12 * 1024 * 1024;
    private static final int MAX_IMAGE_BYTES = 40 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private static final String UPDATE_PREFS = "comik.webUpdates";

    private WebView webView;
    private String userAgent;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ValueCallback<Uri[]> fileChooserCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        rollbackUnconfirmedUpdate();
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new GoogleAuthBridge(), "ComikAndroidAuth");
        webView.addJavascriptInterface(new UpdateBridge(), "ComikAndroidUpdates");
        // The window draws edge to edge, so the status and navigation bars sit on top of whatever is
        // underneath. WebView ignores its own padding for page content, which let the page's top bar
        // slide under the status bar. Pad a parent instead and the page starts below the bars.
        // The keyboard is included so inputs stay visible.
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(0xFF111713);
        ViewCompat.setOnApplyWindowInsetsListener(container, (view, insets) -> {
            // Cutouts (notches and punch holes) are not part of the system bars on every device, so ask for both.
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            // The status bar is always drawn in this layout. If a device reports less than its real height,
            // fall back to the platform's own value so the page never starts underneath it.
            int top = Math.max(bars.top, statusBarHeight());
            view.setPadding(bars.left, top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        userAgent = webView.getSettings().getUserAgentString();
        webView.setWebViewClient(new AppWebViewClient(assetLoader));
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_PICKER_REQUEST);
                    return true;
                } catch (Exception error) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }

            @Override
            public void onReceivedTitle(WebView view, String title) {
                setTitle(title == null || title.isEmpty() ? "Comik" : title);
            }
        });
        container.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(container);

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl("https://" + APP_HOST + "/web/index.html");
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_PICKER_REQUEST && fileChooserCallback != null) {
            Uri[] result = resultCode == RESULT_OK && data != null && data.getData() != null
                    ? new Uri[]{data.getData()} : null;
            fileChooserCallback.onReceiveValue(result);
            fileChooserCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    private final class AppWebViewClient extends WebViewClient {
        private final WebViewAssetLoader assetLoader;

        private AppWebViewClient(WebViewAssetLoader assetLoader) {
            this.assetLoader = assetLoader;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!APP_HOST.equals(uri.getHost())) return null;

            if ("/api/health".equals(uri.getPath())) {
                return textResponse("application/json", 200, "OK", "{\"ok\":true,\"name\":\"comik-android\"}");
            }
            if ("/api/fetch".equals(uri.getPath())) return fetchSource(request, uri);
            if ("/api/img".equals(uri.getPath())) return fetchImage(uri);
            WebResourceResponse updated = updatedAsset(uri.getPath());
            if (updated != null) return updated;
            return assetLoader.shouldInterceptRequest(uri);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (APP_HOST.equals(uri.getHost())) return false;
            String scheme = uri.getScheme();
            if ("http".equals(scheme) || "https".equals(scheme)) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // No browser is available to handle this link.
                }
            }
            return true;
        }
    }

    private final class GoogleAuthBridge {
        @JavascriptInterface
        public void requestGoogleIdToken(String requestId, String serverClientId) {
            mainHandler.post(() -> startGoogleIdTokenRequest(requestId, serverClientId));
        }
    }

    private final class UpdateBridge {
        private String stagingVersion;
        private final Map<String, UpdateFile> expected = new ConcurrentHashMap<>();

        @JavascriptInterface
        public String getActiveVersion() {
            return getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE).getString("active", "");
        }

        @JavascriptInterface
        public synchronized boolean beginUpdate(String manifestJson) {
            try {
                JSONObject manifest = new JSONObject(manifestJson);
                String version = manifest.getString("version");
                JSONArray files = manifest.getJSONArray("files");
                if (manifest.getInt("schema") != 1 || !validVersion(version) || files.length() < 1 || files.length() > 5000) return false;
                Map<String, UpdateFile> nextExpected = new HashMap<>();
                boolean hasIndex = false;
                long totalBytes = 0;
                for (int index = 0; index < files.length(); index++) {
                    JSONObject item = files.getJSONObject(index);
                    String path = item.getString("path");
                    String hash = item.getString("sha256").toLowerCase();
                    int size = item.getInt("size");
                    if (!safeUpdatePath(path) || !hash.matches("[a-f0-9]{64}") || size < 0 || size > 24 * 1024 * 1024 || nextExpected.containsKey(path)) return false;
                    totalBytes += size;
                    if (totalBytes > 160L * 1024 * 1024) return false;
                    nextExpected.put(path, new UpdateFile(size, hash));
                    if ("web/index.html".equals(path)) hasIndex = true;
                }
                if (!hasIndex) return false;
                File staging = new File(updateRoot(), version + ".staging");
                deleteTree(staging);
                if (!staging.mkdirs()) return false;
                String active = getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE).getString("active", "");
                if (!active.isEmpty() && validVersion(active)) {
                    File activeRoot = new File(updateRoot(), active);
                    if (activeRoot.isDirectory()) copyTree(activeRoot, staging);
                }
                expected.clear();
                expected.putAll(nextExpected);
                stagingVersion = version;
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean writeUpdateFile(String version, String path, String contentBase64, String sha256) {
            try {
                if (!version.equals(stagingVersion) || !safeUpdatePath(path)) return false;
                UpdateFile item = expected.get(path);
                if (item == null || !item.sha256.equalsIgnoreCase(sha256)) return false;
                byte[] bytes = Base64.decode(contentBase64, Base64.DEFAULT);
                if (bytes.length != item.size || !item.sha256.equalsIgnoreCase(sha256(bytes))) return false;
                File root = new File(updateRoot(), version + ".staging");
                File target = new File(root, path);
                if (!target.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator)) return false;
                File parent = target.getParentFile();
                if (parent == null || (!parent.exists() && !parent.mkdirs())) return false;
                try (FileOutputStream output = new FileOutputStream(target)) { output.write(bytes); }
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean activateUpdate(String version) {
            try {
                if (!version.equals(stagingVersion) || expected.isEmpty()) return false;
                File root = new File(updateRoot(), version + ".staging");
                for (Map.Entry<String, UpdateFile> entry : expected.entrySet()) {
                    File file = new File(root, entry.getKey());
                    if (!file.isFile() || file.length() != entry.getValue().size || !entry.getValue().sha256.equalsIgnoreCase(sha256(file))) return false;
                }
                File installed = new File(updateRoot(), version);
                deleteTree(installed);
                if (!root.renameTo(installed)) return false;
                android.content.SharedPreferences prefs = getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE);
                String previous = prefs.getString("active", "");
                if (!prefs.edit().putString("previous", previous).putString("active", version)
                    .putString("pending", version).commit()) return false;
                expected.clear();
                stagingVersion = null;
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean confirmUpdate() {
            getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE).edit().remove("pending").remove("previous").apply();
            return true;
        }
    }

    private static final class UpdateFile {
        final int size;
        final String sha256;
        UpdateFile(int size, String sha256) { this.size = size; this.sha256 = sha256; }
    }

    private File updateRoot() { return new File(getFilesDir(), "web-updates"); }

    private void rollbackUnconfirmedUpdate() {
        android.content.SharedPreferences prefs = getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE);
        if (prefs.contains("pending")) prefs.edit().putString("active", prefs.getString("previous", "")).remove("pending").remove("previous").apply();
    }

    private WebResourceResponse updatedAsset(String rawPath) {
        try {
            String path = rawPath == null ? "" : rawPath.replaceFirst("^/", "");
            if (!safeUpdatePath(path)) return null;
            String version = getSharedPreferences(UPDATE_PREFS, MODE_PRIVATE).getString("active", "");
            if (version.isEmpty()) return null;
            File root = new File(updateRoot(), version);
            File file = new File(root, path);
            if (!file.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator) || !file.isFile()) return null;
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", path.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
            return new WebResourceResponse(updateMime(path), "UTF-8", 200, "OK", headers, new FileInputStream(file));
        } catch (Exception error) { return null; }
    }

    private static boolean validVersion(String version) { return version.matches("[0-9]+\\.[0-9]+\\.[0-9]+-(alpha|beta|rc)(\\.[0-9A-Za-z.-]+)?"); }

    private static boolean safeUpdatePath(String path) {
        if (!path.matches("^(assets|web|releases)/[A-Za-z0-9._/-]+$")) return false;
        for (String part : path.split("/")) if (part.isEmpty() || ".".equals(part) || "..".equals(part)) return false;
        return true;
    }

    private static String updateMime(String path) {
        String name = path.toLowerCase();
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".js")) return "text/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".woff")) return "font/woff";
        if (name.endsWith(".ttf")) return "font/ttf";
        if (name.endsWith(".otf")) return "font/otf";
        return "application/octet-stream";
    }

    private static String sha256(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder result = new StringBuilder();
        for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }

    private static String sha256(File file) throws Exception {
        try (InputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return sha256(output.toByteArray());
        }
    }

    private static void deleteTree(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteTree(child);
        }
        if (file.exists()) file.delete();
    }

    private static void copyTree(File source, File target) throws IOException {
        if (source.isDirectory()) {
            if (!target.exists() && !target.mkdirs()) throw new IOException("cannot create update staging directory");
            File[] children = source.listFiles();
            if (children != null) for (File child : children) copyTree(child, new File(target, child.getName()));
            return;
        }
        File parent = target.getParentFile();
        if (parent == null || (!parent.exists() && !parent.mkdirs())) throw new IOException("cannot create update staging directory");
        try (InputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
    }

    private int statusBarHeight() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : 0;
    }

    private void startGoogleIdTokenRequest(String requestId, String serverClientId) {
        Uri current = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
        if (!"https".equals(current.getScheme()) || !APP_HOST.equals(current.getHost())) {
            sendGoogleAuthResult(requestId, null, "auth/native-origin-invalid", "Google sign-in is only available inside Comik.");
            return;
        }

        try {
            GetGoogleIdOption googleIdOption = new GetGoogleIdOption.Builder()
                    .setFilterByAuthorizedAccounts(false)
                    .setServerClientId(serverClientId)
                    .setAutoSelectEnabled(false)
                    .build();
            GetCredentialRequest request = new GetCredentialRequest.Builder()
                    .addCredentialOption(googleIdOption)
                    .build();
            CredentialManager.create(this).getCredentialAsync(
                    this,
                    request,
                    new CancellationSignal(),
                    ContextCompat.getMainExecutor(this),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override
                        public void onResult(GetCredentialResponse result) {
                            Credential credential = result.getCredential();
                            if (!(credential instanceof CustomCredential)
                                    || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                                sendGoogleAuthResult(requestId, null, "auth/native-credential-invalid", "Google returned an unsupported credential.");
                                return;
                            }
                            try {
                                GoogleIdTokenCredential googleCredential = GoogleIdTokenCredential.createFrom(credential.getData());
                                sendGoogleAuthResult(requestId, googleCredential.getIdToken(), null, null);
                            } catch (Exception error) {
                                sendGoogleAuthResult(requestId, null, "auth/native-credential-invalid", error.getMessage());
                            }
                        }

                        @Override
                        public void onError(GetCredentialException error) {
                            String code = error instanceof GetCredentialCancellationException
                                    ? "auth/popup-closed-by-user"
                                    : error instanceof NoCredentialException ? "auth/no-credential" : "auth/native-google-failed";
                            sendGoogleAuthResult(requestId, null, code, error.getMessage());
                        }
                    });
        } catch (Exception error) {
            sendGoogleAuthResult(requestId, null, "auth/native-google-failed", error.getMessage());
        }
    }

    private void sendGoogleAuthResult(String requestId, String idToken, String code, String message) {
        JSONObject result = new JSONObject();
        try {
            result.put("requestId", requestId);
            if (idToken != null) result.put("idToken", idToken);
            if (code != null) result.put("code", code);
            if (message != null) result.put("error", message);
        } catch (Exception ignored) {
            return;
        }
        String script = "window.__comikAndroidGoogleResult && window.__comikAndroidGoogleResult("
                + JSONObject.quote(result.toString()) + ");";
        mainHandler.post(() -> {
            if (webView != null && !isFinishing()) webView.evaluateJavascript(script, null);
        });
    }

    private WebResourceResponse fetchSource(WebResourceRequest request, Uri endpoint) {
        HttpURLConnection connection = null;
        try {
            String rawTarget = endpoint.getQueryParameter("url");
            if (rawTarget == null) return textResponse("application/json", 400, "Bad Request", "{\"error\":\"missing url\"}");
            String method = request.getMethod();
            String referer = endpoint.getQueryParameter("ref");
            String encodedHeaders = header(request.getRequestHeaders(), "x-comik-headers");
            connection = openResolved(rawTarget, method, referer, encodedHeaders, header(request.getRequestHeaders(), "accept"), userAgent,
                    "1".equals(header(request.getRequestHeaders(), "x-comik-no-challenge")));
            int status = connection.getResponseCode();
            InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (input == null) input = new ByteArrayInputStream(new byte[0]);
            byte[] bytes;
            try (InputStream responseStream = input) {
                bytes = readBounded(responseStream, MAX_HTML_BYTES);
            }
            String contentType = connection.getContentType();
            String finalUrl = connection.getURL().toString();
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Type", contentType == null ? "application/octet-stream" : contentType);
            headers.put("X-Comik-Final-Url", finalUrl);
            if ((status == 403 || status == 503) && isCloudflareChallenge(connection)) headers.put("X-Comik-Challenge", "cloudflare");
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mimeType(contentType), charset(contentType), status,
                    reasonPhrase(connection, status), headers, new ByteArrayInputStream(bytes));
        } catch (Exception error) {
            return textResponse("application/json", 502, "Bad Gateway", errorJson(error));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private WebResourceResponse fetchImage(Uri endpoint) {
        HttpURLConnection connection = null;
        try {
            String rawTarget = endpoint.getQueryParameter("url");
            if (rawTarget == null) return textResponse("text/plain", 400, "Bad Request", "missing url");
            connection = openResolved(rawTarget, "GET", endpoint.getQueryParameter("ref"), null,
                    "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", userAgent, false);
            int status = connection.getResponseCode();
            String contentType = connection.getContentType();
            if (status < 400 && contentType != null && !contentType.startsWith("image/")
                    && !contentType.startsWith("application/octet-stream")) {
                connection.disconnect();
                return textResponse("text/plain", 415, "Unsupported Media Type", "not an image");
            }
            if (connection.getContentLength() > MAX_IMAGE_BYTES) {
                connection.disconnect();
                return textResponse("text/plain", 413, "Payload Too Large", "image too large");
            }
            InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (input == null) input = new ByteArrayInputStream(new byte[0]);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "public, max-age=604800, immutable");
            headers.put("Cross-Origin-Resource-Policy", "cross-origin");
            return new WebResourceResponse(mimeType(contentType), charset(contentType), status,
                    reasonPhrase(connection, status), headers,
                    new DisconnectingInputStream(input, connection, MAX_IMAGE_BYTES));
        } catch (Exception error) {
            if (connection != null) connection.disconnect();
            return textResponse("text/plain", 502, "Bad Gateway", error.getMessage() == null ? "upstream request failed" : error.getMessage());
        }
    }

    /**
     * Opens the request and follows redirects by hand. HttpURLConnection never follows a redirect that
     * changes scheme (http to https), which many sites rely on, so every hop is reopened here.
     *
     * Cookies are shared with the WebView, so a Cloudflare clearance earned in a WebView also applies to
     * these requests. When a site answers with a Cloudflare check, it is solved once in a real WebView
     * (see solveCloudflare) and the request is repeated.
     */
    private HttpURLConnection openResolved(String rawUrl, String method, String referer,
                                           String encodedHeaders, String accept, String userAgent, boolean noChallenge) throws Exception {
        String current = rawUrl;
        String currentMethod = method;
        boolean triedChallenge = noChallenge;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpURLConnection connection = openConnection(current, currentMethod, referer, encodedHeaders, accept, userAgent);
            int status = connection.getResponseCode();
            storeCookies(current, connection);
            if ((status == 403 || status == 503) && isCloudflareChallenge(connection) && !triedChallenge) {
                triedChallenge = true;
                // Keep this response open: if the check cannot be solved it is what the caller reports.
                if (solveCloudflare(originOf(current))) {
                    connection.disconnect();
                    hop--;
                    continue;
                }
                return connection;
            }
            String location = connection.getHeaderField("Location");
            if (status < 300 || status >= 400 || location == null) return connection;
            URL next = new URL(new URL(current), location);
            connection.disconnect();
            current = next.toString();
            if (status == 303 || ((status == 301 || status == 302) && "POST".equalsIgnoreCase(currentMethod))) {
                currentMethod = "GET";
            }
        }
        throw new IOException("too many redirects");
    }

    private HttpURLConnection openConnection(String rawUrl, String method, String referer,
                                             String encodedHeaders, String accept, String userAgent) throws Exception {
        URL url = new URL(rawUrl);
        if (!"http".equals(url.getProtocol()) && !"https".equals(url.getProtocol())) {
            throw new IOException("only http(s) sources are supported");
        }
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(25000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("User-Agent", userAgent);
        connection.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
        if (accept != null && !accept.isEmpty()) connection.setRequestProperty("Accept", accept);
        connection.setRequestProperty("Referer", referer == null || referer.isEmpty()
                ? url.getProtocol() + "://" + url.getAuthority() + "/" : referer);

        if (encodedHeaders != null && !encodedHeaders.isEmpty()) {
            JSONObject headers = new JSONObject(encodedHeaders);
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String normalized = key.toLowerCase();
                if (!"host".equals(normalized) && !"content-length".equals(normalized)
                        && !"connection".equals(normalized) && !"origin".equals(normalized)
                        && !"x-forwarded-for".equals(normalized)) {
                    connection.setRequestProperty(key, headers.getString(key));
                }
            }
        }
        // Cookies the WebView holds for this site, including any Cloudflare clearance.
        String stored = CookieManager.getInstance().getCookie(rawUrl);
        if (stored != null && !stored.isEmpty()) {
            String own = connection.getRequestProperty("Cookie");
            connection.setRequestProperty("Cookie", own == null || own.isEmpty() ? stored : own + "; " + stored);
        }
        // WebView does not expose request bodies to shouldInterceptRequest, so POSTs go out empty.
        if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            connection.setDoOutput(true);
            connection.getOutputStream().close();
        }
        return connection;
    }

    /** Keep the cookies a site sets so later requests, and the WebView, see them. */
    private static void storeCookies(String url, HttpURLConnection connection) {
        CookieManager manager = CookieManager.getInstance();
        for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
            if (entry.getKey() == null || !"set-cookie".equalsIgnoreCase(entry.getKey())) continue;
            for (String cookie : entry.getValue()) manager.setCookie(url, cookie);
        }
        manager.flush();
    }

    private static boolean isCloudflareChallenge(HttpURLConnection connection) {
        String mitigated = connection.getHeaderField("cf-mitigated");
        String server = connection.getHeaderField("Server");
        return "challenge".equalsIgnoreCase(mitigated) || (server != null && server.toLowerCase().contains("cloudflare"));
    }

    private static String originOf(String url) {
        Uri uri = Uri.parse(url);
        return uri.getScheme() + "://" + uri.getAuthority();
    }

    private final ConcurrentHashMap<String, CountDownLatch> solving = new ConcurrentHashMap<>();

    /**
     * Pass a Cloudflare check the way a person would: load the site in a real WebView and wait for the
     * clearance cookie. The WebView stays hidden while the check solves itself, which is usually a few
     * seconds. If it needs a click, a window opens so the person can do it. Blocks the calling thread.
     */
    private boolean solveCloudflare(String origin) {
        CountDownLatch mine = new CountDownLatch(1);
        CountDownLatch running = solving.putIfAbsent(origin, mine);
        try {
            if (running != null) {
                // Another request is already solving this site; wait for it and reuse the result.
                running.await(130, TimeUnit.SECONDS);
                return hasClearance(origin);
            }
            mainHandler.post(() -> showCloudflareCheck(origin, mine));
            mine.await(130, TimeUnit.SECONDS);
            return hasClearance(origin);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        } finally {
            if (running == null) solving.remove(origin);
        }
    }

    private static boolean hasClearance(String origin) {
        String cookies = CookieManager.getInstance().getCookie(origin);
        return cookies != null && cookies.contains("cf_clearance=");
    }

    /** Runs on the main thread. */
    private void showCloudflareCheck(String origin, CountDownLatch finished) {
        String host = Uri.parse(origin).getHost();
        CookieManager cookies = CookieManager.getInstance();
        // Forget an old clearance so the check below has to earn a new one.
        for (String domain : new String[]{"", "; Domain=" + host, "; Domain=." + host}) {
            cookies.setCookie(origin, "cf_clearance=; Max-Age=0; Path=/" + domain);
        }

        WebView check = new WebView(this);
        check.getSettings().setJavaScriptEnabled(true);
        check.getSettings().setDomStorageEnabled(true);
        check.getSettings().setUserAgentString(userAgent);
        cookies.setAcceptThirdPartyCookies(check, true);
        check.setWebViewClient(new WebViewClient());

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(0xFF111713);
        TextView title = new TextView(this);
        title.setText("Checking " + host + "\nThis usually takes a few seconds. If a box appears, tick it.");
        title.setTextColor(0xFFF4F6EF);
        title.setPadding(32, 40, 32, 24);
        Button cancel = new Button(this);
        cancel.setText("Cancel");
        layout.addView(title);
        layout.addView(check, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        layout.addView(cancel);

        Dialog dialog = new Dialog(this, android.R.style.Theme_Material_NoActionBar);
        dialog.setContentView(layout);
        dialog.setCancelable(true);

        boolean[] done = {false};
        Runnable[] poll = new Runnable[1];
        Runnable finish = () -> {
            if (done[0]) return;
            done[0] = true;
            mainHandler.removeCallbacksAndMessages(check);
            if (dialog.isShowing()) dialog.dismiss();
            check.destroy();
            cookies.flush();
            finished.countDown();
        };
        poll[0] = () -> {
            if (done[0]) return;
            if (hasClearance(origin)) finish.run();
            else mainHandler.postAtTime(poll[0], check, android.os.SystemClock.uptimeMillis() + 600);
        };
        cancel.setOnClickListener((view) -> finish.run());
        dialog.setOnCancelListener((view) -> finish.run());
        // Most checks pass on their own, so only show the window if it is taking long.
        mainHandler.postAtTime(() -> { if (!done[0] && !isFinishing()) dialog.show(); }, check, android.os.SystemClock.uptimeMillis() + 8000);
        mainHandler.postAtTime(finish, check, android.os.SystemClock.uptimeMillis() + 120000);
        poll[0].run();
        check.loadUrl(origin + "/");
    }

    private static String header(Map<String, String> headers, String name) {
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (name.equalsIgnoreCase(entry.getKey())) return entry.getValue();
        }
        return null;
    }

    private static byte[] readBounded(InputStream input, int maxBytes) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > maxBytes) throw new IOException("upstream response too large");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static String mimeType(String contentType) {
        return contentType == null || contentType.isEmpty() ? "application/octet-stream" : contentType.split(";", 2)[0].trim();
    }

    private static String charset(String contentType) {
        if (contentType != null) {
            for (String part : contentType.split(";")) {
                String trimmed = part.trim();
                if (trimmed.toLowerCase().startsWith("charset=")) return trimmed.substring(8).replace("\"", "");
            }
        }
        return "UTF-8";
    }

    private static String reasonPhrase(HttpURLConnection connection, int status) {
        try {
            String message = connection.getResponseMessage();
            return message == null || message.isEmpty() ? (status >= 400 ? "Upstream Error" : "OK") : message;
        } catch (IOException ignored) {
            return status >= 400 ? "Upstream Error" : "OK";
        }
    }

    private static String errorJson(Exception error) {
        try {
            return new JSONObject().put("error", error.getMessage() == null ? "request failed" : error.getMessage()).toString();
        } catch (Exception ignored) {
            return "{\"error\":\"request failed\"}";
        }
    }

    private static WebResourceResponse textResponse(String contentType, int status, String reason, String text) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(contentType, "UTF-8", status, reason, headers,
                new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }

    private static final class DisconnectingInputStream extends FilterInputStream {
        private final HttpURLConnection connection;
        private final int maxBytes;
        private int bytesRead;

        private DisconnectingInputStream(InputStream input, HttpURLConnection connection, int maxBytes) {
            super(input);
            this.connection = connection;
            this.maxBytes = maxBytes;
        }

        @Override
        public int read() throws IOException {
            int value = super.read();
            if (value != -1 && ++bytesRead > maxBytes) throw new IOException("image too large");
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int count = super.read(buffer, offset, Math.min(length, maxBytes - bytesRead + 1));
            if (count > 0 && (bytesRead += count) > maxBytes) throw new IOException("image too large");
            return count;
        }

        @Override
        public void close() throws IOException {
            try {
                super.close();
            } finally {
                connection.disconnect();
            }
        }
    }
}
