import { createRoot } from 'react-dom/client'
import 'xterm/css/xterm.css'
import './index.css'
import App from './App.tsx'

function stringifyRuntimeIssue(error: unknown) {
  if (error instanceof Error) {
    return error.stack || error.message || String(error)
  }
  return String(error)
}

function isIgnorableRuntimeIssue(error: unknown) {
  const message = stringifyRuntimeIssue(error)
  return (
    message.includes('ResizeObserver loop completed with undelivered notifications') ||
    message.includes('ResizeObserver loop limit exceeded')
  )
}

function suppressIgnorableRuntimeIssue(event: Event, error: unknown) {
  if (!isIgnorableRuntimeIssue(error)) {
    return
  }
  event.preventDefault()
  event.stopImmediatePropagation()
}

window.addEventListener(
  'error',
  (event) => {
    suppressIgnorableRuntimeIssue(event, event.error ?? event.message)
  },
  { capture: true },
)

window.addEventListener(
  'unhandledrejection',
  (event) => {
    suppressIgnorableRuntimeIssue(event, event.reason)
  },
  { capture: true },
)

window.onerror = (message, _source, _lineno, _colno, error) => {
  return isIgnorableRuntimeIssue(error ?? message)
}

createRoot(document.getElementById('root')!).render(<App />)
