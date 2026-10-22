package io.github.skibididobdob228.riffspotify;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.MutableContextWrapper;
import android.graphics.Color;
import android.net.Uri;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;

/**
 * Owns the one WebView that runs Riff's UI. It outlives MainActivity so playback continues
 * when the activity is closed; the activity attaches it while visible.
 */
final class WebViewHolder {
    private static WebView webView;
    private static MutableContextWrapper context;
    private static RiffBridge bridge;
    private static boolean loaded;

    private WebViewHolder() {
    }

    @SuppressLint("SetJavaScriptEnabled")
    static synchronized WebView get(Context any) {
        if (webView != null) return webView;
        Context app = any.getApplicationContext();
        if ((app.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        context = new MutableContextWrapper(app);
        webView = new RiffWebView(context);
        webView.setBackgroundColor(Color.parseColor("#121214"));

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Riff's page is a local file that talks to its server on 127.0.0.1 and reads cover pixels, as in Electron
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " RiffAndroid");

        bridge = new RiffBridge(app, webView);
        webView.addJavascriptInterface(bridge, "RiffAndroidNative");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.println(m.messageLevel() == ConsoleMessage.MessageLevel.ERROR ? Log.ERROR : Log.INFO,
                        "RiffWeb", m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("file".equals(scheme)) return false;
                String host = uri.getHost();
                if (("http".equals(scheme) || "https".equals(scheme)) && ("127.0.0.1".equals(host) || "localhost".equals(host))) return false;
                // Everything else (Spotify login, GitHub, links in lyrics) opens in the browser
                openExternal(view.getContext(), uri.toString());
                return true;
            }
        });
        return webView;
    }

    static synchronized RiffBridge bridge() {
        return bridge;
    }

    static synchronized void loadOnce(File appDir) {
        if (loaded) return;
        loaded = true;
        webView.loadUrl(Uri.fromFile(new File(appDir, "index.html")).toString());
    }

    static synchronized void attach(Activity activity, ViewGroup parent) {
        context.setBaseContext(activity);
        bridge.setActivity(activity);
        if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
        parent.addView(webView, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    static synchronized void detach(Activity activity) {
        if (webView == null) return;
        if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
        context.setBaseContext(activity.getApplicationContext());
        bridge.setActivity(null);
    }

    static synchronized void evaluate(String js) {
        if (webView != null) webView.post(() -> webView.evaluateJavascript(js, null));
    }

    static void openExternal(Context context, String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            Log.w("RiffWeb", "cannot open " + url, e);
        }
    }
}
