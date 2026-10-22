package ph.grabcycle.app.ui.driver;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.PopupMenu;
import android.widget.RatingBar;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.ViewModelProvider;

import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.SupportMapFragment;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;
import com.google.android.material.bottomsheet.BottomSheetBehavior;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.util.Locale;
import java.util.Map;

import ph.grabcycle.app.R;
import ph.grabcycle.app.config.AppConfig;
import ph.grabcycle.app.data.AppException;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.ConfigRepository;
import ph.grabcycle.app.data.DocState;
import ph.grabcycle.app.databinding.ActivityDriverHomeBinding;
import ph.grabcycle.app.databinding.ItemFareLineBinding;
import ph.grabcycle.app.location.DriverLocationService;
import ph.grabcycle.app.location.DriverSessionState;
import ph.grabcycle.app.location.LocationHelper;
import ph.grabcycle.app.location.LocationPermissions;
import ph.grabcycle.app.model.AvailabilityResult;
import ph.grabcycle.app.model.DriverProfile;
import ph.grabcycle.app.model.FareLine;
import ph.grabcycle.app.model.MatchingConfig;
import ph.grabcycle.app.model.PoliciesConfig;
import ph.grabcycle.app.model.Ride;
import ph.grabcycle.app.model.RideContact;
import ph.grabcycle.app.model.RidePlace;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.Dialogs;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.common.MarkerIcons;
import ph.grabcycle.app.ui.common.StatusStyles;
import ph.grabcycle.app.ui.profile.ProfileActivity;
import ph.grabcycle.app.ui.ride.CancelReasons;
import ph.grabcycle.app.ui.ride.EmergencyActions;
import ph.grabcycle.app.ui.ride.RideHistoryActivity;
import ph.grabcycle.app.ui.support.SupportActivity;
import ph.grabcycle.core.location.LocationQuality;
import ph.grabcycle.core.model.Availability;
import ph.grabcycle.core.model.DriverStatus;
import ph.grabcycle.core.model.PaymentStatus;
import ph.grabcycle.core.model.RideStatus;
import ph.grabcycle.core.ride.DriverAction;
import ph.grabcycle.core.ride.RideRules;
import ph.grabcycle.core.util.Durations;
import ph.grabcycle.core.util.Money;

/**
 * Driver home: availability, incoming offers, the active trip and cash
 * collection. The online switch only requests a change; the backend decides,
 * and location is shared only while it says the driver is online.
 */
public class DriverHomeActivity extends BaseActivity implements OnMapReadyCallback {

    private ActivityDriverHomeBinding b;
    private DriverHomeViewModel vm;
    private String uid;
    @Nullable private GoogleMap map;
    @Nullable private Marker targetMarker;
    @Nullable private DriverProfile driver;
    @Nullable private Ride offerRide;
    @Nullable private Ride tripRide;
    @Nullable private RideContact contact;
    @Nullable private Ride collectRide;
    @Nullable private MatchingConfig matching;
    @Nullable private PoliciesConfig policies;
    @Nullable private DriverSessionState.Status session;
    /** Session id for which this screen already (re)started location sharing. */
    @Nullable private String resumedSession;
    @Nullable private String filledCollectFor;
    private boolean askedNotifications;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            renderOfferCountdown();
            renderNoShow();
            renderLocationStatus();
            handler.postDelayed(this, 1000);
        }
    };

    private ActivityResultLauncher<String[]> locationPermission;
    private ActivityResultLauncher<String> notificationPermission;

    @Nullable private LocationHelper location;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        uid = AuthRepository.get().uid();
        if (uid == null) {
            finish();
            return;
        }
        b = ActivityDriverHomeBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.topBar, true, false);
        Insets.pad(b.sheetContent, false, true);
        location = new LocationHelper(this);

        locationPermission = registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), result -> {
            if (LocationPermissions.hasAny(this)) requestOnline();
            else showError(getString(R.string.dh_location_needed));
        });
        notificationPermission = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> requestOnline());

        if (AppConfig.isMapsKeyPresent()) {
            SupportMapFragment mf = (SupportMapFragment) getSupportFragmentManager().findFragmentById(R.id.map);
            if (mf != null) mf.getMapAsync(this);
        } else {
            b.mapUnavailable.setVisibility(View.VISIBLE);
            BottomSheetBehavior.from(b.sheet).setState(BottomSheetBehavior.STATE_EXPANDED);
        }

        vm = new ViewModelProvider(this).get(DriverHomeViewModel.class);
        vm.bind(uid);

        b.menu.setOnClickListener(this::showMenu);
        b.openSetup.setOnClickListener(v -> startActivity(new Intent(this, DriverOnboardingActivity.class)));
        b.toggleOnline.setOnClickListener(v -> {
            if (driver != null && Availability.fromWire(driver.availability).sharesLocation()) confirmOffline();
            else requestOnline();
        });
        b.accept.setOnClickListener(v -> { if (offerRide != null) vm.respond(offerRide.rideId, true); });
        b.decline.setOnClickListener(v -> { if (offerRide != null) vm.respond(offerRide.rideId, false); });
        b.primaryAction.setOnClickListener(v -> onPrimaryAction());
        b.navigate.setOnClickListener(v -> navigate());
        b.callPassenger.setOnClickListener(v -> {
            if (contact != null && contact.passengerPhone != null) EmergencyActions.dial(this, contact.passengerPhone);
        });
        b.messagePassenger.setOnClickListener(v -> {
            if (contact != null && contact.passengerPhone != null) EmergencyActions.sms(this, contact.passengerPhone, "");
        });
        b.cancelTrip.setOnClickListener(v -> {
            if (tripRide == null) return;
            String rideId = tripRide.rideId;
            CancelReasons.pickDriver(this, code -> vm.cancel(rideId, code));
        });
        b.noShow.setOnClickListener(v -> {
            if (tripRide == null) return;
            String rideId = tripRide.rideId;
            Dialogs.confirm(this, R.string.dh_no_show, getString(R.string.dh_no_show_confirm), R.string.dh_no_show,
                    () -> vm.cancel(rideId, "PASSENGER_NO_SHOW"));
        });
        b.emergency.setOnClickListener(v -> { if (tripRide != null) EmergencyActions.show(this, tripRide, null); });
        b.recordCash.setOnClickListener(v -> recordCash());

        vm.driver().observe(this, this::onDriver);
        vm.offer().observe(this, s -> {
            offerRide = validOffer(s);
            render();
        });
        vm.trip().observe(this, s -> {
            tripRide = s.data;
            render();
        });
        vm.contact().observe(this, s -> {
            contact = s.data;
            boolean phone = contact != null && contact.passengerPhone != null;
            b.callPassenger.setEnabled(phone);
            b.messagePassenger.setEnabled(phone);
        });
        vm.collectRide().observe(this, this::onCollectRide);
        vm.busy().observe(this, busy -> setBusy(Boolean.TRUE.equals(busy)));
        vm.error().observe(this, e -> showError(e != null ? messageFor(e) : null));
        vm.wentOnline().observe(this, this::onWentOnline);
        vm.wentOffline().observe(this, done -> {
            if (Boolean.TRUE.equals(done)) {
                DriverLocationService.stop(this);
                vm.consumeOffline();
            }
        });
        vm.ratePrompt().observe(this, rideId -> {
            if (rideId != null) {
                vm.consumeRatePrompt();
                promptRating(rideId);
            }
        });
        DriverSessionState.status().observe(this, st -> {
            session = st;
            renderLocationStatus();
        });
        ConfigRepository.get().matching().observe(this, s -> matching = s.data);
        ConfigRepository.get().policies().observe(this, s -> policies = s.data);
    }

    @Override
    protected void onStart() {
        super.onStart();
        handler.post(ticker);
    }

    @Override
    protected void onStop() {
        handler.removeCallbacks(ticker);
        if (location != null) location.cancel();
        super.onStop();
    }

    // ---- Driver record ----------------------------------------------------------------

    private void onDriver(DocState<DriverProfile> s) {
        b.cachedNotice.setVisibility(s.fromCache && s.data != null ? View.VISIBLE : View.GONE);
        b.loading.setVisibility(s.data == null && s.loading ? View.VISIBLE : View.GONE);
        if (s.data == null) {
            if (!s.loading) {
                // No driver record yet: registration finished but onboarding has not started.
                driver = null;
                render();
            }
            return;
        }
        driver = s.data;
        syncLocationSharing(driver);
        render();
    }

    /**
     * Keeps the location service in step with what the server says: running
     * while online (restarted after the app returns), stopped once offline.
     */
    private void syncLocationSharing(@NonNull DriverProfile d) {
        boolean shouldShare = Availability.fromWire(d.availability).sharesLocation() && d.presenceSessionId != null;
        boolean running = session != null && session.running;
        if (!shouldShare) {
            if (running) DriverLocationService.stop(this);
            resumedSession = null;
            return;
        }
        if (!running && !d.presenceSessionId.equals(resumedSession) && LocationPermissions.hasAny(this)) {
            resumedSession = d.presenceSessionId;
            MatchingConfig m = matching != null ? matching : new MatchingConfig();
            DriverLocationService.start(this, d.presenceSessionId, m.locationUpdateIntervalSec, m.maxLocationAccuracyM, m.locationFreshnessSec);
        }
    }

    @Nullable
    private Ride validOffer(DocState<Ride> s) {
        Ride r = s.data;
        if (r == null || r.offer == null || !uid.equals(r.offer.driverId)) return null;
        return RideStatus.fromWire(r.status).isSearching() ? r : null;
    }

    // ---- Rendering --------------------------------------------------------------------

    private void render() {
        DriverStatus status = driver != null ? DriverStatus.fromWire(driver.status) : DriverStatus.PROFILE_INCOMPLETE;
        Availability availability = driver != null ? Availability.fromWire(driver.availability) : Availability.OFFLINE;
        boolean eligible = driver != null && status == DriverStatus.APPROVED && driver.eligibility != null && driver.eligibility.eligible;
        boolean hasTrip = tripRide != null && !RideStatus.fromWire(tripRide.status).isTerminal();
        boolean hasOffer = !hasTrip && offerRide != null;
        boolean collecting = !hasTrip && !hasOffer && collectRide != null;
        // A driver mid-trip keeps working even if eligibility lapses; only new work is blocked.
        boolean setup = !eligible && !hasTrip && !collecting && !availability.sharesLocation();

        b.stageSetup.setVisibility(setup ? View.VISIBLE : View.GONE);
        b.stageAvailability.setVisibility(!setup && !hasTrip && !hasOffer && !collecting ? View.VISIBLE : View.GONE);
        b.stageOffer.setVisibility(hasOffer ? View.VISIBLE : View.GONE);
        b.stageTrip.setVisibility(hasTrip ? View.VISIBLE : View.GONE);
        b.stageCollect.setVisibility(collecting ? View.VISIBLE : View.GONE);
        b.emergency.setVisibility(hasTrip ? View.VISIBLE : View.GONE);

        if (availability.sharesLocation()) StatusStyles.apply(b.availabilityChip, R.string.dh_online, "SUCCESS");
        else StatusStyles.apply(b.availabilityChip, R.string.dh_offline, "NEUTRAL");

        if (setup) renderSetup(status);
        else if (hasTrip) renderTrip();
        else if (hasOffer) renderOffer();
        else if (collecting) renderCollect();
        else renderAvailability(availability);
        renderMap(hasTrip ? tripRide : (hasOffer ? offerRide : null));
    }

    private void renderSetup(DriverStatus status) {
        StatusStyles.driver(b.setupChip, status);
        if (driver == null || status == DriverStatus.PROFILE_INCOMPLETE) {
            b.setupTitle.setText(R.string.dh_setup_title);
            b.setupMessage.setText(R.string.dh_setup_message);
        } else if (status == DriverStatus.UNDER_REVIEW) {
            b.setupTitle.setText(R.string.dh_review_title);
            b.setupMessage.setText(R.string.dh_review_message);
        } else if (status == DriverStatus.SUSPENDED || status == DriverStatus.REJECTED) {
            b.setupTitle.setText(R.string.dh_blocked_title);
            b.setupMessage.setText(driver.decision != null && driver.decision.publicMessage != null
                    ? driver.decision.publicMessage : getString(R.string.dh_blocked_message));
        } else if (status == DriverStatus.APPROVED) {
            // Approved, but a document or the vehicle no longer qualifies.
            b.setupTitle.setText(R.string.dh_ineligible_title);
            b.setupMessage.setText(R.string.dh_ineligible_message);
        } else {
            b.setupTitle.setText(R.string.dh_action_needed_title);
            b.setupMessage.setText(R.string.dh_action_needed_message);
        }
        b.openSetup.setText(status == DriverStatus.UNDER_REVIEW ? R.string.dh_view_application : R.string.dh_continue_setup);
    }

    private void renderAvailability(Availability availability) {
        boolean online = availability.sharesLocation();
        b.availabilityTitle.setText(online ? R.string.dh_online_title : R.string.dh_offline_title);
        b.availabilityMessage.setText(online ? R.string.dh_online_message : R.string.dh_offline_message);
        b.toggleOnline.setText(online ? R.string.dh_go_offline : R.string.dh_go_online);
        if (driver != null && driver.stats != null) {
            Double avg = driver.ratingSummary != null
                    ? driver.ratingSummary.averageIfAtLeast((int) (policies != null ? policies.ratings.minRatingsToDisplay : 5)) : null;
            b.stats.setText(avg != null
                    ? getString(R.string.dh_stats_rating, driver.stats.completedTrips, String.format(Locale.US, "%.1f", avg))
                    : getString(R.string.dh_stats, driver.stats.completedTrips));
        } else {
            b.stats.setText("");
        }
        renderLocationStatus();
    }

    private void renderLocationStatus() {
        boolean online = driver != null && Availability.fromWire(driver.availability).sharesLocation();
        b.locationStatus.setVisibility(online ? View.VISIBLE : View.GONE);
        if (!online) return;
        DriverSessionState.Status st = session;
        if (st == null || !st.running) {
            b.locationStatus.setText(LocationPermissions.hasAny(this) ? R.string.dh_loc_starting : R.string.dh_loc_permission);
            return;
        }
        if (!st.connected) {
            b.locationStatus.setText(R.string.dh_loc_offline);
        } else if (st.quality == LocationQuality.POOR || st.quality == LocationQuality.STALE || st.quality == LocationQuality.NONE) {
            b.locationStatus.setText(R.string.dh_loc_weak);
        } else if (st.lastPublishedAt > 0) {
            b.locationStatus.setText(getString(R.string.dh_loc_ok,
                    st.lastAccuracy != null ? Math.round(st.lastAccuracy) : 0,
                    DateUtils.getRelativeTimeSpanString(st.lastPublishedAt, System.currentTimeMillis(), DateUtils.SECOND_IN_MILLIS)));
        } else {
            b.locationStatus.setText(R.string.dh_loc_starting);
        }
    }

    private void renderOffer() {
        Ride r = offerRide;
        if (r == null) return;
        b.offerPickup.setText(r.pickup != null ? r.pickup.address : "");
        boolean hasNote = r.pickup != null && r.pickup.note != null && !r.pickup.note.isEmpty();
        b.offerPickupNote.setVisibility(hasNote ? View.VISIBLE : View.GONE);
        if (hasNote) b.offerPickupNote.setText(getString(R.string.dh_pickup_note, r.pickup.note));
        b.offerDestination.setText(r.destination != null ? r.destination.address : "");
        long passengers = r.quote != null ? Math.max(1, r.quote.passengers) : 1;
        String rider = r.passenger != null && r.passenger.firstName != null ? r.passenger.firstName : getString(R.string.dh_passenger);
        b.offerDetails.setText(getResources().getQuantityString(R.plurals.dh_offer_details, (int) passengers, rider, (int) passengers));
        b.offerFare.setText(r.quote != null ? getString(r.quote.fareIsSample ? R.string.dh_fare_cash_sample : R.string.dh_fare_cash, Money.format(r.quote.total)) : "");
        renderOfferCountdown();
    }

    private void renderOfferCountdown() {
        Ride r = offerRide;
        if (r == null || r.offer == null || r.offer.expiresAt == null || b.stageOffer.getVisibility() != View.VISIBLE) return;
        long now = System.currentTimeMillis();
        long expires = r.offer.expiresAt.toDate().getTime();
        long start = r.offer.offeredAt != null ? r.offer.offeredAt.toDate().getTime() : expires - 20_000;
        long remaining = Durations.secondsRemaining(expires, now);
        b.offerCountdown.setText(remaining > 0
                ? getResources().getQuantityString(R.plurals.dh_offer_countdown, (int) remaining, (int) remaining)
                : getString(R.string.dh_offer_expired));
        long total = Math.max(1, expires - start);
        b.offerProgress.setProgressCompat((int) Math.max(0, Math.min(1000, (expires - now) * 1000 / total)), false);
        b.accept.setEnabled(remaining > 0 && !Boolean.TRUE.equals(vm.busy().getValue()));
    }

    private void renderTrip() {
        Ride r = tripRide;
        if (r == null) return;
        RideStatus status = RideStatus.fromWire(r.status);
        StatusStyles.ride(b.tripStatus, status);
        String rider = r.passenger != null && r.passenger.firstName != null ? r.passenger.firstName : getString(R.string.dh_passenger);
        boolean toPickup = status != RideStatus.IN_PROGRESS;
        switch (status) {
            case ACCEPTED: b.tripTitle.setText(getString(R.string.dh_trip_accepted, rider)); break;
            case DRIVER_EN_ROUTE: b.tripTitle.setText(getString(R.string.dh_trip_en_route, rider)); break;
            case DRIVER_ARRIVED: b.tripTitle.setText(getString(R.string.dh_trip_arrived, rider)); break;
            default: b.tripTitle.setText(getString(R.string.dh_trip_in_progress, rider));
        }
        RidePlace target = toPickup ? r.pickup : r.destination;
        b.tripTarget.setText(getString(toPickup ? R.string.dh_target_pickup : R.string.dh_target_destination, target != null ? target.address : ""));
        boolean hasNote = toPickup && r.pickup != null && r.pickup.note != null && !r.pickup.note.isEmpty();
        b.tripNote.setVisibility(hasNote ? View.VISIBLE : View.GONE);
        if (hasNote) b.tripNote.setText(getString(R.string.dh_pickup_note, r.pickup.note));
        b.tripFare.setText(r.quote != null ? getString(R.string.dh_fare_cash, Money.format(r.quote.total)) : "");

        DriverAction action = RideRules.driverPrimaryAction(status);
        b.primaryAction.setVisibility(action != DriverAction.NONE ? View.VISIBLE : View.GONE);
        switch (action) {
            case START_HEADING_TO_PICKUP: b.primaryAction.setText(R.string.dh_action_en_route); break;
            case MARK_ARRIVED: b.primaryAction.setText(R.string.dh_action_arrived); break;
            case START_TRIP: b.primaryAction.setText(R.string.dh_action_start); break;
            case COMPLETE_TRIP: b.primaryAction.setText(R.string.dh_action_complete); break;
            default: break;
        }
        b.cancelTrip.setVisibility(RideRules.driverCanCancel(status) ? View.VISIBLE : View.GONE);
        renderNoShow();
    }

    private void renderNoShow() {
        Ride r = tripRide;
        if (r == null || b.stageTrip.getVisibility() != View.VISIBLE) return;
        RideStatus status = RideStatus.fromWire(r.status);
        int wait = (int) (policies != null ? policies.cancellation.driverNoShowWaitMinutes : 5);
        Long arrived = r.arrivedAt != null ? r.arrivedAt.toDate().getTime() : null;
        boolean allowed = RideRules.driverCanReportNoShow(status, arrived, System.currentTimeMillis(), wait);
        b.noShow.setVisibility(allowed ? View.VISIBLE : View.GONE);
        if (status == RideStatus.DRIVER_ARRIVED && !allowed && arrived != null) {
            long secs = Math.max(0, (arrived + wait * 60_000L - System.currentTimeMillis()) / 1000);
            b.noShowHint.setVisibility(View.VISIBLE);
            b.noShowHint.setText(getString(R.string.dh_no_show_wait, Durations.formatEta(secs)));
        } else {
            b.noShowHint.setVisibility(View.GONE);
        }
    }

    private void onCollectRide(DocState<Ride> s) {
        Ride r = s.data;
        if (r != null && PaymentStatus.fromWire(r.payment != null ? r.payment.status : null) != PaymentStatus.UNPAID) {
            // Already recorded (e.g. from the ride details screen).
            collectRide = null;
            vm.finishCollect();
        } else {
            collectRide = r != null && RideStatus.fromWire(r.status) == RideStatus.COMPLETED ? r : null;
        }
        render();
    }

    private void renderCollect() {
        Ride r = collectRide;
        if (r == null || r.finalFare == null) return;
        b.collectLines.removeAllViews();
        if (r.finalFare.lines != null) {
            for (FareLine line : r.finalFare.lines) {
                ItemFareLineBinding row = ItemFareLineBinding.inflate(getLayoutInflater(), b.collectLines, true);
                row.label.setText(line.label);
                row.amount.setText(Money.format(line.amount));
            }
        }
        b.collectTotal.setText(getString(R.string.dh_collect_total, Money.format(r.finalFare.total)));
        if (!r.rideId.equals(filledCollectFor)) {
            // Prefill once with the amount due; the driver edits it if the passenger paid differently.
            filledCollectFor = r.rideId;
            b.collectAmount.setText(String.format(Locale.US, "%d.%02d", r.finalFare.total / 100, r.finalFare.total % 100));
        }
    }

    private void renderMap(@Nullable Ride r) {
        if (map == null) return;
        RidePlace target = null;
        if (r != null) target = RideStatus.fromWire(r.status) == RideStatus.IN_PROGRESS ? r.destination : r.pickup;
        if (target == null) {
            if (targetMarker != null) {
                targetMarker.remove();
                targetMarker = null;
            }
            return;
        }
        LatLng pos = new LatLng(target.lat, target.lng);
        boolean destination = r != null && RideStatus.fromWire(r.status) == RideStatus.IN_PROGRESS;
        if (targetMarker == null || !targetMarker.getPosition().equals(pos)) {
            if (targetMarker != null) targetMarker.remove();
            targetMarker = map.addMarker(new MarkerOptions().position(pos).anchor(0.5f, 1f).title(target.address)
                    .icon(MarkerIcons.fromVector(this, destination ? R.drawable.ic_pin_destination : R.drawable.ic_pin_pickup)));
            map.animateCamera(CameraUpdateFactory.newLatLngZoom(pos, 16f));
        }
    }

    @Override
    @SuppressLint("MissingPermission") // Checked just below; a race is caught.
    public void onMapReady(@NonNull GoogleMap googleMap) {
        map = googleMap;
        map.getUiSettings().setMapToolbarEnabled(false);
        if (LocationPermissions.hasAny(this)) {
            try {
                map.setMyLocationEnabled(true);
            } catch (SecurityException ignored) {
                // Permission revoked between the check and the call.
            }
        }
        b.sheet.post(() -> { if (map != null) map.setPadding(0, b.topBar.getHeight(), 0, BottomSheetBehavior.from(b.sheet).getPeekHeight()); });
        render();
    }

    // ---- Actions ----------------------------------------------------------------------

    private void requestOnline() {
        showError(null);
        if (!LocationPermissions.hasAny(this)) {
            locationPermission.launch(LocationPermissions.FOREGROUND);
            return;
        }
        if (LocationPermissions.approximateOnly(this)) {
            showError(getString(R.string.dh_precise_needed));
            return;
        }
        if (!LocationPermissions.isLocationEnabled(this)) {
            showError(getString(R.string.ph_location_off_message));
            return;
        }
        if (LocationPermissions.needsNotificationPermission(this) && !askedNotifications) {
            // Offers arrive as notifications; asked once, never required to go online.
            askedNotifications = true;
            notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS);
            return;
        }
        if (location == null) return;
        setBusy(true);
        b.toggleOnline.setText(R.string.dh_getting_location);
        location.currentLocation(this).addOnCompleteListener(this, t -> {
            if (t.isSuccessful() && t.getResult() != null) vm.goOnline(t.getResult());
            else vm.reportLocationError(t.getException() != null ? t.getException() : new IllegalStateException("No fix"));
        });
    }

    private void onWentOnline(@Nullable AvailabilityResult r) {
        if (r == null) return;
        vm.consumeOnline();
        if (r.sessionId == null) return;
        resumedSession = r.sessionId;
        DriverLocationService.start(this, r.sessionId, r.locationUpdateIntervalSec, r.maxLocationAccuracyM, r.locationFreshnessSec);
    }

    private void confirmOffline() {
        Dialogs.confirm(this, R.string.dh_go_offline, getString(R.string.dh_go_offline_confirm), R.string.dh_go_offline, vm::goOffline);
    }

    private void onPrimaryAction() {
        Ride r = tripRide;
        if (r == null) return;
        DriverAction action = RideRules.driverPrimaryAction(RideStatus.fromWire(r.status));
        if (action == DriverAction.COMPLETE_TRIP) {
            Dialogs.confirm(this, R.string.dh_action_complete, getString(R.string.dh_complete_confirm), R.string.dh_action_complete,
                    () -> vm.complete(r.rideId));
            return;
        }
        String wire = RideRules.progressActionWire(action);
        if (wire != null) vm.progress(r.rideId, wire);
    }

    private void recordCash() {
        Ride r = collectRide;
        if (r == null || r.finalFare == null) return;
        long amount = Money.parsePesos(b.collectAmount.getText() != null ? b.collectAmount.getText().toString() : "");
        if (amount < 0) {
            b.collectAmountLayout.setError(getString(R.string.dh_cash_invalid));
            return;
        }
        b.collectAmountLayout.setError(null);
        if (amount < r.finalFare.total) {
            // A shortfall is recorded as such and visible to support; confirm it is intended.
            Dialogs.confirm(this, R.string.dh_record_cash,
                    getString(R.string.dh_cash_short_confirm, Money.format(amount), Money.format(r.finalFare.total)),
                    R.string.dh_record_cash, () -> vm.recordCash(r.rideId, amount));
        } else {
            vm.recordCash(r.rideId, amount);
        }
    }

    private void promptRating(@NonNull String rideId) {
        RatingBar bar = new RatingBar(this);
        bar.setNumStars(5);
        bar.setStepSize(1f);
        android.widget.FrameLayout box = new android.widget.FrameLayout(this);
        android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, android.view.Gravity.CENTER);
        box.addView(bar, lp);
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.dh_rate_passenger)
                .setView(box)
                .setNegativeButton(R.string.dh_skip, null)
                .setPositiveButton(R.string.action_submit, (d, w) -> {
                    int stars = Math.round(bar.getRating());
                    if (stars >= 1) vm.ratePassenger(rideId, stars);
                })
                .show();
    }

    private void navigate() {
        Ride r = tripRide;
        if (r == null) return;
        RidePlace target = RideStatus.fromWire(r.status) == RideStatus.IN_PROGRESS ? r.destination : r.pickup;
        if (target == null) return;
        Uri uri = Uri.parse(String.format(Locale.US, "geo:%.6f,%.6f?q=%.6f,%.6f(%s)", target.lat, target.lng, target.lat, target.lng,
                Uri.encode(target.address != null ? target.address : "")));
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.dh_no_maps_app, Toast.LENGTH_LONG).show();
        }
    }

    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenuInflater().inflate(R.menu.menu_driver_home, menu.getMenu());
        menu.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.menu_history) startActivity(RideHistoryActivity.intent(this, true));
            else if (id == R.id.menu_accreditation) startActivity(new Intent(this, DriverOnboardingActivity.class));
            else if (id == R.id.menu_support) startActivity(SupportActivity.intent(this, tripRide != null ? tripRide.rideId : null));
            else if (id == R.id.menu_profile) startActivity(new Intent(this, ProfileActivity.class));
            else return false;
            return true;
        });
        menu.show();
    }

    // ---- Helpers ----------------------------------------------------------------------

    private void setBusy(boolean busy) {
        b.toggleOnline.setEnabled(!busy);
        b.accept.setEnabled(!busy);
        b.decline.setEnabled(!busy);
        b.primaryAction.setEnabled(!busy);
        b.cancelTrip.setEnabled(!busy);
        b.noShow.setEnabled(!busy);
        b.recordCash.setEnabled(!busy);
        if (!busy && b.stageAvailability.getVisibility() == View.VISIBLE) render();
    }

    /** Ineligibility reasons are listed so the driver knows exactly what to fix. */
    private String messageFor(@NonNull AppException e) {
        String base = ErrorMessages.of(this, e);
        Map<String, Object> details = e.getDetails();
        Object reasons = details != null ? details.get("reasons") : null;
        if (reasons instanceof java.util.List && !((java.util.List<?>) reasons).isEmpty()) {
            StringBuilder sb = new StringBuilder(base);
            for (Object o : (java.util.List<?>) reasons) sb.append("\n• ").append(DriverReasons.label(this, String.valueOf(o)));
            return sb.toString();
        }
        return base;
    }

    private void showError(@Nullable String message) {
        b.error.setVisibility(message != null ? View.VISIBLE : View.GONE);
        b.error.setText(message);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(ticker);
        super.onDestroy();
    }
}
