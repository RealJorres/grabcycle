package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;

import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

/**
 * Live position of the driver assigned to the passenger's active ride.
 * Database rules allow this read only while the server has marked this
 * passenger as the tracking party; access ends automatically when the trip
 * ends (reported as {@link State#revoked}).
 */
public class DriverLocationLiveData extends LiveData<DriverLocationLiveData.State> {

    public static final class State {
        public final boolean hasFix;
        public final double lat;
        public final double lng;
        public final float accuracy;
        @Nullable public final Float heading;
        /** Server timestamp of the fix (epoch millis). */
        public final long serverTs;
        public final boolean revoked;

        State(boolean hasFix, double lat, double lng, float accuracy, @Nullable Float heading, long serverTs, boolean revoked) {
            this.hasFix = hasFix;
            this.lat = lat;
            this.lng = lng;
            this.accuracy = accuracy;
            this.heading = heading;
            this.serverTs = serverTs;
            this.revoked = revoked;
        }

        static State none() {
            return new State(false, 0, 0, 0, null, 0, false);
        }
    }

    private final DatabaseReference ref;
    private final ValueEventListener listener = new ValueEventListener() {
        @Override
        public void onDataChange(@NonNull DataSnapshot snap) {
            Double lat = snap.child("lat").getValue(Double.class);
            Double lng = snap.child("lng").getValue(Double.class);
            Double acc = snap.child("acc").getValue(Double.class);
            Double hdg = snap.child("hdg").getValue(Double.class);
            Long ts = snap.child("ts").getValue(Long.class);
            if (lat == null || lng == null || ts == null) {
                setValue(State.none());
                return;
            }
            setValue(new State(true, lat, lng, acc != null ? acc.floatValue() : 0f, hdg != null ? hdg.floatValue() : null, ts, false));
        }

        @Override
        public void onCancelled(@NonNull DatabaseError error) {
            // Permission denied => the server ended this passenger's tracking access.
            setValue(new State(false, 0, 0, 0, null, 0, error.getCode() == DatabaseError.PERMISSION_DENIED));
        }
    };

    public DriverLocationLiveData(@NonNull String driverUid) {
        ref = FirebaseDatabase.getInstance().getReference("locations").child(driverUid);
    }

    @Override
    protected void onActive() {
        ref.addValueEventListener(listener);
    }

    @Override
    protected void onInactive() {
        ref.removeEventListener(listener);
    }
}
