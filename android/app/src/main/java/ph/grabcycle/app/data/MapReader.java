package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Null-safe accessors for callable-function responses (JSON decoded to Map/List). */
public final class MapReader {
    private final Map<?, ?> map;

    public MapReader(@Nullable Object value) {
        this.map = value instanceof Map ? (Map<?, ?>) value : Collections.emptyMap();
    }

    @Nullable
    public String string(@NonNull String key) {
        Object v = map.get(key);
        return v instanceof String ? (String) v : null;
    }

    public long getLong(@NonNull String key, long fallback) {
        Object v = map.get(key);
        return v instanceof Number ? ((Number) v).longValue() : fallback;
    }

    @Nullable
    public Long optLong(@NonNull String key) {
        Object v = map.get(key);
        return v instanceof Number ? ((Number) v).longValue() : null;
    }

    public double getDouble(@NonNull String key, double fallback) {
        Object v = map.get(key);
        return v instanceof Number ? ((Number) v).doubleValue() : fallback;
    }

    @Nullable
    public Double optDouble(@NonNull String key) {
        Object v = map.get(key);
        return v instanceof Number ? ((Number) v).doubleValue() : null;
    }

    public boolean getBool(@NonNull String key, boolean fallback) {
        Object v = map.get(key);
        return v instanceof Boolean ? (Boolean) v : fallback;
    }

    @NonNull
    public MapReader child(@NonNull String key) {
        return new MapReader(map.get(key));
    }

    public boolean has(@NonNull String key) {
        return map.get(key) != null;
    }

    @NonNull
    public List<MapReader> list(@NonNull String key) {
        Object v = map.get(key);
        if (!(v instanceof List)) return Collections.emptyList();
        List<MapReader> out = new ArrayList<>();
        for (Object item : (List<?>) v) out.add(new MapReader(item));
        return out;
    }

    @NonNull
    public List<String> strings(@NonNull String key) {
        Object v = map.get(key);
        if (!(v instanceof List)) return Collections.emptyList();
        List<String> out = new ArrayList<>();
        for (Object item : (List<?>) v) if (item instanceof String) out.add((String) item);
        return out;
    }
}
