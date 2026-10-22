import type { StoredFile } from '../domain/driverAccreditation';
import { AppError } from '../domain/errors';
import type { DocumentSide } from '../domain/types';
import { bucket, db } from '../lib/firebase';
import { randomId, sha256Hex } from '../lib/ids';
import { log } from '../lib/log';
import { now, ts } from '../lib/time';

/**
 * Private document pipeline.
 *
 * Clients upload a re-encoded JPEG (EXIF stripped on device) to
 * `uploads/{uid}/{uploadId}`. On submission the server:
 *   1. verifies the object exists, its declared type and size,
 *   2. checks the JPEG signature in the actual bytes,
 *   3. stores it under a randomized `private/...` path that no client can read,
 *   4. deletes the staging object.
 * Storage paths never contain names or ID numbers.
 */

export interface UploadRef {
  side: DocumentSide;
  uploadId: string;
}

const MIN_BYTES = 1024;

function invalid(message: string, meta: Record<string, unknown> = {}): AppError {
  return new AppError('invalid-argument', 'UPLOAD_INVALID', message, meta);
}

/** JPEG files start with FF D8 FF and end with FF D9 (allowing trailing padding). */
export function looksLikeJpeg(bytes: Buffer): boolean {
  if (bytes.length < MIN_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return false;
  const tail = bytes.subarray(Math.max(0, bytes.length - 64));
  for (let i = tail.length - 2; i >= 0; i--) {
    if (tail[i] === 0xff && tail[i + 1] === 0xd9) return true;
  }
  return false;
}

export async function promoteUploads(
  uid: string,
  uploads: UploadRef[],
  destPrefix: string,
  maxBytes: number,
): Promise<StoredFile[]> {
  if (new Set(uploads.map((u) => u.uploadId)).size !== uploads.length) {
    throw invalid('The same photo was used more than once.');
  }
  if (new Set(uploads.map((u) => u.side)).size !== uploads.length) {
    throw invalid('Each side may only be provided once.');
  }

  const saved: StoredFile[] = [];
  try {
    for (const upload of uploads) {
      const source = bucket().file(`uploads/${uid}/${upload.uploadId}`);
      const [exists] = await source.exists();
      if (!exists) {
        throw new AppError('not-found', 'UPLOAD_NOT_FOUND', 'An uploaded photo could not be found. Please upload it again.', {
          side: upload.side,
        });
      }
      const [metadata] = await source.getMetadata();
      const size = Number(metadata.size ?? 0);
      if (metadata.contentType !== 'image/jpeg') throw invalid('Only JPEG photos are accepted.', { side: upload.side });
      if (size < MIN_BYTES || size > maxBytes) throw invalid('The photo file size is not allowed.', { side: upload.side });

      const [bytes] = await source.download();
      if (!looksLikeJpeg(bytes)) throw invalid('The file is not a valid JPEG photo.', { side: upload.side });

      const storagePath = `${destPrefix}/${randomId()}.jpg`;
      await bucket()
        .file(storagePath)
        .save(bytes, {
          resumable: false,
          contentType: 'image/jpeg',
          metadata: { cacheControl: 'private, no-store', metadata: { ownerUid: uid, side: upload.side } },
        });
      saved.push({ side: upload.side, storagePath, contentType: 'image/jpeg', sizeBytes: bytes.length, sha256: sha256Hex(bytes) });
    }
  } catch (err) {
    await deleteFilesQuietly(saved.map((f) => f.storagePath));
    throw err;
  }

  // Staging objects are no longer needed once copied.
  await deleteFilesQuietly(uploads.map((u) => `uploads/${uid}/${u.uploadId}`));
  return saved;
}

export async function deleteFilesQuietly(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (path) => {
      try {
        await bucket().file(path).delete({ ignoreNotFound: true });
      } catch (err) {
        log.warn('storage.delete_failed', { message: err instanceof Error ? err.message : String(err) });
      }
    }),
  );
}

/** Schedules private files for deletion under the retention policy (processed by a sweeper). */
export function queueFileDeletion(paths: string[], deleteAfterMs: number, reason: string) {
  if (paths.length === 0) return null;
  const ref = db().collection('fileDeletionQueue').doc();
  return { ref, data: { paths, reason, deleteAfter: ts(deleteAfterMs), createdAt: ts(now()) } };
}

export async function readPrivateFile(path: string): Promise<{ bytes: Buffer; contentType: string }> {
  if (!path.startsWith('private/')) throw new AppError('permission-denied', 'PERMISSION_DENIED', 'Not a private document.');
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) throw new AppError('not-found', 'NOT_FOUND', 'Document file not found.');
  const [[bytes], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
  return { bytes, contentType: String(metadata.contentType ?? 'application/octet-stream') };
}

/** Copies an approved profile photo to the public area. Returns the public path. */
export async function publishProfilePhoto(driverUid: string, privatePath: string, previousPublicPath: string | null): Promise<string> {
  const publicPath = `public/driverPhotos/${driverUid}/${randomId()}.jpg`;
  await bucket().file(privatePath).copy(bucket().file(publicPath));
  await bucket()
    .file(publicPath)
    .setMetadata({ contentType: 'image/jpeg', cacheControl: 'public, max-age=86400', metadata: { ownerUid: driverUid } });
  if (previousPublicPath && previousPublicPath !== publicPath) await deleteFilesQuietly([previousPublicPath]);
  return publicPath;
}
