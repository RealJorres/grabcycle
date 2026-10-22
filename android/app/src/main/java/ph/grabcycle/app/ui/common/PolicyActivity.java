package ph.grabcycle.app.ui.common;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

import ph.grabcycle.app.R;
import ph.grabcycle.app.databinding.ActivityPolicyBinding;

/** Displays the versioned Terms of Service or Privacy Notice bundled with the app. */
public class PolicyActivity extends AppCompatActivity {

    private static final String EXTRA_KIND = "kind";
    public static final String KIND_TERMS = "terms";
    public static final String KIND_PRIVACY = "privacy";

    public static Intent intent(@NonNull Context c, @NonNull String kind) {
        return new Intent(c, PolicyActivity.class).putExtra(EXTRA_KIND, kind);
    }

    public static void start(@NonNull Context c, @NonNull String kind) {
        c.startActivity(intent(c, kind));
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ActivityPolicyBinding b = ActivityPolicyBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        Insets.pad(b.root, true, true);
        boolean privacy = KIND_PRIVACY.equals(getIntent().getStringExtra(EXTRA_KIND));
        b.toolbar.setTitle(privacy ? R.string.policy_privacy_title : R.string.policy_terms_title);
        b.toolbar.setNavigationOnClickListener(v -> finish());
        b.body.setText(readRaw(privacy ? R.raw.privacy_notice : R.raw.terms_of_service));
    }

    private String readRaw(int res) {
        try (InputStream in = getResources().openRawResource(res);
             BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
            return sb.toString();
        } catch (IOException e) {
            return getString(R.string.err_generic);
        }
    }
}
