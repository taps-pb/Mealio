package app.mealio.personal;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/** Private, online-only shell for the existing authenticated Mealio website. */
public final class MainActivity extends Activity {
    private static final String HOME = "https://mealio-two.vercel.app/";
    private static final String HOST = "mealio-two.vercel.app";
    private static final String EXPORT_PATH = "/api/meals/export";
    private static final int EXPORT_REQUEST = 7712;
    private static final long MAX_PDF_BYTES = 25L * 1024L * 1024L;
    private WebView webView;
    private LinearLayout errorView;
    private boolean loadFailed;
    private String pendingExport;

    private static boolean trusted(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme())
                && HOST.equalsIgnoreCase(uri.getHost())
                && uri.getUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(247, 252, 253));
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        setContentView(root);

        webView = new WebView(this);
        configureWebView();
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        errorView = makeErrorView();
        errorView.setVisibility(View.GONE);
        root.addView(errorView, new FrameLayout.LayoutParams(-1, -1));
        if (state != null) pendingExport = state.getString("pendingExport");
        webView.loadUrl(HOME);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true); // Required by the Next.js site.
        settings.setDomStorageEnabled(true); // Used for the local theme preference.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        settings.setSaveFormData(false);
        settings.setSafeBrowsingEnabled(true);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true); // First-party session cookie for owner login.
        cookies.setAcceptThirdPartyCookies(webView, false);
        // The site's unsaved-changes confirmation uses the normal WebChromeClient dialog.
        // Never add a JavaScript interface or a file chooser.
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (trusted(uri)) return false;
                if (request.isForMainFrame() && "https".equalsIgnoreCase(uri.getScheme())) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        intent.addCategory(Intent.CATEGORY_BROWSABLE);
                        startActivity(intent);
                    } catch (RuntimeException ignored) {
                        // Do not load an external destination inside the WebView.
                    }
                }
                return true; // Block http, local files, data, JavaScript and custom schemes.
            }

            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                loadFailed = false;
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (!loadFailed && url != null && trusted(Uri.parse(url))) {
                    errorView.setVisibility(View.GONE);
                    webView.setVisibility(View.VISIBLE);
                }
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError();
            }

            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); // Never bypass an invalid TLS certificate.
                showError();
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            Uri uri = Uri.parse(url);
            if (!trusted(uri) || !EXPORT_PATH.equals(uri.getPath())) {
                Toast.makeText(this, "Download blocked", Toast.LENGTH_SHORT).show();
                return;
            }
            pendingExport = url;
            Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            picker.addCategory(Intent.CATEGORY_OPENABLE);
            picker.setType("application/pdf");
            picker.putExtra(Intent.EXTRA_TITLE, "Mealio-history.pdf");
            try {
                startActivityForResult(picker, EXPORT_REQUEST);
            } catch (RuntimeException ignored) {
                pendingExport = null;
                Toast.makeText(this, "No file picker available", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (pendingExport != null) state.putString("pendingExport", pendingExport);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != EXPORT_REQUEST) return;
        String url = pendingExport;
        pendingExport = null;
        if (resultCode != RESULT_OK || data == null || data.getData() == null || url == null) return;
        Uri destination = data.getData();
        if (!trusted(Uri.parse(url)) || !EXPORT_PATH.equals(Uri.parse(url).getPath())) return;
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie == null || cookie.isEmpty()) {
            Toast.makeText(this, "Sign in before exporting", Toast.LENGTH_SHORT).show();
            discardIncomplete(destination);
            return;
        }
        new Thread(() -> savePdf(url, cookie, destination), "mealio-pdf-export").start();
    }

    private void savePdf(String url, String cookie, Uri destination) {
        HttpURLConnection connection = null;
        boolean complete = false;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(45000);
            connection.setRequestProperty("Accept", "application/pdf");
            connection.setRequestProperty("Cookie", cookie);
            if (connection.getResponseCode() != 200 || connection.getContentLengthLong() > MAX_PDF_BYTES ||
                    connection.getContentType() == null ||
                    !connection.getContentType().toLowerCase(Locale.ROOT).startsWith("application/pdf")) return;
            try (InputStream in = connection.getInputStream()) {
                byte[] prefix = new byte[5];
                int filled = 0;
                while (filled < prefix.length) {
                    int read = in.read(prefix, filled, prefix.length - filled);
                    if (read < 0) return;
                    filled += read;
                }
                if (!"%PDF-".equals(new String(prefix, java.nio.charset.StandardCharsets.US_ASCII))) return;
                try (OutputStream out = getContentResolver().openOutputStream(destination, "w")) {
                    if (out == null) return;
                    out.write(prefix);
                    long size = prefix.length;
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = in.read(buffer)) >= 0) {
                        size += read;
                        if (size > MAX_PDF_BYTES) return;
                        out.write(buffer, 0, read);
                    }
                    out.flush();
                    complete = true;
                }
            }
        } catch (Exception ignored) {
            // Never log session cookies, URLs containing meal searches, or PDF contents.
        } finally {
            if (connection != null) connection.disconnect();
            if (!complete) discardIncomplete(destination);
            final boolean saved = complete;
            runOnUiThread(() -> Toast.makeText(this, saved ? "Mealio PDF saved" : "PDF export failed", Toast.LENGTH_SHORT).show());
        }
    }

    private void discardIncomplete(Uri destination) {
        try { DocumentsContract.deleteDocument(getContentResolver(), destination); }
        catch (Exception ignored) { /* Some document providers do not permit deletion. */ }
    }

    private LinearLayout makeErrorView() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(24), dp(24), dp(24), dp(24));
        panel.setBackgroundColor(Color.rgb(247, 252, 253));

        TextView title = new TextView(this);
        title.setText(R.string.error_title);
        title.setTextColor(Color.rgb(51, 30, 56));
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);
        panel.addView(title);
        TextView message = new TextView(this);
        message.setText(R.string.error_message);
        message.setTextColor(Color.rgb(92, 113, 128));
        message.setTextSize(14);
        message.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(-1, -2);
        messageParams.topMargin = dp(12);
        panel.addView(message, messageParams);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setAllCaps(false);
        retry.setMinHeight(dp(48));
        retry.setMinWidth(dp(120));
        retry.setTextColor(Color.WHITE);
        retry.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(0, 126, 167)));
        retry.setOnClickListener(view -> {
            loadFailed = false;
            errorView.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            webView.loadUrl(HOME);
        });
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(-2, dp(48));
        retryParams.topMargin = dp(24);
        panel.addView(retry, retryParams);
        return panel;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void showError() {
        loadFailed = true;
        webView.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    @Override public void onBackPressed() {
        if (errorView.getVisibility() == View.VISIBLE) {
            webView.loadUrl(HOME);
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override protected void onPause() {
        CookieManager.getInstance().flush();
        webView.onPause();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override protected void onDestroy() {
        ((ViewGroup) webView.getParent()).removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}
