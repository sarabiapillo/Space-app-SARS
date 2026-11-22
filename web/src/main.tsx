import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/SolarAnalysis.css'
import App from './App.tsx'
import { getLanguage, setLanguage } from './i18n/core.ts'

setLanguage(getLanguage())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
