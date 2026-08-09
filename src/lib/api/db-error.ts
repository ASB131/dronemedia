function getErrorCause(error: unknown): Error | undefined {
  if (error instanceof Error && "cause" in error && error.cause instanceof Error) {
    return error.cause;
  }
  return undefined;
}

export function formatDbError(error: unknown): string {
  const cause = getErrorCause(error);
  const pgMessage = cause?.message ?? (error instanceof Error ? error.message : "");

  if (/relation "upload_(batches|files)" does not exist/i.test(pgMessage)) {
    return "Upload database tables are missing. Run: npm run db:migrate";
  }

  if (/type "upload_(batch|file)_status" does not exist/i.test(pgMessage)) {
    return "Upload database types are missing. Run: npm run db:migrate";
  }

  if (pgMessage && !pgMessage.startsWith("Failed query:")) {
    return pgMessage;
  }

  return error instanceof Error ? error.message : "Database operation failed";
}
