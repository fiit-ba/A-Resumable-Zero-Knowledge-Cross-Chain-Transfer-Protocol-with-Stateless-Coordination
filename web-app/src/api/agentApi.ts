import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  AgentHealth,
  PostSubmitBehavior,
  RelayJob,
  RelayMode,
  RelayProofStage,
  StageDetails,
  TransferIntent,
} from "./types";

const BASE_URL =
  (import.meta as { env?: { VITE_AGENT_URL?: string } }).env?.VITE_AGENT_URL ??
  "http://localhost:7549";

export const agentApi = createApi({
  reducerPath: "agentApi",
  baseQuery: fetchBaseQuery({ baseUrl: BASE_URL }),
  tagTypes: ["Job", "Health"],
  endpoints: (builder) => ({
    getHealth: builder.query<AgentHealth, void>({
      query: () => "/health",
      providesTags: ["Health"],
    }),
    createJob: builder.mutation<RelayJob, { txId: string; intent: TransferIntent }>({
      query: (body) => ({
        url: "/jobs",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Job"],
    }),
    getJobs: builder.query<RelayJob[], void>({
      query: () => "/jobs",
      providesTags: ["Job"],
    }),
    getJob: builder.query<RelayJob, string>({
      query: (id) => `/jobs/${id}`,
      providesTags: (_result, _err, id) => [{ type: "Job", id }],
    }),
    confirmJob: builder.mutation<RelayJob, string>({
      query: (id) => ({
        url: `/jobs/${id}/confirm`,
        method: "POST",
        body: {},
      }),
      invalidatesTags: (_result, _err, id) => [{ type: "Job", id }],
    }),
    updateJobSettings: builder.mutation<
      RelayJob,
      { jobId: string; relayMode?: RelayMode; postSubmitBehavior?: PostSubmitBehavior }
    >({
      query: ({ jobId, ...body }) => ({
        url: `/jobs/${jobId}/settings`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (_result, _err, { jobId }) => [{ type: "Job", id: jobId }],
    }),
    refreshJob: builder.mutation<RelayJob, string>({
      query: (jobId) => ({
        url: `/jobs/${jobId}/refresh`,
        method: "POST",
        body: {},
      }),
      invalidatesTags: (_result, _err, jobId) => [{ type: "Job", id: jobId }],
    }),
    prepareJobStage: builder.mutation<
      RelayJob,
      { jobId: string; stage?: RelayProofStage; force?: boolean; regenerate?: boolean }
    >({
      query: ({ jobId, ...body }) => ({
        url: `/jobs/${jobId}/prepare`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_result, _err, { jobId }) => [{ type: "Job", id: jobId }],
    }),
    getCurrentStage: builder.query<StageDetails, string>({
      query: (id) => `/jobs/${id}/stages/current`,
      providesTags: (_result, _err, id) => [{ type: "Job", id }],
    }),
    getStageDetails: builder.query<StageDetails, { jobId: string; stage: RelayProofStage }>({
      query: ({ jobId, stage }) => `/jobs/${jobId}/stages/${stage}`,
      providesTags: (_result, _err, { jobId }) => [{ type: "Job", id: jobId }],
    }),
    submitReceipt: builder.mutation<RelayJob, { jobId: string; stage: RelayProofStage; txHash: string }>({
      query: ({ jobId, stage, txHash }) => ({
        url: `/jobs/${jobId}/receipts`,
        method: "POST",
        body: { stage, txHash },
      }),
      invalidatesTags: (_result, _err, { jobId }) => [{ type: "Job", id: jobId }],
    }),
    recoverJob: builder.mutation<
      RelayJob,
      { txId: string; sourceProfileHint?: string; destinationProfileHint?: string }
    >({
      query: (body) => ({
        url: "/jobs/recover",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Job"],
    }),
  }),
});

export const {
  useGetHealthQuery,
  useCreateJobMutation,
  useGetJobsQuery,
  useGetJobQuery,
  useConfirmJobMutation,
  useUpdateJobSettingsMutation,
  useRefreshJobMutation,
  usePrepareJobStageMutation,
  useGetCurrentStageQuery,
  useGetStageDetailsQuery,
  useSubmitReceiptMutation,
  useRecoverJobMutation,
} = agentApi;
