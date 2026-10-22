package io.github.skibididobdob228.riffspotify;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.FileObserver;
import android.os.Handler;
import android.os.HandlerThread;
import android.provider.MediaStore;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * Riff saves downloads in the app's own Music folder (Android/data/...), which other apps and file
 * managers can't easily reach. Each finished download is also copied to the shared Music/Riff
 * collection, where music players and file managers find it.
 */
final class DownloadExporter {
    private static final String TAG = "RiffDownloads";
    private static final String RELATIVE_PATH = "Music/Riff/";
    private static FileObserver observer;

    private DownloadExporter() {
    }

    static synchronized void watch(Context context, File dir) {
        if (observer != null || Build.VERSION.SDK_INT < 29) return;
        Context app = context.getApplicationContext();
        HandlerThread thread = new HandlerThread("download-export");
        thread.start();
        Handler handler = new Handler(thread.getLooper());
        observer = new FileObserver(dir, FileObserver.CLOSE_WRITE | FileObserver.MOVED_TO) {
            @Override
            public void onEvent(int event, String name) {
                if (name == null || mimeType(name) == null) return;
                // ffmpeg and yt-dlp rename into place; give the file a moment to settle
                handler.postDelayed(() -> export(app, new File(dir, name)), 1500);
            }
        };
        observer.startWatching();
    }

    private static void export(Context app, File file) {
        if (!file.isFile() || file.length() == 0) return;
        ContentResolver resolver = app.getContentResolver();
        Uri collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        String[] args = {file.getName(), RELATIVE_PATH};
        try (Cursor c = resolver.query(collection, new String[]{MediaStore.Audio.Media._ID},
                MediaStore.Audio.Media.DISPLAY_NAME + "=? AND " + MediaStore.Audio.Media.RELATIVE_PATH + "=?", args, null)) {
            if (c != null && c.moveToFirst()) return;
        }

        ContentValues values = new ContentValues();
        values.put(MediaStore.Audio.Media.DISPLAY_NAME, file.getName());
        values.put(MediaStore.Audio.Media.MIME_TYPE, mimeType(file.getName()));
        values.put(MediaStore.Audio.Media.RELATIVE_PATH, RELATIVE_PATH);
        values.put(MediaStore.Audio.Media.IS_PENDING, 1);
        Uri item = resolver.insert(collection, values);
        if (item == null) return;
        try (InputStream in = new FileInputStream(file); OutputStream out = resolver.openOutputStream(item)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            values.clear();
            values.put(MediaStore.Audio.Media.IS_PENDING, 0);
            resolver.update(item, values, null, null);
            Log.i(TAG, "exported " + file.getName() + " to " + RELATIVE_PATH);
        } catch (Exception e) {
            resolver.delete(item, null, null);
            Log.w(TAG, "export failed for " + file.getName(), e);
        }
    }

    private static String mimeType(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".mp3")) return "audio/mpeg";
        if (n.endsWith(".m4a")) return "audio/mp4";
        if (n.endsWith(".flac")) return "audio/flac";
        if (n.endsWith(".opus") || n.endsWith(".ogg")) return "audio/ogg";
        if (n.endsWith(".wav")) return "audio/wav";
        return null;
    }
}
