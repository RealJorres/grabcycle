package ph.grabcycle.app.ui.ride;

import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MediatorLiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.Transformations;
import androidx.lifecycle.ViewModel;

import java.util.List;
import java.util.Objects;

import ph.grabcycle.app.data.AppException;
import ph.grabcycle.app.data.DocState;
import ph.grabcycle.app.data.DriverLocationLiveData;
import ph.grabcycle.app.data.RideRepository;
import ph.grabcycle.app.model.Ride;
import ph.grabcycle.app.model.RideContact;
import ph.grabcycle.app.model.RideEvent;
import ph.grabcycle.core.model.RideStatus;
import ph.grabcycle.core.ride.RideRules;

/**
 * Observes one ride (the authoritative Firestore document) and asks the
 * backend to advance it while searching. Live driver location and contact
 * details are only attached during stages where the server allows them.
 */
public class PassengerRideViewModel extends ViewModel {

    private final RideRepository repo = RideRepository.get();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final MutableLiveData<String> rideId = new MutableLiveData<>();
    private final MutableLiveData<AppException> actionError = new MutableLiveData<>();
    private final MutableLiveData<Boolean> busy = new MutableLiveData<>(false);
    private final MutableLiveData<Boolean> rated = new MutableLiveData<>(false);
    private final LiveData<DocState<Ride>> ride = Transformations.switchMap(rideId, repo::ride);
    private final LiveData<DocState<List<RideEvent>>> events = Transformations.switchMap(rideId, repo::events);
    private final MediatorLiveData<String> trackedDriver = new MediatorLiveData<>();
    private final MediatorLiveData<String> contactRide = new MediatorLiveData<>();
    private final LiveData<DriverLocationLiveData.State> driverLocation;
    private final LiveData<DocState<RideContact>> contact;
    private boolean searching;

    private final Runnable refresh = new Runnable() {
        @Override
        public void run() {
            String id = rideId.getValue();
            if (id == null || !searching) return;
            // Lets the server enforce offer timeouts / search deadlines promptly.
            repo.refresh(id).addOnCompleteListener(t -> {
                if (searching) handler.postDelayed(this, 5_000);
            });
        }
    };

    public PassengerRideViewModel() {
        trackedDriver.addSource(ride, s -> {
            Ride r = s.data;
            String driver = r != null && RideRules.passengerSeesDriverLocation(RideStatus.fromWire(r.status)) ? r.driverUid : null;
            if (!Objects.equals(driver, trackedDriver.getValue())) trackedDriver.setValue(driver);
        });
        contactRide.addSource(ride, s -> {
            Ride r = s.data;
            String id = r != null && RideRules.contactAvailable(RideStatus.fromWire(r.status)) ? r.rideId : null;
            if (!Objects.equals(id, contactRide.getValue())) contactRide.setValue(id);
        });
        // switchMap with a null source stops observing (e.g. once the trip ends).
        driverLocation = Transformations.switchMap(trackedDriver, d -> d != null ? repo.driverLocation(d) : null);
        contact = Transformations.switchMap(contactRide, id -> id != null ? repo.contact(id) : null);
    }

    public void bind(@NonNull String id) {
        if (!id.equals(rideId.getValue())) rideId.setValue(id);
    }

    public LiveData<DocState<Ride>> ride() { return ride; }
    public LiveData<DocState<List<RideEvent>>> events() { return events; }
    public LiveData<DriverLocationLiveData.State> driverLocation() { return driverLocation; }
    public LiveData<DocState<RideContact>> contact() { return contact; }
    public LiveData<AppException> actionError() { return actionError; }
    public LiveData<Boolean> busy() { return busy; }
    public LiveData<Boolean> rated() { return rated; }

    /** Called by the screen on each ride update; polls the backend only while searching. */
    public void onRideUpdate(Ride r) {
        boolean nowSearching = r != null && RideStatus.fromWire(r.status).isSearching();
        if (nowSearching && !searching) {
            searching = true;
            handler.postDelayed(refresh, 5_000);
        } else if (!nowSearching && searching) {
            searching = false;
            handler.removeCallbacks(refresh);
        }
    }

    public void cancel(@NonNull String reasonCode) {
        String id = rideId.getValue();
        if (id == null) return;
        busy.setValue(true);
        repo.cancel(id, reasonCode, null).addOnCompleteListener(t -> {
            busy.setValue(false);
            actionError.setValue(t.isSuccessful() ? null : AppException.from(t.getException()));
        });
    }

    public void rate(int stars, String comment) {
        String id = rideId.getValue();
        if (id == null) return;
        busy.setValue(true);
        repo.rate(id, stars, comment).addOnCompleteListener(t -> {
            busy.setValue(false);
            if (t.isSuccessful()) rated.setValue(true);
            else actionError.setValue(AppException.from(t.getException()));
        });
    }

    @Override
    protected void onCleared() {
        searching = false;
        handler.removeCallbacks(refresh);
    }
}
