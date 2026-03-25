import { configureStore } from '@reduxjs/toolkit';
import { agentApi } from '../shared/api/agentApi';
import { transferSlice } from '../features/transfer-start/transferSlice';
import { jobsSlice } from '../features/job-progress/jobsSlice';

export const store = configureStore({
  reducer: {
    [agentApi.reducerPath]: agentApi.reducer,
    transferStart: transferSlice.reducer,
    jobs: jobsSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(agentApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
