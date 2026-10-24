package com.comik.reader;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

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

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final int FILE_PICKER_REQUEST = 41;
    private static final int MAX_HTML_BYTES = 12 * 1024 * 1024;
    private static final int MAX_IMAGE_BYTES = 40 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;

    private WebView webView;
    private String userAgent;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
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
            connection = openResolved(rawTarget, method, referer, encodedHeaders, header(request.getRequestHeaders(), "accept"), userAgent);
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
                    "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", userAgent);
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
     */
    private static HttpURLConnection openResolved(String rawUrl, String method, String referer,
                                                   String encodedHeaders, String accept, String userAgent) throws Exception {
        String current = rawUrl;
        String currentMethod = method;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpURLConnection connection = openConnection(current, currentMethod, referer, encodedHeaders, accept, userAgent);
            int status = connection.getResponseCode();
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

    private static HttpURLConnection openConnection(String rawUrl, String method, String referer,
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
        // WebView does not expose request bodies to shouldInterceptRequest, so POSTs go out empty.
        if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            connection.setDoOutput(true);
            connection.getOutputStream().close();
        }
        return connection;
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
