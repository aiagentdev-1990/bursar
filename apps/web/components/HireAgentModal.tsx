'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { hireAgent, type HireFormState } from '@/app/actions'
import { parseUsd, usdWhole } from '@/lib/money'
import { InfoIcon } from './Icons'

/** No address anywhere — §4.1's "the owner never sees a wallet address" showing up in the form.
 *  Caps are typed as bare dollars and converted to base units on the server; nothing downstream
 *  sees a float.
 *
 *  Submitting returns as soon as the API accepts the hire. The agent then sets itself up in the
 *  background — a minute or two — and the roster page shows its progress. */

interface Preset {
  label: string
  role: string
  perTx: string
  perPeriod: string
}

const PRESETS: Preset[] = [
  { label: 'Research', role: 'Comparable-listing research', perTx: '50', perPeriod: '300' },
  { label: 'Payouts', role: 'One-off task payouts', perTx: '75', perPeriod: '900' },
  { label: 'Support', role: 'Buyer questions and offers', perTx: '25', perPeriod: '150' },
]

export function HireAgentModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [perTx, setPerTx] = useState('75')
  const [perPeriod, setPerPeriod] = useState('400')
  const [budget, setBudget] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const [state, formAction, submitting] = useActionState<HireFormState, FormData>(hireAgent, {})

  useEffect(() => {
    nameRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Accepted: close, and re-render the page so the hire's progress row appears.
  useEffect(() => {
    if (!state.acceptedAt) return
    router.refresh()
    onClose()
  }, [state.acceptedAt, router, onClose])

  const perTxBase = parseUsd(perTx)
  const perPeriodBase = parseUsd(perPeriod)
  const budgetBase = budget.trim() === '' ? null : parseUsd(budget)
  const capsValid = perTxBase !== null && perTxBase > 0n && perPeriodBase !== null && perPeriodBase > 0n
  const budgetValid = budget.trim() === '' || (budgetBase !== null && budgetBase > 0n)
  const canSubmit = capsValid && budgetValid && name.trim() !== '' && role.trim() !== '' && !submitting

  const activePreset = PRESETS.find((p) => p.perTx === perTx && p.perPeriod === perPeriod && p.role === role)

  function applyPreset(preset: Preset) {
    setRole(preset.role)
    setPerTx(preset.perTx)
    setPerPeriod(preset.perPeriod)
  }

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="hire-title" action={formAction}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title" id="hire-title">Hire an agent</h2>
            <p className="modal-sub">
              It sets itself up in the background — a minute or two — and joins the roster with these caps live
              from its first transaction.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="preset"
              data-active={preset === activePreset}
              onClick={() => applyPreset(preset)}
            >
              {preset.label} · ${preset.perTx} / ${preset.perPeriod}
            </button>
          ))}
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="hire-name">Name</label>
            <input id="hire-name" name="name" ref={nameRef} value={name} placeholder="e.g. Courier" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="hire-role">Role</label>
            <input id="hire-role" name="role" value={role} placeholder="What it is allowed to do" onChange={(e) => setRole(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="hire-pertx">Per-transaction cap</label>
            <input
              id="hire-pertx"
              name="perTx"
              value={perTx}
              inputMode="decimal"
              data-invalid={perTxBase === null}
              onChange={(e) => setPerTx(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="hire-perperiod">Monthly cap</label>
            <input
              id="hire-perperiod"
              name="perPeriod"
              value={perPeriod}
              inputMode="decimal"
              data-invalid={perPeriodBase === null}
              onChange={(e) => setPerPeriod(e.target.value)}
            />
          </div>
          <div className="field field-wide">
            <label htmlFor="hire-budget">Opening budget <span className="field-hint">— optional</span></label>
            <input
              id="hire-budget"
              name="budget"
              value={budget}
              inputMode="decimal"
              placeholder="Set aside from the treasury for this agent to spend"
              data-invalid={!budgetValid}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        </div>

        <p className="summary">
          <span className="summary-mark"><InfoIcon size={15} /></span>
          <span>
            {capsValid ? (
              <>
                Spends up to <strong>{usdWhole(perTxBase)}</strong> at a time,{' '}
                <strong>{usdWhole(perPeriodBase)}</strong> a month. Anything larger waits for you.{' '}
                {budgetBase ? (
                  <>It starts with <strong>{usdWhole(budgetBase)}</strong> to spend.</>
                ) : (
                  <>With no opening budget it can't spend until you fund it.</>
                )}
              </>
            ) : (
              <>Enter both caps as plain amounts — they take effect from the first transaction.</>
            )}
          </span>
        </p>

        {state.error && (
          <p className="modal-error" role="alert">
            {state.error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {submitting ? 'Hiring…' : 'Add to roster'}
          </button>
        </div>
      </form>
    </div>
  )
}
