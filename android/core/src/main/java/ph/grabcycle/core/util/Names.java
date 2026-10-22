package ph.grabcycle.core.util;

import java.util.regex.Pattern;

/** Person-name validation mirroring the backend rule (letters incl. ñ/accents, spaces, . ' -). */
public final class Names {
    private Names() {}

    private static final Pattern VALID = Pattern.compile("^\\p{L}[\\p{L}\\p{M} .'-]*$");

    public static String normalize(String input) {
        if (input == null) return "";
        return input.replaceAll("\\p{Cntrl}", " ").replaceAll("\\s+", " ").trim();
    }

    public static boolean isValidPersonName(String input) {
        String n = normalize(input);
        return n.length() >= 2 && n.length() <= 100 && VALID.matcher(n).matches() && n.contains(" ");
    }
}
