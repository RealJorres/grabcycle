package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.lifecycle.LiveData;

import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FirebaseFirestoreException;
import com.google.firebase.firestore.ListenerRegistration;
import com.google.firebase.firestore.MetadataChanges;
import com.google.firebase.firestore.Query;

import java.util.ArrayList;
import java.util.List;

import ph.grabcycle.core.model.ErrorReason;

/** Listens to a Firestore query only while observed. */
public class FirestoreQueryLiveData<T> extends LiveData<DocState<List<T>>> {
    private final Query query;
    private final Class<T> type;
    private ListenerRegistration registration;

    public FirestoreQueryLiveData(@NonNull Query query, @NonNull Class<T> type) {
        this.query = query;
        this.type = type;
        setValue(DocState.loading());
    }

    @Override
    protected void onActive() {
        registration = query.addSnapshotListener(MetadataChanges.INCLUDE, (snap, error) -> {
            if (error != null) {
                DocState<List<T>> last = getValue();
                ErrorReason reason = error.getCode() == FirebaseFirestoreException.Code.PERMISSION_DENIED
                        ? ErrorReason.PERMISSION_DENIED : ErrorReason.NETWORK;
                setValue(DocState.failed(new AppException(reason, error.getMessage(), null, error), last != null ? last.data : null));
                return;
            }
            if (snap == null) return;
            List<T> items = new ArrayList<>();
            for (DocumentSnapshot d : snap.getDocuments()) {
                try {
                    T item = d.toObject(type);
                    if (item != null) items.add(item);
                } catch (RuntimeException ignored) {
                    // Skip malformed documents rather than crashing.
                }
            }
            setValue(DocState.of(items, true, snap.getMetadata().isFromCache()));
        });
    }

    @Override
    protected void onInactive() {
        if (registration != null) {
            registration.remove();
            registration = null;
        }
    }
}
