package com.comik.reader;

import android.app.Activity;
import android.app.Dialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final int FILE_PICKER_REQUEST = 41;
    private static final int MAX_HTML_BYTES = 12 * 1024 * 1024;
    private static final int MAX_IMAGE_BYTES = 40 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;

    private WebView webView;
    private String userAgent;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private ValueCallback<Uri[]> fileChooserCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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

    /** In-app updates: look up the newest release, and save its APK to the Downloads folder. */
    private final class UpdateBridge {
        @JavascriptInterface
        public void fetchUpdateInfo(String requestId, String rawUrl) {
            if (requestId == null || requestId.length() > 80) return;
            if (!insideComik()) {
                sendUpdateInfoResult(requestId, null, "Update checks are only available inside Comik.");
                return;
            }
            updateExecutor.execute(() -> {
                try {
                    byte[] bytes = downloadGitHubAsset(rawUrl, 8 * 1024 * 1024);
                    sendUpdateInfoResult(requestId, Base64.encodeToString(bytes, Base64.NO_WRAP), null);
                } catch (Exception error) {
                    sendUpdateInfoResult(requestId, null, error.getMessage() == null ? "The update check failed" : error.getMessage());
                }
            });
        }

        @JavascriptInterface
        public boolean downloadApk(String rawUrl, String fileName) {
            if (!insideComik() || fileName == null || !fileName.matches("Comik-[A-Za-z0-9._-]{1,100}\\.apk")) return false;
            try {
                URL target = new URL(rawUrl);
                if (!"https".equalsIgnoreCase(target.getProtocol()) || !isGitHubUpdateHost(target.getHost())) return false;
                mainHandler.post(() -> startApkDownload(target.toString(), fileName));
                return true;
            } catch (Exception error) {
                return false;
            }
        }
    }

    private boolean insideComik() {
        Uri current = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
        return "https".equals(current.getScheme()) && APP_HOST.equals(current.getHost());
    }

    /**
     * Hands the file to Android's download manager. It saves into Downloads, shows its own progress and
     * completion notification, and tapping that notification opens the package installer.
     */
    private void startApkDownload(String url, String fileName) {
        try {
            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle(fileName)
                    .setDescription("Comik update")
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            long id = manager.enqueue(request);
            updateExecutor.execute(() -> watchDownload(manager, id));
        } catch (Exception error) {
            sendDownloadReport("error", 0, 0, error.getMessage() == null ? "Android could not start the download." : error.getMessage());
        }
    }

    private void watchDownload(DownloadManager manager, long id) {
        for (int idle = 0; idle < 3600; idle++) {
            try (android.database.Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
                if (cursor == null || !cursor.moveToFirst()) { sendDownloadReport("error", 0, 0, "The download was cancelled."); return; }
                int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                long received = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                if (status == DownloadManager.STATUS_SUCCESSFUL) { sendDownloadReport("done", received, total, null); return; }
                if (status == DownloadManager.STATUS_FAILED) { sendDownloadReport("error", received, total, "The download failed. Check your connection and try again."); return; }
                sendDownloadReport("progress", received, total, null);
            }
            try { Thread.sleep(500); } catch (InterruptedException ignored) { return; }
        }
        sendDownloadReport("error", 0, 0, "The download took too long.");
    }

    private void sendDownloadReport(String status, long received, long total, String message) {
        JSONObject report = new JSONObject();
        try {
            report.put("status", status);
            report.put("received", received);
            report.put("total", total);
            if (message != null) report.put("message", message);
        } catch (Exception ignored) { return; }
        String script = "window.__comikAndroidDownload && window.__comikAndroidDownload(" + JSONObject.quote(report.toString()) + ");";
        mainHandler.post(() -> {
            if (webView != null && !isFinishing()) webView.evaluateJavascript(script, null);
        });
    }

    private byte[] downloadGitHubAsset(String rawUrl, int limit) throws Exception {
        URL target = new URL(rawUrl);
        if (!"https".equalsIgnoreCase(target.getProtocol()) || !isGitHubUpdateHost(target.getHost())) throw new IOException("Update URL is not a trusted GitHub host");
        HttpURLConnection connection = (HttpURLConnection) target.openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(45000);
        connection.setRequestProperty("Accept", "application/vnd.github+json, application/octet-stream");
        try {
            int status = connection.getResponseCode();
            URL finalUrl = connection.getURL();
            if (status < 200 || status >= 300) throw new IOException("GitHub update download returned " + status);
            if (!"https".equalsIgnoreCase(finalUrl.getProtocol()) || !isGitHubUpdateHost(finalUrl.getHost())) throw new IOException("GitHub redirected the update to an untrusted host");
            if (connection.getContentLength() > limit) throw new IOException("Update response is too large");
            try (InputStream input = connection.getInputStream()) { return readBounded(input, limit); }
        } finally {
            connection.disconnect();
        }
    }

    private static boolean isGitHubUpdateHost(String host) {
        String normalized = host.toLowerCase(java.util.Locale.ROOT);
        return normalized.equals("github.com") || normalized.equals("api.github.com")
                || normalized.endsWith(".github.com") || normalized.endsWith(".githubusercontent.com");
    }

    private void sendUpdateInfoResult(String requestId, String data, String error) {
        JSONObject result = new JSONObject();
        try {
            result.put("requestId", requestId);
            if (data != null) result.put("data", data);
            if (error != null) result.put("error", error);
        } catch (Exception ignored) { return; }
        String script = "window.__comikAndroidUpdateResult && window.__comikAndroidUpdateResult(" + JSONObject.quote(result.toString()) + ");";
        mainHandler.post(() -> {
            if (webView != null && !isFinishing()) webView.evaluateJavascript(script, null);
        });
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
