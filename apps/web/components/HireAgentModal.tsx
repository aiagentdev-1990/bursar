'use client'

import { useEffect, useRef, useState } from 'react'
import { parseUsd, usdWhole } from '@/lib/money'
import { InfoIcon } from './Icons'

/** Four fields and no address — §4.1's "the owner never sees a wallet address" showing up in
 *  the form. Caps are typed as bare dollars and converted to base units immediately; nothing
 *  downstream of this component sees a float. */

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
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const perTxBase = parseUsd(perTx)
  const perPeriodBase = parseUsd(perPeriod)
  const capsValid = perTxBase !== null && perTxBase > 0n && perPeriodBase !== null && perPeriodBase > 0n
  const canSubmit = capsValid && name.trim() !== '' && role.trim() !== ''

  const activePreset = PRESETS.find((p) => p.perTx === perTx && p.perPeriod === perPeriod && p.role === role)

  function applyPreset(preset: Preset) {
    setRole(preset.role)
    setPerTx(preset.perTx)
    setPerPeriod(preset.perPeriod)
  }

  function submit() {
    if (!canSubmit) return
    // Checkpoint 6 wires this to POST /agents (Privy wallet → hireAgent → Claude session, §4.1).
    // At checkpoint 8 the roster is static fixture data, so hiring closes without mutating it.
    onClose()
  }

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="hire-title">
        <div className="modal-head">
          <div>
            <h2 className="modal-title" id="hire-title">Hire an agent</h2>
            <p className="modal-sub">It joins the roster with these caps live from the first transaction.</p>
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
            <input id="hire-name" ref={nameRef} value={name} placeholder="e.g. Courier" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="hire-role">Role</label>
            <input id="hire-role" value={role} placeholder="What it is allowed to do" onChange={(e) => setRole(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="hire-pertx">Per-transaction cap</label>
            <input
              id="hire-pertx"
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
              value={perPeriod}
              inputMode="decimal"
              data-invalid={perPeriodBase === null}
              onChange={(e) => setPerPeriod(e.target.value)}
            />
          </div>
        </div>

        <p className="summary">
          <span className="summary-mark"><InfoIcon size={15} /></span>
          <span>
            {capsValid ? (
              <>
                Spends up to <strong>{usdWhole(perTxBase)}</strong> at a time,{' '}
                <strong>{usdWhole(perPeriodBase)}</strong> a month. Anything larger waits for you.
              </>
            ) : (
              <>Enter both caps as plain amounts — they take effect from the first transaction.</>
            )}
          </span>
        </p>

        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
            Add to roster
          </button>
        </div>
      </div>
    </div>
  )
}
