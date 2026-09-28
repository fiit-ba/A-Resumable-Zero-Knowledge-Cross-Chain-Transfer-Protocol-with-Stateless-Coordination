import { describe, expect, it } from "vitest";
import { formatUiError, isUserRejection } from "./errors";

describe("formatUiError", () => {
  it("prefers the agent's error body for RTK Query failures", () => {
    expect(formatUiError({ status: 409, data: { error: "Job is terminal" } })).toBe(
      "Job is terminal",
    );
  });

  it("falls back to the HTTP status when the body has no message", () => {
    expect(formatUiError({ status: 500, data: {} })).toBe("Request failed with status 500.");
  });

  it("uses Error messages and stringifies anything else", () => {
    expect(formatUiError(new Error("boom"))).toBe("boom");
    expect(formatUiError("plain")).toBe("plain");
  });
});

describe("isUserRejection", () => {
  it("recognises wallet rejection wording across providers", () => {
    expect(isUserRejection(new Error("User rejected the request."))).toBe(true);
    expect(isUserRejection(new Error("ACTION_REJECTED"))).toBe(true);
    expect(isUserRejection(new Error("execution reverted"))).toBe(false);
  });
});
