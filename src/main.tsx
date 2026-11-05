// Application entry point.
//
// `./core/money` MUST be the first import: it installs the BigInt.prototype.toJSON patch before any
// module can call JSON.stringify on poisha values (snapshots, audit exports, clipboard payloads).
import './core/money';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');

if (!container) {
  throw new Error('LedgerVault could not start: #root is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
