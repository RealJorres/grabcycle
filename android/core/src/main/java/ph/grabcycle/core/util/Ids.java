package ph.grabcycle.core.util;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;

/** Client-generated identifiers. */
public final class Ids {
    private Ids() {}

    private static final SecureRandom RANDOM = new SecureRandom();

    /**
     * Idempotency key for one user intent (e.g. a single "Book ride" tap).
     * Retries of the same intent must reuse it so the server returns the
     * same ride instead of creating a duplicate.
     */
    public static String newRequestId() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    /** Unguessable staging-upload object name (no personal data in storage paths). */
    public static String newUploadId() {
        byte[] bytes = new byte[18];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
