package ph.grabcycle.app.ui.common;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.annotation.StringRes;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

/** Confirmation dialogs for consequential actions. */
public final class Dialogs {
    private Dialogs() {}

    public static void confirm(@NonNull Context c, @StringRes int title, @NonNull CharSequence message,
                               @StringRes int confirmLabel, @NonNull Runnable onConfirm) {
        new MaterialAlertDialogBuilder(c)
                .setTitle(title)
                .setMessage(message)
                .setNegativeButton(ph.grabcycle.app.R.string.action_cancel, null)
                .setPositiveButton(confirmLabel, (d, w) -> onConfirm.run())
                .show();
    }

    public static void info(@NonNull Context c, @StringRes int title, @NonNull CharSequence message) {
        new MaterialAlertDialogBuilder(c)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton(ph.grabcycle.app.R.string.action_ok, null)
                .show();
    }
}
