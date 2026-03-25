import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** Active job session stored after deposit succeeds */
export interface ActiveJobSession {
  jobId: string;
  txId: string;
  sourceProfile: string;
  destProfile: string;
  sourceConnector: string;
  destConnector: string;
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
  name: 'jobs',
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

export const { setActiveJob, clearActiveJob, setSubmitting, setSubmitError } =
  jobsSlice.actions;
