export type PersistStatus = 'granted' | 'already' | 'denied' | 'unsupported';

export interface PersistResult {
  status: PersistStatus;
  /** האם האחסון מתמשך עכשיו. כש-false כדאי להציג למשתמש אזהרה ולהדגיש גיבוי. */
  persisted: boolean;
}

type StorageManagerLike = Pick<StorageManager, 'persist' | 'persisted'>;

/** מבקש אחסון מתמשך ובודק אם אושר. לא זורק: כשלון פירושו "לא אושר". */
export async function requestPersistence(
  storage: Partial<StorageManagerLike> | undefined = typeof navigator === 'undefined' ? undefined : navigator.storage,
): Promise<PersistResult> {
  if (!storage || typeof storage.persist !== 'function') return { status: 'unsupported', persisted: false };
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) {
      return { status: 'already', persisted: true };
    }
    const granted = await storage.persist();
    return granted ? { status: 'granted', persisted: true } : { status: 'denied', persisted: false };
  } catch {
    return { status: 'denied', persisted: false };
  }
}
