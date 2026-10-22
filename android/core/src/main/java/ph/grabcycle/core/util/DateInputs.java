package ph.grabcycle.core.util;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** Document expiry dates (YYYY-MM-DD, valid through the end of that day in Asia/Manila). */
public final class DateInputs {
    private DateInputs() {}

    public static final ZoneId SERVICE_ZONE = ZoneId.of("Asia/Manila");
    private static final DateTimeFormatter DISPLAY = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);

    public static LocalDate parse(String value) {
        if (value == null || !value.matches("\\d{4}-\\d{2}-\\d{2}")) return null;
        try {
            return LocalDate.parse(value);
        } catch (DateTimeException e) {
            return null;
        }
    }

    public static boolean isNotExpired(String value, LocalDate today) {
        LocalDate d = parse(value);
        return d != null && !d.isBefore(today);
    }

    public static LocalDate todayInService() {
        return LocalDate.now(SERVICE_ZONE);
    }

    public static String toWire(int year, int month1to12, int day) {
        return String.format(Locale.US, "%04d-%02d-%02d", year, month1to12, day);
    }

    public static String forDisplay(String value) {
        LocalDate d = parse(value);
        return d == null ? "—" : DISPLAY.format(d);
    }
}
