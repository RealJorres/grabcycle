import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

const RULES_DIR = resolve(__dirname, '../../../rules');

function hostPort(envVar: string, fallback: string): { host: string; port: number } {
  const value = process.env[envVar] ?? fallback;
  const idx = value.lastIndexOf(':');
  return { host: value.slice(0, idx), port: Number(value.slice(idx + 1)) };
}

export const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-grabcycle';

export async function createRulesEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(RULES_DIR, 'firestore.rules'), 'utf8'),
      ...hostPort('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080'),
    },
    database: {
      rules: readFileSync(resolve(RULES_DIR, 'database.rules.json'), 'utf8'),
      ...hostPort('FIREBASE_DATABASE_EMULATOR_HOST', '127.0.0.1:9000'),
    },
    storage: {
      rules: readFileSync(resolve(RULES_DIR, 'storage.rules'), 'utf8'),
      ...hostPort('FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9199'),
    },
  });
}
