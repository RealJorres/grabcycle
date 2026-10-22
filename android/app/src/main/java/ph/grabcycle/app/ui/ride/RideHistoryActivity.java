package ph.grabcycle.app.ui.ride;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.recyclerview.widget.DiffUtil;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.ListAdapter;
import androidx.recyclerview.widget.RecyclerView;

import java.text.DateFormat;
import java.util.List;
import java.util.Objects;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.DocState;
import ph.grabcycle.app.data.RideRepository;
import ph.grabcycle.app.databinding.ActivityRideHistoryBinding;
import ph.grabcycle.app.databinding.ItemRideHistoryBinding;
import ph.grabcycle.app.model.Ride;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.common.StatusStyles;
import ph.grabcycle.app.ui.driver.DriverHomeActivity;
import ph.grabcycle.app.ui.passenger.PassengerRideActivity;
import ph.grabcycle.core.model.RideStatus;
import ph.grabcycle.core.util.Money;

/** The signed-in user's rides, newest first (as passenger or as driver). */
public class RideHistoryActivity extends BaseActivity {

    private static final String EXTRA_AS_DRIVER = "asDriver";
    private static final int LIMIT = 50;

    public static Intent intent(@NonNull Context c, boolean asDriver) {
        return new Intent(c, RideHistoryActivity.class).putExtra(EXTRA_AS_DRIVER, asDriver);
    }

    private ActivityRideHistoryBinding b;
    private boolean asDriver;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String uid = AuthRepository.get().uid();
        if (uid == null) {
            finish();
            return;
        }
        asDriver = getIntent().getBooleanExtra(EXTRA_AS_DRIVER, false);
        b = ActivityRideHistoryBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, false);
        Insets.pad(b.list, false, true);
        b.toolbar.setNavigationOnClickListener(v -> finish());
        if (asDriver) b.toolbar.setTitle(R.string.history_driver_title);

        Adapter adapter = new Adapter(this::open);
        b.list.setLayoutManager(new LinearLayoutManager(this));
        b.list.setAdapter(adapter);
        b.state.showLoading(null);
        RideRepository.get().history(uid, asDriver, LIMIT).observe(this, s -> render(s, adapter));
    }

    private void render(DocState<List<Ride>> s, Adapter adapter) {
        b.cachedNotice.setVisibility(s.fromCache && s.data != null ? View.VISIBLE : View.GONE);
        if (s.data == null) {
            b.list.setVisibility(View.GONE);
            if (s.loading) b.state.showLoading(null);
            else b.state.showError(getString(R.string.history_error), ErrorMessages.of(this, s.error), null);
            return;
        }
        if (s.data.isEmpty()) {
            b.list.setVisibility(View.GONE);
            b.state.showEmpty(R.drawable.ic_history, getString(R.string.history_empty_title),
                    getString(asDriver ? R.string.history_empty_driver : R.string.history_empty_passenger));
            return;
        }
        b.state.hide();
        b.list.setVisibility(View.VISIBLE);
        adapter.submitList(s.data);
    }

    private void open(@NonNull Ride r) {
        if (r.rideId == null) return;
        if (!RideStatus.fromWire(r.status).isTerminal()) {
            // Active rides open their live screen.
            startActivity(asDriver ? new Intent(this, DriverHomeActivity.class) : PassengerRideActivity.intent(this, r.rideId));
        } else {
            startActivity(RideDetailActivity.intent(this, r.rideId, asDriver));
        }
    }

    private interface OnRide {
        void onRide(@NonNull Ride r);
    }

    private static final class Adapter extends ListAdapter<Ride, Adapter.Holder> {
        private final OnRide onRide;

        Adapter(OnRide onRide) {
            super(new DiffUtil.ItemCallback<Ride>() {
                @Override
                public boolean areItemsTheSame(@NonNull Ride a, @NonNull Ride b) {
                    return Objects.equals(a.rideId, b.rideId);
                }

                @Override
                public boolean areContentsTheSame(@NonNull Ride a, @NonNull Ride b) {
                    return Objects.equals(a.status, b.status) && Objects.equals(a.updatedAt, b.updatedAt);
                }
            });
            this.onRide = onRide;
        }

        @NonNull
        @Override
        public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            return new Holder(ItemRideHistoryBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull Holder h, int position) {
            Ride r = getItem(position);
            Context c = h.itemView.getContext();
            h.b.date.setText(r.requestedAt != null
                    ? DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(r.requestedAt.toDate()) : "");
            RideStatus status = RideStatus.fromWire(r.status);
            StatusStyles.ride(h.b.status, status);
            h.b.pickup.setText(c.getString(R.string.history_from, r.pickup != null ? r.pickup.address : ""));
            h.b.destination.setText(c.getString(R.string.history_to, r.destination != null ? r.destination.address : ""));
            if (status == RideStatus.COMPLETED && r.finalFare != null) {
                h.b.fare.setText(Money.format(r.finalFare.total));
            } else if (!status.isTerminal() && r.quote != null) {
                h.b.fare.setText(c.getString(R.string.history_quoted, Money.format(r.quote.total)));
            } else if (r.cancellation != null && r.cancellation.feeApplied > 0) {
                h.b.fare.setText(c.getString(R.string.history_cancellation_fee, Money.format(r.cancellation.feeApplied)));
            } else {
                h.b.fare.setText(status.isTerminal() && status != RideStatus.COMPLETED ? c.getString(R.string.history_no_charge) : "");
            }
            h.itemView.setOnClickListener(v -> onRide.onRide(r));
        }

        static final class Holder extends RecyclerView.ViewHolder {
            final ItemRideHistoryBinding b;

            Holder(ItemRideHistoryBinding b) {
                super(b.getRoot());
                this.b = b;
            }
        }
    }
}
