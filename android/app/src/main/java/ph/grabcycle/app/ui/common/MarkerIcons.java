package ph.grabcycle.app.ui.common;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;

import androidx.annotation.DrawableRes;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.google.android.gms.maps.model.BitmapDescriptor;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;

/** Converts vector drawables into map marker icons. Call after the map is ready. */
public final class MarkerIcons {
    private MarkerIcons() {}

    @NonNull
    public static BitmapDescriptor fromVector(@NonNull Context context, @DrawableRes int res) {
        Drawable d = ContextCompat.getDrawable(context, res);
        if (d == null) return BitmapDescriptorFactory.defaultMarker();
        Bitmap bmp = Bitmap.createBitmap(d.getIntrinsicWidth(), d.getIntrinsicHeight(), Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        d.setBounds(0, 0, c.getWidth(), c.getHeight());
        d.draw(c);
        return BitmapDescriptorFactory.fromBitmap(bmp);
    }
}
