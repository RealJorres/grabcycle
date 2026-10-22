package ph.grabcycle.app.ui.common;

import android.content.Context;
import android.util.AttributeSet;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.FrameLayout;

import androidx.annotation.DrawableRes;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import ph.grabcycle.app.R;
import ph.grabcycle.app.databinding.ViewStateBinding;

/**
 * Reusable loading / empty / error / offline state with an optional retry
 * action, so no screen ever fails silently.
 */
public class StateView extends FrameLayout {
    private final ViewStateBinding b;

    public StateView(@NonNull Context context) {
        this(context, null);
    }

    public StateView(@NonNull Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);
        b = ViewStateBinding.inflate(LayoutInflater.from(context), this);
        hide();
    }

    public void showLoading(@Nullable CharSequence message) {
        setVisibility(VISIBLE);
        b.progress.setVisibility(VISIBLE);
        b.icon.setVisibility(GONE);
        b.title.setVisibility(message != null ? VISIBLE : GONE);
        b.title.setText(message);
        b.message.setVisibility(GONE);
        b.action.setVisibility(GONE);
    }

    public void showEmpty(@DrawableRes int icon, @NonNull CharSequence title, @Nullable CharSequence message) {
        show(icon, title, message, null, null);
    }

    public void showError(@NonNull CharSequence title, @Nullable CharSequence message, @Nullable Runnable retry) {
        show(R.drawable.ic_error, title, message, retry != null ? getContext().getString(R.string.action_retry) : null, retry);
    }

    public void showOffline(@Nullable Runnable retry) {
        show(R.drawable.ic_cloud_off, getContext().getString(R.string.state_offline_title),
                getContext().getString(R.string.state_offline_message),
                retry != null ? getContext().getString(R.string.action_retry) : null, retry);
    }

    public void show(@DrawableRes int icon, @NonNull CharSequence title, @Nullable CharSequence message,
                     @Nullable CharSequence actionLabel, @Nullable Runnable action) {
        setVisibility(VISIBLE);
        b.progress.setVisibility(GONE);
        b.icon.setVisibility(VISIBLE);
        b.icon.setImageResource(icon);
        b.title.setVisibility(VISIBLE);
        b.title.setText(title);
        b.message.setVisibility(message != null ? VISIBLE : GONE);
        b.message.setText(message);
        if (actionLabel != null && action != null) {
            b.action.setVisibility(VISIBLE);
            b.action.setText(actionLabel);
            b.action.setOnClickListener(v -> action.run());
        } else {
            b.action.setVisibility(GONE);
        }
    }

    public void hide() {
        setVisibility(View.GONE);
    }
}
