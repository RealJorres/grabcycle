package ph.grabcycle.app.ui.driver;

import android.location.Location;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MediatorLiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.SavedStateHandle;
import androidx.lifecycle.Transformations;
import androidx.lifecycle.ViewModel;

import com.google.android.gms.tasks.Task;

import java.util.Objects;

import ph.grabcycle.app.data.AppException;
import ph.grabcycle.app.data.DocState;
import ph.grabcycle.app.data.DriverRepository;
import ph.grabcycle.app.data.MapReader;
import ph.grabcycle.app.data.RideRepository;
import ph.grabcycle.app.location.LocationPermissions;
import ph.grabcycle.app.model.AvailabilityResult;
import ph.grabcycle.app.model.DriverProfile;
import ph.grabcycle.app.model.Ride;
import ph.grabcycle.app.model.RideContact;
import ph.grabcycle.core.model.RideStatus;
import ph.grabcycle.core.ride.RideRules;

/**
 * Driver home state. Everything shown is derived from the server-written
 * driver record: the current offer and the current trip are whatever
 * {@code drivers/{uid}} points at, so the screen can never show a trip the
 * backend did not assign. Actions only request changes.
 */
public class DriverHomeViewModel extends ViewModel {

    private final DriverRepository drivers = DriverRepository.get();
    private final RideRepository rides = RideRepository.get();

    private final MutableLiveData<String> uid = new MutableLiveData<>();
    private final LiveData<DocState<DriverProfile>> driver;
    private final MediatorLiveData<String> offerRideId = new MediatorLiveData<>();
    private final MediatorLiveData<String> tripRideId = new MediatorLiveData<>();
    private final MediatorLiveData<String> contactRideId = new MediatorLiveData<>();
    private final LiveData<DocState<Ride>> offer;
    private final LiveData<DocState<Ride>> trip;
    private final LiveData<DocState<RideContact>> contact;

    private final MutableLiveData<Boolean> busy = new MutableLiveData<>(false);
    private final MutableLiveData<AppException> error = new MutableLiveData<>();
    private final MutableLiveData<AvailabilityResult> wentOnline = new MutableLiveData<>();
    private final MutableLiveData<Boolean> wentOffline = new MutableLiveData<>();
    /** Completed trip whose cash has not been recorded yet (survives process death). */
    private final MutableLiveData<String> collectRideId;
    private final LiveData<DocState<Ride>> collectRide;
    private final MutableLiveData<String> ratePrompt = new MutableLiveData<>();

    public DriverHomeViewModel(@NonNull SavedStateHandle state) {
        collectRideId = state.getLiveData("collectRideId");
        collectRide = Transformations.switchMap(collectRideId, id -> id != null ? rides.ride(id) : null);
        driver = Transformations.switchMap(uid, u -> u != null ? drivers.driver(u) : null);
        offerRideId.addSource(driver, s -> setIfChanged(offerRideId, s.data != null ? s.data.currentOfferRideId : null));
        tripRideId.addSource(driver, s -> setIfChanged(tripRideId, s.data != null ? s.data.currentRideId : null));
        offer = Transformations.switchMap(offerRideId, id -> id != null ? rides.ride(id) : null);
        trip = Transformations.switchMap(tripRideId, id -> id != null ? rides.ride(id) : null);
        // Contact details are readable only during an active trip.
        contactRideId.addSource(trip, s -> {
            Ride r = s.data;
            setIfChanged(contactRideId, r != null && RideRules.contactAvailable(RideStatus.fromWire(r.status)) ? r.rideId : null);
        });
        contact = Transformations.switchMap(contactRideId, id -> id != null ? rides.contact(id) : null);
    }

    private static void setIfChanged(MutableLiveData<String> target, @Nullable String value) {
        if (!Objects.equals(target.getValue(), value)) target.setValue(value);
    }

    public void bind(@NonNull String driverUid) {
        if (!driverUid.equals(uid.getValue())) uid.setValue(driverUid);
    }

    public LiveData<DocState<DriverProfile>> driver() { return driver; }
    public LiveData<DocState<Ride>> offer() { return offer; }
    public LiveData<DocState<Ride>> trip() { return trip; }
    public LiveData<DocState<RideContact>> contact() { return contact; }
    public LiveData<Boolean> busy() { return busy; }
    public LiveData<AppException> error() { return error; }
    /** One-shot: the backend accepted the go-online request (start sharing location). */
    public LiveData<AvailabilityResult> wentOnline() { return wentOnline; }
    public LiveData<Boolean> wentOffline() { return wentOffline; }
    public LiveData<DocState<Ride>> collectRide() { return collectRide; }
    /** One-shot: cash recorded for this ride; prompt to rate the passenger. */
    public LiveData<String> ratePrompt() { return ratePrompt; }

    public void clearError() { error.setValue(null); }
    public void consumeOnline() { wentOnline.setValue(null); }
    public void consumeOffline() { wentOffline.setValue(null); }
    public void consumeRatePrompt() { ratePrompt.setValue(null); }

    /** Stops asking for cash on a ride whose payment was already recorded (e.g. elsewhere). */
    public void finishCollect() { collectRideId.setValue(null); }

    private boolean begin() {
        if (Boolean.TRUE.equals(busy.getValue())) return false;
        busy.setValue(true);
        error.setValue(null);
        return true;
    }

    private void fail(@Nullable Exception e) {
        busy.setValue(false);
        error.setValue(AppException.from(e));
    }

    // ---- Availability ---------------------------------------------------------------

    public void goOnline(@NonNull Location fix) {
        if (!begin()) return;
        float acc = fix.hasAccuracy() ? fix.getAccuracy() : 10_000f;
        drivers.setAvailability(true, fix.getLatitude(), fix.getLongitude(), acc, LocationPermissions.isMock(fix))
                .addOnCompleteListener(t -> {
                    if (!t.isSuccessful() || t.getResult() == null) {
                        fail(t.getException());
                        return;
                    }
                    busy.setValue(false);
                    wentOnline.setValue(t.getResult());
                });
    }

    public void goOffline() {
        if (!begin()) return;
        drivers.setAvailability(false, 0, 0, 0, false).addOnCompleteListener(t -> {
            if (!t.isSuccessful()) {
                fail(t.getException());
                return;
            }
            busy.setValue(false);
            wentOffline.setValue(true);
        });
    }

    public void reportLocationError(@NonNull Exception e) {
        busy.setValue(false);
        error.setValue(AppException.from(e));
    }

    // ---- Offer and trip -------------------------------------------------------------

    public void respond(@NonNull String rideId, boolean accept) {
        if (!begin()) return;
        run(rides.respondToOffer(rideId, accept, accept ? null : "DRIVER_DECLINED"));
    }

    public void progress(@NonNull String rideId, @NonNull String action) {
        if (!begin()) return;
        run(rides.updateProgress(rideId, action));
    }

    /**
     * Completes the trip; the backend computes the final fare (quote plus any
     * waiting time). Cash is recorded in a second step against that amount.
     */
    public void complete(@NonNull String rideId) {
        if (!begin()) return;
        rides.complete(rideId, null).addOnCompleteListener(t -> {
            if (!t.isSuccessful()) {
                fail(t.getException());
                return;
            }
            busy.setValue(false);
            collectRideId.setValue(rideId);
        });
    }

    public void recordCash(@NonNull String rideId, long amountCentavos) {
        if (!begin()) return;
        rides.recordCash(rideId, amountCentavos).addOnCompleteListener(t -> {
            if (!t.isSuccessful()) {
                fail(t.getException());
                return;
            }
            busy.setValue(false);
            collectRideId.setValue(null);
            ratePrompt.setValue(rideId);
        });
    }

    public void cancel(@NonNull String rideId, @NonNull String reasonCode) {
        if (!begin()) return;
        run(rides.cancel(rideId, reasonCode, null));
    }

    public void ratePassenger(@NonNull String rideId, int stars) {
        rides.rate(rideId, stars, null).addOnCompleteListener(t -> {
            if (!t.isSuccessful()) error.setValue(AppException.from(t.getException()));
        });
    }

    private void run(@NonNull Task<MapReader> task) {
        task.addOnCompleteListener(t -> {
            if (!t.isSuccessful()) fail(t.getException());
            else busy.setValue(false);
        });
    }
}
