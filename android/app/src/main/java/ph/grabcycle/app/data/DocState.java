package ph.grabcycle.app.data;

import androidx.annotation.Nullable;

/**
 * Snapshot of a listened document or query. {@code fromCache} tells the UI
 * the data may be stale (offline) so it is never presented as live.
 */
public final class DocState<T> {
    @Nullable public final T data;
    public final boolean exists;
    public final boolean fromCache;
    public final boolean loading;
    @Nullable public final AppException error;

    private DocState(@Nullable T data, boolean exists, boolean fromCache, boolean loading, @Nullable AppException error) {
        this.data = data;
        this.exists = exists;
        this.fromCache = fromCache;
        this.loading = loading;
        this.error = error;
    }

    public static <T> DocState<T> loading() {
        return new DocState<>(null, false, false, true, null);
    }

    public static <T> DocState<T> of(@Nullable T data, boolean exists, boolean fromCache) {
        return new DocState<>(data, exists, fromCache, false, null);
    }

    public static <T> DocState<T> failed(AppException error, @Nullable T last) {
        return new DocState<>(last, last != null, true, false, error);
    }
}
