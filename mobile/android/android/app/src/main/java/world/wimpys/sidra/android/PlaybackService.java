package world.wimpys.sidra.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class PlaybackService extends Service {

    public interface CommandSink {
        void sendPlayerCommand(String command, Object... args);
    }

    public static final String ACTION_SNAPSHOT = "world.wimpys.sidra.android.SNAPSHOT";
    public static final String ACTION_CLEAR = "world.wimpys.sidra.android.CLEAR";
    public static final String EXTRA_STABLE_STATE = "stableState";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_DURATION_MS = "durationMs";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_ALBUM = "album";
    public static final String EXTRA_ARTWORK_URL = "artworkUrl";

    private static final String CHANNEL_ID = "sidra_playback";
    private static final int NOTIFICATION_ID = 1;
    private static CommandSink commandSink;

    private MediaSession mediaSession;
    private boolean playing;
    private boolean foreground;
    private long positionMs;
    private long durationMs;
    private String title = "Sidra";
    private String artist = "";
    private String album = "";
    private String artworkUrl = "";
    private Bitmap artwork;
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public static void setCommandSink(CommandSink sink) {
        commandSink = sink;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        mediaSession = new MediaSession(this, "Sidra");
        mediaSession.setCallback(
            new MediaSession.Callback() {
                @Override
                public void onPlay() {
                    sendCommand("player:play");
                }

                @Override
                public void onPause() {
                    sendCommand("player:pause");
                }

                @Override
                public void onSkipToNext() {
                    sendCommand("player:next");
                }

                @Override
                public void onSkipToPrevious() {
                    sendCommand("player:previous");
                }

                @Override
                public void onSeekTo(long position) {
                    sendCommand("player:seek", position / 1000.0);
                }
            }
        );
        mediaSession.setActive(true);
        registerReceiver(
            becomingNoisyReceiver,
            new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
        );
        updateSession();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        switch (intent.getAction()) {
            case ACTION_SNAPSHOT:
                boolean wasPlaying = playing;
                String previousTitle = title;
                String previousArtist = artist;
                String previousAlbum = album;
                String previousArtworkUrl = artworkUrl;
                playing = "playing".equals(
                    intent.getStringExtra(EXTRA_STABLE_STATE)
                );
                positionMs = intent.getLongExtra(EXTRA_POSITION_MS, positionMs);
                title = valueOrEmpty(intent.getStringExtra(EXTRA_TITLE));
                artist = valueOrEmpty(intent.getStringExtra(EXTRA_ARTIST));
                album = valueOrEmpty(intent.getStringExtra(EXTRA_ALBUM));
                durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0);
                String nextArtworkUrl =
                    valueOrEmpty(intent.getStringExtra(EXTRA_ARTWORK_URL));
                boolean metadataChanged =
                    !title.equals(previousTitle)
                    || !artist.equals(previousArtist)
                    || !album.equals(previousAlbum)
                    || !nextArtworkUrl.equals(previousArtworkUrl);
                if (!nextArtworkUrl.equals(previousArtworkUrl)) {
                    loadArtwork(nextArtworkUrl);
                } else if (metadataChanged) {
                    updateMetadata();
                }
                updateSession();
                if (playing) {
                    if (!foreground || metadataChanged || !wasPlaying) {
                        startForeground(NOTIFICATION_ID, buildNotification());
                        foreground = true;
                    }
                } else if (foreground) {
                    stopForeground(false);
                    foreground = false;
                    notifyPlayback();
                } else if (metadataChanged || wasPlaying) {
                    notifyPlayback();
                }
                break;
            case ACTION_CLEAR:
                clearSession();
                break;
            default:
                break;
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        unregisterReceiver(becomingNoisyReceiver);
        artworkExecutor.shutdownNow();
        mediaSession.release();
        super.onDestroy();
    }

    private void updateMetadata() {
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (artwork != null) {
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
        }
        mediaSession.setMetadata(metadata.build());
    }

    private void updateSession() {
        long actions =
            PlaybackState.ACTION_PLAY
                | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT
                | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_SEEK_TO;
        mediaSession.setPlaybackState(
            new PlaybackState.Builder()
                .setActions(actions)
                .setState(
                    playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                    positionMs,
                    playing ? 1.0f : 0.0f
                )
                .build()
        );
    }

    private Notification buildNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        Notification.Builder notification = new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(contentIntent)
            .setOngoing(playing)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setStyle(new Notification.MediaStyle().setMediaSession(mediaSession.getSessionToken()));
        if (artwork != null) notification.setLargeIcon(artwork);
        return notification.build();
    }

    private void notifyPlayback() {
        NotificationManager manager =
            (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        manager.notify(NOTIFICATION_ID, buildNotification());
    }

    private void createNotificationChannel() {
        NotificationManager manager =
            (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Apple Music playback controls");
        manager.createNotificationChannel(channel);
    }

    private final BroadcastReceiver becomingNoisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            sendCommand("player:pause");
        }
    };

    private void sendCommand(String command, Object... args) {
        CommandSink sink = commandSink;
        if (sink != null) sink.sendPlayerCommand(command, args);
    }

    private void clearSession() {
        playing = false;
        positionMs = 0;
        durationMs = 0;
        title = "Sidra";
        artist = "";
        album = "";
        artworkUrl = "";
        artwork = null;
        mediaSession.setActive(false);
        stopForeground(true);
        foreground = false;
        NotificationManager manager =
            (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        manager.cancel(NOTIFICATION_ID);
        stopSelf();
    }

    private void loadArtwork(String url) {
        artworkUrl = url;
        artwork = null;
        updateMetadata();
        notifyPlayback();
        if (url.isEmpty()) return;

        artworkExecutor.execute(
            () -> {
                Bitmap loaded = readCachedArtwork(url);
                if (loaded == null) loaded = downloadArtwork(url);
                if (loaded == null) return;

                Bitmap finalArtwork = loaded;
                mainHandler.post(
                    () -> {
                        if (!url.equals(artworkUrl)) return;
                        artwork = finalArtwork;
                        updateMetadata();
                        notifyPlayback();
                    }
                );
            }
        );
    }

    private Bitmap readCachedArtwork(String url) {
        File file = artworkCacheFile(url);
        if (!file.isFile()) return null;
        try (FileInputStream input = new FileInputStream(file)) {
            return BitmapFactory.decodeStream(input);
        } catch (IOException error) {
            return null;
        }
    }

    private Bitmap downloadArtwork(String urlString) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(urlString);
            if (!"https".equals(url.getProtocol())) return null;
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setInstanceFollowRedirects(true);
            Bitmap bitmap = BitmapFactory.decodeStream(connection.getInputStream());
            if (bitmap != null) {
                try (FileOutputStream output = new FileOutputStream(artworkCacheFile(urlString))) {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
                }
            }
            return bitmap;
        } catch (IOException error) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private File artworkCacheFile(String url) {
        File directory = new File(getCacheDir(), "artwork");
        if (!directory.exists()) directory.mkdirs();
        return new File(directory, Integer.toHexString(url.hashCode()) + ".png");
    }

    private String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }
}
