package ph.grabcycle.app.ui.common;

import android.view.View;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import ph.grabcycle.app.R;

/**
 * Common activity behaviour: an offline banner (any layout that includes
 * {@code include_offline_banner}) driven by real connectivity, so cached data
 * is never presented as live without notice.
 */
public abstract class BaseActivity extends AppCompatActivity {

    @Override
    protected void onPostCreate(@Nullable android.os.Bundle savedInstanceState) {
        super.onPostCreate(savedInstanceState);
        View banner = findViewById(R.id.offline_banner);
        if (banner != null) {
            ConnectivityMonitor.get(this).observe(this, online -> banner.setVisibility(Boolean.TRUE.equals(online) ? View.GONE : View.VISIBLE));
        }
    }

    protected boolean isOnline() {
        return ConnectivityMonitor.get(this).isOnlineNow();
    }
}
