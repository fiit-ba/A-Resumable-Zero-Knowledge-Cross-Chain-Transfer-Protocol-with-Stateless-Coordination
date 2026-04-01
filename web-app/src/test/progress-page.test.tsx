import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    useGetNextStageQuery: vi.fn(),
    useSubmitReceiptMutation: vi.fn(),
  };
});

import {
  useGetJobQuery,
  useConfirmJobMutation,
  useGetNextStageQuery,
  useSubmitReceiptMutation,
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
  vi.mocked(useGetNextStageQuery).mockReturnValue(anyMock({ data: undefined }));
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
