import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireIdentity } from "@/lib/auth-middleware";
import {
  CURRENT_POLICY_BUNDLE_VERSION,
  POLICY_DOCUMENTS,
  REQUIRED_POLICY_DOCUMENTS,
} from "@/lib/policies";

const AcceptPoliciesSchema = z
  .object({
    locale: z.enum(["en", "sv"]),
    terms: z.literal(true),
    privacy_notice: z.literal(true),
    health_data: z.literal(true),
    health_safety: z.literal(true),
    adult_attestation: z.literal(true),
  })
  .strict();

export const getPublicLegalConfig = createServerFn({ method: "GET" }).handler(async () => {
  const operatorName = process.env.LEGAL_OPERATOR_NAME?.trim() || null;
  const contactEmail = process.env.LEGAL_CONTACT_EMAIL?.trim().toLowerCase() || null;
  const appEnvironment =
    process.env.APP_ENV?.trim().toLowerCase() ||
    (process.env.NODE_ENV === "production" ? "production" : "local");
  return {
    operatorName: operatorName ?? "COACH private beta",
    contactEmail,
    country: process.env.LEGAL_OPERATOR_COUNTRY?.trim() || "Sweden",
    appEnvironment,
    detailsComplete: Boolean(operatorName && contactEmail),
  };
});

export const getPolicyStatus = createServerFn({ method: "GET" })
  .middleware([requireIdentity])
  .handler(async ({ context }) => {
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { policyConsents } = await import("@/db/schema");
    const rows = await getDb()
      .select({
        document: policyConsents.document,
        version: policyConsents.version,
        locale: policyConsents.locale,
        granted_at: policyConsents.granted_at,
      })
      .from(policyConsents)
      .where(eq(policyConsents.user_id, context.userId));
    const accepted = new Set(rows.map((row) => `${row.document}:${row.version}`));
    const missing = REQUIRED_POLICY_DOCUMENTS.filter(
      (document) => !accepted.has(`${document}:${POLICY_DOCUMENTS[document]}`),
    );
    return {
      bundleVersion: CURRENT_POLICY_BUNDLE_VERSION,
      complete:
        context.user.policy_bundle_version === CURRENT_POLICY_BUNDLE_VERSION &&
        missing.length === 0,
      missing,
      accepted: rows,
    };
  });

export const acceptCurrentPolicies = createServerFn({ method: "POST" })
  .middleware([requireIdentity])
  .validator((input: unknown) => AcceptPoliciesSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { createHash } = await import("node:crypto");
    const { eq } = await import("drizzle-orm");
    const { getDb } = await import("@/db/db.server");
    const { policyConsents, users } = await import("@/db/schema");
    const request = getRequest();
    const userAgent = request.headers.get("user-agent")?.slice(0, 1_000) ?? "";
    const userAgentHash = userAgent ? createHash("sha256").update(userAgent).digest("hex") : null;
    const grantedAt = new Date().toISOString();

    await getDb().transaction(async (tx) => {
      await tx
        .insert(policyConsents)
        .values(
          REQUIRED_POLICY_DOCUMENTS.map((document) => ({
            user_id: context.userId,
            document,
            version: POLICY_DOCUMENTS[document],
            locale: data.locale,
            source: "web",
            user_agent_hash: userAgentHash,
            granted_at: grantedAt,
          })),
        )
        .onConflictDoNothing();
      await tx
        .update(users)
        .set({
          policy_bundle_version: CURRENT_POLICY_BUNDLE_VERSION,
          policy_accepted_at: grantedAt,
        })
        .where(eq(users.id, context.userId));
    });

    return { ok: true, bundleVersion: CURRENT_POLICY_BUNDLE_VERSION };
  });
