//
// Reading a Starknet RPC throw without showing anyone the transaction it was carrying.
//
// ── THE REASON SITS AFTER THE PAYLOAD, NOT INSTEAD OF IT ──────────────────────────────────
//
// A starknet.js `RpcError` stringifies as:
//
//   RpcError: RPC: <method> with params { …the entire signed transaction… } <code>: <message>
//
// The params object is the request we sent — on a proven pool batch that is hundreds of kilobytes
// of calldata with the proof blob inside it, and it is never the explanation. So it has to go.
//
// But it is in the MIDDLE. Cutting from "with params" to the end of the string, which is the
// obvious way to do it, takes the explanation with it and leaves `RpcError: RPC: <method>` — a
// sentence that says only that something failed. That is why this matches braces instead: the
// payload is removed and the message after it survives.
//

/** What a node's own explanation looks like where the payload ended: `41: Transaction execution…`. */
const NODE_MESSAGE = /^-?\d+\s*:/

/**
 * The RPC method a throw came from, read ONLY from the library's own prefix.
 *
 * ── IT IS ANCHORED, AND THAT IS THE WHOLE SECURITY PROPERTY ───────────────────────────────
 *
 * The rest of this string is the request echoed back, and on a proven submission the request
 * contains a `proof` blob the CALLER chose. Matching a method name anywhere in the text therefore
 * matches something the caller wrote: a client that sends `proof: "starknet_getNonce"` can make
 * any failure look like one that happened before the broadcast. Only the `<Something>Error: RPC:
 * <method>` prefix is written by the library, so only the prefix is read.
 */
export function rpcMethod(text: string): string | null {
  return text.match(/^\s*\w*Error:\s*RPC:\s*(\S+)/i)?.[1] ?? null
}

/** Removes only the `with params {…}` object, keeping everything the node said after it. */
export function stripRpcParams(text: string): string {
  const at = text.search(/with params\s*/i)
  if (at < 0) return text.trim()
  const open = text.indexOf('{', at)
  if (open < 0) return text.slice(0, at).trim()
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        // Balanced — but only KEEP the tail if it reads like the node's own message, which
        // follows the payload as `<code>: <message>`. The brace walk assumes strictly quoted
        // JSON, and a params render that is not that (single quotes, a log-truncated object)
        // flips the string flag, balances on the wrong brace, and leaves us holding the middle
        // of the signed transaction. Refusing an unrecognised tail costs a reason; returning
        // one costs the calldata this whole function exists to withhold.
        const tail = text.slice(i + 1).trim()
        if (!NODE_MESSAGE.test(tail)) return text.slice(0, at).trim()
        return `${text.slice(0, at)} ${tail}`.replace(/\s+/g, ' ').trim()
      }
    }
  }
  // Unbalanced (truncated by a log, or not JSON at all): keep the head, drop the rest.
  return text.slice(0, at).trim()
}

/**
 * The Cairo panic a revert carries, when there is one.
 *
 * The node reports it twice — once as the felt-encoded bytes and once in parentheses beside them,
 * `0x526573… ('Result::unwrap failed.')`. The parenthesised half is the only part of a reverted
 * transaction that reads as words, so it is worth more than every other clause in the string.
 */
export function cairoPanic(text: string): string | null {
  return text.match(/\('([^']{1,160})'\)/)?.[1]?.trim() || null
}

/** True when the throw came from fee estimation, which runs BEFORE the transaction is broadcast. */
export function isEstimateFailure(text: string): boolean {
  return /starknet_estimateFee/i.test(text)
}
