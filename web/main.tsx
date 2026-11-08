import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PublicCanteen from './Public';
import './style.css';
const cache = new QueryClient();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={cache}><PublicCanteen /></QueryClientProvider></React.StrictMode>,
);
