package app.overman.sleep.health;

/** Android Metadata recording-method values (API34+). Future values stay unknown. */
public final class HealthRecordingMethod {
    private HealthRecordingMethod() {}
    public static String name(int value) {
        return switch(value) {
            case 1 -> "active";
            case 2 -> "automatic";
            case 3 -> "manual";
            default -> "unknown";
        };
    }
}
