package ph.grabcycle.app.ui.common;

import android.content.res.ColorStateList;
import android.widget.TextView;

import androidx.annotation.ColorRes;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.StringRes;
import androidx.core.content.ContextCompat;

import ph.grabcycle.app.R;
import ph.grabcycle.core.model.DocumentStatus;
import ph.grabcycle.core.model.DriverStatus;
import ph.grabcycle.core.model.PaymentStatus;
import ph.grabcycle.core.model.RideStatus;
import ph.grabcycle.core.model.VerificationStatus;

/** Consistent labels and colours for status chips across the app. */
public final class StatusStyles {
    private StatusStyles() {}

    private enum Tone { SUCCESS, WARNING, DANGER, INFO, NEUTRAL }

    public static void apply(@NonNull TextView chip, @StringRes int label, @NonNull String toneName) {
        Tone tone = Tone.valueOf(toneName);
        chip.setText(label);
        @ColorRes int fg;
        @ColorRes int bg;
        switch (tone) {
            case SUCCESS: fg = R.color.gc_status_success; bg = R.color.gc_status_success_bg; break;
            case WARNING: fg = R.color.gc_status_warning; bg = R.color.gc_status_warning_bg; break;
            case DANGER: fg = R.color.gc_status_danger; bg = R.color.gc_status_danger_bg; break;
            case INFO: fg = R.color.gc_status_info; bg = R.color.gc_status_info_bg; break;
            default: fg = R.color.gc_status_neutral; bg = R.color.gc_status_neutral_bg;
        }
        if (chip.getBackground() == null) {
            // Chips declared without styling get the standard pill shape.
            chip.setBackgroundResource(R.drawable.bg_status_chip);
            float d = chip.getResources().getDisplayMetrics().density;
            chip.setPadding((int) (10 * d), (int) (4 * d), (int) (10 * d), (int) (4 * d));
        }
        chip.setTextColor(ContextCompat.getColor(chip.getContext(), fg));
        chip.setBackgroundTintList(ColorStateList.valueOf(ContextCompat.getColor(chip.getContext(), bg)));
    }

    public static void verification(@NonNull TextView chip, @NonNull VerificationStatus s) {
        switch (s) {
            case APPROVED: apply(chip, R.string.vstatus_approved, "SUCCESS"); break;
            case SUBMITTED: apply(chip, R.string.vstatus_submitted, "INFO"); break;
            case UNDER_REVIEW: apply(chip, R.string.vstatus_under_review, "INFO"); break;
            case NEEDS_RESUBMISSION: apply(chip, R.string.vstatus_needs_resubmission, "WARNING"); break;
            case REJECTED: apply(chip, R.string.vstatus_rejected, "DANGER"); break;
            case SUSPENDED: apply(chip, R.string.vstatus_suspended, "DANGER"); break;
            default: apply(chip, R.string.vstatus_not_submitted, "NEUTRAL");
        }
    }

    public static void driver(@NonNull TextView chip, @NonNull DriverStatus s) {
        switch (s) {
            case APPROVED: apply(chip, R.string.dstatus_approved, "SUCCESS"); break;
            case UNDER_REVIEW: apply(chip, R.string.dstatus_under_review, "INFO"); break;
            case DOCUMENTS_PENDING: apply(chip, R.string.dstatus_documents_pending, "NEUTRAL"); break;
            case NEEDS_RESUBMISSION: apply(chip, R.string.dstatus_needs_resubmission, "WARNING"); break;
            case EXPIRED: apply(chip, R.string.dstatus_expired, "WARNING"); break;
            case REJECTED: apply(chip, R.string.dstatus_rejected, "DANGER"); break;
            case SUSPENDED: apply(chip, R.string.dstatus_suspended, "DANGER"); break;
            default: apply(chip, R.string.dstatus_profile_incomplete, "NEUTRAL");
        }
    }

    public static void document(@NonNull TextView chip, @NonNull DocumentStatus s) {
        switch (s) {
            case APPROVED: apply(chip, R.string.docstatus_approved, "SUCCESS"); break;
            case PENDING_REVIEW: apply(chip, R.string.docstatus_pending, "INFO"); break;
            case NEEDS_RESUBMISSION: apply(chip, R.string.docstatus_needs_resubmission, "WARNING"); break;
            case REJECTED: apply(chip, R.string.docstatus_rejected, "DANGER"); break;
            case EXPIRED: apply(chip, R.string.docstatus_expired, "WARNING"); break;
            default: apply(chip, R.string.docstatus_not_submitted, "NEUTRAL");
        }
    }

    public static void ride(@NonNull TextView chip, @NonNull RideStatus s) {
        switch (s) {
            case COMPLETED: apply(chip, R.string.rstatus_completed, "SUCCESS"); break;
            case IN_PROGRESS: apply(chip, R.string.rstatus_in_progress, "INFO"); break;
            case ACCEPTED: case DRIVER_EN_ROUTE: apply(chip, R.string.rstatus_driver_coming, "INFO"); break;
            case DRIVER_ARRIVED: apply(chip, R.string.rstatus_driver_arrived, "WARNING"); break;
            case REQUESTED: case SEARCHING: apply(chip, R.string.rstatus_searching, "NEUTRAL"); break;
            case NO_DRIVER_FOUND: apply(chip, R.string.rstatus_no_driver, "NEUTRAL"); break;
            case EXPIRED: apply(chip, R.string.rstatus_expired, "NEUTRAL"); break;
            case CANCELLED_BY_PASSENGER: case CANCELLED_BY_DRIVER: case CANCELLED_BY_ADMIN:
                apply(chip, R.string.rstatus_cancelled, "DANGER"); break;
            default: apply(chip, R.string.rstatus_unknown, "NEUTRAL");
        }
    }

    public static void payment(@NonNull TextView chip, @NonNull PaymentStatus s) {
        switch (s) {
            case PAID: apply(chip, R.string.pstatus_paid, "SUCCESS"); break;
            case PENDING: apply(chip, R.string.pstatus_pending, "WARNING"); break;
            case DISPUTED: apply(chip, R.string.pstatus_disputed, "WARNING"); break;
            case REFUNDED: apply(chip, R.string.pstatus_refunded, "INFO"); break;
            case FAILED: apply(chip, R.string.pstatus_failed, "DANGER"); break;
            default: apply(chip, R.string.pstatus_unpaid, "NEUTRAL");
        }
    }

    public static void support(@NonNull TextView chip, @Nullable String status) {
        if ("RESOLVED".equals(status) || "CLOSED".equals(status)) apply(chip, R.string.support_status_resolved, "SUCCESS");
        else if ("IN_PROGRESS".equals(status)) apply(chip, R.string.support_status_in_progress, "INFO");
        else apply(chip, R.string.support_status_open, "WARNING");
    }
}
