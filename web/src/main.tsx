import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import App from './App';
import { configureServiceWorker } from './serviceWorker';

const root = document.getElementById('root');
if (!root) {
  throw new Error('root element not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

configureServiceWorker();
