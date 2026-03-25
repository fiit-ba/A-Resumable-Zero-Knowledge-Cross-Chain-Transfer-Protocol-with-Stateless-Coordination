import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { TransferForm } from '../pages/TransferForm';
import { transferSlice } from '../features/transfer-start/transferSlice';
import { jobsSlice } from '../features/job-progress/jobsSlice';
import { agentApi } from '../shared/api/agentApi';

vi.mock('ethers', () => ({
  BrowserProvider: vi.fn(),
  Contract: vi.fn(),
  Interface: vi.fn().mockImplementation(() => ({
    parseLog: vi.fn().mockReturnValue(null),
  })),
}));

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
      <MemoryRouter>
        <TransferForm />
      </MemoryRouter>
    </Provider>
  );
}

describe('TransferForm', () => {
  it('renders page title', () => {
    renderForm();
    expect(screen.getByText('Cross-Chain Transfer')).toBeInTheDocument();
  });

  it('renders source and destination network selects', () => {
    renderForm();
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2);
  });

  it('renders connector address inputs', () => {
    renderForm();
    // source connector, dest connector, tokenFrom, tokenTo, receiver → all have placeholder "0x…"
    expect(screen.getAllByPlaceholderText('0x…').length).toBeGreaterThanOrEqual(4);
  });

  it('renders the deposit button', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /Deposit & Lock/i })).toBeInTheDocument();
  });

  it('shows error alert when submitting with empty address fields', async () => {
    renderForm();
    screen.getByRole('button', { name: /Deposit & Lock/i }).click();
    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
  });
});
