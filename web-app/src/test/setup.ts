import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Explicitly clean up the DOM after every test because @testing-library/react
// relies on a global afterEach which is unavailable without vitest globals mode.
afterEach(() => {
  cleanup();
});
