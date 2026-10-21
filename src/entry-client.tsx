/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { hydrateRoot, createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installAuthFetch } from './utils/authToken';

declare global {
  interface Window {
    __INITIAL_DATA__?: any;
  }
}

installAuthFetch();

if (typeof window !== 'undefined') {
  window.alert = (message?: any) => {
    window.dispatchEvent(new CustomEvent('app:notify', { detail: String(message ?? '') }));
  };
}

const initialData = window.__INITIAL_DATA__;
const initialPath = window.location.pathname;
const rootElement = document.getElementById('root')!;

if (rootElement.hasChildNodes() && initialData) {
  hydrateRoot(
    rootElement,
    <App initialPath={initialPath} initialData={initialData} />
  );
} else {
  createRoot(rootElement).render(
    <App initialPath={initialPath} initialData={initialData} />
  );
}
