package ph.grabcycle.app.ui.common;

import android.content.Context;
import android.net.Uri;
import android.os.Bundle;

import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.FileProvider;

import java.io.File;
import java.util.UUID;

/**
 * Document photo capture through the system camera (no CAMERA permission
 * needed) or the system photo picker (no storage permission needed).
 * Must be constructed during {@code onCreate}.
 */
public final class ImageCapture {

    public interface Callback {
        void onImage(@NonNull String slotKey, @NonNull Uri uri, boolean fromCamera);

        void onCancelled(@NonNull String slotKey);
    }

    private static final String STATE_SLOT = "imagecapture.slot";
    private static final String STATE_URI = "imagecapture.uri";

    private final ComponentActivity activity;
    private final Callback callback;
    private final ActivityResultLauncher<Uri> takePicture;
    private final ActivityResultLauncher<PickVisualMediaRequest> pickMedia;
    @Nullable private String pendingSlot;
    @Nullable private Uri pendingUri;

    public ImageCapture(@NonNull ComponentActivity activity, @Nullable Bundle savedState, @NonNull Callback callback) {
        this.activity = activity;
        this.callback = callback;
        if (savedState != null) {
            pendingSlot = savedState.getString(STATE_SLOT);
            String u = savedState.getString(STATE_URI);
            pendingUri = u != null ? Uri.parse(u) : null;
        }
        takePicture = activity.registerForActivityResult(new ActivityResultContracts.TakePicture(), success -> {
            String slot = pendingSlot;
            Uri uri = pendingUri;
            pendingSlot = null;
            pendingUri = null;
            if (slot == null) return;
            if (Boolean.TRUE.equals(success) && uri != null) callback.onImage(slot, uri, true);
            else callback.onCancelled(slot);
        });
        pickMedia = activity.registerForActivityResult(new ActivityResultContracts.PickVisualMedia(), uri -> {
            String slot = pendingSlot;
            pendingSlot = null;
            if (slot == null) return;
            if (uri != null) callback.onImage(slot, uri, false);
            else callback.onCancelled(slot);
        });
    }

    public void saveState(@NonNull Bundle out) {
        out.putString(STATE_SLOT, pendingSlot);
        out.putString(STATE_URI, pendingUri != null ? pendingUri.toString() : null);
    }

    public void takePhoto(@NonNull String slotKey) {
        File dir = new File(activity.getCacheDir(), "captures");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File file = new File(dir, UUID.randomUUID() + ".jpg");
        pendingSlot = slotKey;
        pendingUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", file);
        takePicture.launch(pendingUri);
    }

    public void pickPhoto(@NonNull String slotKey) {
        pendingSlot = slotKey;
        pickMedia.launch(new PickVisualMediaRequest.Builder()
                .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
                .build());
    }

    /** Deletes app-private camera captures (called after submission or cancellation). */
    public static void clearCaptures(@NonNull Context context) {
        File[] files = new File(context.getCacheDir(), "captures").listFiles();
        if (files == null) return;
        for (File f : files) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }
}
