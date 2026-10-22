package io.github.skibididobdob228.riffspotify;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Keeps the app alive while music plays and mirrors Riff's Media Session into Android:
 * notification, lock screen, headset and Bluetooth buttons. Commands go back to the page
 * through window.__riffAndroid.media(). Audio focus (calls, other players) is handled by the WebView itself.
 */
public final class PlaybackService extends Service {
    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 1;
    private static final String ACTION_UPDATE = "update";
    private static final String ACTION_COMMAND = "command";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static PlaybackService instance;
    private static JSONObject latest;

    private MediaSessionCompat session;
    private boolean foreground;
    private boolean noisyRegistered;
    private String artworkUrl;
    private Bitmap artwork;

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            sendToPage("pause");
        }
    };

    /** Called by the bridge for every metadata/state change on the page. */
    static void update(Context app, String json) {
        JSONObject state;
        try {
            state = new JSONObject(json);
        } catch (Exception e) {
            return;
        }
        MAIN.post(() -> {
            latest = state;
            if (instance != null) {
                instance.apply();
            } else if ("playing".equals(state.optString("state"))) {
                Intent intent = new Intent(app, PlaybackService.class).setAction(ACTION_UPDATE);
                ContextCompat.startForegroundService(app, intent);
            }
        });
    }

    static void stop(Context app) {
        app.stopService(new Intent(app, PlaybackService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW));

        session = new MediaSessionCompat(this, "Riff");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                sendToPage("play");
            }

            @Override
            public void onPause() {
                sendToPage("pause");
            }

            @Override
            public void onSkipToNext() {
                sendToPage("next");
            }

            @Override
            public void onSkipToPrevious() {
                sendToPage("prev");
            }

            @Override
            public void onStop() {
                sendToPage("pause");
            }

            @Override
            public void onSeekTo(long pos) {
                WebViewHolder.evaluate("window.__riffAndroid && window.__riffAndroid.media('seek'," + (pos / 1000.0) + ")");
            }
        });
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE));
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_COMMAND.equals(intent.getAction())) {
            sendToPage(intent.getStringExtra("cmd"));
        }
        apply();
        return START_NOT_STICKY;
    }

    private void apply() {
        JSONObject s = latest != null ? latest : new JSONObject();
        String state = s.optString("state", "none");
        boolean playing = "playing".equals(state);
        if ("none".equals(state) || s.optString("title").isEmpty()) {
            stopSelf();
            return;
        }

        long durationMs = (long) (s.optDouble("duration", 0) * 1000);
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.optString("title"))
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.optString("artist"))
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.optString("album"))
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs > 0 ? durationMs : -1);
        if (artwork != null) meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(meta.build());
        loadArtwork(s.optString("artwork"));

        long position = (long) (s.optDouble("position", 0) * 1000);
        float rate = (float) s.optDouble("rate", 1);
        session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
                        | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                        | PlaybackStateCompat.ACTION_SEEK_TO | PlaybackStateCompat.ACTION_STOP)
                .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, position, playing ? rate : 0f)
                .build());

        Notification notification = buildNotification(s, playing);
        if (playing) {
            registerNoisy(true);
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            foreground = true;
        } else {
            registerNoisy(false);
            if (foreground) {
                // Paused: the notification stays (and can be swiped away), the service may be stopped by the system
                stopForeground(STOP_FOREGROUND_DETACH);
                foreground = false;
            }
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification(JSONObject s, boolean playing) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(s.optString("title"))
                .setContentText(s.optString("artist"))
                .setLargeIcon(artwork)
                .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
                .setDeleteIntent(command("pause", 9))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setOngoing(playing)
                .addAction(R.drawable.ic_prev, "Previous", command("prev", 1))
                .addAction(playing ? R.drawable.ic_pause : R.drawable.ic_play, playing ? "Pause" : "Play", command(playing ? "pause" : "play", 2))
                .addAction(R.drawable.ic_next, "Next", command("next", 3))
                .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    private PendingIntent command(String cmd, int requestCode) {
        Intent i = new Intent(this, PlaybackService.class).setAction(ACTION_COMMAND).putExtra("cmd", cmd);
        return PendingIntent.getService(this, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void loadArtwork(String url) {
        if (url == null || url.isEmpty() || url.equals(artworkUrl)) return;
        artworkUrl = url;
        new Thread(() -> {
            Bitmap bmp = null;
            try {
                Uri uri = Uri.parse(url);
                InputStream in;
                if ("file".equals(uri.getScheme())) {
                    in = new java.io.FileInputStream(uri.getPath());
                } else {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(8000);
                    in = c.getInputStream();
                }
                try (InputStream is = in) {
                    bmp = BitmapFactory.decodeStream(is);
                }
            } catch (Exception e) {
                Log.w("RiffWeb", "artwork failed " + url, e);
            }
            Bitmap result = bmp;
            MAIN.post(() -> {
                if (!url.equals(artworkUrl)) return;
                artwork = result;
                if (instance == this) apply();
            });
        }, "artwork").start();
    }

    private void registerNoisy(boolean on) {
        if (on == noisyRegistered) return;
        noisyRegistered = on;
        if (on) {
            ContextCompat.registerReceiver(this, noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED);
        } else {
            unregisterReceiver(noisy);
        }
    }

    private static void sendToPage(String cmd) {
        if (cmd == null) return;
        WebViewHolder.evaluate("window.__riffAndroid && window.__riffAndroid.media(" + JSONObject.quote(cmd) + ")");
    }

    @Override
    public void onDestroy() {
        registerNoisy(false);
        session.setActive(false);
        session.release();
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
