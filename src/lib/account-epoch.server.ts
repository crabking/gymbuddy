import { eq, sql } from "drizzle-orm";
import type { getDb } from "@/db/db.server";
import { profiles } from "@/db/schema";

export type AccountMutationTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export class DataEpochConflictError extends Error {
  readonly code = "data_epoch_conflict";

  constructor() {
    super("data_epoch_conflict");
    this.name = "DataEpochConflictError";
  }
}

/**
 * Every account-scoped mutation takes this lock before any narrower
 * chat/program/workout/workspace lock. Coach switches and resets take the same
 * lock first, so an old request can never commit after the reset transaction.
 */
export async function acquireAccountMutationLock(tx: AccountMutationTransaction, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"account:" + userId}, 0))`);
}

/**
 * Validate the snapshot the client acted on while holding the account lock.
 * The profile row is also locked so a reset cannot increment the epoch until
 * this transaction commits.
 */
export async function requireExpectedDataEpoch(
  tx: AccountMutationTransaction,
  userId: string,
  expectedDataEpoch: number,
) {
  if (!Number.isInteger(expectedDataEpoch) || expectedDataEpoch < 0) {
    throw new DataEpochConflictError();
  }
  await acquireAccountMutationLock(tx, userId);
  const [profile] = await tx
    .select({ data_epoch: profiles.data_epoch })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .for("update")
    .limit(1);
  if (!profile || profile.data_epoch !== expectedDataEpoch) {
    throw new DataEpochConflictError();
  }
  return profile.data_epoch;
}
