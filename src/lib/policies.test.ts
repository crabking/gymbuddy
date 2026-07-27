import { describe, expect, it } from "vitest";
import {
  CURRENT_POLICY_BUNDLE_VERSION,
  POLICY_DOCUMENTS,
  REQUIRED_POLICY_DOCUMENTS,
  hasCurrentPolicyBundle,
} from "./policies";

describe("policy bundle", () => {
  it("requires every explicit policy document", () => {
    expect(REQUIRED_POLICY_DOCUMENTS.sort()).toEqual(Object.keys(POLICY_DOCUMENTS).sort());
    expect(REQUIRED_POLICY_DOCUMENTS).toContain("health_data");
    expect(REQUIRED_POLICY_DOCUMENTS).toContain("adult_attestation");
  });

  it("accepts only the current bundle marker", () => {
    expect(hasCurrentPolicyBundle({ policy_bundle_version: CURRENT_POLICY_BUNDLE_VERSION })).toBe(
      true,
    );
    expect(hasCurrentPolicyBundle({ policy_bundle_version: null })).toBe(false);
    expect(hasCurrentPolicyBundle({ policy_bundle_version: "older" })).toBe(false);
  });
});
