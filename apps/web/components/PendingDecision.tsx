'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { CornerArrow } from './Icons'
import { decide, type DecisionState } from '@/app/pending/[requestId]/actions'

function Buttons() {
  const { pending, data } = useFormStatus()
  const choice = pending ? data?.get('decision') : undefined

  // An on-chain confirmation takes a few seconds. Both buttons lock while it runs, so a second
  // click can't send the opposite decision for a request that is already settling.
  return (
    <div className="actions">
      <button type="submit" name="decision" value="reject" className="btn btn-quiet" disabled={pending}>
        {choice === 'reject' ? 'Rejecting…' : 'Reject'}
      </button>
      <button type="submit" name="decision" value="approve" className="btn btn-primary" disabled={pending}>
        {choice === 'approve' ? 'Confirming on-chain…' : 'Approve payment'}
      </button>
    </div>
  )
}

export function PendingDecision({ requestId }: { requestId: string }) {
  const [state, action] = useActionState<DecisionState, FormData>(decide.bind(null, requestId), {})

  return (
    <form action={action}>
      {state.error && (
        <div className="callout" role="alert">
          <span className="callout-mark"><CornerArrow /></span>
          <span>{state.error}</span>
        </div>
      )}
      <Buttons />
    </form>
  )
}
