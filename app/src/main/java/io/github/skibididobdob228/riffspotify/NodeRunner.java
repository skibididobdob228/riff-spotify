package io.github.skibididobdob228.riffspotify;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Runs Riff's Node.js server (server.js) inside the app with nodejs-mobile.
 * yt-dlp and ffmpeg come from youtubedl-android; their paths reach Node as environment variables.
 */
public final class NodeRunner {
    private static final String TAG = "RiffNode";

    static {
        System.loadLibrary("node");
        System.loadLibrary("riffnode");
    }

    private static native int startNode(String[] args, String[] envPairs);

    public interface Listener {
        void onReady(Session session);

        void onError(String message);
    }

    public static final class Session {
        public final int port;
        public final int ipcPort;
        public final String token;
        public final String json;

        Session(JSONObject o) {
            port = o.optInt("port");
            ipcPort = o.optInt("ipcPort");
            token = o.optString("token");
            json = o.toString();
        }
    }

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final List<Listener> listeners = new ArrayList<>();
    private static Session session;
    private static String error;
    private static boolean started;
    private static File appDir;

    private NodeRunner() {
    }

    public static synchronized Session session() {
        return session;
    }

    /** The unpacked Riff app (UI and server), shared by Node and the WebView. */
    public static synchronized File appDir() {
        return appDir;
    }

    public static synchronized void start(Context context, Listener listener) {
        if (session != null) {
            listener.onReady(session);
            return;
        }
        if (error != null) {
            listener.onError(error);
            return;
        }
        listeners.add(listener);
        if (started) return;
        started = true;
        Context app = context.getApplicationContext();
        // Node and V8 want a big stack
        new Thread(null, () -> run(app), "node", 16 * 1024 * 1024).start();
    }

    private static void run(Context app) {
        try {
            File dir = unpackApp(app);
            synchronized (NodeRunner.class) {
                appDir = dir;
            }
            YoutubeDL.getInstance().init(app);
            FFmpeg.getInstance().init(app);
            YtDlpUpdater.updateInBackground(app);

            File sessionFile = new File(app.getFilesDir(), "session.json");
            sessionFile.delete();
            watchSession(sessionFile);

            String[] args = {"node", new File(dir, "android-main.js").getAbsolutePath()};
            int code = startNode(args, environment(app, sessionFile));
            fail("Riff's server stopped (exit code " + code + ")");
        } catch (Throwable t) {
            Log.e(TAG, "start failed", t);
            fail(t.toString());
        }
    }

    private static String[] environment(Context app, File sessionFile) {
        File nativeDir = new File(app.getApplicationInfo().nativeLibraryDir);
        File ytdlBase = new File(app.getNoBackupFilesDir(), "youtubedl-android");
        File packages = new File(ytdlBase, "packages");
        File python = new File(packages, "python");
        File music = app.getExternalFilesDir(Environment.DIRECTORY_MUSIC);
        File downloads = music != null ? music : new File(app.getFilesDir(), "downloads");
        downloads.mkdirs();
        DownloadExporter.watch(app, downloads);

        List<String> env = new ArrayList<>();
        put(env, "HOME", app.getFilesDir().getAbsolutePath());
        put(env, "TMPDIR", app.getCacheDir().getAbsolutePath());
        put(env, "RIFF_DATA_DIR", new File(app.getFilesDir(), "data").getAbsolutePath());
        put(env, "XDG_CONFIG_HOME", new File(app.getFilesDir(), "config").getAbsolutePath());
        put(env, "RIFF_ANDROID_SESSION", sessionFile.getAbsolutePath());
        put(env, "RIFF_ANDROID_DOWNLOADS", downloads.getAbsolutePath());
        put(env, "RIFF_APP_VERSION", versionName(app));
        // Same setup youtubedl-android uses for its own yt-dlp processes
        put(env, "RIFF_YTDLP_PYTHON", new File(nativeDir, "libpython.so").getAbsolutePath());
        put(env, "RIFF_YTDLP_SCRIPT", new File(new File(ytdlBase, "yt-dlp"), "yt-dlp").getAbsolutePath());
        put(env, "RIFF_YTDLP_QUICKJS", new File(nativeDir, "libqjs.so").getAbsolutePath());
        put(env, "RIFF_FFMPEG", new File(nativeDir, "libffmpeg.so").getAbsolutePath());
        put(env, "LD_LIBRARY_PATH", new File(python, "usr/lib").getAbsolutePath() + ":"
                + new File(packages, "ffmpeg/usr/lib").getAbsolutePath() + ":"
                + new File(packages, "aria2c/usr/lib").getAbsolutePath());
        put(env, "SSL_CERT_FILE", new File(python, "usr/etc/tls/cert.pem").getAbsolutePath());
        put(env, "PYTHONHOME", new File(python, "usr").getAbsolutePath());
        put(env, "PATH", System.getenv("PATH") + ":" + nativeDir.getAbsolutePath());
        return env.toArray(new String[0]);
    }

    private static void put(List<String> env, String key, String value) {
        env.add(key);
        env.add(value);
    }

    /** Unpacks assets/riff.zip into files/riff once per installed app version. */
    private static File unpackApp(Context app) throws IOException {
        File dir = new File(app.getFilesDir(), "riff");
        SharedPreferences prefs = app.getSharedPreferences("riff", Context.MODE_PRIVATE);
        String stamp = versionName(app) + ":" + lastUpdate(app);
        if (dir.isDirectory() && stamp.equals(prefs.getString("unpacked", ""))) return dir;

        deleteRecursively(dir);
        File tmp = new File(app.getFilesDir(), "riff.tmp");
        deleteRecursively(tmp);
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(app.getAssets().open("riff.zip")))) {
            byte[] buf = new byte[64 * 1024];
            ZipEntry entry;
            String root = tmp.getCanonicalPath() + File.separator;
            while ((entry = zip.getNextEntry()) != null) {
                File out = new File(tmp, entry.getName());
                if (!out.getCanonicalPath().startsWith(root)) throw new IOException("bad zip entry " + entry.getName());
                if (entry.isDirectory()) {
                    out.mkdirs();
                    continue;
                }
                out.getParentFile().mkdirs();
                try (OutputStream os = new FileOutputStream(out)) {
                    int n;
                    while ((n = zip.read(buf)) > 0) os.write(buf, 0, n);
                }
            }
        }
        if (!tmp.renameTo(dir)) throw new IOException("could not move unpacked app into place");
        prefs.edit().putString("unpacked", stamp).apply();
        return dir;
    }

    private static void watchSession(File sessionFile) {
        new Thread(() -> {
            long deadline = System.currentTimeMillis() + 120_000;
            while (System.currentTimeMillis() < deadline) {
                if (sessionFile.length() > 0) {
                    try {
                        String text = new String(Files.readAllBytes(sessionFile.toPath()), StandardCharsets.UTF_8);
                        JSONObject o = new JSONObject(text);
                        if (o.has("error")) fail(o.getString("error"));
                        else ready(new Session(o));
                        return;
                    } catch (Exception e) {
                        // written but not complete yet
                    }
                }
                try {
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    return;
                }
            }
            fail("Riff's server did not start in time");
        }, "node-session").start();
    }

    private static void ready(Session s) {
        List<Listener> copy;
        synchronized (NodeRunner.class) {
            session = s;
            copy = new ArrayList<>(listeners);
            listeners.clear();
        }
        MAIN.post(() -> {
            for (Listener l : copy) l.onReady(s);
        });
    }

    private static void fail(String message) {
        List<Listener> copy;
        synchronized (NodeRunner.class) {
            if (session != null || error != null) return;
            error = message;
            copy = new ArrayList<>(listeners);
            listeners.clear();
        }
        MAIN.post(() -> {
            for (Listener l : copy) l.onError(message);
        });
    }

    static String versionName(Context app) {
        try {
            return app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    private static long lastUpdate(Context app) {
        try {
            PackageInfo info = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
            return info.lastUpdateTime;
        } catch (Exception e) {
            return 0;
        }
    }

    static void deleteRecursively(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursively(c);
        f.delete();
    }

    static void copy(InputStream in, File out) throws IOException {
        try (InputStream is = in; OutputStream os = new FileOutputStream(out)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
        }
    }
}
