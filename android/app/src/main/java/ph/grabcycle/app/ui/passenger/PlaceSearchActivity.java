package ph.grabcycle.app.ui.passenger;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.IntentCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import ph.grabcycle.app.R;
import ph.grabcycle.app.data.AppException;
import ph.grabcycle.app.data.PlacesRepository;
import ph.grabcycle.app.databinding.ActivityPlaceSearchBinding;
import ph.grabcycle.app.databinding.ItemPlaceResultBinding;
import ph.grabcycle.app.model.PlaceResult;
import ph.grabcycle.app.model.SelectedPlace;
import ph.grabcycle.app.ui.common.BaseActivity;
import ph.grabcycle.app.ui.common.ErrorMessages;
import ph.grabcycle.app.ui.common.Insets;
import ph.grabcycle.core.model.ErrorReason;
import ph.grabcycle.core.util.GeoMath;

/** Search local landmarks and places for a pickup or destination. */
public class PlaceSearchActivity extends BaseActivity {

    public static final String EXTRA_FOR_PICKUP = "forPickup";
    private static final String EXTRA_NEAR = "near";
    public static final String RESULT_PLACE = "place";
    public static final String RESULT_CHOOSE_ON_MAP = "chooseOnMap";

    public static Intent intent(@NonNull Context c, boolean forPickup, @Nullable SelectedPlace near) {
        return new Intent(c, PlaceSearchActivity.class).putExtra(EXTRA_FOR_PICKUP, forPickup).putExtra(EXTRA_NEAR, near);
    }

    private ActivityPlaceSearchBinding b;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<PlaceResult> results = new ArrayList<>();
    @Nullable private SelectedPlace near;
    private boolean forPickup;
    private int generation;
    private final Runnable search = this::runSearch;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        b = ActivityPlaceSearchBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);
        forPickup = getIntent().getBooleanExtra(EXTRA_FOR_PICKUP, false);
        near = IntentCompat.getParcelableExtra(getIntent(), EXTRA_NEAR, SelectedPlace.class);
        b.queryLayout.setHint(forPickup ? R.string.search_pickup_hint : R.string.search_destination_hint);
        b.back.setOnClickListener(v -> finish());
        b.chooseOnMap.setOnClickListener(v -> {
            setResult(RESULT_OK, new Intent().putExtra(RESULT_CHOOSE_ON_MAP, true).putExtra(EXTRA_FOR_PICKUP, forPickup));
            finish();
        });

        b.results.setLayoutManager(new LinearLayoutManager(this));
        b.results.setAdapter(new Adapter());
        b.query.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override
            public void afterTextChanged(Editable s) {
                handler.removeCallbacks(search);
                handler.postDelayed(search, 450);
            }
        });
        b.query.requestFocus();
        b.state.showEmpty(R.drawable.ic_search, getString(R.string.search_empty_title), getString(R.string.search_empty_message));
    }

    private void runSearch() {
        String q = b.query.getText() != null ? b.query.getText().toString().trim() : "";
        final int gen = ++generation;
        if (q.length() < 2) {
            results.clear();
            notifyResults();
            b.state.showEmpty(R.drawable.ic_search, getString(R.string.search_empty_title), getString(R.string.search_empty_message));
            return;
        }
        b.progress.setVisibility(View.VISIBLE);
        PlacesRepository.get().search(q, near != null ? near.lat : null, near != null ? near.lng : null).addOnCompleteListener(t -> {
            if (gen != generation) return; // stale response for an older query
            b.progress.setVisibility(View.INVISIBLE);
            results.clear();
            if (!t.isSuccessful()) {
                notifyResults();
                AppException e = AppException.from(t.getException());
                if (e.getReason() == ErrorReason.NETWORK) b.state.showOffline(this::runSearch);
                else b.state.showError(getString(R.string.search_error_title), ErrorMessages.of(this, e), this::runSearch);
                return;
            }
            results.addAll(t.getResult().results);
            b.providerNote.setVisibility(t.getResult().providerAvailable ? View.GONE : View.VISIBLE);
            notifyResults();
            if (results.isEmpty()) {
                b.state.showEmpty(R.drawable.ic_location_off, getString(R.string.search_no_results), getString(R.string.search_no_results_message));
            } else {
                b.state.hide();
            }
        });
    }

    @SuppressWarnings("NotifyDataSetChanged")
    private void notifyResults() {
        RecyclerView.Adapter<?> a = b.results.getAdapter();
        if (a != null) a.notifyDataSetChanged();
    }

    private void pick(PlaceResult p) {
        if (!p.inServiceArea) return;
        String label = p.address != null && !p.address.isEmpty() && !p.address.equals(p.name) ? p.name + ", " + p.address : p.name;
        SelectedPlace place = new SelectedPlace(p.lat, p.lng, label, p.placeId, null);
        setResult(RESULT_OK, new Intent().putExtra(RESULT_PLACE, place).putExtra(EXTRA_FOR_PICKUP, forPickup));
        finish();
    }

    private final class Adapter extends RecyclerView.Adapter<Holder> {
        @NonNull
        @Override
        public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            return new Holder(ItemPlaceResultBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull Holder h, int position) {
            PlaceResult p = results.get(position);
            h.b.name.setText(p.name);
            h.b.address.setText(p.address);
            h.b.icon.setImageResource("LANDMARK".equals(p.source) ? R.drawable.ic_star : R.drawable.ic_place);
            h.b.distance.setText(p.distanceMeters != null ? GeoMath.formatDistance(p.distanceMeters) : "");
            h.b.outside.setVisibility(p.inServiceArea ? View.GONE : View.VISIBLE);
            h.itemView.setAlpha(p.inServiceArea ? 1f : 0.55f);
            h.itemView.setEnabled(p.inServiceArea);
            h.itemView.setOnClickListener(v -> pick(p));
        }

        @Override
        public int getItemCount() {
            return results.size();
        }
    }

    private static final class Holder extends RecyclerView.ViewHolder {
        final ItemPlaceResultBinding b;

        Holder(ItemPlaceResultBinding b) {
            super(b.getRoot());
            this.b = b;
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(search);
        super.onDestroy();
    }
}
