// Fire-and-forget public-page invalidation. Call after admin writes so the
// public site reflects the change immediately instead of waiting for the
// 30s ISR / unstable_cache revalidate window.
//
// Failures are intentionally swallowed: a stale public page is far better
// than a thrown exception aborting the admin's save flow.

interface RevalidateInput {
  tournamentId?: string
  teamId?: string
  playerId?: string
}

export async function revalidatePublic(input: RevalidateInput): Promise<void> {
  try {
    await fetch('/api/admin/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      // Don't block other requests
      keepalive: true,
    })
  } catch {
    // Ignore: stale-by-30s is acceptable
  }
}
