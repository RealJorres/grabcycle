package ph.grabcycle.app.ui.passenger;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.DiffUtil;
import androidx.recyclerview.widget.ListAdapter;
import androidx.recyclerview.widget.RecyclerView;

import java.util.Locale;

import ph.grabcycle.app.R;
import ph.grabcycle.app.databinding.ItemNearbyDriverBinding;
import ph.grabcycle.app.model.NearbyDriver;
import ph.grabcycle.app.ui.common.PhotoLoader;
import ph.grabcycle.core.util.GeoMath;

/** List of eligible nearby drivers (straight-line distance, coarse positions). */
class NearbyDriverAdapter extends ListAdapter<NearbyDriver, NearbyDriverAdapter.Holder> {

    interface OnPick {
        void onPick(@NonNull NearbyDriver driver);
    }

    private final OnPick onPick;

    NearbyDriverAdapter(@NonNull OnPick onPick) {
        super(new DiffUtil.ItemCallback<NearbyDriver>() {
            @Override
            public boolean areItemsTheSame(@NonNull NearbyDriver a, @NonNull NearbyDriver b) {
                return a.driverId.equals(b.driverId);
            }

            @Override
            public boolean areContentsTheSame(@NonNull NearbyDriver a, @NonNull NearbyDriver b) {
                return a.distanceMeters == b.distanceMeters && String.valueOf(a.displayName).equals(String.valueOf(b.displayName))
                        && String.valueOf(a.photoPath).equals(String.valueOf(b.photoPath));
            }
        });
        this.onPick = onPick;
    }

    @NonNull
    @Override
    public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        return new Holder(ItemNearbyDriverBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false));
    }

    @Override
    public void onBindViewHolder(@NonNull Holder h, int position) {
        NearbyDriver d = getItem(position);
        h.b.name.setText(d.displayName);
        h.b.vehicle.setText(d.vehicleSummary);
        h.b.distance.setText(GeoMath.formatDistance(d.distanceMeters));
        h.b.distance.setContentDescription(h.itemView.getContext().getString(R.string.ph_distance_desc, GeoMath.formatDistance(d.distanceMeters)));
        if (d.ratingAverage != null && d.ratingCount != null) {
            h.b.rating.setVisibility(View.VISIBLE);
            h.b.rating.setText(String.format(Locale.US, "★ %.1f (%d)", d.ratingAverage, d.ratingCount));
        } else {
            h.b.rating.setVisibility(View.VISIBLE);
            h.b.rating.setText(R.string.ph_new_driver);
        }
        PhotoLoader.load(h.b.photo, d.photoPath);
        h.itemView.setOnClickListener(v -> onPick.onPick(d));
    }

    static final class Holder extends RecyclerView.ViewHolder {
        final ItemNearbyDriverBinding b;

        Holder(ItemNearbyDriverBinding b) {
            super(b.getRoot());
            this.b = b;
        }
    }
}
