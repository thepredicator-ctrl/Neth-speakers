import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { engine } from './audio/engine';
import { useApp } from './store';
import './styles.css';

// Debug / power-user hook
(window as unknown as Record<string, unknown>).__neth = { engine, useApp };

const el = document.getElementById('root')!;
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Global error guard — show useful errors instead of a white screen.
window.addEventListener('error', (e) => {
  const root = document.getElementById('root');
  if (!root || root.childElementCount > 0) return;
  root.innerHTML = `<div style="font-family:monospace;color:#ff7a1a;background:#0b0c0f;padding:24px">
    <h2>Neth Speakers failed to start</h2><pre style="color:#e9ebf0">${(e.error?.stack ?? e.message ?? '').toString().slice(0, 2000)}</pre>
  </div>`;
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[neth] unhandled rejection:', e.reason);
});
