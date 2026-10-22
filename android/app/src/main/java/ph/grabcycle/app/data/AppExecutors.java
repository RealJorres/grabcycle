package ph.grabcycle.app.data;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Background executor for CPU/IO work such as image re-encoding. */
public final class AppExecutors {
    private AppExecutors() {}

    private static final ExecutorService IO = Executors.newFixedThreadPool(2);

    public static ExecutorService io() {
        return IO;
    }
}
