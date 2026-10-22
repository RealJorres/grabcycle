/**
 * Out-of-band provisioning of the FIRST GrabCycle superadmin.
 *
 * Administrators can never be created through the apps. This script runs on
 * a trusted operator workstation with Google Application Default Credentials
 * for the target project (e.g. `gcloud auth application-default login`
 * by a project Owner). It:
 *   1. creates (or finds) an email/password Auth user,
 *   2. sets the `staffRole` custom claim,
 *   3. records the assignment in `staff/{uid}` and the audit log.
 *
 * Usage:
 *   cd backend/functions && npm run provision:admin -- --project <projectId> --email ops@example.ph --role superadmin
 *
 * The temporary password is printed once; the admin must change it at first
 * sign-in (use "Forgot password" in the dashboard). Never commit credentials.
 * Additional staff should be managed from the dashboard by a superadmin.
 */
import { randomBytes } from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const ROLES = ['superadmin', 'admin', 'reviewer', 'support'] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const projectId = arg('project');
  const email = arg('email');
  const role = (arg('role') ?? 'superadmin') as (typeof ROLES)[number];
  if (!projectId || !email || !ROLES.includes(role)) {
    console.error('Usage: provision-admin.ts --project <id> --email <email> [--role superadmin|admin|reviewer|support]');
    process.exit(2);
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) console.warn('NOTE: running against the Firestore emulator.');

  initializeApp({ credential: applicationDefault(), projectId });
  const auth = getAuth();
  const db = getFirestore();

  const existingRider = await auth
    .getUserByEmail(email)
    .then(async (u) => ((await db.collection('users').doc(u.uid).get()).exists ? u : null))
    .catch(() => null);
  if (existingRider) {
    console.error('Refusing: this identity is a passenger/driver account. Staff accounts must be separate.');
    process.exit(1);
  }

  let user = await auth.getUserByEmail(email).catch(() => null);
  let tempPassword: string | null = null;
  if (!user) {
    tempPassword = randomBytes(18).toString('base64url');
    user = await auth.createUser({ email, password: tempPassword, emailVerified: false, disabled: false });
  }
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), staffRole: role });
  await auth.revokeRefreshTokens(user.uid);
  await db.collection('staff').doc(user.uid).set(
    { uid: user.uid, email, role, active: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'provision-admin-script' },
    { merge: true },
  );
  await db.collection('auditLogs').add({
    category: 'SECURITY',
    action: 'STAFF_ROLE_PROVISIONED',
    actorUid: 'provision-admin-script',
    actorRole: 'OPERATOR',
    targetType: 'staff',
    targetId: user.uid,
    targetUid: user.uid,
    reasonCode: null,
    details: { role },
    at: FieldValue.serverTimestamp(),
  });

  console.log(`Provisioned ${email} as ${role} (uid ${user.uid}).`);
  if (tempPassword) {
    console.log(`Temporary password (shown once, change immediately): ${tempPassword}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
