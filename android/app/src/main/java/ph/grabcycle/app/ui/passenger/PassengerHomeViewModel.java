package ph.grabcycle.app.ui.passenger;

import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;

import ph.grabcycle.app.data.AppException;
import ph.grabcycle.app.data.RideRepository;
import ph.grabcycle.app.model.FareQuote;
import ph.grabcycle.app.model.NearbyDriver;
import ph.grabcycle.app.model.RideSummary;
import ph.grabcycle.app.model.SelectedPlace;
import ph.grabcycle.core.model.ErrorReason;
import ph.grabcycle.core.model.RideStatus;
import ph.grabcycle.core.util.Ids;

/**
 * Passenger booking flow. Holds the trip being prepared (pickup, destination,
 * quote, nearby drivers) across configuration changes and drives the backend
 * calls. Selections survive failures so the passenger never has to start
 * over after a refused booking.
 */
public class PassengerHomeViewModel extends ViewModel {

    public enum Stage { PERMISSION, WHERE_TO, PIN_PICKUP, PIN_DESTINATION, QUOTE, DRIVERS }

    public static final class BookingResult {
        @Nullable public final String rideId;
        @Nullable public final AppException error;

        BookingResult(@Nullable String rideId, @Nullable AppException error) {
            this.rideId = rideId;
            this.error = error;
        }
    }

    private final RideRepository rides = RideRepository.get();
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final MutableLiveData<Stage> stage = new MutableLiveData<>(Stage.WHERE_TO);
    private final MutableLiveData<SelectedPlace> pickup = new MutableLiveData<>();
    private final MutableLiveData<SelectedPlace> destination = new MutableLiveData<>();
    private final MutableLiveData<FareQuote> quote = new MutableLiveData<>();
    private final MutableLiveData<Integer> passengers = new MutableLiveData<>(1);
    private final MutableLiveData<NearbyDriver.Result> nearby = new MutableLiveData<>();
    private final MutableLiveData<Boolean> busy = new MutableLiveData<>(false);
    private final MutableLiveData<AppException> error = new MutableLiveData<>();
    private final MutableLiveData<AppException> nearbyError = new MutableLiveData<>();
    private final MutableLiveData<BookingResult> booking = new MutableLiveData<>();

    /** Idempotency key for the current booking intent (reused across retries). */
    @Nullable private String pendingRequestId;
    private boolean expandSearch;
    private boolean polling;
    private boolean canBook;

    private final Runnable pollNearby = new Runnable() {
        @Override
        public void run() {
            if (!polling) return;
            loadNearby(false);
        }
    };

    // ---- Exposed state -----------------------------------------------------

    public LiveData<Stage> stage() { return stage; }
    public LiveData<SelectedPlace> pickup() { return pickup; }
    public LiveData<SelectedPlace> destination() { return destination; }
    public LiveData<FareQuote> quote() { return quote; }
    public LiveData<Integer> passengers() { return passengers; }
    public LiveData<NearbyDriver.Result> nearby() { return nearby; }
    public LiveData<Boolean> busy() { return busy; }
    public LiveData<AppException> error() { return error; }
    public LiveData<AppException> nearbyError() { return nearbyError; }
    public LiveData<BookingResult> booking() { return booking; }

    public void setCanBook(boolean value) {
        canBook = value;
        if (!value) stopPolling();
    }

    public void setStage(@NonNull Stage s) {
        error.setValue(null);
        stage.setValue(s);
        if (s == Stage.DRIVERS) startPolling();
        else stopPolling();
    }

    public void setPickup(@NonNull SelectedPlace place) {
        pickup.setValue(place);
        invalidateQuote();
    }

    public void setDestination(@NonNull SelectedPlace place) {
        destination.setValue(place);
        invalidateQuote();
    }

    public void changePassengers(int delta) {
        Integer current = passengers.getValue();
        int next = Math.max(1, Math.min(4, (current != null ? current : 1) + delta));
        if (current == null || next != current) {
            passengers.setValue(next);
            requestQuote();
        }
    }

    private void invalidateQuote() {
        quote.setValue(null);
        pendingRequestId = null;
    }

    // ---- Quote -------------------------------------------------------------

    public void requestQuote() {
        SelectedPlace p = pickup.getValue();
        SelectedPlace d = destination.getValue();
        if (p == null || d == null) return;
        busy.setValue(true);
        error.setValue(null);
        Integer n = passengers.getValue();
        rides.quote(p, d, n != null ? n : 1).addOnCompleteListener(t -> {
            busy.setValue(false);
            if (t.isSuccessful()) {
                quote.setValue(t.getResult());
                pendingRequestId = null; // new price => new booking intent
                stage.setValue(Stage.QUOTE);
            } else {
                error.setValue(AppException.from(t.getException()));
            }
        });
    }

    // ---- Discovery ---------------------------------------------------------

    public void expandSearch() {
        expandSearch = true;
        loadNearby(true);
    }

    private void startPolling() {
        if (polling) return;
        polling = true;
        expandSearch = false;
        loadNearby(true);
    }

    public void stopPolling() {
        polling = false;
        handler.removeCallbacks(pollNearby);
    }

    public void loadNearby(boolean showBusy) {
        SelectedPlace p = pickup.getValue();
        if (p == null || !canBook) return;
        handler.removeCallbacks(pollNearby);
        if (showBusy) busy.setValue(true);
        rides.nearbyDrivers(p.lat, p.lng, expandSearch).addOnCompleteListener(t -> {
            if (showBusy) busy.setValue(false);
            long next = 10;
            if (t.isSuccessful() && t.getResult() != null) {
                nearbyError.setValue(null);
                nearby.setValue(t.getResult());
                next = Math.max(5, t.getResult().refreshAfterSec);
            } else {
                // Never keep showing drivers we can no longer verify as available.
                nearby.setValue(null);
                nearbyError.setValue(AppException.from(t.getException()));
                next = 15;
            }
            if (polling) handler.postDelayed(pollNearby, next * 1000);
        });
    }

    // ---- Booking -----------------------------------------------------------

    /**
     * Books with the given driver (or automatic matching when null). The same
     * request id is reused if this booking intent is retried after a
     * transport failure, so a duplicate tap or retry can never create two rides.
     */
    public void book(@Nullable String selectedDriverId, boolean allowFallback) {
        FareQuote q = quote.getValue();
        if (q == null || Boolean.TRUE.equals(busy.getValue())) return;
        if (pendingRequestId == null) pendingRequestId = Ids.newRequestId();
        final String requestId = pendingRequestId;
        busy.setValue(true);
        error.setValue(null);
        rides.createRide(requestId, q.quoteId, selectedDriverId, allowFallback, null).addOnCompleteListener(t -> {
            busy.setValue(false);
            if (t.isSuccessful() && t.getResult() != null) {
                RideSummary s = t.getResult();
                RideStatus status = RideStatus.fromWire(s.status);
                pendingRequestId = null;
                if (status == RideStatus.NO_DRIVER_FOUND || status == RideStatus.EXPIRED) {
                    // The request ended immediately (e.g. the selected driver was just taken).
                    booking.setValue(new BookingResult(null, new AppException(
                            "SELECTED_DRIVER_UNAVAILABLE".equals(s.statusReason) ? ErrorReason.DRIVER_UNAVAILABLE : ErrorReason.NO_DRIVERS_AVAILABLE,
                            s.statusReason, null, null)));
                    loadNearby(false);
                } else {
                    stopPolling();
                    booking.setValue(new BookingResult(s.rideId, null));
                }
                return;
            }
            AppException e = AppException.from(t.getException());
            if (!e.getReason().isRetryable()) pendingRequestId = null;
            if (e.getReason() == ErrorReason.QUOTE_EXPIRED || e.getReason() == ErrorReason.QUOTE_MISMATCH) {
                // Refresh the price and let the passenger confirm it again.
                requestQuote();
            } else if (e.getReason() == ErrorReason.DRIVER_UNAVAILABLE || e.getReason() == ErrorReason.NO_DRIVERS_AVAILABLE) {
                loadNearby(false);
            }
            booking.setValue(new BookingResult(null, e));
        });
    }

    public void consumeBooking() {
        booking.setValue(null);
    }

    public void clearTrip() {
        destination.setValue(null);
        invalidateQuote();
        nearby.setValue(null);
        setStage(Stage.WHERE_TO);
    }

    @Override
    protected void onCleared() {
        stopPolling();
        super.onCleared();
    }
}
