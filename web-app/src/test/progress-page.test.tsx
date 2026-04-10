import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { ProgressPage } from "../pages/ProgressPage";
import { transferSlice } from "../features/transfer-start/transferSlice";
import { jobsSlice } from "../features/job-progress/jobsSlice";
import { agentApi } from "../api/agentApi";
import type { RelayJob } from "../api/types";

vi.mock("ethers", () => ({
  BrowserProvider: vi.fn(),
  Contract: vi.fn(),
  AbiCoder: {
    defaultAbiCoder: vi.fn(() => ({
      decode: vi.fn(),
    })),
  },
}));

vi.mock("../api/agentApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/agentApi")>();
  return {
    ...actual,
    useGetJobQuery: vi.fn(),
    useConfirmJobMutation: vi.fn(),
    useGetCurrentStageQuery: vi.fn(),
    useGetStageDetailsQuery: vi.fn(),
    usePrepareJobStageMutation: vi.fn(),
    useRefreshJobMutation: vi.fn(),
    useSubmitReceiptMutation: vi.fn(),
    useUpdateJobSettingsMutation: vi.fn(),
  };
});

import {
  useGetJobQuery,
  useConfirmJobMutation,
  useGetCurrentStageQuery,
  useGetStageDetailsQuery,
  usePrepareJobStageMutation,
  useRefreshJobMutation,
  useSubmitReceiptMutation,
  useUpdateJobSettingsMutation,
} from "../api/agentApi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyMock = (value: unknown) => value as any;

function makeStore() {
  return configureStore({
    reducer: {
      [agentApi.reducerPath]: agentApi.reducer,
      transferStart: transferSlice.reducer,
      jobs: jobsSlice.reducer,
    },
    middleware: (getDefault) => getDefault().concat(agentApi.middleware),
  });
}

function renderPage(jobId = "job-123") {
  return render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={[`/progress/${jobId}`]}>
        <Routes>
          <Route path="/progress/:jobId" element={<ProgressPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

function mockJob(overrides: Partial<RelayJob> = {}): RelayJob {
  return {
    id: "job-123",
    txId: "0x" + "ab".repeat(32),
    currentStage: "lock",
    status: "awaiting_confirmation",
    relayMode: "auto",
    postSubmitBehavior: "auto_prepare",
    plannerAction: "lock",
    plannerReason: "source has deposit, destination needs lock proof",
    sourceStatus: 1,
    destinationStatus: 0,
    intent: {
      sourceProfile: "local-anvil",
      destinationProfile: "local-hardhat",
      sourceConnector: "0x1111111111111111111111111111111111111111",
      destinationConnector: "0x2222222222222222222222222222222222222222",
      tokenFrom: "0xaaaa",
      tokenTo: "0xbbbb",
      amount: "1000",
      receiver: "0xcccc",
    },
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useGetJobQuery).mockReturnValue(
    anyMock({ data: undefined, error: undefined, isLoading: true }),
  );
  vi.mocked(useConfirmJobMutation).mockReturnValue(
    anyMock([vi.fn(), { isLoading: false, reset: vi.fn() }]),
  );
  vi.mocked(useUpdateJobSettingsMutation).mockReturnValue(anyMock([vi.fn(), { isLoading: false }]));
  vi.mocked(useRefreshJobMutation).mockReturnValue(anyMock([vi.fn(), { isLoading: false }]));
  vi.mocked(usePrepareJobStageMutation).mockReturnValue(anyMock([vi.fn(), { isLoading: false }]));
  vi.mocked(useGetCurrentStageQuery).mockReturnValue(anyMock({ data: undefined }));
  vi.mocked(useGetStageDetailsQuery).mockReturnValue(anyMock({ data: undefined }));
  vi.mocked(useSubmitReceiptMutation).mockReturnValue(anyMock([vi.fn()]));
});

describe("ProgressPage", () => {
  it("shows loading indicator while polling starts", () => {
    renderPage();
    expect(screen.getByText(/Loading job/i)).toBeInTheDocument();
  });

  it("shows confirm button for awaiting_confirmation status", async () => {
    vi.mocked(useGetJobQuery).mockReturnValue(
      anyMock({
        data: mockJob({ status: "awaiting_confirmation" }),
        error: undefined,
        isLoading: false,
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Confirm & start relay/i })).toBeInTheDocument();
    });
  });

  it("renders manual controls when relay mode is manual", async () => {
    vi.mocked(useGetJobQuery).mockReturnValue(
      anyMock({
        data: mockJob({
          relayMode: "manual",
          currentStage: "mint",
          plannerAction: "lock",
          plannerReason: "planner recommends lock first",
        }),
        error: undefined,
        isLoading: false,
      }),
    );
    vi.mocked(useGetStageDetailsQuery).mockReturnValue(
      anyMock({
        data: {
          stage: "mint",
          checkpointState: "prepared",
          plannerAction: "lock",
          plannerReason: "planner recommends lock first",
          plannerMismatch: true,
          preparedPayload: {
            stage: "mint",
            actionKind: "proof",
            proofPayload: "0x1234",
            contractMethod: "submitMintProof",
            contractArgs: ["0xabc"],
            targetChainId: 31337,
            targetConnector: "0x2222222222222222222222222222222222222222",
            verificationMode: "colibri",
            verificationDegraded: false,
            verifiedStage: "destination-funds-released",
          },
          submissionTxHash: undefined,
          completedAt: undefined,
        },
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Prepare selected stage/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Regenerate proof/i })).toBeInTheDocument();
      expect(screen.getByText(/Refresh status/i)).toBeInTheDocument();
      expect(screen.getByText(/Selected stage differs from planner recommendation/i)).toBeInTheDocument();
    });
  });

  it("requests regenerate=true when regenerating a manual proof stage", async () => {
    const prepareJobStage = vi.fn(() => ({
      unwrap: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(usePrepareJobStageMutation).mockReturnValue(
      anyMock([prepareJobStage, { isLoading: false }]),
    );
    vi.mocked(useGetJobQuery).mockReturnValue(
      anyMock({
        data: mockJob({
          status: "awaiting_confirmation",
          relayMode: "manual",
          currentStage: "mint",
          plannerAction: "mint",
          plannerReason: "mint proof should be prepared now",
        }),
        error: undefined,
        isLoading: false,
      }),
    );

    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Regenerate proof/i }));

    await waitFor(() => {
      expect(prepareJobStage).toHaveBeenCalledWith({
        jobId: "job-123",
        stage: "mint",
        force: false,
        regenerate: true,
      });
    });
  });

  it("allows regenerating proof from auto mode ready_for_signature card", async () => {
    const prepareJobStage = vi.fn(() => ({
      unwrap: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(usePrepareJobStageMutation).mockReturnValue(
      anyMock([prepareJobStage, { isLoading: false }]),
    );
    vi.mocked(useGetJobQuery).mockReturnValue(
      anyMock({
        data: mockJob({
          status: "ready_for_signature",
          relayMode: "auto",
          currentStage: "lock",
          plannerAction: "lock",
          plannerReason: "lock proof ready",
        }),
        error: undefined,
        isLoading: false,
      }),
    );
    vi.mocked(useGetCurrentStageQuery).mockReturnValue(
      anyMock({
        data: {
          stage: "lock",
          checkpointState: "prepared",
          plannerAction: "lock",
          plannerMismatch: false,
          preparedPayload: {
            stage: "lock",
            actionKind: "proof",
            proofPayload: "0xdeadbeef",
            contractMethod: "submitLockProof",
            contractArgs: [0, "0xdeadbeef", "0x" + "ab".repeat(32)],
            targetChainId: 31338,
            targetConnector: "0x2222222222222222222222222222222222222222",
          },
        },
      }),
    );

    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Regenerate proof/i }));

    await waitFor(() => {
      expect(prepareJobStage).toHaveBeenCalledWith({
        jobId: "job-123",
        stage: "lock",
        force: false,
        regenerate: true,
      });
    });
  });

  it("renders direct-action stage details in manual mode", async () => {
    vi.mocked(useGetJobQuery).mockReturnValue(
      anyMock({
        data: mockJob({
          relayMode: "manual",
          currentStage: "execute-burn",
          plannerAction: "execute-burn",
        }),
        error: undefined,
        isLoading: false,
      }),
    );
    vi.mocked(useGetStageDetailsQuery).mockReturnValue(
      anyMock({
        data: {
          stage: "execute-burn",
          checkpointState: "submitted",
          plannerAction: "execute-burn",
          plannerReason: "burn should execute now",
          plannerMismatch: false,
          preparedPayload: {
            stage: "execute-burn",
            actionKind: "direct",
            contractMethod: "executeBurn",
            contractArgs: ["0xabc"],
            targetChainId: 31338,
            targetConnector: "0x3333333333333333333333333333333333333333",
          },
          submissionTxHash: "0xdeadbeef",
          completedAt: 1712012345000,
        },
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Stage details/i)).toBeInTheDocument();
      expect(screen.getAllByText(/executeBurn/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/submitted/i)).toBeInTheDocument();
    });
  });

  it("preserves manual stage selection across polling updates for the same current stage", async () => {
    let currentJob = mockJob({
      relayMode: "manual",
      currentStage: "mint",
      plannerAction: "lock",
      plannerReason: "planner recommends lock first",
    });

    vi.mocked(useGetJobQuery).mockImplementation(() =>
      anyMock({
        data: currentJob,
        error: undefined,
        isLoading: false,
      }),
    );

    const view = renderPage();
    const user = userEvent.setup();

    const selector = await screen.findByLabelText(/Stage/i);
    await user.selectOptions(selector, "ack");
    expect(screen.getByLabelText(/Stage/i)).toHaveValue("ack");

    currentJob = {
      ...currentJob,
      updatedAt: currentJob.updatedAt + 1000,
    };
    view.rerender(
      <Provider store={makeStore()}>
        <MemoryRouter initialEntries={["/progress/job-123"]}>
          <Routes>
            <Route path="/progress/:jobId" element={<ProgressPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByLabelText(/Stage/i)).toHaveValue("ack");
  });

  it("shows unsupported status badge", async () => {
    vi.mocked(useGetJobQuery).mockReturnValue(
      anyMock({
        data: mockJob({ status: "unsupported", lastError: "Refund state detected" }),
        error: undefined,
        isLoading: false,
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Unsupported/i)).toBeInTheDocument();
    });
  });

  it("shows success heading when completed", async () => {
    vi.mocked(useGetJobQuery).mockReturnValue(
      anyMock({
        data: mockJob({
          status: "completed",
          currentStage: "completed" as RelayJob["currentStage"],
        }),
        error: undefined,
        isLoading: false,
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Transfer Complete/i)).toBeInTheDocument();
    });
  });

  it("shows error alert for failed status", async () => {
    vi.mocked(useGetJobQuery).mockReturnValue(
      anyMock({
        data: mockJob({ status: "failed", lastError: "proof generation failed" }),
        error: undefined,
        isLoading: false,
      }),
    );
    renderPage();
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("proof generation failed");
    });
  });

  it("shows agent-offline banner when fetch fails", async () => {
    vi.mocked(useGetJobQuery).mockReturnValue(
      anyMock({ data: undefined, error: { error: "Connection refused" }, isLoading: false }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Cannot reach local agent/i)).toBeInTheDocument();
    });
  });
});
