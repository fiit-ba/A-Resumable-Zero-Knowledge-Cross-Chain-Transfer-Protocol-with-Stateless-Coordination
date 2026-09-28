import { describe, expect, it } from "vitest";
import { defaultProofPaths, resolveRelayConfig } from "../../src/config/config.js";

const BASE_OPTIONS = {
  "tx-id": "0x" + "ab".repeat(32),
  "private-key": "0x" + "11".repeat(32),
  "proof-backend": "docker",
  "source-connector": "0x1111111111111111111111111111111111111111",
  "destination-connector": "0x2222222222222222222222222222222222222222",
  "repo-root": "/repo",
};

describe("defaultProofPaths", () => {
  it("points every workspace and Docker wrapper at zk-proofs/risc_zero", () => {
    expect(defaultProofPaths("/repo")).toEqual({
      lockWorkspace: "/repo/zk-proofs/risc_zero/lock_event",
      mintWorkspace: "/repo/zk-proofs/risc_zero/mint_event",
      ackWorkspace: "/repo/zk-proofs/risc_zero/ack_event",
      refundClaimWorkspace: "/repo/zk-proofs/risc_zero/refund_claim_event",
      burnWorkspace: "/repo/zk-proofs/risc_zero/burn_event",
      nonAcceptWorkspace: "/repo/zk-proofs/risc_zero/non_accept_event",
      lockDockerScript: "/repo/zk-proofs/risc_zero/lock_event/scripts/prove-lock-docker.sh",
      mintDockerScript: "/repo/zk-proofs/risc_zero/mint_event/scripts/prove-mint-docker.sh",
      ackDockerScript: "/repo/zk-proofs/risc_zero/ack_event/scripts/prove-ack-docker.sh",
      refundClaimDockerScript:
        "/repo/zk-proofs/risc_zero/refund_claim_event/scripts/prove-refund-claim-docker.sh",
      burnDockerScript: "/repo/zk-proofs/risc_zero/burn_event/scripts/prove-burn-docker.sh",
      nonAcceptDockerScript:
        "/repo/zk-proofs/risc_zero/non_accept_event/scripts/prove-non-accept-docker.sh",
    });
  });
});

describe("resolveRelayConfig", () => {
  it("applies per-path CLI overrides on top of the defaults", () => {
    const config = resolveRelayConfig({
      ...BASE_OPTIONS,
      "burn-workspace": "/custom/burn",
      "non-accept-docker-script": "/custom/non-accept.sh",
    });
    expect(config.proofPaths.burnWorkspace).toBe("/custom/burn");
    expect(config.proofPaths.nonAcceptDockerScript).toBe("/custom/non-accept.sh");
    expect(config.proofPaths.lockWorkspace).toBe("/repo/zk-proofs/risc_zero/lock_event");
  });

  it("uses --execution-block as the fallback for every stage-specific block", () => {
    const config = resolveRelayConfig({
      ...BASE_OPTIONS,
      "execution-block": "100",
      "ack-execution-block": "0x20",
    });
    expect(config.executionBlocks).toEqual({
      sourceDeposit: 100,
      destinationFundsReleased: 100,
      sourceAckReady: "0x20",
      sourceRefundInitiated: 100,
      destinationBurnExecuted: 100,
      destinationNonAccept: 100,
    });
  });

  it("defaults to local-anvil -> local-hardhat", () => {
    const config = resolveRelayConfig(BASE_OPTIONS);
    expect(config.source.profileName).toBe("local-anvil");
    expect(config.destination.profileName).toBe("local-hardhat");
  });

  it("layers per-side RPC overrides on top of an explicit profile", () => {
    const config = resolveRelayConfig({
      ...BASE_OPTIONS,
      "destination-profile": "local-hardhat",
      "destination-rpc-url": "http://127.0.0.1:9999",
    });
    expect(config.destination.profileName).toBe("local-hardhat");
    expect(config.destination.chainId).toBe(31338);
    expect(config.destination.rpcUrls).toEqual(["http://127.0.0.1:9999"]);
  });

  it("treats overrides without a profile as a custom chain that needs a chain id", () => {
    expect(() =>
      resolveRelayConfig({ ...BASE_OPTIONS, "destination-rpc-url": "http://127.0.0.1:9999" }),
    ).toThrow(/No destination chain id configured/);
  });
});
