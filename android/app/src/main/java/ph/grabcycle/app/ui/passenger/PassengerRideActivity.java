package ph.grabcycle.app.ui.passenger;

import android.animation.ValueAnimator;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.format.DateFormat;
import android.view.View;
import android.view.animation.LinearInterpolator;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.ViewModelProvider;

import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.SupportMapFragment;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.LatLngBounds;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;
import com.google.android.material.bottomsheet.BottomSheetBehavior;

import java.util.Date;
import java.util.List;
import java.util.Locale;

import ph.grabcycle.app.R;
import ph.grabcycle.app.config.AppConfig;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.ConfigRepository;
import ph.grabcycle.app.data.DocState;
import ph.grabcycle.app.data.DriverLocationLiveData;
import ph.grabcycle.app.data.UserRepository;
import ph.grabcycle.app.databinding.ActivityPassengerRideBinding;
import ph.grabcycle.app.databinding.ItemTimelineEventBinding;
import ph.grabcycle.app.model.EmergencyContact;
import ph.grabcycle.app.model.PoliciesConfig;
import ph.grabcycle.app.model.Ride;
import ph.grabcycle.app.model.RideContact;
import ph.grabcycle.app.model.RideEvent;
import ph.grabcycle.app.model.RidePlace;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.common.MarkerIcons;
import ph.grabcycle.app.ui.common.PhotoLoader;
import ph.grabcycle.app.ui.common.StatusStyles;
import ph.grabcycle.app.ui.ride.CancelReasons;
import ph.grabcycle.app.ui.ride.EmergencyActions;
import ph.grabcycle.app.ui.ride.PassengerRideViewModel;
import ph.grabcycle.app.ui.ride.RideDetailActivity;
import ph.grabcycle.app.ui.ride.RideTexts;
import ph.grabcycle.app.ui.support.SupportActivity;
import ph.grabcycle.core.model.PaymentStatus;
import ph.grabcycle.core.model.RideStatus;
import ph.grabcycle.core.ride.RideRules;
import ph.grabcycle.core.util.Durations;
import ph.grabcycle.core.util.GeoMath;
import ph.grabcycle.core.util.Money;

/** Live view of one ride for the passenger, rendered from the authoritative ride document. */
public class PassengerRideActivity extends BaseActivity implements OnMapReadyCallback {

    private static final String EXTRA_RIDE = "rideId";
    /** Driver positions older than this are flagged as not current. */
    private static final long STALE_LOCATION_MS = 45_000;

    public static Intent intent(@NonNull Context c, @NonNull String rideId) {
        return new Intent(c, PassengerRideActivity.class).putExtra(EXTRA_RIDE, rideId).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    private ActivityPassengerRideBinding b;
    private PassengerRideViewModel vm;
    @Nullable private GoogleMap map;
    @Nullable private Marker driverMarker;
    @Nullable private Marker pickupMarker;
    @Nullable private Marker destinationMarker;
    @Nullable private ValueAnimator markerAnimator;
    @Nullable private Ride ride;
    @Nullable private RideContact contactInfo;
    @Nullable private EmergencyContact emergencyContact;
    @Nullable private DriverLocationLiveData.State lastLocation;
    @Nullable private PoliciesConfig policies;
    private boolean cameraFitted;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            renderCountdown();
            renderFreshness();
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String rideId = getIntent().getStringExtra(EXTRA_RIDE);
        String uid = AuthRepository.get().uid();
        if (rideId == null || uid == null) {
            finish();
            return;
        }
        b = ActivityPassengerRideBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.topBar, true, false);
        Insets.pad(b.sheetContent, false, true);
        BottomSheetBehavior.from(b.sheet).setState(BottomSheetBehavior.STATE_COLLAPSED);

        vm = new ViewModelProvider(this).get(PassengerRideViewModel.class);
        vm.bind(rideId);

        if (AppConfig.isMapsKeyPresent()) {
            SupportMapFragment mf = (SupportMapFragment) getSupportFragmentManager().findFragmentById(R.id.map);
            if (mf != null) mf.getMapAsync(this);
        }

        b.close.setOnClickListener(v -> finish());
        b.cancel.setOnClickListener(v -> confirmCancel());
        b.report.setOnClickListener(v -> startActivity(SupportActivity.intent(this, rideId)));
        b.emergency.setOnClickListener(v -> { if (ride != null) EmergencyActions.show(this, ride, emergencyContact); });
        b.callDriver.setOnClickListener(v -> {
            if (contactInfo != null && contactInfo.driverPhone != null) EmergencyActions.dial(this, contactInfo.driverPhone);
        });
        b.messageDriver.setOnClickListener(v -> {
            if (contactInfo != null && contactInfo.driverPhone != null) EmergencyActions.sms(this, contactInfo.driverPhone, "");
        });
        b.viewReceipt.setOnClickListener(v -> startActivity(RideDetailActivity.intent(this, rideId, false)));
        b.submitRating.setOnClickListener(v -> {
            int stars = Math.round(b.ratingBar.getRating());
            if (stars < 1) {
                showError(getString(R.string.ride_rating_required));
                return;
            }
            String comment = b.ratingComment.getText() != null ? b.ratingComment.getText().toString().trim() : "";
            vm.rate(stars, comment.isEmpty() ? null : comment);
        });

        vm.ride().observe(this, this::renderRide);
        vm.events().observe(this, this::renderEvents);
        vm.driverLocation().observe(this, this::renderDriverLocation);
        vm.contact().observe(this, s -> {
            contactInfo = s != null ? s.data : null;
            boolean hasPhone = contactInfo != null && contactInfo.driverPhone != null;
            b.callDriver.setEnabled(hasPhone);
            b.messageDriver.setEnabled(hasPhone);
        });
        vm.busy().observe(this, busy -> {
            b.cancel.setEnabled(!Boolean.TRUE.equals(busy));
            b.submitRating.setEnabled(!Boolean.TRUE.equals(busy));
        });
        vm.actionError().observe(this, e -> showError(e != null ? ErrorMessages.of(this, e) : null));
        vm.rated().observe(this, done -> {
            if (Boolean.TRUE.equals(done)) b.ratingSection.setVisibility(View.GONE);
        });
        UserRepository.get().profile(uid).observe(this, s -> emergencyContact = s.data != null ? s.data.emergencyContact : null);
        ConfigRepository.get().policies().observe(this, s -> policies = s.data);
    }

    @Override
    protected void onNewIntent(@NonNull Intent intent) {
        super.onNewIntent(intent);
        String rideId = intent.getStringExtra(EXTRA_RIDE);
        if (rideId != null) vm.bind(rideId);
    }

    @Override
    protected void onStart() {
        super.onStart();
        handler.post(ticker);
    }

    @Override
    protected void onStop() {
        handler.removeCallbacks(ticker);
        super.onStop();
    }

    // ---- Rendering ----------------------------------------------------------------

    private void renderRide(DocState<Ride> state) {
        b.cachedNotice.setVisibility(state.fromCache && state.data != null ? View.VISIBLE : View.GONE);
        if (state.data == null) {
            if (!state.loading && state.error != null) showError(ErrorMessages.of(this, state.error));
            return;
        }
        Ride r = state.data;
        ride = r;
        vm.onRideUpdate(r);
        RideStatus status = RideStatus.fromWire(r.status);
        StatusStyles.ride(b.statusChip, status);
        b.tripPickup.setText(r.pickup != null ? r.pickup.address : "");
        b.tripDestination.setText(r.destination != null ? r.destination.address : "");
        if (r.quote != null) {
            b.tripFare.setText(getString(r.quote.fareIsSample ? R.string.ride_quoted_fare_sample : R.string.ride_quoted_fare, Money.format(r.quote.total)));
        }

        b.stageSearching.setVisibility(status.isSearching() ? View.VISIBLE : View.GONE);
        b.stageDriver.setVisibility(status.isAssigned() ? View.VISIBLE : View.GONE);
        b.stageDone.setVisibility(status == RideStatus.COMPLETED ? View.VISIBLE : View.GONE);
        b.cancel.setVisibility(RideRules.passengerCanCancel(status) ? View.VISIBLE : View.GONE);
        b.report.setVisibility(status.isAssigned() || status == RideStatus.COMPLETED ? View.VISIBLE : View.GONE);
        b.emergency.setVisibility(status.isAssigned() ? View.VISIBLE : View.GONE);
        b.primaryAction.setVisibility(status.isTerminal() ? View.VISIBLE : View.GONE);

        switch (status) {
            case REQUESTED:
            case SEARCHING:
                b.statusTitle.setText("SELECTED".equals(r.mode) ? R.string.ride_waiting_selected : R.string.ride_finding_driver);
                b.statusSubtitle.setText(R.string.ride_finding_subtitle);
                break;
            case ACCEPTED:
            case DRIVER_EN_ROUTE:
                b.statusTitle.setText(getString(R.string.ride_driver_coming, driverName(r)));
                b.statusSubtitle.setText(r.driverEtaSeconds != null
                        ? getString(R.string.ride_eta, Durations.formatEta(r.driverEtaSeconds)) : getString(R.string.ride_eta_unknown));
                break;
            case DRIVER_ARRIVED:
                b.statusTitle.setText(getString(R.string.ride_driver_arrived, driverName(r)));
                b.statusSubtitle.setText(R.string.ride_driver_arrived_subtitle);
                break;
            case IN_PROGRESS:
                b.statusTitle.setText(R.string.ride_in_progress);
                b.statusSubtitle.setText(getString(R.string.ride_heading_to, r.destination != null ? r.destination.address : ""));
                break;
            case COMPLETED:
                b.statusTitle.setText(R.string.ride_completed);
                b.statusSubtitle.setText(R.string.ride_completed_subtitle);
                long total = r.finalFare != null ? r.finalFare.total : (r.quote != null ? r.quote.total : 0);
                b.finalFare.setText(Money.format(total));
                StatusStyles.payment(b.paymentChip, PaymentStatus.fromWire(r.payment != null ? r.payment.status : null));
                boolean alreadyRated = r.rated != null && r.rated.byPassenger;
                b.ratingSection.setVisibility(RideRules.canRate(status, alreadyRated) && !Boolean.TRUE.equals(vm.rated().getValue()) ? View.VISIBLE : View.GONE);
                b.primaryAction.setText(R.string.action_done);
                b.primaryAction.setOnClickListener(v -> finish());
                break;
            default:
                b.statusTitle.setText(status.isCancelled() ? R.string.ride_cancelled_title : R.string.ride_ended_title);
                b.statusSubtitle.setText(RideTexts.endedMessage(status, r.statusReason));
                b.primaryAction.setText(R.string.ride_book_again);
                b.primaryAction.setOnClickListener(v -> finish());
        }

        if (status.isAssigned() && r.driver != null) {
            b.driverCard.driverName.setText(r.driver.displayName);
            b.driverCard.driverVehicle.setText(r.driver.vehicleDescription);
            b.driverCard.plate.setText(r.driver.plateNumber);
            b.driverCard.plate.setContentDescription(getString(R.string.ride_plate_desc, r.driver.plateNumber));
            b.driverCard.bodyNumber.setText(getString(R.string.ride_body_number, r.driver.bodyNumber));
            b.driverCard.driverRating.setText(r.driver.ratingAvg != null
                    ? String.format(Locale.US, "★ %.1f", r.driver.ratingAvg) : getString(R.string.ph_new_driver));
            PhotoLoader.load(b.driverCard.driverPhoto, r.driver.photoPath);
        }
        renderPlacesOnMap();
        renderCountdown();
    }

    private String driverName(Ride r) {
        return r.driver != null && r.driver.displayName != null ? r.driver.displayName : getString(R.string.ride_your_driver);
    }

    private void renderCountdown() {
        if (ride == null || ride.offer == null || ride.offer.expiresAt == null || !RideStatus.fromWire(ride.status).isSearching()) {
            b.offerCountdown.setText(ride != null && RideStatus.fromWire(ride.status).isSearching() ? getString(R.string.ride_contacting) : "");
            return;
        }
        long remaining = Durations.secondsRemaining(ride.offer.expiresAt.toDate().getTime(), System.currentTimeMillis());
        b.offerCountdown.setText(getResources().getQuantityString(R.plurals.ride_offer_countdown, (int) remaining, (int) remaining));
    }

    private void renderEvents(DocState<List<RideEvent>> state) {
        b.timeline.removeAllViews();
        if (state.data == null) return;
        java.text.DateFormat fmt = DateFormat.getTimeFormat(this);
        for (RideEvent e : state.data) {
            if ("OFFER_SENT".equals(e.type) || "OFFER_EXPIRED".equals(e.type) || "OFFER_DECLINED".equals(e.type)) continue;
            ItemTimelineEventBinding row = ItemTimelineEventBinding.inflate(getLayoutInflater(), b.timeline, true);
            row.time.setText(e.at != null ? fmt.format(e.at.toDate()) : "");
            row.label.setText(RideTexts.eventLabel(e.type != null ? e.type : ""));
        }
    }

    private void renderDriverLocation(@Nullable DriverLocationLiveData.State s) {
        lastLocation = s;
        if (s == null || !s.hasFix || map == null) {
            renderFreshness();
            return;
        }
        LatLng target = new LatLng(s.lat, s.lng);
        if (driverMarker == null) {
            driverMarker = map.addMarker(new MarkerOptions().position(target).anchor(0.5f, 0.5f).flat(true)
                    .title(getString(R.string.ride_your_driver)).icon(MarkerIcons.fromVector(this, R.drawable.ic_marker_tricycle)));
        } else {
            animateMarker(driverMarker, target);
        }
        if (!cameraFitted && ride != null && ride.pickup != null) {
            cameraFitted = true;
            LatLngBounds bounds = LatLngBounds.builder().include(target).include(new LatLng(ride.pickup.lat, ride.pickup.lng)).build();
            try {
                map.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, (int) (80 * getResources().getDisplayMetrics().density)));
            } catch (IllegalStateException ignored) {
                // Layout not ready.
            }
        }
        renderFreshness();
    }

    /** Smoothly moves the marker between consecutive fixes instead of jumping. */
    private void animateMarker(@NonNull Marker marker, @NonNull LatLng to) {
        if (markerAnimator != null) markerAnimator.cancel();
        final LatLng from = marker.getPosition();
        markerAnimator = ValueAnimator.ofFloat(0f, 1f);
        markerAnimator.setDuration(1200);
        markerAnimator.setInterpolator(new LinearInterpolator());
        markerAnimator.addUpdateListener(a -> {
            float t = (float) a.getAnimatedValue();
            marker.setPosition(new LatLng(from.latitude + (to.latitude - from.latitude) * t, from.longitude + (to.longitude - from.longitude) * t));
        });
        markerAnimator.start();
    }

    private void renderFreshness() {
        if (ride == null || !RideStatus.fromWire(ride.status).isAssigned()) {
            b.locationFreshness.setVisibility(View.GONE);
            return;
        }
        b.locationFreshness.setVisibility(View.VISIBLE);
        DriverLocationLiveData.State s = lastLocation;
        if (s == null || !s.hasFix) {
            b.locationFreshness.setText(s != null && s.revoked ? R.string.ride_location_ended : R.string.ride_location_waiting);
            return;
        }
        long age = Math.max(0, System.currentTimeMillis() - s.serverTs);
        if (age > STALE_LOCATION_MS) {
            b.locationFreshness.setText(getString(R.string.ride_location_stale, DateFormat.getTimeFormat(this).format(new Date(s.serverTs))));
            b.locationFreshness.setTextColor(getColor(R.color.gc_status_warning));
        } else {
            RidePlace target = RideStatus.fromWire(ride.status) == RideStatus.IN_PROGRESS ? ride.destination : ride.pickup;
            if (target != null) {
                double meters = GeoMath.distanceMeters(s.lat, s.lng, target.lat, target.lng);
                b.locationFreshness.setText(getString(RideStatus.fromWire(ride.status) == RideStatus.IN_PROGRESS
                        ? R.string.ride_location_live_to_destination : R.string.ride_location_live_to_pickup, GeoMath.formatDistance(meters)));
            } else {
                b.locationFreshness.setText(R.string.ride_location_live);
            }
            b.locationFreshness.setTextColor(getColor(R.color.gc_status_success));
        }
    }

    private void renderPlacesOnMap() {
        if (map == null || ride == null) return;
        if (pickupMarker == null && ride.pickup != null) {
            pickupMarker = map.addMarker(new MarkerOptions().position(new LatLng(ride.pickup.lat, ride.pickup.lng)).anchor(0.5f, 1f)
                    .icon(MarkerIcons.fromVector(this, R.drawable.ic_pin_pickup)).title(getString(R.string.ph_pickup)));
        }
        if (destinationMarker == null && ride.destination != null) {
            destinationMarker = map.addMarker(new MarkerOptions().position(new LatLng(ride.destination.lat, ride.destination.lng)).anchor(0.5f, 1f)
                    .icon(MarkerIcons.fromVector(this, R.drawable.ic_pin_destination)).title(getString(R.string.ph_destination)));
        }
        RideStatus status = RideStatus.fromWire(ride.status);
        if (driverMarker != null && !RideRules.passengerSeesDriverLocation(status)) {
            driverMarker.remove();
            driverMarker = null;
        }
        if (!cameraFitted && ride.pickup != null && ride.destination != null && driverMarker == null) {
            LatLngBounds bounds = LatLngBounds.builder()
                    .include(new LatLng(ride.pickup.lat, ride.pickup.lng))
                    .include(new LatLng(ride.destination.lat, ride.destination.lng)).build();
            try {
                map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds, (int) (80 * getResources().getDisplayMetrics().density)));
            } catch (IllegalStateException ignored) {
                // Layout not ready.
            }
        }
    }

    @Override
    public void onMapReady(@NonNull GoogleMap googleMap) {
        map = googleMap;
        map.getUiSettings().setMapToolbarEnabled(false);
        b.sheet.post(() -> { if (map != null) map.setPadding(0, b.topBar.getHeight(), 0, BottomSheetBehavior.from(b.sheet).getPeekHeight()); });
        renderPlacesOnMap();
        renderDriverLocation(lastLocation);
    }

    private void confirmCancel() {
        if (ride == null) return;
        RideStatus status = RideStatus.fromWire(ride.status);
        CharSequence warning;
        if (!status.isAssigned()) {
            warning = getString(R.string.cancel_passenger_searching_warning);
        } else if (feeWouldApply()) {
            // The backend makes the final decision; this mirrors its published policy.
            warning = getString(R.string.cancel_passenger_fee_warning, Money.format(policies.cancellation.passengerFee));
        } else {
            warning = getString(R.string.cancel_passenger_assigned_warning);
        }
        CancelReasons.pickPassenger(this, warning, vm::cancel);
    }

    private boolean feeWouldApply() {
        if (policies == null || ride == null || ride.acceptedAt == null) return false;
        PoliciesConfig.CancellationPolicy p = policies.cancellation;
        if (!p.passengerFeeEnabled || p.passengerFee <= 0) return false;
        return System.currentTimeMillis() - ride.acceptedAt.toDate().getTime() >= p.passengerFeeAfterAcceptMinutes * 60_000L;
    }

    private void showError(@Nullable String message) {
        b.error.setVisibility(message != null ? View.VISIBLE : View.GONE);
        b.error.setText(message);
    }

    @Override
    protected void onDestroy() {
        if (markerAnimator != null) markerAnimator.cancel();
        handler.removeCallbacks(ticker);
        super.onDestroy();
    }
}
