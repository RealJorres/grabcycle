package ph.grabcycle.app.data;

import androidx.annotation.NonNull;
import androidx.lifecycle.LiveData;

import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.ListenerRegistration;
import com.google.firebase.firestore.MetadataChanges;

import ph.grabcycle.core.model.ErrorReason;

/** Listens to one Firestore document only while observed (no leaked listeners). */
public class FirestoreDocLiveData<T> extends LiveData<DocState<T>> {
    private final DocumentReference ref;
    private final Class<T> type;
    private ListenerRegistration registration;

    public FirestoreDocLiveData(@NonNull DocumentReference ref, @NonNull Class<T> type) {
        this.ref = ref;
        this.type = type;
        setValue(DocState.loading());
    }

    @Override
    protected void onActive() {
        registration = ref.addSnapshotListener(MetadataChanges.INCLUDE, (snap, error) -> {
            if (error != null) {
                DocState<T> last = getValue();
                setValue(DocState.failed(
                        new AppException(error.getCode() == com.google.firebase.firestore.FirebaseFirestoreException.Code.PERMISSION_DENIED
                                ? ErrorReason.PERMISSION_DENIED : ErrorReason.NETWORK, error.getMessage(), null, error),
                        last != null ? last.data : null));
                return;
            }
            if (snap == null) return;
            setValue(DocState.of(convert(snap), snap.exists(), snap.getMetadata().isFromCache()));
        });
    }

    private T convert(DocumentSnapshot snap) {
        try {
            return snap.exists() ? snap.toObject(type) : null;
        } catch (RuntimeException e) {
            // Defensive: a schema mismatch must not crash the app.
            return null;
        }
    }

    @Override
    protected void onInactive() {
        if (registration != null) {
            registration.remove();
            registration = null;
        }
    }
}
