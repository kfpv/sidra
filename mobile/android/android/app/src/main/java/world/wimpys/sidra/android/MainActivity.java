package world.wimpys.sidra.android;

import android.annotation.SuppressLint;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "SidraAndroid";
    private static final String APPLE_MUSIC_ORIGIN = "https://music.apple.com";
    private boolean playbackActive;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        bridgeBuilder.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    Log.i(TAG, "Page visible: " + url);
                }

                @Override
                public void onReceivedError(WebView view) {
                    Log.e(TAG, "WebView reported a page load error");
                }

                @Override
                public void onReceivedHttpError(WebView view) {
                    Log.w(TAG, "WebView reported an HTTP error");
                }
            }
        );

        super.onCreate(savedInstanceState);
        configureAppleMusicWebView();
        PlaybackService.setCommandSink(this::sendPlayerCommand);
        requestNotificationPermission();
        installBackNavigation();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureAppleMusicWebView() {
        WebView webView = bridge.getWebView();
        WebSettings settings = webView.getSettings();
        String defaultUserAgent = settings.getUserAgentString();
        String chromeUserAgent = defaultUserAgent
            .replace("; wv)", ")")
            .replace(" Version/4.0", "");

        webView.stopLoading();
        settings.setUserAgentString(chromeUserAgent);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        Log.i(TAG, "WebView package: " + WebViewCompat.getCurrentWebViewPackage(this));
        Log.i(TAG, "User-Agent: " + chromeUserAgent);

        installSidraBridge(webView);
        installDiagnosticHook(webView);
        installMusicKitHook(webView);
        installPluginManagerHook(webView);
        webView.loadUrl(APPLE_MUSIC_ORIGIN);
    }

    private void installSidraBridge(WebView webView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.w(TAG, "Web-message listeners are unavailable; Sidra navigation disabled");
            return;
        }

        Set<String> allowedOrigins = Collections.singleton(APPLE_MUSIC_ORIGIN);
        WebViewCompat.addWebMessageListener(
            webView,
            "SidraAndroid",
            allowedOrigins,
            (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                if (!isMainFrame || !APPLE_MUSIC_ORIGIN.equals(sourceOrigin.toString())) return;

                handleBridgeMessage(message.getData());
            }
        );
        Log.i(TAG, "Installed origin-scoped Sidra web-message bridge");
    }

    private void handleBridgeMessage(String message) {
        if ("nav:pluginManager".equals(message)) {
            Log.i(TAG, "Navigation requested: " + message);
            startActivity(new Intent(this, PluginManagerActivity.class));
            return;
        }

        try {
            JSONObject event = new JSONObject(message);
            String channel = event.getString("channel");
            Object data = event.opt("data");
            switch (channel) {
                case "playbackSnapshotDidChange":
                    handlePlaybackSnapshot(data);
                    break;
                default:
                    Log.w(TAG, "Blocked unrecognised bridge channel: " + channel);
                    break;
            }
        } catch (JSONException error) {
            Log.w(TAG, "Blocked malformed bridge message", error);
        }
    }

    private void handlePlaybackSnapshot(Object data) throws JSONException {
        if (!(data instanceof JSONObject)) return;
        JSONObject snapshot = (JSONObject) data;
        if (snapshot.optInt("version") != 1) return;

        JSONObject item = snapshot.optJSONObject("metadata");
        if (item == null) {
            playbackActive = false;
            startService(
                new Intent(this, PlaybackService.class)
                    .setAction(PlaybackService.ACTION_CLEAR)
            );
            return;
        }

        String stableState = snapshot.getString("stableState");
        playbackActive = "playing".equals(stableState);
        Intent intent = new Intent(this, PlaybackService.class)
            .setAction(PlaybackService.ACTION_SNAPSHOT)
            .putExtra(PlaybackService.EXTRA_STABLE_STATE, stableState)
            .putExtra(
                PlaybackService.EXTRA_POSITION_MS,
                snapshot.optLong("positionUs") / 1000
            )
            .putExtra(PlaybackService.EXTRA_TITLE, item.optString("name"))
            .putExtra(PlaybackService.EXTRA_ARTIST, item.optString("artistName"))
            .putExtra(PlaybackService.EXTRA_ALBUM, item.optString("albumName"))
            .putExtra(PlaybackService.EXTRA_ARTWORK_URL, item.optString("artworkUrl"))
            .putExtra(
                PlaybackService.EXTRA_DURATION_MS,
                item.optLong("durationInMillis")
            );
        if (playbackActive) {
            ContextCompat.startForegroundService(this, intent);
        } else {
            startService(intent);
        }
    }

    private void sendPlayerCommand(String channel, Object... args) {
        JSONArray encodedArgs = new JSONArray();
        for (Object arg : args) encodedArgs.put(arg);
        String script =
            "window.postMessage({type:'sidra:command',channel:"
                + JSONObject.quote(channel)
                + ",args:"
                + encodedArgs
                + "},'https://music.apple.com')";
        runOnUiThread(() -> bridge.getWebView().evaluateJavascript(script, null));
    }

    private void installDiagnosticHook(WebView webView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.w(TAG, "Document-start scripts are unavailable; diagnostics disabled");
            return;
        }

        try {
            String script = readRawResource(R.raw.sidra_android_hook);
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                script,
                Collections.singleton(APPLE_MUSIC_ORIGIN)
            );
            Log.i(TAG, "Installed origin-scoped Apple Music diagnostic hook");
        } catch (IOException | IllegalArgumentException error) {
            Log.e(TAG, "Failed to install diagnostic hook", error);
        }
    }

    private void installMusicKitHook(WebView webView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.w(TAG, "Document-start scripts are unavailable; MusicKit bridge disabled");
            return;
        }

        try {
            String script = readRawResource(R.raw.music_kit_hook);
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                script,
                Collections.singleton(APPLE_MUSIC_ORIGIN)
            );
            Log.i(TAG, "Installed shared MusicKit bridge");
        } catch (IOException | IllegalArgumentException error) {
            Log.e(TAG, "Failed to install MusicKit bridge", error);
        }
    }

    private void installPluginManagerHook(WebView webView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.w(TAG, "Document-start scripts are unavailable; Plugin Manager menu disabled");
            return;
        }

        try {
            String script = readRawResource(R.raw.plugin_manager);
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                script,
                Collections.singleton(APPLE_MUSIC_ORIGIN)
            );
            Log.i(TAG, "Installed shared Plugin Manager menu hook");
        } catch (IOException | IllegalArgumentException error) {
            Log.e(TAG, "Failed to install Plugin Manager menu hook", error);
        }
    }

    private String readRawResource(int resourceId) throws IOException {
        try (InputStream stream = getResources().openRawResource(resourceId)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = stream.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private void requestNotificationPermission() {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                new String[] { Manifest.permission.POST_NOTIFICATIONS },
                1
            );
        }
    }

    private void installBackNavigation() {
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    WebView webView = bridge.getWebView();
                    if (webView.canGoBack()) {
                        webView.goBack();
                        return;
                    }
                    if (playbackActive) {
                        moveTaskToBack(true);
                        return;
                    }

                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        );
    }

    @Override
    public void onDestroy() {
        PlaybackService.setCommandSink(null);
        super.onDestroy();
    }
}
