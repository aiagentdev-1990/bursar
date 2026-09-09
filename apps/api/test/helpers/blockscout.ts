import { createServer, type Server } from 'node:http'
import type { Address } from 'viem'

/// A stand-in for Blockscout that re-serves the node's own `eth_getLogs` in Blockscout's
/// `/api/v2` response shape.
///
/// This is the one mocked seam in the integration tests, and it is mocked because there is no
/// Blockscout instance for a local anvil node. It still exercises everything on our side of the
/// boundary — the HTTP call, the pagination envelope, newest-first ordering, and the ABI
/// decoding of real topics and data emitted by the real contract. What it cannot catch is the
/// real explorer's field naming drifting from this shape; checkpoint 9 is where that gets
/// confirmed against the live instance.

export interface BlockscoutStub {
  url: string
  /// Number of log pages served, so a test can assert pagination was followed.
  pagesServed: number
  stop(): Promise<void>
}

interface StubOptions {
  rpcUrl: string
  /// Serve this many logs per page, to exercise the pagination loop.
  pageSize?: number
}

export async function startBlockscoutStub(options: StubOptions): Promise<BlockscoutStub> {
  const pageSize = options.pageSize ?? 50
  let pagesServed = 0

  const rpc = async (method: string, params: unknown[]): Promise<any> => {
    const response = await fetch(options.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    return (await response.json()).result
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const match = req.url?.match(/\/api\/v2\/addresses\/(0x[0-9a-fA-F]{40})\/logs/)
      if (!match) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('{}')
        return
      }

      const address = match[1] as Address
      const offset = Number(new URL(req.url!, 'http://stub').searchParams.get('offset') ?? '0')

      const logs: any[] = await rpc('eth_getLogs', [
        { address, fromBlock: '0x0', toBlock: 'latest' },
      ])

      const timestamps = new Map<string, number>()
      const items = []
      for (const log of logs) {
        if (!timestamps.has(log.blockNumber)) {
          const block = await rpc('eth_getBlockByNumber', [log.blockNumber, false])
          timestamps.set(log.blockNumber, Number(block.timestamp))
        }
        items.push({
          topics: log.topics,
          data: log.data,
          block_number: Number(log.blockNumber),
          block_timestamp: new Date(timestamps.get(log.blockNumber)! * 1000).toISOString(),
          transaction_hash: log.transactionHash,
          index: Number(log.logIndex),
        })
      }

      // Blockscout returns newest first; eth_getLogs returns oldest first.
      items.reverse()

      const page = items.slice(offset, offset + pageSize)
      const nextOffset = offset + pageSize
      pagesServed += 1

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          items: page,
          next_page_params: nextOffset < items.length ? { offset: nextOffset } : null,
        }),
      )
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  return {
    url: `http://127.0.0.1:${port}`,
    get pagesServed() {
      return pagesServed
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
