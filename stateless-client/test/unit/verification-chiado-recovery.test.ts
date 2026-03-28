import { describe, expect, it } from "vitest";
import {
  degradeReasonFromError,
  isSyncBackwardsError,
  isTransientSszBootstrapError,
  isParentBeaconSuccessorBlockMissingError,
  isFinalizedCheckpointBootstrapError,
  isBlockNotSignedYetError,
  isBootstrapEndpointNotFoundError
} from "../../src/relay/verification.js";

// ---------------------------------------------------------------------------
// degradeReasonFromError — pure mapping, no I/O
// ---------------------------------------------------------------------------

describe("degradeReasonFromError", () => {
  it("maps sync-backwards error to chiado_sync_backwards", () => {
    const err = new Error(
      "last sync state is higher than the required period, but we cannot sync backwards"
    );
    expect(isSyncBackwardsError(err)).toBe(true);
    expect(degradeReasonFromError(err)).toBe("chiado_sync_backwards");
  });

  it("maps transient SSZ parse error to chiado_ssz_parse", () => {
    const listErr = new Error("Invalid offset for list");
    expect(isTransientSszBootstrapError(listErr)).toBe(true);
    expect(degradeReasonFromError(listErr)).toBe("chiado_ssz_parse");

    const containerErr = new Error("Invalid Invalid  offset for list");
    expect(isTransientSszBootstrapError(containerErr)).toBe(true);
    expect(degradeReasonFromError(containerErr)).toBe("chiado_ssz_parse");
  });

  it("maps parent-beacon-missing error to chiado_parent_beacon_missing", () => {
    const err = new Error(
      "The Block after 10520082, which should contain the parentBeaconBlockRoot " +
      "for the data block can not be found in the execution layer!"
    );
    expect(isParentBeaconSuccessorBlockMissingError(err)).toBe(true);
    expect(degradeReasonFromError(err)).toBe("chiado_parent_beacon_missing");
  });

  it("maps finalized-checkpoint bootstrap error to chiado_finalization", () => {
    const err = new Error(
      '{"code":404,"message":"NOT_FOUND: Sync committee branch for block root 0xabc not found. ' +
      "Light client bootstrap is only supported for finalized checkpoint block roots.\"}"
    );
    expect(isFinalizedCheckpointBootstrapError(err)).toBe(true);
    expect(degradeReasonFromError(err)).toBe("chiado_finalization");
  });

  it("maps block-not-signed-yet error to chiado_block_not_signed", () => {
    const err = new Error(
      "The requested block has not been signed yet and cannot be verified!!"
    );
    expect(isBlockNotSignedYetError(err)).toBe(true);
    expect(degradeReasonFromError(err)).toBe("chiado_block_not_signed");
  });

  it("returns undefined for unrecognised errors", () => {
    expect(degradeReasonFromError(new Error("connection refused"))).toBeUndefined();
    expect(degradeReasonFromError("string error")).toBeUndefined();
    expect(degradeReasonFromError(null)).toBeUndefined();
  });

  it("maps bootstrap-endpoint-not-found error to chiado_bootstrap_unsupported", () => {
    const javalinErr = new Error(
      'HTTP error! Status: 404, Details: {' +
      '"title": "Endpoint GET /eth/v1/beacon/light_client/bootstrap/0xabc not found",' +
      '"status": 404,' +
      '"type": "https://javalin.io/documentation#endpointnotfound",' +
      '"details": {}}'
    );
    expect(isBootstrapEndpointNotFoundError(javalinErr)).toBe(true);
    expect(degradeReasonFromError(javalinErr)).toBe("chiado_bootstrap_unsupported");
  });

  it("returns undefined for non-Error values", () => {
    expect(degradeReasonFromError(42)).toBeUndefined();
    expect(degradeReasonFromError({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Regression: degradeReasonFromError is stable across error variants
// The recovery loop selects the LAST error that caused the throw; verify that
// the most common Chiado sequence (SSZ first, then sync-backwards) correctly
// resolves to chiado_sync_backwards when sync-backwards is the final cause.
// ---------------------------------------------------------------------------

describe("degradeReasonFromError — multi-error sequence regression", () => {
  const errors = [
    new Error("Invalid Invalid  offset for list"),            // chiado_ssz_parse
    new Error(
      "last sync state is higher than the required period, but we cannot sync backwards"
    )                                                          // chiado_sync_backwards
  ];

  it("last error in typical Chiado sequence is sync-backwards", () => {
    const last = errors[errors.length - 1];
    expect(degradeReasonFromError(last)).toBe("chiado_sync_backwards");
  });

  it("first error in typical Chiado sequence is ssz_parse", () => {
    const first = errors[0];
    expect(degradeReasonFromError(first)).toBe("chiado_ssz_parse");
  });

  it("each error in the sequence maps to a distinct reason", () => {
    const reasons = errors.map(degradeReasonFromError);
    const uniqueReasons = new Set(reasons);
    expect(uniqueReasons.size).toBe(errors.length);
  });
});
