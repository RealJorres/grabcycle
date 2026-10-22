package ph.grabcycle.core.util;

import java.util.Locale;

/**
 * Philippine peso amounts. The backend stores every amount as integer
 * centavos; the app never computes payable fares, it only formats them and
 * parses the cash amount a driver typed in.
 */
public final class Money {
    private Money() {}

    public static final long MAX_CENTAVOS = 10_000_000L;

    /** 4550 → "₱45.50"; negative values are shown with a leading minus. */
    public static String format(long centavos) {
        long abs = Math.abs(centavos);
        String text = String.format(Locale.US, "₱%,d.%02d", abs / 100, abs % 100);
        return centavos < 0 ? "−" + text : text;
    }

    /**
     * Parses a cash amount typed by a driver ("45", "45.5", "₱1,045.50") into
     * centavos. Returns -1 when the input is not a valid non-negative amount
     * with at most two decimals.
     */
    public static long parsePesos(String input) {
        if (input == null) return -1;
        String s = input.trim().replace("₱", "").replace(",", "").replace(" ", "");
        if (!s.matches("\\d{1,7}(\\.\\d{1,2})?")) return -1;
        String[] parts = s.split("\\.");
        long pesos = Long.parseLong(parts[0]);
        long cents = 0;
        if (parts.length == 2) {
            String frac = parts[1].length() == 1 ? parts[1] + "0" : parts[1];
            cents = Long.parseLong(frac);
        }
        long total = pesos * 100 + cents;
        return total <= MAX_CENTAVOS ? total : -1;
    }
}
