import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { preloadAllUnitIcons } from './ui/unitIcons';
import './index.css';

void preloadAllUnitIcons();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
