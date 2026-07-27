export const CURRENT_POLICY_BUNDLE_VERSION = "2026-07-27.2";

export const POLICY_DOCUMENTS = {
  terms: "2026-07-27.2",
  privacy_notice: "2026-07-27.2",
  health_data: "2026-07-27",
  health_safety: "2026-07-27",
  adult_attestation: "2026-07-27",
} as const;

export type PolicyDocument = keyof typeof POLICY_DOCUMENTS;

export const REQUIRED_POLICY_DOCUMENTS = Object.keys(POLICY_DOCUMENTS) as PolicyDocument[];

export function hasCurrentPolicyBundle(user: { policy_bundle_version?: string | null }): boolean {
  return user.policy_bundle_version === CURRENT_POLICY_BUNDLE_VERSION;
}
