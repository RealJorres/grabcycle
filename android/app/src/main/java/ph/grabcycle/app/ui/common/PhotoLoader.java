package ph.grabcycle.app.ui.common;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.LruCache;
import android.widget.ImageView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.UploadRepository;

/** Loads approved driver profile photos (public area only) with a small memory cache. */
public final class PhotoLoader {
    private PhotoLoader() {}

    private static final LruCache<String, Bitmap> CACHE = new LruCache<>(24);

    public static void load(@NonNull ImageView view, @Nullable String publicPath) {
        view.setTag(R.id.photo_path_tag, publicPath);
        view.setImageResource(R.drawable.ic_person);
        if (publicPath == null) return;
        Bitmap cached = CACHE.get(publicPath);
        if (cached != null) {
            view.setImageBitmap(cached);
            return;
        }
        UploadRepository.get().publicPhotoBytes(publicPath).addOnSuccessListener(bytes -> {
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp == null) return;
            CACHE.put(publicPath, bmp);
            // Ignore late results for a recycled view.
            if (publicPath.equals(view.getTag(R.id.photo_path_tag))) view.setImageBitmap(bmp);
        });
    }
}
