package ph.grabcycle.app.model;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.List;

import ph.grabcycle.app.data.MapReader;

/** A searchable place: curated local landmark or Google Places result. */
public final class PlaceResult {
    /** LANDMARK or GOOGLE. */
    public String source;
    public String placeId;
    public String name;
    public String address;
    public double lat;
    public double lng;
    public boolean inServiceArea;
    @Nullable public Long distanceMeters;

    /** Search response; {@code providerAvailable} is false when only curated landmarks were searched. */
    public static final class SearchResult {
        public final List<PlaceResult> results;
        public final boolean providerAvailable;

        SearchResult(List<PlaceResult> results, boolean providerAvailable) {
            this.results = results;
            this.providerAvailable = providerAvailable;
        }
    }

    @NonNull
    public static SearchResult parseSearch(@NonNull MapReader r) {
        return new SearchResult(parseList(r), r.getBool("providerAvailable", true));
    }

    @NonNull
    public static List<PlaceResult> parseList(@NonNull MapReader r) {
        List<PlaceResult> out = new ArrayList<>();
        for (MapReader p : r.list("results")) {
            PlaceResult place = new PlaceResult();
            place.source = p.string("source");
            place.placeId = p.string("placeId");
            place.name = p.string("name");
            place.address = p.string("address");
            place.lat = p.getDouble("lat", 0);
            place.lng = p.getDouble("lng", 0);
            place.inServiceArea = p.getBool("inServiceArea", false);
            place.distanceMeters = p.optLong("distanceMeters");
            out.add(place);
        }
        return out;
    }
}
