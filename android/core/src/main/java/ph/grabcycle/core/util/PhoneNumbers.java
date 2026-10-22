package ph.grabcycle.core.util;

/** Philippine mobile number handling for phone sign-in. */
public final class PhoneNumbers {
    private PhoneNumbers() {}

    /**
     * Normalizes common Philippine mobile formats to E.164 (+639XXXXXXXXX):
     * "0917 123 4567", "917-123-4567", "+63 917 123 4567", "639171234567".
     * Returns null if the input is not a Philippine mobile number.
     */
    public static String normalizePhilippineMobile(String input) {
        if (input == null) return null;
        String digits = input.replaceAll("[\\s\\-().]", "");
        if (digits.startsWith("+")) digits = digits.substring(1);
        if (!digits.matches("\\d+")) return null;
        String national;
        if (digits.startsWith("63") && digits.length() == 12) {
            national = digits.substring(2);
        } else if (digits.startsWith("0") && digits.length() == 11) {
            national = digits.substring(1);
        } else if (digits.length() == 10) {
            national = digits;
        } else {
            return null;
        }
        return national.startsWith("9") ? "+63" + national : null;
    }

    public static boolean isValidPhilippineMobile(String input) {
        return normalizePhilippineMobile(input) != null;
    }

    /** "+639171234567" → "+63 917 ••• 4567" for display. */
    public static String mask(String e164) {
        if (e164 == null || e164.length() < 8) return "•••";
        return e164.substring(0, 3) + " " + e164.substring(3, 6) + " ••• " + e164.substring(e164.length() - 4);
    }

    /** "+639171234567" → "+63 917 123 4567". */
    public static String formatForDisplay(String e164) {
        if (e164 == null || !e164.matches("\\+639\\d{9}")) return e164;
        return "+63 " + e164.substring(3, 6) + " " + e164.substring(6, 9) + " " + e164.substring(9);
    }
}
