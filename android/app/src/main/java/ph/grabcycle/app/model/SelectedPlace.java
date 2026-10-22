package ph.grabcycle.app.model;

import android.os.Parcel;
import android.os.Parcelable;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.HashMap;
import java.util.Map;

/** A pickup or destination chosen by the passenger (passed between screens). */
public final class SelectedPlace implements Parcelable {
    public final double lat;
    public final double lng;
    @NonNull public final String address;
    @Nullable public final String placeId;
    /** Horizontal accuracy when the place came from the device GPS, else null. */
    @Nullable public final Float accuracyM;

    public SelectedPlace(double lat, double lng, @NonNull String address, @Nullable String placeId, @Nullable Float accuracyM) {
        this.lat = lat;
        this.lng = lng;
        this.address = address;
        this.placeId = placeId;
        this.accuracyM = accuracyM;
    }

    /** Payload shape expected by the backend placeSchema. */
    @NonNull
    public Map<String, Object> toPayload() {
        Map<String, Object> m = new HashMap<>();
        m.put("lat", lat);
        m.put("lng", lng);
        m.put("address", address.length() > 300 ? address.substring(0, 300) : address);
        m.put("placeId", placeId);
        return m;
    }

    private SelectedPlace(Parcel in) {
        lat = in.readDouble();
        lng = in.readDouble();
        String a = in.readString();
        address = a != null ? a : "";
        placeId = in.readString();
        accuracyM = in.readInt() == 1 ? in.readFloat() : null;
    }

    @Override
    public void writeToParcel(@NonNull Parcel dest, int flags) {
        dest.writeDouble(lat);
        dest.writeDouble(lng);
        dest.writeString(address);
        dest.writeString(placeId);
        dest.writeInt(accuracyM != null ? 1 : 0);
        if (accuracyM != null) dest.writeFloat(accuracyM);
    }

    @Override
    public int describeContents() {
        return 0;
    }

    public static final Creator<SelectedPlace> CREATOR = new Creator<SelectedPlace>() {
        @Override
        public SelectedPlace createFromParcel(Parcel in) {
            return new SelectedPlace(in);
        }

        @Override
        public SelectedPlace[] newArray(int size) {
            return new SelectedPlace[size];
        }
    };
}
