package ph.grabcycle.app.data;

import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.exifinterface.media.ExifInterface;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Prepares a document photo for upload: corrects orientation, downsizes and
 * re-encodes to JPEG. Re-encoding from pixels drops ALL metadata (EXIF GPS,
 * device serials, timestamps) before anything leaves the phone.
 */
public final class ImageProcessor {
    private ImageProcessor() {}

    public static final int MAX_DIMENSION = 1800;
    public static final int MAX_BYTES = 5_500_000;

    @NonNull
    public static byte[] prepareJpeg(@NonNull ContentResolver resolver, @NonNull Uri uri) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) throw new IOException("Cannot open image");
            BitmapFactory.decodeStream(in, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("Not an image");

        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, MAX_DIMENSION);
        Bitmap decoded;
        try (InputStream in = resolver.openInputStream(uri)) {
            decoded = BitmapFactory.decodeStream(in, null, opts);
        }
        if (decoded == null) throw new IOException("Cannot decode image");

        int rotation = 0;
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in != null) rotation = new ExifInterface(in).getRotationDegrees();
        } catch (IOException ignored) {
            // No EXIF: keep orientation as decoded.
        }

        float scale = Math.min(1f, MAX_DIMENSION / (float) Math.max(decoded.getWidth(), decoded.getHeight()));
        Matrix m = new Matrix();
        if (scale < 1f) m.postScale(scale, scale);
        if (rotation != 0) m.postRotate(rotation);
        Bitmap output = m.isIdentity() ? decoded : Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), m, true);
        if (output != decoded) decoded.recycle();

        try {
            for (int quality = 88; quality >= 50; quality -= 8) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                output.compress(Bitmap.CompressFormat.JPEG, quality, bos);
                if (bos.size() <= MAX_BYTES) return bos.toByteArray();
            }
            throw new IOException("Image too large");
        } finally {
            output.recycle();
        }
    }

    static int sampleSize(int width, int height, int target) {
        int sample = 1;
        while (width / (sample * 2) >= target && height / (sample * 2) >= target) sample *= 2;
        return sample;
    }
}
