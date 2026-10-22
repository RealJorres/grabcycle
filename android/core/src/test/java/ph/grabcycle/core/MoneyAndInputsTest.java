package ph.grabcycle.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import ph.grabcycle.core.util.DateInputs;
import ph.grabcycle.core.util.Ids;
import ph.grabcycle.core.util.Money;
import ph.grabcycle.core.util.Names;
import ph.grabcycle.core.util.PhoneNumbers;

class MoneyAndInputsTest {

    @Test
    void formatsCentavos() {
        assertEquals("₱45.50", Money.format(4550));
        assertEquals("₱0.05", Money.format(5));
        assertEquals("₱1,045.00", Money.format(104500));
        assertEquals("−₱8.00", Money.format(-800));
    }

    @Test
    void parsesCashAmounts() {
        assertEquals(4500, Money.parsePesos("45"));
        assertEquals(4550, Money.parsePesos("45.5"));
        assertEquals(4505, Money.parsePesos("45.05"));
        assertEquals(104550, Money.parsePesos("₱1,045.50"));
        assertEquals(-1, Money.parsePesos("45.555"));
        assertEquals(-1, Money.parsePesos("-5"));
        assertEquals(-1, Money.parsePesos("abc"));
        assertEquals(-1, Money.parsePesos(""));
        assertEquals(-1, Money.parsePesos(null));
        assertEquals(-1, Money.parsePesos("99999999"));
    }

    @Test
    void normalizesPhilippineMobileNumbers() {
        assertEquals("+639171234567", PhoneNumbers.normalizePhilippineMobile("0917 123 4567"));
        assertEquals("+639171234567", PhoneNumbers.normalizePhilippineMobile("917-123-4567"));
        assertEquals("+639171234567", PhoneNumbers.normalizePhilippineMobile("+63 917 123 4567"));
        assertEquals("+639171234567", PhoneNumbers.normalizePhilippineMobile("639171234567"));
        assertNull(PhoneNumbers.normalizePhilippineMobile("02 8123 4567"), "landline");
        assertNull(PhoneNumbers.normalizePhilippineMobile("12345"));
        assertNull(PhoneNumbers.normalizePhilippineMobile("+1 415 555 0100"));
        assertNull(PhoneNumbers.normalizePhilippineMobile(null));
        assertEquals("+63 917 ••• 4567", PhoneNumbers.mask("+639171234567"));
        assertEquals("+63 917 123 4567", PhoneNumbers.formatForDisplay("+639171234567"));
    }

    @Test
    void validatesFullLegalNames() {
        assertTrue(Names.isValidPersonName("Juan Dela Cruz"));
        assertTrue(Names.isValidPersonName("María Peñafrancia O'Neil-Santos"));
        assertTrue(Names.isValidPersonName("  Ana   Reyes  "));
        assertFalse(Names.isValidPersonName("Juan"), "first and last name required");
        assertFalse(Names.isValidPersonName("J0hn Doe"));
        assertFalse(Names.isValidPersonName("<script> x"));
        assertEquals("Ana Reyes", Names.normalize("  Ana \t Reyes "));
    }

    @Test
    void handlesDocumentDates() {
        LocalDate today = LocalDate.of(2026, 10, 22);
        assertTrue(DateInputs.isNotExpired("2026-10-22", today), "valid through the whole day");
        assertFalse(DateInputs.isNotExpired("2026-10-21", today));
        assertFalse(DateInputs.isNotExpired("2026-02-30", today));
        assertFalse(DateInputs.isNotExpired("22/10/2026", today));
        assertEquals("2027-01-05", DateInputs.toWire(2027, 1, 5));
        assertEquals("Jan 5, 2027", DateInputs.forDisplay("2027-01-05"));
    }

    @Test
    void generatesServerCompatibleIds() {
        assertTrue(Ids.newRequestId().matches("^[A-Za-z0-9_-]{16,64}$"));
        assertTrue(Ids.newUploadId().matches("^[A-Za-z0-9_-]{20,64}$"));
        assertFalse(Ids.newUploadId().equals(Ids.newUploadId()));
    }
}
