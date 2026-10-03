export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/** ייבוא שנדחה. הנתונים הקיימים לא נפגעו. */
export class BackupError extends StorageError {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`קובץ הגיבוי נדחה: ${problems.slice(0, 5).join('; ')}`);
    this.name = 'BackupError';
    this.problems = problems;
  }
}
