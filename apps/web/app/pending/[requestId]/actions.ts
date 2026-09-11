'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { api, ApiRequestError, ApiUnavailable } from '@/lib/api'

export interface DecisionState {
  error?: string
}

/// §4.3. Approve calls `approvePending`, and apps/api waits for the receipt before it tells the
/// agent's session to retry; reject calls `rejectPending` and moves nothing. Either way this
/// only returns once the chain has the answer, so the redirect lands on a roster that already
/// reflects it.
export async function decide(requestId: string, _previous: DecisionState, form: FormData): Promise<DecisionState> {
  const decision = form.get('decision')
  if (decision !== 'approve' && decision !== 'reject') return { error: 'Choose approve or reject.' }
  if (!/^\d+$/.test(requestId)) return { error: 'That is not a valid request.' }

  try {
    await api(`/pending/${requestId}/${decision}`, { method: 'POST' })
  } catch (error) {
    if (error instanceof ApiRequestError || error instanceof ApiUnavailable) return { error: error.message }
    throw error
  }

  revalidatePath('/', 'layout')
  redirect('/')
}
