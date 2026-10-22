package ph.grabcycle.core.ride;

/** The single primary action shown to a driver for the current trip stage. */
public enum DriverAction {
    /** Tell the passenger you are heading to the pickup (ACCEPTED → DRIVER_EN_ROUTE). */
    START_HEADING_TO_PICKUP,
    /** DRIVER_EN_ROUTE → DRIVER_ARRIVED. */
    MARK_ARRIVED,
    /** DRIVER_ARRIVED → IN_PROGRESS. */
    START_TRIP,
    /** IN_PROGRESS → COMPLETED (records cash collected). */
    COMPLETE_TRIP,
    NONE
}
