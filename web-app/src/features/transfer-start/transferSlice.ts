import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface TransferDraft {
  sourceProfile: string;
  destProfile: string;
  sourceConnector: string;
  destConnector: string;
  tokenFrom: string;
  tokenTo: string;
  amount: string;
  receiver: string;
}

const INITIAL_DRAFT: TransferDraft = {
  sourceProfile: 'local-anvil',
  destProfile: 'local-hardhat',
  sourceConnector: '',
  destConnector: '',
  tokenFrom: '',
  tokenTo: '',
  amount: '',
  receiver: '',
};

interface TransferStartState {
  draft: TransferDraft;
  txStatus: 'idle' | 'approving' | 'depositing' | 'registering';
  error: string | null;
}

const initialState: TransferStartState = {
  draft: INITIAL_DRAFT,
  txStatus: 'idle',
  error: null,
};

export const transferSlice = createSlice({
  name: 'transferStart',
  initialState,
  reducers: {
    setDraftField(
      state,
      action: PayloadAction<{ key: keyof TransferDraft; value: string }>
    ) {
      state.draft[action.payload.key] = action.payload.value;
    },
    setTxStatus(state, action: PayloadAction<TransferStartState['txStatus']>) {
      state.txStatus = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    resetTransfer(state) {
      state.draft = INITIAL_DRAFT;
      state.txStatus = 'idle';
      state.error = null;
    },
  },
});

export const { setDraftField, setTxStatus, setError, resetTransfer } =
  transferSlice.actions;
