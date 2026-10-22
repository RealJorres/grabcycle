package ph.grabcycle.app;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import static androidx.test.espresso.matcher.ViewMatchers.withSubstring;
import static androidx.test.espresso.matcher.ViewMatchers.withText;

import android.content.Context;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import ph.grabcycle.app.ui.common.AccountBlockedActivity;
import ph.grabcycle.app.ui.common.PolicyActivity;

/**
 * Screens that must work without a Firebase project (CI builds have no
 * google-services.json): the app must explain the problem, not crash.
 */
@RunWith(AndroidJUnit4.class)
public class ScreenSmokeTest {

    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    @Test
    public void unconfiguredBuildExplainsInsteadOfCrashing() {
        try (ActivityScenario<AccountBlockedActivity> ignored = ActivityScenario.launch(
                AccountBlockedActivity.intent(context, AccountBlockedActivity.Mode.CONFIG_MISSING, null))) {
            onView(withText(R.string.config_missing_title)).check(matches(isDisplayed()));
            onView(withText(R.string.config_missing_message)).check(matches(isDisplayed()));
        }
    }

    @Test
    public void suspendedAccountShowsTheServerMessage() {
        try (ActivityScenario<AccountBlockedActivity> ignored = ActivityScenario.launch(
                AccountBlockedActivity.intent(context, AccountBlockedActivity.Mode.SUSPENDED, "Reason given by GrabCycle staff."))) {
            onView(withSubstring("Reason given by GrabCycle staff.")).check(matches(isDisplayed()));
        }
    }

    @Test
    public void privacyNoticeRendersBundledText() {
        try (ActivityScenario<PolicyActivity> ignored = ActivityScenario.launch(PolicyActivity.intent(context, PolicyActivity.KIND_PRIVACY))) {
            onView(withText(R.string.policy_privacy_title)).check(matches(isDisplayed()));
            onView(withId(R.id.body)).check(matches(withSubstring("GrabCycle")));
        }
    }

    @Test
    public void termsRenderBundledText() {
        try (ActivityScenario<PolicyActivity> ignored = ActivityScenario.launch(PolicyActivity.intent(context, PolicyActivity.KIND_TERMS))) {
            onView(withText(R.string.policy_terms_title)).check(matches(isDisplayed()));
        }
    }
}
