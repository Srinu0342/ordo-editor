import { createRoot } from 'react-dom/client';
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './ui.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
