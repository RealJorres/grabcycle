package ph.grabcycle.core.model;

/** Lenient parsing of server enum strings so unknown future values never crash the app. */
public final class Enums {
    private Enums() {}

    public static <E extends Enum<E>> E parse(Class<E> type, String value, E fallback) {
        if (value == null || value.isEmpty()) return fallback;
        try {
            return Enum.valueOf(type, value);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }
}
