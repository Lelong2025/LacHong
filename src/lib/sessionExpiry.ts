const sessionExpiredPatterns = [
  'jwt expired',
  'invalid jwt',
  'invalid authorization token',
  'refresh token',
  'session_not_found',
  'auth session missing',
]

export function isSessionExpiredError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : ''

  return sessionExpiredPatterns.some((pattern) => message.toLowerCase().includes(pattern))
}

export function emitSessionExpired(error?: unknown) {
  if (!isSessionExpiredError(error)) return false
  window.dispatchEvent(new CustomEvent('lachong:session-expired'))
  return true
}
