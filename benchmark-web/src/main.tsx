import { createRoot } from 'react-dom/client';
import OpenCodeBenchmarkPage from './pages/OpenCodeBenchmarkPage';
import VSCodeCopilotBenchmarkPage from './pages/VSCodeCopilotBenchmarkPage';
import './style.css';
createRoot(document.getElementById('root')!).render(location.pathname.startsWith('/vscode-copilot') ? <VSCodeCopilotBenchmarkPage/> : <OpenCodeBenchmarkPage/>);
