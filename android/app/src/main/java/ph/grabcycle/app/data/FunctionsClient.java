package ph.grabcycle.app.data;

import androidx.annotation.NonNull;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.functions.FirebaseFunctions;
import com.google.firebase.functions.HttpsCallableResult;

import java.util.Map;
import java.util.concurrent.TimeUnit;

import ph.grabcycle.app.config.AppConfig;

/**
 * Thin wrapper over Firebase callable functions. Every privileged operation
 * (booking, assignment, availability, reviews, payments) goes through the
 * backend; the app never writes authoritative state itself.
 */
public final class FunctionsClient {

    public interface Parser<T> {
        T parse(MapReader response);
    }

    private static FunctionsClient instance;
    private final FirebaseFunctions functions;

    private FunctionsClient() {
        functions = FirebaseFunctions.getInstance(AppConfig.functionsRegion());
    }

    public static synchronized FunctionsClient get() {
        if (instance == null) instance = new FunctionsClient();
        return instance;
    }

    /** Calls {@code name} and parses the response; failures become {@link AppException}. */
    @NonNull
    public <T> Task<T> call(@NonNull String name, @NonNull Map<String, Object> payload, @NonNull Parser<T> parser) {
        return functions
                .getHttpsCallable(name)
                .withTimeout(45, TimeUnit.SECONDS)
                .call(payload)
                .continueWithTask(task -> {
                    if (!task.isSuccessful()) {
                        return Tasks.forException(AppException.from(task.getException()));
                    }
                    HttpsCallableResult result = task.getResult();
                    return Tasks.forResult(parser.parse(new MapReader(result != null ? result.getData() : null)));
                });
    }

    @NonNull
    public Task<MapReader> call(@NonNull String name, @NonNull Map<String, Object> payload) {
        return call(name, payload, r -> r);
    }
}
