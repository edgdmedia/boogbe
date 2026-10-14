import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom (25) ships HTMLDialogElement without the modal methods Dialog relies on.
// Guarded so the real implementation wins whenever jsdom catches up.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.open = true;
    },
    close(this: HTMLDialogElement) {
      this.open = false;
    },
  });
}

afterEach(cleanup); // vitest globals are off, so RTL does not auto-register cleanup

