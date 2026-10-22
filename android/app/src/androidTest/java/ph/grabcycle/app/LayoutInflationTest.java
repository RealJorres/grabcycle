package ph.grabcycle.app;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;
import android.content.res.XmlResourceParser;
import android.view.ContextThemeWrapper;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.FrameLayout;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.xmlpull.v1.XmlPullParser;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Inflates every layout with the app theme on a real Android runtime. This
 * catches problems compile-time checks cannot: unknown or API-incompatible
 * attributes, missing theme attributes required by Material widgets, broken
 * custom views and bad drawable references.
 */
@RunWith(AndroidJUnit4.class)
public class LayoutInflationTest {

    /**
     * These host a SupportMapFragment through FragmentContainerView, which needs
     * a FragmentActivity and Google Play services; they are covered when their
     * activities run against a configured project.
     */
    private static final Set<String> NEEDS_FRAGMENT_HOST = new HashSet<>(Arrays.asList(
            "activity_passenger_home", "activity_passenger_ride", "activity_driver_home"));

    @Test
    public void everyLayoutInflatesWithTheAppTheme() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Context themed = new ContextThemeWrapper(app, R.style.Theme_GrabCycle);
        List<String> failures = new ArrayList<>();
        int inflated = 0;
        for (Field f : R.layout.class.getFields()) {
            String name = f.getName();
            if (NEEDS_FRAGMENT_HOST.contains(name)) continue;
            int id = f.getInt(null);
            final Throwable[] error = new Throwable[1];
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                try {
                    LayoutInflater inflater = LayoutInflater.from(themed);
                    FrameLayout parent = new FrameLayout(themed);
                    View v = isMerge(themed, id) ? inflater.inflate(id, parent, true) : inflater.inflate(id, parent, false);
                    assertNotNull(v);
                } catch (Throwable t) {
                    error[0] = t;
                }
            });
            if (error[0] != null) {
                failures.add(name + ": " + rootCause(error[0]));
            } else {
                inflated++;
            }
        }
        if (!failures.isEmpty()) fail("Layouts failed to inflate:\n" + String.join("\n", failures));
        assertTrue("Expected app layouts to be inflated", inflated > 20);
    }

    private static boolean isMerge(Context c, int layoutId) throws Exception {
        try (XmlResourceParser p = c.getResources().getLayout(layoutId)) {
            int event;
            while ((event = p.next()) != XmlPullParser.START_TAG && event != XmlPullParser.END_DOCUMENT) {
                // Skip to the root element.
            }
            return event == XmlPullParser.START_TAG && "merge".equals(p.getName());
        }
    }

    private static String rootCause(Throwable t) {
        Throwable c = t;
        while (c.getCause() != null && c.getCause() != c) c = c.getCause();
        return c.getClass().getSimpleName() + ": " + c.getMessage();
    }
}
