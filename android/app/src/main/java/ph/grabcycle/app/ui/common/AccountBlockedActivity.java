package ph.grabcycle.app.ui.common;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.databinding.ActivityAccountBlockedBinding;
import ph.grabcycle.app.ui.launch.LauncherActivity;

/** Full-screen explanation when the app cannot be used right now. */
public class AccountBlockedActivity extends AppCompatActivity {

    public enum Mode { SUSPENDED, STAFF, MAINTENANCE, UPDATE_REQUIRED, CONFIG_MISSING, SESSION_ENDED }

    private static final String EXTRA_MODE = "mode";
    private static final String EXTRA_MESSAGE = "message";

    public static void start(@NonNull Context c, @NonNull Mode mode, @Nullable String message) {
        c.startActivity(new Intent(c, AccountBlockedActivity.class)
                .putExtra(EXTRA_MODE, mode.name())
                .putExtra(EXTRA_MESSAGE, message)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ActivityAccountBlockedBinding b = ActivityAccountBlockedBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);

        Mode mode = Mode.valueOf(getIntent().getStringExtra(EXTRA_MODE) != null ? getIntent().getStringExtra(EXTRA_MODE) : Mode.SUSPENDED.name());
        String serverMessage = getIntent().getStringExtra(EXTRA_MESSAGE);
        b.signOut.setOnClickListener(v -> {
            b.signOut.setEnabled(false);
            AuthRepository.get().signOut(this).addOnCompleteListener(this, t -> {
                startActivity(new Intent(this, LauncherActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
                finish();
            });
        });
        switch (mode) {
            case STAFF:
                b.title.setText(R.string.blocked_staff_title);
                b.message.setText(R.string.blocked_staff_message);
                break;
            case MAINTENANCE:
                b.icon.setImageResource(R.drawable.ic_schedule);
                b.title.setText(R.string.blocked_maintenance_title);
                b.message.setText(R.string.blocked_maintenance_message);
                b.signOut.setVisibility(View.GONE);
                showRetry(b);
                break;
            case UPDATE_REQUIRED:
                b.icon.setImageResource(R.drawable.ic_refresh);
                b.title.setText(R.string.blocked_update_title);
                b.message.setText(R.string.blocked_update_message);
                b.primary.setVisibility(View.VISIBLE);
                b.primary.setText(R.string.blocked_update_action);
                b.primary.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_VIEW,
                        Uri.parse("market://details?id=" + getPackageName()))));
                break;
            case CONFIG_MISSING:
                b.icon.setImageResource(R.drawable.ic_error);
                b.title.setText(R.string.config_missing_title);
                b.message.setText(R.string.config_missing_message);
                b.signOut.setVisibility(View.GONE);
                break;
            case SESSION_ENDED:
                b.icon.setImageResource(R.drawable.ic_logout);
                b.title.setText(R.string.blocked_session_title);
                b.message.setText(R.string.blocked_session_message);
                b.signOut.setVisibility(View.GONE);
                showRetry(b);
                break;
            case SUSPENDED:
            default:
                b.title.setText(R.string.blocked_suspended_title);
                b.message.setText(serverMessage != null ? serverMessage : getString(R.string.blocked_suspended_message));
                b.support.setVisibility(View.VISIBLE);
                b.support.setText(R.string.blocked_suspended_support);
        }
    }

    private void showRetry(ActivityAccountBlockedBinding b) {
        b.primary.setVisibility(View.VISIBLE);
        b.primary.setText(R.string.action_continue);
        b.primary.setOnClickListener(v -> {
            startActivity(new Intent(this, LauncherActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            finish();
        });
    }
}
