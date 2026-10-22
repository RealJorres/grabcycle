package ph.grabcycle.app.ui.common;

import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/** Edge-to-edge helpers (targetSdk 36 always draws behind system bars). */
public final class Insets {
    private Insets() {}

    /** Pads {@code view} by the system-bar (and IME) insets on the chosen edges, keeping its own padding. */
    public static void pad(@NonNull View view, boolean top, boolean bottom) {
        final int l = view.getPaddingLeft();
        final int t = view.getPaddingTop();
        final int r = view.getPaddingRight();
        final int b = view.getPaddingBottom();
        ViewCompat.setOnApplyWindowInsetsListener(view, (v, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            androidx.core.graphics.Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(l + bars.left, t + (top ? bars.top : 0), r + bars.right, b + (bottom ? Math.max(bars.bottom, ime.bottom) : 0));
            return insets;
        });
        ViewCompat.requestApplyInsets(view);
    }

    /** Adds the status-bar inset to a view's top margin (for floating map controls). */
    public static void marginTop(@NonNull View view) {
        final ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
        final int base = lp.topMargin;
        ViewCompat.setOnApplyWindowInsetsListener(view, (v, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            ViewGroup.MarginLayoutParams p = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            p.topMargin = base + bars.top;
            v.setLayoutParams(p);
            return insets;
        });
        ViewCompat.requestApplyInsets(view);
    }
}
