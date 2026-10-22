package ph.grabcycle.app.ui.ride;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.lifecycle.LiveData;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.text.DateFormat;
import java.util.List;
import java.util.Locale;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.DocState;
import ph.grabcycle.app.data.RideRepository;
import ph.grabcycle.app.databinding.ActivityRideDetailBinding;
import ph.grabcycle.app.databinding.ItemFareLineBinding;
import ph.grabcycle.app.databinding.ItemTimelineEventBinding;
import ph.grabcycle.app.model.FareLine;
import ph.grabcycle.app.model.Payment;
import ph.grabcycle.app.model.Ride;
import ph.grabcycle.app.model.RideEvent;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.common.StatusStyles;
import ph.grabcycle.app.ui.support.SupportActivity;
import ph.grabcycle.core.model.PaymentStatus;
import ph.grabcycle.core.model.RideStatus;
import ph.grabcycle.core.util.Money;

/**
 * Receipt and timeline of one ride, read from the backend-written ride and
 * payment records. Amounts are never computed here; the screen shows what the
 * server recorded (final fare for completed trips, the quote otherwise).
 */
public class RideDetailActivity extends BaseActivity {

    private static final String EXTRA_RIDE = "rideId";
    private static final String EXTRA_AS_DRIVER = "asDriver";
    private static final int MIN_DISPUTE = 10;

    public static Intent intent(@NonNull Context c, @NonNull String rideId, boolean asDriver) {
        return new Intent(c, RideDetailActivity.class).putExtra(EXTRA_RIDE, rideId).putExtra(EXTRA_AS_DRIVER, asDriver);
    }

    private ActivityRideDetailBinding b;
    private String rideId;
    private boolean asDriver;
    @Nullable private Ride ride;
    @Nullable private Payment payment;
    @Nullable private LiveData<DocState<Payment>> paymentLive;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        rideId = getIntent().getStringExtra(EXTRA_RIDE);
        if (rideId == null) {
            finish();
            return;
        }
        asDriver = getIntent().getBooleanExtra(EXTRA_AS_DRIVER, false);
        b = ActivityRideDetailBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);
        b.toolbar.setNavigationOnClickListener(v -> finish());
        b.rideRef.setText(getString(R.string.detail_ref, rideId.substring(0, Math.min(8, rideId.length())).toUpperCase(Locale.US)));
        b.report.setOnClickListener(v -> startActivity(SupportActivity.intent(this, rideId)));
        b.dispute.setOnClickListener(v -> openDispute());
        b.recordCash.setOnClickListener(v -> openRecordCash());

        b.state.showLoading(null);
        RideRepository repo = RideRepository.get();
        repo.ride(rideId).observe(this, this::renderRide);
        repo.events(rideId).observe(this, this::renderEvents);
    }

    private void renderRide(DocState<Ride> s) {
        if (s.data == null) {
            if (!s.loading) {
                b.content.setVisibility(View.GONE);
                b.state.showError(getString(R.string.detail_error), ErrorMessages.of(this, s.error), null);
            }
            return;
        }
        b.state.hide();
        b.content.setVisibility(View.VISIBLE);
        b.cachedNotice.setVisibility(s.fromCache ? View.VISIBLE : View.GONE);
        Ride r = s.data;
        ride = r;
        RideStatus status = RideStatus.fromWire(r.status);
        StatusStyles.ride(b.status, status);
        b.date.setText(r.requestedAt != null
                ? DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(r.requestedAt.toDate()) : "");
        b.pickup.setText(r.pickup != null ? r.pickup.address : "");
        b.destination.setText(r.destination != null ? r.destination.address : "");
        if (asDriver) {
            b.party.setText(getString(R.string.detail_passenger, r.passenger != null && r.passenger.firstName != null ? r.passenger.firstName : "—"));
        } else if (r.driver != null) {
            b.party.setText(getString(R.string.detail_driver, r.driver.displayName, r.driver.plateNumber, r.driver.bodyNumber));
        } else {
            b.party.setText(R.string.detail_no_driver);
        }

        // Receipt: the final fare for a completed trip, otherwise what was quoted.
        b.fareLines.removeAllViews();
        List<FareLine> lines = null;
        long total = 0;
        if (status == RideStatus.COMPLETED && r.finalFare != null) {
            lines = r.finalFare.lines;
            total = r.finalFare.total;
            b.totalLabel.setText(R.string.detail_total_paid_cash);
        } else if (r.cancellation != null && r.cancellation.feeApplied > 0) {
            total = r.cancellation.feeApplied;
            b.totalLabel.setText(R.string.detail_cancellation_fee);
        } else if (r.quote != null) {
            lines = status.isTerminal() ? null : r.quote.lines;
            total = status.isTerminal() ? 0 : r.quote.total;
            b.totalLabel.setText(status.isTerminal() ? R.string.detail_no_charge : R.string.detail_quoted);
        }
        if (lines != null) {
            for (FareLine line : lines) {
                ItemFareLineBinding row = ItemFareLineBinding.inflate(getLayoutInflater(), b.fareLines, true);
                row.label.setText(line.label);
                row.amount.setText(Money.format(line.amount));
            }
        }
        b.total.setText(Money.format(total));
        b.sampleNotice.setVisibility(r.quote != null && r.quote.fareIsSample ? View.VISIBLE : View.GONE);
        b.paymentMethod.setText(R.string.detail_cash);

        // Payment records exist only for completed trips (and are readable only then).
        if (status == RideStatus.COMPLETED && paymentLive == null) {
            paymentLive = RideRepository.get().payment(rideId);
            paymentLive.observe(this, ps -> {
                payment = ps.data;
                renderPayment();
            });
        }
        renderPayment();
    }

    private void renderPayment() {
        Ride r = ride;
        if (r == null) return;
        boolean completed = RideStatus.fromWire(r.status) == RideStatus.COMPLETED;
        PaymentStatus ps = PaymentStatus.fromWire(payment != null ? payment.status : (r.payment != null ? r.payment.status : null));
        b.paymentStatus.setVisibility(completed ? View.VISIBLE : View.GONE);
        if (completed) StatusStyles.payment(b.paymentStatus, ps);
        if (payment != null && payment.amountCollected != null) {
            b.paymentDetail.setVisibility(View.VISIBLE);
            b.paymentDetail.setText(payment.discrepancy != 0
                    ? getString(R.string.detail_collected_discrepancy, Money.format(payment.amountCollected), Money.format(payment.amountDue))
                    : getString(R.string.detail_collected, Money.format(payment.amountCollected)));
        } else {
            b.paymentDetail.setVisibility(View.GONE);
        }
        boolean disputable = completed && (ps == PaymentStatus.UNPAID || ps == PaymentStatus.PENDING || ps == PaymentStatus.PAID || ps == PaymentStatus.FAILED);
        b.dispute.setVisibility(disputable ? View.VISIBLE : View.GONE);
        // Fallback for a driver whose app closed between completing the trip and recording cash.
        b.recordCash.setVisibility(asDriver && completed && ps == PaymentStatus.UNPAID && r.finalFare != null ? View.VISIBLE : View.GONE);
    }

    private void openRecordCash() {
        Ride r = ride;
        if (r == null || r.finalFare == null) return;
        long due = r.finalFare.total;
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        input.setText(String.format(Locale.US, "%d.%02d", due / 100, due % 100));
        FrameLayout box = new FrameLayout(this);
        int pad = getResources().getDimensionPixelSize(R.dimen.screen_padding);
        box.setPadding(pad, 0, pad, 0);
        box.addView(input);
        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.dh_record_cash)
                .setMessage(getString(R.string.dh_collect_total, Money.format(due)))
                .setView(box)
                .setNegativeButton(R.string.action_cancel, null)
                .setPositiveButton(R.string.dh_record_cash, null)
                .create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            long amount = Money.parsePesos(input.getText().toString());
            if (amount < 0) {
                input.setError(getString(R.string.dh_cash_invalid));
                return;
            }
            v.setEnabled(false);
            RideRepository.get().recordCash(rideId, amount).addOnCompleteListener(this, t -> {
                dialog.dismiss();
                if (!t.isSuccessful()) {
                    b.error.setVisibility(View.VISIBLE);
                    b.error.setText(ErrorMessages.of(this, t.getException()));
                }
            });
        }));
        dialog.show();
    }

    private void renderEvents(DocState<List<RideEvent>> s) {
        b.timeline.removeAllViews();
        if (s.data == null) return;
        DateFormat fmt = DateFormat.getTimeInstance(DateFormat.SHORT);
        for (RideEvent e : s.data) {
            // Offer churn is noise for the participants; support sees it in the dashboard.
            if ("OFFER_SENT".equals(e.type) || "OFFER_EXPIRED".equals(e.type) || "OFFER_DECLINED".equals(e.type)) continue;
            ItemTimelineEventBinding row = ItemTimelineEventBinding.inflate(getLayoutInflater(), b.timeline, true);
            row.time.setText(e.at != null ? fmt.format(e.at.toDate()) : "");
            row.label.setText(RideTexts.eventLabel(e.type != null ? e.type : ""));
        }
    }

    private void openDispute() {
        EditText input = new EditText(this);
        input.setHint(R.string.detail_dispute_hint);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        input.setMinLines(3);
        FrameLayout box = new FrameLayout(this);
        int pad = getResources().getDimensionPixelSize(R.dimen.screen_padding);
        box.setPadding(pad, 0, pad, 0);
        box.addView(input);
        AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.detail_dispute)
                .setMessage(R.string.detail_dispute_explain)
                .setView(box)
                .setNegativeButton(R.string.action_cancel, null)
                .setPositiveButton(R.string.action_submit, null)
                .create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String text = input.getText().toString().trim();
            if (text.length() < MIN_DISPUTE) {
                input.setError(getString(R.string.support_description_short, MIN_DISPUTE));
                return;
            }
            v.setEnabled(false);
            RideRepository.get().disputePayment(rideId, text).addOnCompleteListener(this, t -> {
                dialog.dismiss();
                if (t.isSuccessful()) {
                    Toast.makeText(this, R.string.detail_dispute_sent, Toast.LENGTH_LONG).show();
                } else {
                    b.error.setVisibility(View.VISIBLE);
                    b.error.setText(ErrorMessages.of(this, t.getException()));
                }
            });
        }));
        dialog.show();
    }
}
