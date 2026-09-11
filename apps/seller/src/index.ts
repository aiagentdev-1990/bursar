// Demo x402 seller on Arc testnet.
//
// Paid HTTP endpoints that answer 402 and settle real USDC on Arc, plus a free /catalog an agent
// can query to decide what to call. The services are ours; the payments are real. It settles its
// own payments in-process (x402 "self-facilitation") because no public facilitator supports the
// standard `exact` scheme on Arc — see DECISIONS.md.

import { resolve } from 'node:path'
import { config } from 'dotenv'
import express from 'express'
import { createWalletClient, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { x402Facilitator } from '@x402/core/facilitator'
import { paymentMiddleware, x402ResourceServer } from '@x402/express'
import { toFacilitatorEvmSigner } from '@x402/evm'
import { registerExactEvmScheme } from '@x402/evm/exact/facilitator'
import { ExactEvmScheme as ExactEvmServerScheme } from '@x402/evm/exact/server'

/// Railway (like most hosts) assigns the port through `PORT` and health-checks that port, so it
/// has to win. It is captured *before* the repo's .env is loaded: that file's `PORT` belongs to
/// apps/api, and adopting it locally would put the seller on the API's port. Locally, then, the
/// seller falls back to SELLER_PORT or 4021.
const platformPort = process.env.PORT

config({ path: resolve(import.meta.dirname, '../../../.env') })

const ARC = 'eip155:5042002' as const
const USDC = '0x3600000000000000000000000000000000000000'
/// Arc USDC's EIP-712 domain, verified on-chain: name() = "USDC", version() = "2". The client signs
/// with whatever `extra` says, so getting this wrong makes every payment fail signature checks.
const USDC_DOMAIN = { name: 'USDC', version: '2' }
const PORT = Number(platformPort ?? process.env.SELLER_PORT ?? 4021)

const rawKey = (process.env.SELLER_PRIVATE_KEY ?? process.env.OWNER_PRIVATE_KEY)?.trim()
if (!rawKey) {
  console.error('Set SELLER_PRIVATE_KEY (or OWNER_PRIVATE_KEY) in .env')
  process.exit(1)
}
/// viem requires a 0x prefix; keys pasted from wallets and faucets often lack it.
const key = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`

/// This key both receives payments and pays gas to settle them, so it needs native USDC on Arc.
const account = privateKeyToAccount(key)
const rpcUrl = process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.network'
const chain = createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) }).extend(publicActions)

const facilitator = new x402Facilitator()
registerExactEvmScheme(facilitator, {
  signer: toFacilitatorEvmSigner({
    address: account.address,
    getCode: chain.getCode,
    readContract: chain.readContract,
    // viem's signature is wider than x402's; the call shape is identical at runtime.
    verifyTypedData: (args) => chain.verifyTypedData(args as Parameters<typeof chain.verifyTypedData>[0]),
    writeContract: chain.writeContract,
    sendTransaction: chain.sendTransaction,
    waitForTransactionReceipt: chain.waitForTransactionReceipt,
  }),
  networks: ARC,
})

/// The in-process facilitator reports `network` as a plain string; the resource server wants the
/// CAIP-2 template type. Same values at runtime — this is a typing mismatch between the two packages.
const localFacilitator = {
  verify: facilitator.verify.bind(facilitator),
  settle: facilitator.settle.bind(facilitator),
  getSupported: async () => facilitator.getSupported(),
} as unknown as ConstructorParameters<typeof x402ResourceServer>[0]

interface Service {
  method: 'GET'
  path: string
  /// USDC base units (6 decimals). The x402 library has no default asset for Arc, so a "$0.01"
  /// price would error; every price is an explicit amount of Arc USDC.
  price: string
  name: string
  description: string
  handler: (req: express.Request) => unknown
}

const SERVICES: Service[] = [
  {
    method: 'GET',
    path: '/v1/comps',
    price: '10000',
    name: 'Watch comparable sales',
    description: 'Recent sold listings for a watch reference. Query: ?ref=145.022',
    handler: (req) => ({
      ref: String(req.query.ref ?? '145.022'),
      sales: [
        { date: '2026-08-30', venue: 'Chrono24', condition: 'Very good', priceUsd: 6850 },
        { date: '2026-08-21', venue: 'Phillips', condition: 'Excellent', priceUsd: 7400 },
        { date: '2026-08-09', venue: 'eBay', condition: 'Good', priceUsd: 6120 },
      ],
    }),
  },
  {
    method: 'GET',
    path: '/v1/market-price',
    price: '5000',
    name: 'Watch market price',
    description: 'Current median asking price for a watch reference. Query: ?ref=145.022',
    handler: (req) => ({ ref: String(req.query.ref ?? '145.022'), medianAskUsd: 7050, listings: 42 }),
  },
]

const display = (baseUnits: string) => {
  const n = BigInt(baseUnits)
  return `$${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0')}`
}

const app = express()
app.set('trust proxy', true)

app.get('/health', (_req, res) => {
  res.json({ ok: true, network: ARC, payTo: account.address })
})

/// Free. What an agent reads to decide what to buy.
app.get('/catalog', (req, res) => {
  const base = process.env.SELLER_PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`
  res.json({
    protocol: 'x402',
    network: ARC,
    asset: USDC,
    services: SERVICES.map((s) => ({
      name: s.name,
      description: s.description,
      method: s.method,
      url: `${base}${s.path}`,
      price: { amount: s.price, decimals: 6, display: display(s.price) },
    })),
  })
})

app.use(
  paymentMiddleware(
    Object.fromEntries(
      SERVICES.map((s) => [
        `${s.method} ${s.path}`,
        {
          accepts: [
            {
              scheme: 'exact',
              price: { amount: s.price, asset: USDC, extra: USDC_DOMAIN },
              network: ARC,
              payTo: account.address,
            },
          ],
          description: s.description,
          mimeType: 'application/json',
        },
      ]),
    ),
    new x402ResourceServer(localFacilitator).register(ARC, new ExactEvmServerScheme()),
  ),
)

for (const s of SERVICES) {
  app.get(s.path, (req, res) => {
    res.json(s.handler(req))
  })
}

app.listen(PORT, () => {
  console.log(`x402 seller on :${PORT} — network ${ARC}, payTo ${account.address}`)
})
