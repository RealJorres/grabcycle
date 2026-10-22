package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.gms.tasks.Task;

import java.util.HashMap;
import java.util.Map;

import ph.grabcycle.app.model.PlaceResult;

/** Place search and reverse geocoding through the backend (no privileged keys in the app). */
public final class PlacesRepository {
    private static PlacesRepository instance;

    private PlacesRepository() {}

    public static synchronized PlacesRepository get() {
        if (instance == null) instance = new PlacesRepository();
        return instance;
    }

    @NonNull
    public Task<PlaceResult.SearchResult> search(@NonNull String query, @Nullable Double nearLat, @Nullable Double nearLng) {
        Map<String, Object> p = new HashMap<>();
        p.put("query", query);
        if (nearLat != null && nearLng != null) {
            Map<String, Object> near = new HashMap<>();
            near.put("lat", nearLat);
            near.put("lng", nearLng);
            p.put("near", near);
        } else {
            p.put("near", null);
        }
        return FunctionsClient.get().call("searchPlaces", p, PlaceResult::parseSearch);
    }

    /** Returns a readable address/landmark label, or null when none is available. */
    @NonNull
    public Task<MapReader> reverseGeocode(double lat, double lng) {
        Map<String, Object> p = new HashMap<>();
        p.put("lat", lat);
        p.put("lng", lng);
        return FunctionsClient.get().call("reverseGeocode", p);
    }
}
