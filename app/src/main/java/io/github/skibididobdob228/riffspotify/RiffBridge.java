package io.github.skibididobdob228.riffspotify;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

/**
 * What Riff's UI can ask Android for, exposed to JavaScript as window.RiffAndroidNative.
 * android-shim.js builds window.electronAPI on top of it. Methods run on a WebView binder thread.
 */
public final class RiffBridge {
    static final int PICK_REQUEST = 4711;

    private final Context app;
    private final WebView webView;
    private Activity activity;
    private String pendingPickId;

    RiffBridge(Context app, WebView webView) {
        this.app = app;
        this.webView = webView;
    }

    synchronized void setActivity(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String getSession() {
        NodeRunner.Session s = NodeRunner.session();
        return s != null ? s.json : "{}";
    }

    @JavascriptInterface
    public String getAppVersion() {
        return NodeRunner.versionName(app);
    }

    /** accept: comma-separated MIME types ("audio/*", "image/*,video/*", "*\/*"). Result arrives in __riffAndroid.resolvePick. */
    @JavascriptInterface
    public void pickFiles(String id, String accept, boolean multiple) {
        Activity a;
        synchronized (this) {
            a = activity;
            if (a == null) {
                resolvePick(id, new JSONArray());
                return;
            }
            if (pendingPickId != null) resolvePick(pendingPickId, new JSONArray());
            pendingPickId = id;
        }
        String[] types = accept == null || accept.isEmpty() ? new String[]{"*/*"} : accept.split(",");
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(types.length == 1 ? types[0] : "*/*");
        if (types.length > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
        a.runOnUiThread(() -> a.startActivityForResult(intent, PICK_REQUEST));
    }

    /** Copies the picked documents to the cache so Riff's server can read them as plain files. */
    void onPickResult(Intent data) {
        String id;
        synchronized (this) {
            id = pendingPickId;
            pendingPickId = null;
        }
        if (id == null) return;
        new Thread(() -> {
            JSONArray paths = new JSONArray();
            if (data != null) {
                if (data.getClipData() != null) {
                    for (int i = 0; i < data.getClipData().getItemCount(); i++) addPicked(data.getClipData().getItemAt(i).getUri(), paths);
                } else if (data.getData() != null) {
                    addPicked(data.getData(), paths);
                }
            }
            resolvePick(id, paths);
        }, "pick-copy").start();
    }

    private void addPicked(Uri uri, JSONArray paths) {
        try {
            File dir = new File(app.getCacheDir(), "picked/" + System.nanoTime());
            dir.mkdirs();
            File out = new File(dir, displayName(uri));
            NodeRunner.copy(app.getContentResolver().openInputStream(uri), out);
            paths.put(out.getAbsolutePath());
        } catch (Exception e) {
            Log.w("RiffWeb", "could not copy picked file " + uri, e);
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = app.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                if (name != null && !name.isEmpty()) return name.replace('/', '_');
            }
        } catch (Exception ignored) {
        }
        return "file-" + System.currentTimeMillis();
    }

    private void resolvePick(String id, JSONArray paths) {
        WebViewHolder.evaluate("window.__riffAndroid && window.__riffAndroid.resolvePick(" + JSONObject.quote(id) + "," + paths + ")");
    }

    @JavascriptInterface
    public void openExternal(String url) {
        WebViewHolder.openExternal(app, url);
    }

    /** Media Session state from the page: {title, artist, album, artwork, state, position, duration, rate}. */
    @JavascriptInterface
    public void media(String json) {
        PlaybackService.update(app, json);
    }

    @JavascriptInterface
    public void clearWebCache() {
        webView.post(() -> webView.clearCache(true));
    }

    /** Back with nothing left to close in the UI: keep playing, go to the home screen. */
    @JavascriptInterface
    public void moveToBackground() {
        Activity a;
        synchronized (this) {
            a = activity;
        }
        if (a != null) a.runOnUiThread(() -> a.moveTaskToBack(true));
    }

    /** Node can't be restarted inside a process, so restart the whole app. */
    @JavascriptInterface
    public void restartApp() {
        Intent launch = app.getPackageManager().getLaunchIntentForPackage(app.getPackageName());
        if (launch == null) return;
        PendingIntent pi = PendingIntent.getActivity(app, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_CANCEL_CURRENT);
        AlarmManager am = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        am.set(AlarmManager.RTC, System.currentTimeMillis() + 500, pi);
        PlaybackService.stop(app);
        android.os.Process.killProcess(android.os.Process.myPid());
    }
}
