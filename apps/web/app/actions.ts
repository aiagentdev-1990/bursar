'use server'

import { revalidatePath } from 'next/cache'
import { api, ApiRequestError, ApiUnavailable } from '@/lib/api'
import { parseUsd } from '@/lib/money'

export interface HireFormState {
  error?: string
  /** Set when the API accepted the hire — the modal closes on a change to this. */
  acceptedAt?: number
}

/// The hire form. Returns as soon as the API has accepted the hire: the agent sets itself up in
/// the background and the roster page shows its progress. Amounts are parsed again here — the
/// browser's checks are for the owner's convenience, not trusted.
export async function hireAgent(_previous: HireFormState, form: FormData): Promise<HireFormState> {
  const field = (key: string) => String(form.get(key) ?? '').trim()

  const name = field('name')
  const role = field('role')
  const perTx = parseUsd(field('perTx'))
  const perPeriod = parseUsd(field('perPeriod'))

  if (!name || !role) return { error: 'Give the agent a name and a role.' }
  if (!perTx || !perPeriod) return { error: 'Enter both limits as amounts greater than zero.' }

  try {
    await api('/agents', {
      method: 'POST',
      body: { name, role, perTxCap: perTx.toString(), perPeriodCap: perPeriod.toString() },
    })
  } catch (error) {
    if (error instanceof ApiRequestError || error instanceof ApiUnavailable) return { error: error.message }
    throw error
  }

  revalidatePath('/', 'layout')
  return { acceptedAt: Date.now() }
}

export interface AddMoneyState {
  error?: string
  /** Set when the deposit is mined — the dialog closes on a change to this. */
  addedAt?: number
}

/// "Add money": moves USDC from the owner's wallet into the roster's balance, which every agent
/// spends from. Waits for the transaction, so the page re-renders with the new balance.
export async function addMoney(_previous: AddMoneyState, form: FormData): Promise<AddMoneyState> {
  const amount = parseUsd(String(form.get('amount') ?? ''))
  if (!amount) return { error: 'Enter an amount greater than zero.' }

  try {
    await api('/treasury/deposit', { method: 'POST', body: { amount: amount.toString() } })
  } catch (error) {
    if (error instanceof ApiRequestError || error instanceof ApiUnavailable) return { error: error.message }
    throw error
  }

  revalidatePath('/', 'layout')
  return { addedAt: Date.now() }
}

/// Clears a failed hire the owner has read.
export async function dismissHire(hireId: string): Promise<void> {
  if (!/^hire_[a-z0-9]+$/.test(hireId)) return
  try {
    await api(`/agents/hires/${hireId}`, { method: 'DELETE' })
  } catch (error) {
    // Already gone, or still running: the next render shows whichever it is.
    if (!(error instanceof ApiRequestError)) throw error
  }
  revalidatePath('/')
}
