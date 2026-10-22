package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/** UI state wrapper for a one-shot operation or a loaded value. */
public final class Resource<T> {
    public enum Status { IDLE, LOADING, SUCCESS, ERROR }

    @NonNull public final Status status;
    @Nullable public final T data;
    @Nullable public final AppException error;

    private Resource(@NonNull Status status, @Nullable T data, @Nullable AppException error) {
        this.status = status;
        this.data = data;
        this.error = error;
    }

    public static <T> Resource<T> idle() {
        return new Resource<>(Status.IDLE, null, null);
    }

    public static <T> Resource<T> loading(@Nullable T previous) {
        return new Resource<>(Status.LOADING, previous, null);
    }

    public static <T> Resource<T> success(@Nullable T data) {
        return new Resource<>(Status.SUCCESS, data, null);
    }

    public static <T> Resource<T> error(@NonNull AppException error, @Nullable T previous) {
        return new Resource<>(Status.ERROR, previous, error);
    }

    public boolean isLoading() {
        return status == Status.LOADING;
    }
}
