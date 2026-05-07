import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import brandIconUrl from './assets/game/brand/Icon.webp';
import { preloadAllUnitIcons } from './ui/unitIcons';
import './index.css';

void preloadAllUnitIcons();

const ensureBrandFavicon = () => {
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/webp";
  link.href = brandIconUrl;
};

ensureBrandFavicon();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
