import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { ThemeProvider } from './app/ThemeProvider';
import './styles/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root container #root não encontrado');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
