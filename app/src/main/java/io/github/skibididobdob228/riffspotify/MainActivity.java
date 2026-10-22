package io.github.skibididobdob228.riffspotify;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;

public final class MainActivity extends Activity implements NodeRunner.Listener {
    private FrameLayout root;
    private View splash;
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#121214"));
        // Keep Riff's UI clear of the status bar, navigation bar and display cutout
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                int types = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime();
                android.graphics.Insets i = insets.getInsets(types);
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            }
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);

        WebViewHolder.get(this);
        WebViewHolder.attach(this, root);
        splash = buildSplash();
        root.addView(splash);
        NodeRunner.start(this, this);

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
            }
        }
    }

    private View buildSplash() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#121214"));
        box.addView(new ProgressBar(this));
        status = new TextView(this);
        status.setTextColor(Color.parseColor("#CAC4D0"));
        status.setGravity(Gravity.CENTER);
        status.setPadding(48, 32, 48, 0);
        status.setText("Starting Riff…");
        box.addView(status);
        box.setLayoutParams(new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        return box;
    }

    @Override
    public void onReady(NodeRunner.Session session) {
        WebViewHolder.loadOnce(NodeRunner.appDir());
        root.removeView(splash);
    }

    @Override
    public void onError(String message) {
        status.setText("Riff could not start:\n" + message);
    }

    private void handleBack() {
        // The page closes its own dialogs and views first; with nothing left it calls moveToBackground()
        WebViewHolder.evaluate("window.__riffAndroid ? window.__riffAndroid.back() : RiffAndroidNative.moveToBackground()");
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == RiffBridge.PICK_REQUEST && WebViewHolder.bridge() != null) {
            WebViewHolder.bridge().onPickResult(resultCode == RESULT_OK ? data : null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        WebViewHolder.evaluate("window.__riffAndroid && window.__riffAndroid.visibility(true)");
    }

    @Override
    protected void onPause() {
        WebViewHolder.evaluate("window.__riffAndroid && window.__riffAndroid.visibility(false)");
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        // The WebView (and the music) lives on; it's re-attached when the activity comes back
        WebViewHolder.detach(this);
        super.onDestroy();
    }
}
