package io.github.skibididobdob228.riffspotify;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.yausername.youtubedl_android.YoutubeDL;

/** Keeps yt-dlp current (YouTube changes often), at most once a day, like Riff does on desktop. */
final class YtDlpUpdater {
    private static final long DAY = 24L * 3600 * 1000;

    private YtDlpUpdater() {
    }

    static void updateInBackground(Context app) {
        SharedPreferences prefs = app.getSharedPreferences("riff", Context.MODE_PRIVATE);
        if (System.currentTimeMillis() - prefs.getLong("ytdlpChecked", 0) < DAY) return;
        new Thread(() -> {
            try {
                YoutubeDL.UpdateStatus status = YoutubeDL.getInstance().updateYoutubeDL(app, YoutubeDL.UpdateChannel._STABLE);
                prefs.edit().putLong("ytdlpChecked", System.currentTimeMillis()).apply();
                Log.i("RiffNode", "yt-dlp update: " + status + ", now " + YoutubeDL.getInstance().versionName(app));
            } catch (Exception e) {
                Log.w("RiffNode", "yt-dlp update failed", e);
            }
        }, "ytdlp-update").start();
    }
}
