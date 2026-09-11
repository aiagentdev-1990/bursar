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
  const budgetText = field('budget')
  const budget = budgetText === '' ? null : parseUsd(budgetText)

  if (!name || !role) return { error: 'Give the agent a name and a role.' }
  if (!perTx || !perPeriod) return { error: 'Enter both caps as amounts greater than zero.' }
  if (budgetText !== '' && !budget) return { error: 'Enter the opening budget as a plain amount, or leave it empty.' }

  try {
    await api('/agents', {
      method: 'POST',
      body: {
        name,
        role,
        perTxCap: perTx.toString(),
        perPeriodCap: perPeriod.toString(),
        ...(budget ? { fundAmount: budget.toString() } : {}),
      },
    })
  } catch (error) {
    if (error instanceof ApiRequestError || error instanceof ApiUnavailable) return { error: error.message }
    throw error
  }

  revalidatePath('/', 'layout')
  return { acceptedAt: Date.now() }
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
