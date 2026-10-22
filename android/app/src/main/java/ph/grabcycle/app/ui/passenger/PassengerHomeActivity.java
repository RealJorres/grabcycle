package ph.grabcycle.app.ui.passenger;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.location.Location;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.PopupMenu;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.core.content.IntentCompat;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;

import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.SupportMapFragment;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.LatLngBounds;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;
import com.google.android.gms.maps.model.Polyline;
import com.google.android.gms.maps.model.PolylineOptions;
import com.google.android.material.bottomsheet.BottomSheetBehavior;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.util.ArrayList;
import java.util.List;

import ph.grabcycle.app.R;
import ph.grabcycle.app.config.AppConfig;
import ph.grabcycle.app.data.AppException;
import ph.grabcycle.app.data.AuthRepository;
import ph.grabcycle.app.data.ConfigRepository;
import ph.grabcycle.app.data.MapReader;
import ph.grabcycle.app.data.PlacesRepository;
import ph.grabcycle.app.data.UserRepository;
import ph.grabcycle.app.databinding.ActivityPassengerHomeBinding;
import ph.grabcycle.app.databinding.ItemFareLineBinding;
import ph.grabcycle.app.location.LocationHelper;
import ph.grabcycle.app.location.LocationPermissions;
import ph.grabcycle.app.model.FareLine;
import ph.grabcycle.app.model.FareQuote;
import ph.grabcycle.app.model.NearbyDriver;
import ph.grabcycle.app.model.SelectedPlace;
import ph.grabcycle.app.model.ServiceArea;
import ph.grabcycle.app.model.UserProfile;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.app.ui.common.MarkerIcons;
import ph.grabcycle.app.ui.launch.LauncherActivity;
import ph.grabcycle.app.ui.profile.ProfileActivity;
import ph.grabcycle.app.ui.ride.RideHistoryActivity;
import ph.grabcycle.app.ui.support.SupportActivity;
import ph.grabcycle.app.ui.verification.PassengerVerificationActivity;
import ph.grabcycle.core.model.ErrorReason;
import ph.grabcycle.core.model.VerificationStatus;
import ph.grabcycle.core.util.Durations;
import ph.grabcycle.core.util.GeoMath;
import ph.grabcycle.core.util.Money;

/** Map-centred passenger home: set pickup and destination, see the fare, choose a driver. */
public class PassengerHomeActivity extends BaseActivity implements OnMapReadyCallback {

    private static final LatLng MARINDUQUE_FALLBACK = new LatLng(13.40, 121.96);

    private ActivityPassengerHomeBinding b;
    private PassengerHomeViewModel vm;
    private LocationHelper locationHelper;
    private BottomSheetBehavior<View> sheet;
    @Nullable private GoogleMap map;
    @Nullable private Marker pickupMarker;
    @Nullable private Marker destinationMarker;
    @Nullable private Polyline routeLine;
    private final List<Marker> driverMarkers = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    @Nullable private Runnable pendingGeocode;
    @Nullable private SelectedPlace pinPlace;
    private boolean pickupConfirmed;
    private boolean breakdownVisible;
    @Nullable private String launchedRideId;
    @Nullable private ServiceArea serviceArea;
    @Nullable private String firstName;

    private final ActivityResultLauncher<String[]> permissionLauncher =
            registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), result -> onPermissionResult());

    private final ActivityResultLauncher<Intent> placeSearch =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
                if (r.getResultCode() != RESULT_OK || r.getData() == null) return;
                boolean forPickup = r.getData().getBooleanExtra(PlaceSearchActivity.EXTRA_FOR_PICKUP, false);
                if (r.getData().getBooleanExtra(PlaceSearchActivity.RESULT_CHOOSE_ON_MAP, false)) {
                    enterPinMode(forPickup);
                    return;
                }
                SelectedPlace place = IntentCompat.getParcelableExtra(r.getData(), PlaceSearchActivity.RESULT_PLACE, SelectedPlace.class);
                if (place == null) return;
                if (forPickup) {
                    vm.setPickup(place);
                    pickupConfirmed = false;
                    enterPinMode(true);
                } else {
                    vm.setDestination(place);
                    proceedAfterDestination();
                }
            });

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String uid = AuthRepository.get().uid();
        if (uid == null) {
            restart();
            return;
        }
        b = ActivityPassengerHomeBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.topBar, true, false);
        Insets.pad(b.sheet, false, true);
        vm = new ViewModelProvider(this).get(PassengerHomeViewModel.class);
        locationHelper = new LocationHelper(this);
        sheet = BottomSheetBehavior.from(b.sheet);
        if (savedInstanceState != null) pickupConfirmed = savedInstanceState.getBoolean("pickupConfirmed");

        if (AppConfig.isMapsKeyPresent()) {
            SupportMapFragment mf = (SupportMapFragment) getSupportFragmentManager().findFragmentById(R.id.map);
            if (mf != null) mf.getMapAsync(this);
        } else {
            b.mapUnavailable.setVisibility(View.VISIBLE);
        }

        setUpSheet();
        observe(uid);
        if (vm.pickup().getValue() == null) startLocationFlow();
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean("pickupConfirmed", pickupConfirmed);
    }

    // ---- Setup ---------------------------------------------------------------

    private void setUpSheet() {
        b.menu.setOnClickListener(this::showMenu);
        b.myLocation.setOnClickListener(v -> startLocationFlow());
        b.verifyBanner.setOnClickListener(v -> startActivity(new Intent(this, PassengerVerificationActivity.class)));

        b.permissionAction.setOnClickListener(v -> onPermissionAction());
        b.permissionSkip.setOnClickListener(v -> vm.setStage(PassengerHomeViewModel.Stage.WHERE_TO));
        b.pickupRow.setOnClickListener(v -> openSearch(true));
        b.whereTo.setOnClickListener(v -> openSearch(false));
        b.pinConfirm.setOnClickListener(v -> confirmPin());
        b.pinCancel.setOnClickListener(v -> vm.setStage(vm.quote().getValue() != null ? PassengerHomeViewModel.Stage.QUOTE : PassengerHomeViewModel.Stage.WHERE_TO));
        b.passengersMinus.setOnClickListener(v -> vm.changePassengers(-1));
        b.passengersPlus.setOnClickListener(v -> vm.changePassengers(1));
        b.toggleBreakdown.setOnClickListener(v -> {
            breakdownVisible = !breakdownVisible;
            renderQuote(vm.quote().getValue());
        });
        b.findDriver.setOnClickListener(v -> vm.setStage(PassengerHomeViewModel.Stage.DRIVERS));
        b.quoteBack.setOnClickListener(v -> vm.clearTrip());
        b.bookNearest.setOnClickListener(v -> vm.book(null, true));
        b.driversBack.setOnClickListener(v -> vm.setStage(PassengerHomeViewModel.Stage.QUOTE));

        NearbyDriverAdapter adapter = new NearbyDriverAdapter(this::confirmDriver);
        b.driversList.setLayoutManager(new LinearLayoutManager(this));
        b.driversList.setAdapter(adapter);
        vm.nearby().observe(this, result -> {
            adapter.submitList(result != null ? result.drivers : null);
            renderNearby(result);
        });
    }

    private void observe(String uid) {
        UserRepository.get().profile(uid).observe(this, state -> {
            UserProfile p = state.data;
            if (p == null) return;
            firstName = p.firstName;
            b.greeting.setText(firstName != null ? getString(R.string.ph_greeting, firstName) : getString(R.string.ph_greeting_plain));
            renderVerification(p);
            if (p.activeRideId != null && !p.activeRideId.equals(launchedRideId)) {
                launchedRideId = p.activeRideId;
                startActivity(PassengerRideActivity.intent(this, p.activeRideId));
            }
        });
        ConfigRepository.get().serviceArea().observe(this, s -> {
            serviceArea = s.data;
            if (map != null && vm.pickup().getValue() == null) moveToServiceArea();
        });
        vm.stage().observe(this, this::renderStage);
        vm.pickup().observe(this, p -> { renderPickup(p); renderMapPlaces(); });
        vm.destination().observe(this, d -> renderMapPlaces());
        vm.quote().observe(this, this::renderQuote);
        vm.passengers().observe(this, n -> b.passengers.setText(getResources().getQuantityString(R.plurals.ph_passengers, n, n)));
        vm.busy().observe(this, busy -> {
            b.sheetProgress.setVisibility(Boolean.TRUE.equals(busy) ? View.VISIBLE : View.GONE);
            b.findDriver.setEnabled(!Boolean.TRUE.equals(busy));
            b.bookNearest.setEnabled(!Boolean.TRUE.equals(busy));
            b.pinConfirm.setEnabled(!Boolean.TRUE.equals(busy) && pinPlace != null);
        });
        vm.error().observe(this, e -> showSheetError(e != null ? ErrorMessages.of(this, e) : null));
        vm.nearbyError().observe(this, e -> {
            if (e != null) renderNearby(null);
        });
        vm.booking().observe(this, r -> {
            if (r == null) return;
            vm.consumeBooking();
            if (r.rideId != null) {
                launchedRideId = r.rideId;
                startActivity(PassengerRideActivity.intent(this, r.rideId));
            } else if (r.error != null) {
                showSheetError(ErrorMessages.of(this, r.error));
            }
        });
    }

    // ---- Verification gate --------------------------------------------------

    private void renderVerification(UserProfile p) {
        VerificationStatus status = VerificationStatus.fromWire(p.passengerVerification != null ? p.passengerVerification.status : null);
        Long validUntil = p.passengerVerification != null ? p.passengerVerification.validUntil : null;
        boolean canBook = VerificationStatus.canBook(status, validUntil, System.currentTimeMillis());
        vm.setCanBook(canBook);
        b.verifyBanner.setVisibility(canBook ? View.GONE : View.VISIBLE);
        b.findDriver.setText(canBook ? R.string.ph_choose_driver : R.string.ph_verify_to_book);
        if (canBook) return;
        switch (status) {
            case SUBMITTED:
            case UNDER_REVIEW:
                b.verifyTitle.setText(R.string.ph_verify_pending_title);
                b.verifyMessage.setText(R.string.ph_verify_pending_message);
                break;
            case NEEDS_RESUBMISSION:
                b.verifyTitle.setText(R.string.ph_verify_resubmit_title);
                b.verifyMessage.setText(p.passengerVerification != null && p.passengerVerification.publicMessage != null
                        ? p.passengerVerification.publicMessage : getString(R.string.ph_verify_resubmit_message));
                break;
            case REJECTED:
            case SUSPENDED:
                b.verifyTitle.setText(R.string.ph_verify_blocked_title);
                b.verifyMessage.setText(R.string.ph_verify_blocked_message);
                break;
            default:
                b.verifyTitle.setText(R.string.ph_verify_title);
                b.verifyMessage.setText(R.string.ph_verify_message);
        }
    }

    private boolean ensureCanBook() {
        if (b.verifyBanner.getVisibility() == View.VISIBLE) {
            startActivity(new Intent(this, PassengerVerificationActivity.class));
            return false;
        }
        return true;
    }

    // ---- Location -------------------------------------------------------------

    private void startLocationFlow() {
        if (!LocationPermissions.hasAny(this)) {
            showPermissionStage(false);
            return;
        }
        if (!LocationPermissions.isLocationEnabled(this)) {
            showLocationDisabled();
            return;
        }
        enableMyLocationLayer();
        vm.setStage(PassengerHomeViewModel.Stage.WHERE_TO);
        b.pickupText.setText(R.string.ph_locating);
        locationHelper.currentLocation(this).addOnCompleteListener(t -> {
            if (!t.isSuccessful() || t.getResult() == null) {
                b.pickupText.setText(R.string.ph_location_unavailable);
                return;
            }
            Location loc = t.getResult();
            SelectedPlace place = new SelectedPlace(loc.getLatitude(), loc.getLongitude(), getString(R.string.ph_current_location), null, loc.getAccuracy());
            vm.setPickup(place);
            pickupConfirmed = false;
            if (map != null) map.animateCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(place.lat, place.lng), 16f));
            resolveAddress(place.lat, place.lng, (address, inArea) -> {
                SelectedPlace current = vm.pickup().getValue();
                if (current != null && current.lat == place.lat && current.lng == place.lng) {
                    vm.setPickup(new SelectedPlace(place.lat, place.lng, address != null ? address : place.address, null, place.accuracyM));
                }
                if (!inArea) showSheetError(getString(R.string.err_outside_service_area));
            });
        });
    }

    private void showPermissionStage(boolean permanentlyDenied) {
        vm.setStage(PassengerHomeViewModel.Stage.PERMISSION);
        b.permissionTitle.setText(R.string.ph_location_title);
        b.permissionMessage.setText(permanentlyDenied ? R.string.ph_location_denied : R.string.ph_location_rationale);
        b.permissionAction.setText(permanentlyDenied ? R.string.action_open_settings : R.string.ph_location_allow);
        b.permissionAction.setTag(permanentlyDenied ? "settings" : "request");
    }

    private void showLocationDisabled() {
        vm.setStage(PassengerHomeViewModel.Stage.PERMISSION);
        b.permissionTitle.setText(R.string.ph_location_off_title);
        b.permissionMessage.setText(R.string.ph_location_off_message);
        b.permissionAction.setText(R.string.action_open_settings);
        b.permissionAction.setTag("location_settings");
    }

    private void onPermissionAction() {
        Object tag = b.permissionAction.getTag();
        if ("settings".equals(tag)) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getPackageName(), null)));
        } else if ("location_settings".equals(tag)) {
            startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
        } else {
            permissionLauncher.launch(LocationPermissions.FOREGROUND);
        }
    }

    private void onPermissionResult() {
        if (LocationPermissions.hasAny(this)) {
            if (LocationPermissions.approximateOnly(this)) showSheetError(getString(R.string.ph_location_approximate));
            startLocationFlow();
        } else {
            boolean canAskAgain = shouldShowRequestPermissionRationale(android.Manifest.permission.ACCESS_FINE_LOCATION);
            showPermissionStage(!canAskAgain);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (vm.stage().getValue() == PassengerHomeViewModel.Stage.PERMISSION && LocationPermissions.hasAny(this)
                && LocationPermissions.isLocationEnabled(this)) {
            startLocationFlow();
        }
    }

    @SuppressLint("MissingPermission")
    private void enableMyLocationLayer() {
        if (map != null && LocationPermissions.hasAny(this)) map.setMyLocationEnabled(true);
    }

    // ---- Map -------------------------------------------------------------------

    @Override
    public void onMapReady(@NonNull GoogleMap googleMap) {
        map = googleMap;
        map.getUiSettings().setMyLocationButtonEnabled(false);
        map.getUiSettings().setMapToolbarEnabled(false);
        map.getUiSettings().setRotateGesturesEnabled(false);
        map.setOnCameraIdleListener(this::onCameraIdle);
        b.sheet.post(() -> {
            if (map != null) map.setPadding(0, b.topBar.getHeight(), 0, sheet.getPeekHeight());
        });
        enableMyLocationLayer();
        SelectedPlace p = vm.pickup().getValue();
        if (p != null) map.moveCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(p.lat, p.lng), 15f));
        else moveToServiceArea();
        renderMapPlaces();
        renderQuote(vm.quote().getValue());
        renderNearby(vm.nearby().getValue());
    }

    private void moveToServiceArea() {
        if (map == null) return;
        LatLng center = MARINDUQUE_FALLBACK;
        if (serviceArea != null && serviceArea.polygons != null && !serviceArea.polygons.isEmpty()
                && serviceArea.polygons.get(0).points != null && !serviceArea.polygons.get(0).points.isEmpty()) {
            double lat = 0;
            double lng = 0;
            int n = serviceArea.polygons.get(0).points.size();
            for (ph.grabcycle.app.model.GeoPoint2 pt : serviceArea.polygons.get(0).points) {
                lat += pt.lat;
                lng += pt.lng;
            }
            center = new LatLng(lat / n, lng / n);
        }
        map.moveCamera(CameraUpdateFactory.newLatLngZoom(center, 10.5f));
    }

    private void onCameraIdle() {
        PassengerHomeViewModel.Stage s = vm.stage().getValue();
        if (map == null || (s != PassengerHomeViewModel.Stage.PIN_PICKUP && s != PassengerHomeViewModel.Stage.PIN_DESTINATION)) return;
        LatLng target = map.getCameraPosition().target;
        pinPlace = null;
        b.pinConfirm.setEnabled(false);
        b.pinAddress.setText(R.string.ph_resolving);
        if (pendingGeocode != null) handler.removeCallbacks(pendingGeocode);
        pendingGeocode = () -> resolveAddress(target.latitude, target.longitude, (address, inArea) -> {
            LatLng now = map != null ? map.getCameraPosition().target : null;
            if (now == null || now.latitude != target.latitude || now.longitude != target.longitude) return;
            String label = address != null ? address : getString(R.string.ph_pinned_location, target.latitude, target.longitude);
            b.pinAddress.setText(label);
            b.pinWarning.setVisibility(inArea ? View.GONE : View.VISIBLE);
            b.pinWarning.setText(R.string.err_outside_service_area);
            pinPlace = inArea ? new SelectedPlace(target.latitude, target.longitude, label, null, null) : null;
            b.pinConfirm.setEnabled(pinPlace != null);
        });
        handler.postDelayed(pendingGeocode, 600);
    }

    private interface AddressCallback {
        void onAddress(@Nullable String address, boolean inServiceArea);
    }

    private void resolveAddress(double lat, double lng, AddressCallback cb) {
        PlacesRepository.get().reverseGeocode(lat, lng).addOnCompleteListener(t -> {
            if (!t.isSuccessful()) {
                // Unknown: let the server decide service-area eligibility at quote time.
                cb.onAddress(null, true);
                return;
            }
            MapReader r = t.getResult();
            cb.onAddress(r.string("address"), r.getBool("inServiceArea", true));
        });
    }

    private void enterPinMode(boolean forPickup) {
        vm.setStage(forPickup ? PassengerHomeViewModel.Stage.PIN_PICKUP : PassengerHomeViewModel.Stage.PIN_DESTINATION);
        SelectedPlace start = forPickup ? vm.pickup().getValue() : vm.destination().getValue();
        if (map != null && start != null) map.animateCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(start.lat, start.lng), 17f));
        else onCameraIdle();
    }

    private void confirmPin() {
        if (pinPlace == null) return;
        if (vm.stage().getValue() == PassengerHomeViewModel.Stage.PIN_PICKUP) {
            SelectedPlace current = vm.pickup().getValue();
            // Keep GPS accuracy only if the passenger did not move the pin away from the fix.
            Float acc = current != null && current.accuracyM != null
                    && GeoMath.distanceMeters(current.lat, current.lng, pinPlace.lat, pinPlace.lng) < 15 ? current.accuracyM : null;
            vm.setPickup(new SelectedPlace(pinPlace.lat, pinPlace.lng, pinPlace.address, null, acc));
            pickupConfirmed = true;
        } else {
            vm.setDestination(pinPlace);
        }
        proceedAfterDestination();
    }

    private void proceedAfterDestination() {
        if (vm.destination().getValue() == null) {
            vm.setStage(PassengerHomeViewModel.Stage.WHERE_TO);
            return;
        }
        if (!pickupConfirmed) {
            enterPinMode(true);
            return;
        }
        vm.requestQuote();
    }

    private void openSearch(boolean forPickup) {
        SelectedPlace near = vm.pickup().getValue();
        placeSearch.launch(PlaceSearchActivity.intent(this, forPickup, near));
    }

    // ---- Rendering --------------------------------------------------------------

    private void renderStage(PassengerHomeViewModel.Stage s) {
        b.stagePermission.setVisibility(s == PassengerHomeViewModel.Stage.PERMISSION ? View.VISIBLE : View.GONE);
        b.stageWhere.setVisibility(s == PassengerHomeViewModel.Stage.WHERE_TO ? View.VISIBLE : View.GONE);
        boolean pin = s == PassengerHomeViewModel.Stage.PIN_PICKUP || s == PassengerHomeViewModel.Stage.PIN_DESTINATION;
        b.stagePin.setVisibility(pin ? View.VISIBLE : View.GONE);
        b.centerPin.setVisibility(pin ? View.VISIBLE : View.GONE);
        b.stageQuote.setVisibility(s == PassengerHomeViewModel.Stage.QUOTE ? View.VISIBLE : View.GONE);
        b.stageDrivers.setVisibility(s == PassengerHomeViewModel.Stage.DRIVERS ? View.VISIBLE : View.GONE);
        if (pin) {
            boolean forPickup = s == PassengerHomeViewModel.Stage.PIN_PICKUP;
            b.centerPin.setImageResource(forPickup ? R.drawable.ic_pin_pickup : R.drawable.ic_pin_destination);
            b.pinTitle.setText(forPickup ? R.string.ph_confirm_pickup_title : R.string.ph_confirm_destination_title);
            b.pinConfirm.setText(forPickup ? R.string.ph_confirm_pickup : R.string.ph_confirm_destination);
            SelectedPlace gps = vm.pickup().getValue();
            b.pinHint.setText(forPickup && gps != null && gps.accuracyM != null
                    ? getString(R.string.ph_pin_hint_accuracy, Math.round(gps.accuracyM)) : getString(R.string.ph_pin_hint));
        }
        if (s == PassengerHomeViewModel.Stage.DRIVERS && !ensureCanBook()) {
            vm.setStage(PassengerHomeViewModel.Stage.QUOTE);
        }
        renderMapPlaces();
        sheet.setState(BottomSheetBehavior.STATE_EXPANDED);
    }

    private void renderPickup(@Nullable SelectedPlace p) {
        if (p == null) return;
        String text = p.address;
        if (p.accuracyM != null && p.accuracyM > 50) text = getString(R.string.ph_pickup_with_accuracy, p.address, Math.round(p.accuracyM));
        b.pickupText.setText(text);
    }

    private void renderMapPlaces() {
        if (map == null) return;
        PassengerHomeViewModel.Stage s = vm.stage().getValue();
        boolean pinPickup = s == PassengerHomeViewModel.Stage.PIN_PICKUP;
        boolean pinDest = s == PassengerHomeViewModel.Stage.PIN_DESTINATION;
        SelectedPlace p = vm.pickup().getValue();
        SelectedPlace d = vm.destination().getValue();
        if (pickupMarker != null) pickupMarker.remove();
        if (destinationMarker != null) destinationMarker.remove();
        pickupMarker = null;
        destinationMarker = null;
        if (p != null && !pinPickup) {
            pickupMarker = map.addMarker(new MarkerOptions().position(new LatLng(p.lat, p.lng)).anchor(0.5f, 1f)
                    .title(getString(R.string.ph_pickup)).icon(MarkerIcons.fromVector(this, R.drawable.ic_pin_pickup)));
        }
        if (d != null && !pinDest) {
            destinationMarker = map.addMarker(new MarkerOptions().position(new LatLng(d.lat, d.lng)).anchor(0.5f, 1f)
                    .title(getString(R.string.ph_destination)).icon(MarkerIcons.fromVector(this, R.drawable.ic_pin_destination)));
        }
    }

    private void renderQuote(@Nullable FareQuote q) {
        if (routeLine != null) {
            routeLine.remove();
            routeLine = null;
        }
        if (q == null) return;
        SelectedPlace p = vm.pickup().getValue();
        SelectedPlace d = vm.destination().getValue();
        b.routeSummary.setText(p != null && d != null ? getString(R.string.ph_route_summary, p.address, d.address) : "");
        b.fareTotal.setText(Money.format(q.total));
        b.fareTotal.setContentDescription(getString(R.string.ph_fare_desc, Money.format(q.total)));
        String distance = GeoMath.formatDistance(q.distanceMeters);
        if (q.isRoadDistance()) {
            b.distanceInfo.setText(q.durationSeconds != null
                    ? getString(R.string.ph_distance_road_eta, distance, Durations.formatEta(q.durationSeconds))
                    : getString(R.string.ph_distance_road, distance));
        } else {
            b.distanceInfo.setText(getString(R.string.ph_distance_estimate, distance));
        }
        List<String> notices = new ArrayList<>();
        if (q.notice != null) notices.add(q.notice);
        if (q.fareIsSample) notices.add(getString(R.string.ph_sample_fare_notice));
        b.quoteNotice.setVisibility(notices.isEmpty() ? View.GONE : View.VISIBLE);
        b.quoteNotice.setText(android.text.TextUtils.join("\n", notices));

        b.toggleBreakdown.setText(breakdownVisible ? R.string.ph_hide_breakdown : R.string.ph_show_breakdown);
        b.breakdown.setVisibility(breakdownVisible ? View.VISIBLE : View.GONE);
        b.breakdown.removeAllViews();
        LayoutInflater inflater = getLayoutInflater();
        for (FareLine line : q.lines) {
            ItemFareLineBinding row = ItemFareLineBinding.inflate(inflater, b.breakdown, true);
            row.label.setText(line.label);
            row.amount.setText(Money.format(line.amount));
        }

        if (map != null && p != null && d != null) {
            // Only real road routes are drawn; straight-line estimates get no route line.
            List<double[]> pts = ph.grabcycle.core.util.Polyline.decode(q.isRoadDistance() ? q.polyline : null);
            LatLngBounds.Builder bounds = LatLngBounds.builder().include(new LatLng(p.lat, p.lng)).include(new LatLng(d.lat, d.lng));
            if (!pts.isEmpty()) {
                PolylineOptions opts = new PolylineOptions().width(getResources().getDisplayMetrics().density * 5)
                        .color(ContextCompat.getColor(this, R.color.gc_route_line));
                for (double[] pt : pts) {
                    LatLng ll = new LatLng(pt[0], pt[1]);
                    opts.add(ll);
                    bounds.include(ll);
                }
                routeLine = map.addPolyline(opts);
            }
            try {
                map.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), (int) (64 * getResources().getDisplayMetrics().density)));
            } catch (IllegalStateException ignored) {
                // Map not laid out yet.
            }
        }
    }

    private void renderNearby(@Nullable NearbyDriver.Result result) {
        for (Marker m : driverMarkers) m.remove();
        driverMarkers.clear();
        if (vm.stage().getValue() != PassengerHomeViewModel.Stage.DRIVERS) return;
        AppException err = vm.nearbyError().getValue();
        if (result == null) {
            b.driversList.setVisibility(View.GONE);
            b.bookNearest.setVisibility(View.GONE);
            if (err != null) {
                if (err.getReason() == ErrorReason.NETWORK) b.driversState.showOffline(() -> vm.loadNearby(true));
                else b.driversState.showError(getString(R.string.ph_drivers_error_title), ErrorMessages.of(this, err), () -> vm.loadNearby(true));
            } else {
                b.driversState.showLoading(getString(R.string.ph_finding_nearby));
            }
            return;
        }
        if (result.drivers.isEmpty()) {
            b.driversList.setVisibility(View.GONE);
            b.bookNearest.setVisibility(View.GONE);
            b.driversSubtitle.setText(getString(R.string.ph_no_drivers_radius, GeoMath.formatDistance(result.radiusMeters)));
            b.driversState.show(R.drawable.ic_tricycle, getString(R.string.ph_no_drivers_title),
                    getString(result.maxRadiusReached ? R.string.ph_no_drivers_message_max : R.string.ph_no_drivers_message),
                    getString(result.maxRadiusReached ? R.string.action_retry : R.string.ph_search_wider),
                    result.maxRadiusReached ? () -> vm.loadNearby(true) : vm::expandSearch);
            return;
        }
        b.driversState.hide();
        b.driversList.setVisibility(View.VISIBLE);
        b.bookNearest.setVisibility(View.VISIBLE);
        b.driversSubtitle.setText(getResources().getQuantityString(R.plurals.ph_drivers_within, result.drivers.size(),
                result.drivers.size(), GeoMath.formatDistance(result.radiusMeters)));
        if (map != null) {
            for (NearbyDriver d : result.drivers) {
                driverMarkers.add(map.addMarker(new MarkerOptions().position(new LatLng(d.approxLat, d.approxLng))
                        .anchor(0.5f, 0.5f).title(d.displayName).icon(MarkerIcons.fromVector(this, R.drawable.ic_marker_tricycle))));
            }
        }
    }

    private void confirmDriver(@NonNull NearbyDriver driver) {
        if (!ensureCanBook()) return;
        final boolean[] fallback = {true};
        new MaterialAlertDialogBuilder(this)
                .setTitle(getString(R.string.ph_book_driver_title, driver.displayName))
                .setMultiChoiceItems(new CharSequence[] {getString(R.string.ph_allow_fallback)}, new boolean[] {true},
                        (d, which, checked) -> fallback[0] = checked)
                .setNegativeButton(R.string.action_cancel, null)
                .setPositiveButton(R.string.ph_book, (d, w) -> vm.book(driver.driverId, fallback[0]))
                .show();
    }

    private void showSheetError(@Nullable String message) {
        b.sheetError.setVisibility(message != null ? View.VISIBLE : View.GONE);
        b.sheetError.setText(message);
    }

    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenuInflater().inflate(R.menu.menu_passenger_home, menu.getMenu());
        menu.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.menu_history) startActivity(RideHistoryActivity.intent(this, false));
            else if (id == R.id.menu_verification) startActivity(new Intent(this, PassengerVerificationActivity.class));
            else if (id == R.id.menu_support) startActivity(SupportActivity.intent(this, null));
            else if (id == R.id.menu_profile) startActivity(new Intent(this, ProfileActivity.class));
            return true;
        });
        menu.show();
    }

    private void restart() {
        startActivity(new Intent(this, LauncherActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        finish();
    }

    @Override
    protected void onDestroy() {
        if (pendingGeocode != null) handler.removeCallbacks(pendingGeocode);
        if (locationHelper != null) locationHelper.cancel();
        super.onDestroy();
    }
}
