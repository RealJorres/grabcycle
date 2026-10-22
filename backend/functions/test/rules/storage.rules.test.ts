import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createRulesEnv } from './env';

let env: RulesTestEnvironment;

const UPLOAD_ID = 'Abcdefghijklmnopqrstuv12';
const JPEG = new Uint8Array(4096).fill(7);
JPEG.set([0xff, 0xd8, 0xff, 0xe0], 0);

beforeAll(async () => {
  env = await createRulesEnv();
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearStorage();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/alice'), { status: 'ACTIVE' });
    await setDoc(doc(ctx.firestore(), 'users/sam'), { status: 'SUSPENDED' });
    await uploadBytes(ref(ctx.storage(), 'private/identity/alice/case1/front.jpg'), JPEG, { contentType: 'image/jpeg' });
    await uploadBytes(ref(ctx.storage(), 'public/driverPhotos/dan/p.jpg'), JPEG, { contentType: 'image/jpeg' });
    await uploadBytes(ref(ctx.storage(), `uploads/alice/existing${UPLOAD_ID}`), JPEG, { contentType: 'image/jpeg' });
  });
});

const storageAs = (uid: string) => env.authenticatedContext(uid).storage();

describe('staging uploads', () => {
  it('an active user can create one JPEG in their own staging folder', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs('alice'), `uploads/alice/${UPLOAD_ID}`), JPEG, { contentType: 'image/jpeg' }));
  });

  it('rejects other content types, oversize files, tiny files and bad names', async () => {
    const s = storageAs('alice');
    await assertFails(uploadBytes(ref(s, `uploads/alice/${UPLOAD_ID}`), JPEG, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(s, `uploads/alice/${UPLOAD_ID}`), JPEG, { contentType: 'application/x-msdownload' }));
    await assertFails(uploadBytes(ref(s, `uploads/alice/${UPLOAD_ID}`), new Uint8Array(7 * 1024 * 1024), { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(s, `uploads/alice/${UPLOAD_ID}`), new Uint8Array(100), { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(s, 'uploads/alice/juan-dela-cruz-id.jpg'), JPEG, { contentType: 'image/jpeg' }));
  });

  it('cannot upload into another user’s folder, overwrite, or read uploads', async () => {
    await assertFails(uploadBytes(ref(storageAs('bob'), `uploads/alice/${UPLOAD_ID}`), JPEG, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(storageAs('alice'), `uploads/alice/existing${UPLOAD_ID}`), JPEG, { contentType: 'image/jpeg' }));
    await assertFails(getBytes(ref(storageAs('alice'), `uploads/alice/existing${UPLOAD_ID}`)));
  });

  it('suspended or unregistered accounts cannot upload', async () => {
    await assertFails(uploadBytes(ref(storageAs('sam'), `uploads/sam/${UPLOAD_ID}`), JPEG, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(storageAs('ghost'), `uploads/ghost/${UPLOAD_ID}`), JPEG, { contentType: 'image/jpeg' }));
  });

  it('the owner can discard an upload', async () => {
    await assertSucceeds(deleteObject(ref(storageAs('alice'), `uploads/alice/existing${UPLOAD_ID}`)));
    await assertFails(deleteObject(ref(storageAs('bob'), `uploads/alice/existing${UPLOAD_ID}`)));
  });
});

describe('private documents', () => {
  it('no client — not even the owner or an admin claim — can read private documents', async () => {
    await assertFails(getBytes(ref(storageAs('alice'), 'private/identity/alice/case1/front.jpg')));
    const admin = env.authenticatedContext('a1', { staffRole: 'admin' }).storage();
    await assertFails(getBytes(ref(admin, 'private/identity/alice/case1/front.jpg')));
    await assertFails(uploadBytes(ref(storageAs('alice'), 'private/identity/alice/case1/x.jpg'), JPEG, { contentType: 'image/jpeg' }));
  });
});

describe('public driver photos', () => {
  it('signed-in users can view approved driver photos; nobody can write them', async () => {
    await assertSucceeds(getBytes(ref(storageAs('alice'), 'public/driverPhotos/dan/p.jpg')));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'public/driverPhotos/dan/p.jpg')));
    await assertFails(uploadBytes(ref(storageAs('dan'), 'public/driverPhotos/dan/new.jpg'), JPEG, { contentType: 'image/jpeg' }));
  });
});
