package ph.grabcycle.app.ui.common;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.util.AttributeSet;
import android.view.LayoutInflater;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.material.card.MaterialCardView;

import java.io.InputStream;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AppExecutors;
import ph.grabcycle.app.data.UploadRepository;
import ph.grabcycle.app.databinding.ViewDocumentSlotBinding;

/**
 * One photo slot (e.g. "Front of ID"): capture or pick, preview, upload with
 * progress, retake, cancel. The upload only stages the file privately; it
 * verifies nothing.
 */
public class DocumentSlotView extends MaterialCardView {

    private static final String STATE_KEY = "documentSlots";

    public interface Listener {
        void onCaptureRequested(@NonNull DocumentSlotView slot, boolean camera);

        void onStateChanged(@NonNull DocumentSlotView slot);
    }

    public enum State { EMPTY, UPLOADING, UPLOADED, FAILED }

    private final ViewDocumentSlotBinding b;
    private State state = State.EMPTY;
    @Nullable private Listener listener;
    @Nullable private UploadRepository.Upload upload;
    @Nullable private String uploadId;
    @Nullable private Uri lastUri;
    @Nullable private String uid;
    private String key = "";

    public DocumentSlotView(@NonNull Context context) {
        this(context, null);
    }

    public DocumentSlotView(@NonNull Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);
        b = ViewDocumentSlotBinding.inflate(LayoutInflater.from(context), this);
        b.takePhoto.setOnClickListener(v -> { if (listener != null) listener.onCaptureRequested(this, true); });
        b.choosePhoto.setOnClickListener(v -> { if (listener != null) listener.onCaptureRequested(this, false); });
        b.retake.setOnClickListener(v -> reset());
        b.retry.setOnClickListener(v -> { if (lastUri != null && uid != null) startUpload(uid, lastUri); });
        render();
    }

    public void bind(@NonNull String key, @NonNull CharSequence title, @Nullable CharSequence hint, @NonNull Listener listener) {
        this.key = key;
        this.listener = listener;
        b.title.setText(title);
        b.hint.setText(hint);
        b.hint.setVisibility(hint != null ? VISIBLE : GONE);
    }

    @NonNull
    public String getKey() {
        return key;
    }

    @NonNull
    public State getState() {
        return state;
    }

    @Nullable
    public String getUploadId() {
        return state == State.UPLOADED ? uploadId : null;
    }

    public void startUpload(@NonNull String uid, @NonNull Uri uri) {
        cancelUpload();
        this.uid = uid;
        this.lastUri = uri;
        showPreview(uri);
        state = State.UPLOADING;
        b.progress.setProgressCompat(0, false);
        render();
        UploadRepository.Upload u = UploadRepository.get().upload(getContext(), uid, uri, percent ->
                post(() -> b.progress.setProgressCompat(percent, true)));
        upload = u;
        u.task.addOnCompleteListener(t -> {
            if (upload != u) return; // superseded by a retake
            if (t.isSuccessful()) {
                uploadId = t.getResult();
                state = State.UPLOADED;
            } else if (!t.isCanceled()) {
                state = State.FAILED;
                b.error.setText(ErrorMessages.of(getContext(), t.getException()));
            }
            render();
        });
    }

    /** Restores a completed upload after the screen was recreated (rotation or process death). */
    public void restoreUploaded(@NonNull String uid, @Nullable Uri uri, @NonNull String uploadId) {
        cancelUpload();
        this.uid = uid;
        this.lastUri = uri;
        this.uploadId = uploadId;
        state = State.UPLOADED;
        if (uri != null) showPreview(uri);
        render();
    }

    /** Saves completed uploads so they survive recreation; in-flight uploads must be redone. */
    public static void saveAll(@NonNull Bundle out, @NonNull Iterable<DocumentSlotView> slots) {
        Bundle all = new Bundle();
        for (DocumentSlotView s : slots) {
            String id = s.getUploadId();
            if (id == null) continue;
            Bundle one = new Bundle();
            one.putString("uploadId", id);
            one.putString("uri", s.lastUri != null ? s.lastUri.toString() : null);
            all.putBundle(s.key, one);
        }
        out.putBundle(STATE_KEY, all);
    }

    public static void restoreAll(@Nullable Bundle in, @NonNull String uid, @NonNull Iterable<DocumentSlotView> slots) {
        Bundle all = in != null ? in.getBundle(STATE_KEY) : null;
        if (all == null) return;
        for (DocumentSlotView s : slots) {
            Bundle one = all.getBundle(s.key);
            String id = one != null ? one.getString("uploadId") : null;
            if (id == null) continue;
            String uri = one.getString("uri");
            s.restoreUploaded(uid, uri != null ? Uri.parse(uri) : null, id);
        }
    }

    /** Discards the current photo (and its staged upload). */
    public void reset() {
        cancelUpload();
        if (uploadId != null && uid != null) UploadRepository.get().discard(uid, uploadId);
        uploadId = null;
        lastUri = null;
        state = State.EMPTY;
        b.preview.setImageDrawable(null);
        render();
    }

    public void cancelUpload() {
        if (upload != null) {
            upload.cancel();
            upload = null;
        }
    }

    private void showPreview(@NonNull Uri uri) {
        Context app = getContext().getApplicationContext();
        AppExecutors.runIo(() -> decodeThumbnail(app, uri, 720))
                .addOnSuccessListener(bmp -> { if (bmp != null && uri.equals(lastUri)) b.preview.setImageBitmap(bmp); });
    }

    @Nullable
    private static Bitmap decodeThumbnail(Context c, Uri uri, int maxPx) throws java.io.IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = c.getContentResolver().openInputStream(uri)) {
            BitmapFactory.decodeStream(in, null, bounds);
        }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        int sample = 1;
        while (bounds.outWidth / (sample * 2) >= maxPx && bounds.outHeight / (sample * 2) >= maxPx) sample *= 2;
        opts.inSampleSize = sample;
        try (InputStream in = c.getContentResolver().openInputStream(uri)) {
            return BitmapFactory.decodeStream(in, null, opts);
        }
    }

    private void render() {
        boolean empty = state == State.EMPTY;
        b.placeholder.setVisibility(empty ? VISIBLE : GONE);
        b.preview.setVisibility(empty ? GONE : VISIBLE);
        b.captureActions.setVisibility(empty ? VISIBLE : GONE);
        b.progress.setVisibility(state == State.UPLOADING ? VISIBLE : GONE);
        b.retake.setVisibility(state == State.UPLOADED || state == State.FAILED ? VISIBLE : GONE);
        b.retry.setVisibility(state == State.FAILED ? VISIBLE : GONE);
        b.error.setVisibility(state == State.FAILED ? VISIBLE : GONE);
        b.status.setVisibility(state == State.UPLOADED || state == State.UPLOADING ? VISIBLE : GONE);
        b.status.setText(state == State.UPLOADED ? R.string.slot_uploaded : R.string.slot_uploading);
        setStrokeColor(getResources().getColor(state == State.FAILED ? R.color.gc_error : R.color.gc_outline, getContext().getTheme()));
        if (listener != null) listener.onStateChanged(this);
    }

    @Override
    protected void onDetachedFromWindow() {
        cancelUpload();
        super.onDetachedFromWindow();
    }
}
