import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const theme = new URLSearchParams(window.location.search).get('theme');
if (theme === 'catppuccin') {
  document.documentElement.dataset.theme = theme;
}

const root = document.getElementById('root');
if (!root) throw new Error('Plugin Manager root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
