import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RelayJob } from "../../api/types";

/** Active job session stored after deposit succeeds */
export interface ActiveJobSession {
  jobId: string;
  txId: string;
  sourceProfile: string;
  destProfile: string;
  sourceConnector: string;
  destConnector: string;
}

export function activeSessionFromJob(job: RelayJob): ActiveJobSession {
  return {
    jobId: job.id,
    txId: job.txId,
    sourceProfile: job.intent.sourceProfile,
    destProfile: job.intent.destinationProfile,
    sourceConnector: job.intent.sourceConnector,
    destConnector: job.intent.destinationConnector,
  };
}

interface JobsState {
  active: ActiveJobSession | null;
  submitError: string | null;
  submitting: boolean;
}

const initialState: JobsState = {
  active: null,
  submitError: null,
  submitting: false,
};

export const jobsSlice = createSlice({
  name: "jobs",
  initialState,
  reducers: {
    setActiveJob(state, action: PayloadAction<ActiveJobSession>) {
      state.active = action.payload;
      state.submitError = null;
    },
    clearActiveJob(state) {
      state.active = null;
      state.submitError = null;
      state.submitting = false;
    },
    setSubmitting(state, action: PayloadAction<boolean>) {
      state.submitting = action.payload;
    },
    setSubmitError(state, action: PayloadAction<string | null>) {
      state.submitError = action.payload;
    },
  },
});

export const { setActiveJob, clearActiveJob, setSubmitting, setSubmitError } = jobsSlice.actions;
