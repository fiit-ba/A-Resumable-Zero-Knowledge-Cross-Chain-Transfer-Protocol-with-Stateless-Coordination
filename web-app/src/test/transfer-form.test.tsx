import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { TransferForm } from "../pages/TransferForm";
import { transferSlice } from "../features/transfer-start/transferSlice";
import { jobsSlice } from "../features/job-progress/jobsSlice";
import { agentApi } from "../api/agentApi";
import type { RelayJob } from "../api/types";

vi.mock("ethers", () => ({
  BrowserProvider: vi.fn(),
  Contract: vi.fn(),
  Interface: vi.fn().mockImplementation(() => ({
    parseLog: vi.fn().mockReturnValue(null),
  })),
}));

const recoverJobMock = vi.fn();
const updateJobSettingsMock = vi.fn();
const getJobsQueryMock = vi.fn();

function makeJob(overrides: Partial<RelayJob> = {}): RelayJob {
  return {
    id: "job-default",
    txId: "0x" + "ab".repeat(32),
    relayMode: "manual",
    postSubmitBehavior: "pause",
    plannerAction: "lock",
    plannerReason: "source has deposit, destination needs lock proof",
    currentStage: "lock",
    status: "awaiting_confirmation",
    sourceStatus: 1,
    destinationStatus: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
    intent: {
      sourceProfile: "sepolia",
      destinationProfile: "holesky",
      sourceConnector: "0x1111111111111111111111111111111111111111",
      destinationConnector: "0x2222222222222222222222222222222222222222",
      tokenFrom: "0xaaaa",
      tokenTo: "0xbbbb",
      amount: "1",
      receiver: "0xcccc",
      ...overrides.intent,
    },
  };
}

vi.mock("../api/agentApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/agentApi")>();
  return {
    ...actual,
    useCreateJobMutation: vi.fn(() => [vi.fn()]),
    useGetJobsQuery: vi.fn((...args: unknown[]) => getJobsQueryMock(...args)),
    useRecoverJobMutation: vi.fn(() => [recoverJobMock, { isLoading: false }]),
    useUpdateJobSettingsMutation: vi.fn(() => [updateJobSettingsMock, { isLoading: false }]),
  };
});

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

function renderForm() {
  return render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<TransferForm />} />
          <Route path="/progress/:jobId" element={<div>Progress route</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe("TransferForm", () => {
  beforeEach(() => {
    recoverJobMock.mockReset();
    updateJobSettingsMock.mockReset();
    getJobsQueryMock.mockReset();
    getJobsQueryMock.mockReturnValue({
      data: [],
      isError: false,
    });
  });

  it("renders page title", () => {
    renderForm();
    expect(screen.getByText("Cross-Chain Transfer")).toBeInTheDocument();
  });

  it("renders source and destination network selects", () => {
    renderForm();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(2);
  });

  it("does not show local networks in source/destination selectors", async () => {
    renderForm();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: /Source network/i }));
    expect(screen.queryByText("Local Anvil")).not.toBeInTheDocument();
    expect(screen.queryByText("Local Hardhat")).not.toBeInTheDocument();
  });

  it("renders connector address inputs", () => {
    renderForm();
    // source connector, dest connector, tokenFrom, tokenTo, receiver → all have placeholder "0x…"
    expect(screen.getAllByPlaceholderText("0x…").length).toBeGreaterThanOrEqual(4);
  });

  it("renders the deposit button", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /Deposit & Lock/i })).toBeInTheDocument();
  });

  it("shows error alert when submitting with empty address fields", async () => {
    renderForm();
    screen.getByRole("button", { name: /Deposit & Lock/i }).click();
    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
  });

  it("recovery panel can open existing txId and navigate to progress page", async () => {
    recoverJobMock.mockReturnValue({
      unwrap: vi.fn().mockResolvedValue({
        id: "job-1",
        txId: "0x" + "ab".repeat(32),
        relayMode: "manual",
        postSubmitBehavior: "pause",
        plannerAction: "refund-claim",
        plannerReason: "refund initiated on source",
        currentStage: "refund-claim",
        status: "awaiting_confirmation",
        sourceStatus: 3,
        destinationStatus: 4,
        intent: {
          sourceProfile: "local-anvil",
          destinationProfile: "local-hardhat",
          sourceConnector: "0x1111111111111111111111111111111111111111",
          destinationConnector: "0x2222222222222222222222222222222222222222",
          tokenFrom: "0xaaaa",
          tokenTo: "0xbbbb",
          amount: "1",
          receiver: "0xcccc",
        },
        createdAt: 1,
        updatedAt: 1,
      }),
    });
    updateJobSettingsMock.mockReturnValue({
      unwrap: vi.fn().mockResolvedValue({}),
    });

    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/0x txId/i), "0x" + "ab".repeat(32));
    await user.selectOptions(screen.getByDisplayValue("Auto"), "manual");
    await user.click(screen.getByRole("button", { name: /Recover job/i }));

    expect(await screen.findByText("Progress route")).toBeInTheDocument();
  });

  it("renders an active jobs panel for non-terminal jobs sorted by updatedAt descending", () => {
    getJobsQueryMock.mockReturnValue({
      data: [
        makeJob({ id: "job-older", updatedAt: 10 }),
        makeJob({ id: "job-newer", updatedAt: 20 }),
      ],
      isError: false,
    });

    renderForm();

    const panel = screen.getByRole("heading", { name: /Active Jobs/i }).closest("section");
    expect(panel).toBeInTheDocument();

    const rows = within(panel!).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("job-newer");
    expect(rows[1]).toHaveTextContent("job-older");
  });

  it("excludes completed and unsupported jobs from the active list", () => {
    getJobsQueryMock.mockReturnValue({
      data: [
        makeJob({ id: "job-completed", status: "completed" }),
        makeJob({ id: "job-unsupported", status: "unsupported" }),
        makeJob({ id: "job-awaiting", status: "awaiting_confirmation" }),
      ],
      isError: false,
    });

    renderForm();

    expect(screen.queryByText("job-completed")).not.toBeInTheDocument();
    expect(screen.queryByText("job-unsupported")).not.toBeInTheDocument();
    expect(screen.getByText("job-awaiting")).toBeInTheDocument();
  });

  it("includes failed jobs in the active list", () => {
    getJobsQueryMock.mockReturnValue({
      data: [makeJob({ id: "job-failed", status: "failed" })],
      isError: false,
    });

    renderForm();

    expect(screen.getByRole("heading", { name: /Active Jobs/i })).toBeInTheDocument();
    expect(screen.getByText("job-failed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("navigates to progress when clicking an active job", async () => {
    getJobsQueryMock.mockReturnValue({
      data: [makeJob({ id: "job-open" })],
      isError: false,
    });

    renderForm();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /job-open/i }));

    expect(await screen.findByText("Progress route")).toBeInTheDocument();
  });

  it("hides active jobs panel when no non-terminal jobs exist", () => {
    getJobsQueryMock.mockReturnValue({
      data: [
        makeJob({ id: "job-completed", status: "completed" }),
        makeJob({ id: "job-unsupported", status: "unsupported" }),
      ],
      isError: false,
    });

    renderForm();

    expect(screen.queryByRole("heading", { name: /Active Jobs/i })).not.toBeInTheDocument();
  });

  it("shows non-blocking warning when jobs fetch fails while keeping form and recovery usable", () => {
    getJobsQueryMock.mockReturnValue({
      data: undefined,
      isError: true,
    });

    renderForm();

    expect(screen.getByText(/Could not refresh active jobs right now/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deposit & Lock/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Recover job/i })).toBeEnabled();
    expect(screen.getByPlaceholderText(/0x txId/i)).toBeEnabled();
  });
});
