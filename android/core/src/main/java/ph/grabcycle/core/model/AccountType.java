package ph.grabcycle.core.model;

public enum AccountType {
    PASSENGER,
    DRIVER,
    UNKNOWN;

    public static AccountType fromWire(String value) {
        return Enums.parse(AccountType.class, value, UNKNOWN);
    }
}
