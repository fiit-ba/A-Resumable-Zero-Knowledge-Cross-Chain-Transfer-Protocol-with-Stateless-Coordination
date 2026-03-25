import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type {
  AgentHealth,
  EnrichedStagePayload,
  RelayJob,
  TransferIntent,
} from 'agent-shared';

const BASE_URL =
  (import.meta as { env?: { VITE_AGENT_URL?: string } }).env?.VITE_AGENT_URL ??
  'http://localhost:7549';

export const agentApi = createApi({
  reducerPath: 'agentApi',
  baseQuery: fetchBaseQuery({ baseUrl: BASE_URL }),
  tagTypes: ['Job', 'Health'],
  endpoints: (builder) => ({
    // ── Health ──────────────────────────────────────────────────────────
    getHealth: builder.query<AgentHealth, void>({
      query: () => '/health',
      providesTags: ['Health'],
    }),

    // ── Jobs ────────────────────────────────────────────────────────────
    createJob: builder.mutation<RelayJob, { txId: string; intent: TransferIntent }>({
      query: (body) => ({
        url: '/jobs',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Job'],
    }),

    getJob: builder.query<RelayJob, string>({
      query: (id) => `/jobs/${id}`,
      providesTags: (_result, _err, id) => [{ type: 'Job', id }],
    }),

    confirmJob: builder.mutation<RelayJob, string>({
      query: (id) => ({
        url: `/jobs/${id}/confirm`,
        method: 'POST',
        body: {},
      }),
      invalidatesTags: (_result, _err, id) => [{ type: 'Job', id }],
    }),

    getNextStage: builder.query<EnrichedStagePayload, string>({
      query: (id) => `/jobs/${id}/next-stage`,
      providesTags: (_result, _err, id) => [{ type: 'Job', id }],
    }),

    submitReceipt: builder.mutation<
      RelayJob,
      { jobId: string; stage: string; txHash: string }
    >({
      query: ({ jobId, stage, txHash }) => ({
        url: `/jobs/${jobId}/receipts`,
        method: 'POST',
        body: { stage, txHash },
      }),
      invalidatesTags: (_result, _err, { jobId }) => [{ type: 'Job', id: jobId }],
    }),
  }),
});

export const {
  useGetHealthQuery,
  useCreateJobMutation,
  useGetJobQuery,
  useConfirmJobMutation,
  useGetNextStageQuery,
  useSubmitReceiptMutation,
} = agentApi;
