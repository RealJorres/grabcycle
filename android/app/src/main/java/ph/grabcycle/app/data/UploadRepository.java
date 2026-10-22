package ph.grabcycle.app.data;

import android.content.Context;
import android.net.Uri;

import androidx.annotation.NonNull;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.storage.FirebaseStorage;
import com.google.firebase.storage.StorageMetadata;
import com.google.firebase.storage.UploadTask;

import ph.grabcycle.core.model.ErrorReason;
import ph.grabcycle.core.util.Ids;

/**
 * Uploads document photos to the private staging area
 * (uploads/{uid}/{random id}). Uploading never verifies anything: the backend
 * validates the file and a reviewer decides.
 */
public final class UploadRepository {
    private static UploadRepository instance;
    private final FirebaseStorage storage = FirebaseStorage.getInstance();

    private UploadRepository() {}

    public static synchronized UploadRepository get() {
        if (instance == null) instance = new UploadRepository();
        return instance;
    }

    public interface ProgressListener {
        void onProgress(int percent);
    }

    /** Handle that lets the UI cancel an in-flight upload before submission. */
    public static final class Upload {
        public final String uploadId;
        public final Task<String> task;
        private UploadTask uploadTask;
        private volatile boolean cancelled;

        Upload(String uploadId, Task<String> task) {
            this.uploadId = uploadId;
            this.task = task;
        }

        public void cancel() {
            cancelled = true;
            if (uploadTask != null) uploadTask.cancel();
        }
    }

    @NonNull
    public Upload upload(@NonNull Context context, @NonNull String uid, @NonNull Uri imageUri, @NonNull ProgressListener listener) {
        final String uploadId = Ids.newUploadId();
        final Context app = context.getApplicationContext();
        final Upload[] holder = new Upload[1];
        Task<String> task = AppExecutors.runIo(() -> ImageProcessor.prepareJpeg(app.getContentResolver(), imageUri))
                .continueWithTask(prepared -> {
                    if (!prepared.isSuccessful() || prepared.getResult() == null) {
                        return Tasks.forException(new AppException(ErrorReason.UPLOAD_INVALID, "Could not read the photo", null, prepared.getException()));
                    }
                    if (holder[0] != null && holder[0].cancelled) {
                        return Tasks.forCanceled();
                    }
                    StorageMetadata metadata = new StorageMetadata.Builder().setContentType("image/jpeg").build();
                    UploadTask ut = storage.getReference().child("uploads/" + uid + "/" + uploadId).putBytes(prepared.getResult(), metadata);
                    if (holder[0] != null) holder[0].uploadTask = ut;
                    ut.addOnProgressListener(snap -> {
                        long total = snap.getTotalByteCount();
                        if (total > 0) listener.onProgress((int) (100 * snap.getBytesTransferred() / total));
                    });
                    return ut.continueWithTask(done -> {
                        if (!done.isSuccessful()) return Tasks.forException(AppException.from(done.getException()));
                        return Tasks.forResult(uploadId);
                    });
                });
        holder[0] = new Upload(uploadId, task);
        return holder[0];
    }

    /** Deletes a staged upload the user discarded (best effort; the server also cleans up). */
    public void discard(@NonNull String uid, @NonNull String uploadId) {
        storage.getReference().child("uploads/" + uid + "/" + uploadId).delete();
    }

    /**
     * Loads an approved driver profile photo (public/driverPhotos/...) as bytes
     * through the authenticated SDK, without minting long-lived download URLs.
     */
    @NonNull
    public Task<byte[]> publicPhotoBytes(@NonNull String path) {
        if (!path.startsWith("public/")) return Tasks.forException(new IllegalArgumentException("Not a public path"));
        return storage.getReference().child(path).getBytes(2L * 1024 * 1024);
    }
}
