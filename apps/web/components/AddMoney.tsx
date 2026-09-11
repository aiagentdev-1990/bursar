'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addMoney, type AddMoneyState } from '@/app/actions'
import { parseUsd } from '@/lib/money'

/** "Add money" — tops up the roster's balance from the owner's wallet. The balance is the one
 *  account every agent spends from, so this is the only funding step there is. `available` is
 *  preformatted on the server: it is display copy, and the server re-checks the amount. */
export function AddMoney({ available }: { available?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
        Add money
      </button>
      {open && <AddMoneyDialog available={available} onClose={() => setOpen(false)} />}
    </>
  )
}

function AddMoneyDialog({ available, onClose }: { available?: string; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [state, formAction, submitting] = useActionState<AddMoneyState, FormData>(addMoney, {})

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!state.addedAt) return
    router.refresh()
    onClose()
  }, [state.addedAt, router, onClose])

  const parsed = parseUsd(amount)
  const valid = parsed !== null && parsed > 0n

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form className="modal modal-narrow" role="dialog" aria-modal="true" aria-labelledby="add-money-title" action={formAction}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title" id="add-money-title">Add money</h2>
            <p className="modal-sub">
              Every agent spends from this balance, each within its own limits. It is available to them as soon as
              it lands.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="field">
          <label htmlFor="add-money-amount">
            Amount {available && <span className="field-hint">— {available} in your wallet</span>}
          </label>
          <input
            id="add-money-amount"
            name="amount"
            ref={inputRef}
            value={amount}
            inputMode="decimal"
            placeholder="e.g. 25"
            data-invalid={amount.trim() !== '' && !valid}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        {state.error && (
          <p className="modal-error" role="alert">
            {state.error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!valid || submitting}>
            {submitting ? 'Adding…' : 'Add money'}
          </button>
        </div>
      </form>
    </div>
  )
}
