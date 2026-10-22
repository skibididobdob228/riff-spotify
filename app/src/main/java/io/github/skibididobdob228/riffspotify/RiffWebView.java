package io.github.skibididobdob228.riffspotify;

import android.content.Context;
import android.view.View;
import android.webkit.WebView;

/**
 * Chromium pauses media once the WebView's window is hidden, which would stop music when the app
 * goes to the background. This WebView always reports a visible window; Riff still learns about
 * the app being hidden through window.electronAPI.onWindowVisibility and stops its animations.
 */
final class RiffWebView extends WebView {
    RiffWebView(Context context) {
        super(context);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(View.VISIBLE);
    }
}
