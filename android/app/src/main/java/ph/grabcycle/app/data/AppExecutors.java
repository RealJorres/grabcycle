package ph.grabcycle.app.data;

import androidx.annotation.NonNull;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.TaskCompletionSource;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Background executor for CPU/IO work such as image re-encoding. */
public final class AppExecutors {
    private AppExecutors() {}

    private static final ExecutorService IO = Executors.newFixedThreadPool(2);

    public static ExecutorService io() {
        return IO;
    }

    /**
     * Runs {@code work} on the IO pool and exposes it as a Play-services Task
     * (replaces the deprecated {@code Tasks.call(Executor, Callable)}).
     */
    @NonNull
    public static <T> Task<T> runIo(@NonNull Callable<T> work) {
        TaskCompletionSource<T> source = new TaskCompletionSource<>();
        IO.execute(() -> {
            try {
                source.setResult(work.call());
            } catch (Exception e) {
                source.setException(e);
            }
        });
        return source.getTask();
    }
}
