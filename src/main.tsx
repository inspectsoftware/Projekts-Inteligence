import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import './styles/index.css'
import App from './App'
import { installLog } from './runtime/log'
import { ErrorBoundary } from './ui/ErrorBoundary'

installLog()

if (import.meta.env.DEV) void import('./dev')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
