//
// The sections added to the landing page when it stopped being an argument and started being a
// product tour: the offer, how the boundary works, and the questions a first-time reader has.
//
// Split out of `Landing.tsx` rather than appended to it — the page composition and the copy for
// seven sections do not belong in one file, and this repository holds a 400-line ceiling.
//
import { Band, Inner } from './Band'
import { NETWORK } from '@/data/deployment'

/**
 * The offer, and the fact that makes it worth reading: it is on mainnet.
 *
 * ── WHY "MAINNET" IS THE LOUD WORD AND NOT "FREE" ─────────────────────────────────────────
 *
 * Nearly every privacy demo at this level runs on a testnet where a faucet costs nobody anything,
 * so "your first three transactions are on us" is a sentence most of the field can write and none
 * of them can mean. The number is small; that it is real STRK on the live chain is the whole
 * claim, so the word doing the work is the network, not the price.
 *
 * `NETWORK` is read off the protocol's own chain id rather than typed, so a build pointed anywhere
 * else says where it actually is instead of making this promise about a chain it is not on.
 */
export function Offer() {
  return (
    <Band tone="light" className="py-s60">
      <Inner className="flex max-w-[1100px] flex-col gap-s24">
        <span className="kicker text-[color:var(--ink3)]">Getting started</span>
        <p className="display m-0 text-display2 xl:text-display1">
          Your first three transactions are on us.{' '}
          <span className="text-accent1">Real STRK, on {NETWORK}.</span>
        </p>
        <div className="grid gap-s24 md:grid-cols-3">
          {[
            {
              n: '01',
              title: 'An account, in the browser',
              body: 'No wallet to install and no seed phrase to write down. The key is generated on first load, and a small amount of STRK arrives so the account can put itself on chain.',
            },
            {
              n: '02',
              title: 'Registration is the first one',
              body: 'Joining the pool costs one transaction. We pay it, and your account arrives already holding a shielded balance rather than an empty one.',
            },
            {
              n: '03',
              title: 'Two left, for anything',
              body: 'Send, swap, bet, vote. The pool charges a fee on every transaction; on these two it comes out of our wallet and not your balance. The app counts them down where you can see it.',
            },
          ].map((step) => (
            <div key={step.n} className="flex flex-col gap-s8 border-t border-[color:var(--line)] pt-s16">
              <span className="font-mono text-body4 text-[color:var(--ink3)]">{step.n}</span>
              <h3 className="m-0 text-body1 font-medium">{step.title}</h3>
              <p className="m-0 text-body4 text-[color:var(--ink2)]">{step.body}</p>
            </div>
          ))}
        </div>
        <p className="m-0 font-mono text-body4 text-[color:var(--ink3)]">
          The budget is shared and resets daily. When it is spent the account still works — each
          transaction simply pays the pool fee from its own balance, like any other.
        </p>
      </Inner>
    </Band>
  )
}

/** The seven questions a first-time reader has, answered without hedging. */
const FAQ = [
  {
    q: 'Do I need to fund a wallet first?',
    a: 'No. You arrive holding 3 STRK, already shielded, and a little public STRK so the account can put itself on chain. Registration and two more transactions are on us — on those, the pool fee comes out of our wallet rather than your balance. After them you pay your own fees in STRK, like any Starknet account.',
  },
  {
    q: 'Is there USDC to start?',
    a: 'No — shielded STRK only. Getting USDC means a swap, or bridging some in, and either is an ordinary transaction you can spend one of your three on. The bridge only runs outbound today, so USDC has to arrive at your Starknet address the usual way.',
  },
  {
    q: 'Is my money safe?',
    a: 'Your key is generated in your browser and never leaves it, so nobody here can move your funds. That cuts the other way too: if you lose the key and your backup, nobody can restore it. The app makes you save it before it writes anything on chain, and that is the one step it will not let you skip.',
  },
  {
    q: 'What can you see?',
    a: 'We run the relayer that submits your transactions, so it sees your network address and the moment a request arrived. It cannot read your notes. When it submits for you, your address is not the sender on chain — ours is.',
  },
  {
    q: 'What can the auditor see?',
    a: 'When you register, an encrypted copy of your viewing key is escrowed on chain to StarkWare’s auditor. That is part of the pool, not a choice we made, and it is not optional. Whoever holds that key sees whatever your viewing key sees. This is why we will not describe anything here as end-to-end.',
  },
  {
    q: 'Why do I need STRK at all?',
    a: 'The pool charges a fee in STRK on every transaction, and Starknet charges gas. A new account needs a small amount to put itself on chain; after that we cover the first three. Beyond those, transactions pay the pool fee from your shielded balance.',
  },
  {
    q: 'What does a transaction cost?',
    a: 'Two numbers, and they behave differently. The pool fee is exact and read from the contract at the moment you act. Gas is an estimate — a proof is expensive to verify, so it is the larger part of what varies. Every screen that asks you to sign shows both, separately, before you do.',
  },
  {
    q: 'Can I get my money out?',
    a: 'Yes, and the door is next to the one that put it in. Unshield returns value to any Starknet address; the bridge takes shielded USDC to another chain. A withdrawal writes the destination and the amount on chain — it hides which note paid, and nothing else.',
  },
  {
    q: 'What happens if you disappear?',
    a: 'Your key is yours and the pool is StarkWare’s, deployed and not ours to switch off. What would stop is our relayer, and with it the transactions we submit on your behalf — you would pay your own fees from a funded Starknet account instead. The contracts and addresses are listed below so you can check any of this without us.',
  },
] as const

export function Faq() {
  return (
    <Band tone="dark" className="py-s60">
      <Inner className="max-w-[1100px]">
        <div className="flex items-baseline justify-between gap-s16 pb-s24">
          <span className="kicker">Questions</span>
          <span className="kicker">Answered straight</span>
        </div>
        <div className="flex flex-col border-t border-[color:var(--line)]">
          {FAQ.map((item) => (
            /* Open by default and not a disclosure widget: a page arguing that it does not hide
               things should not make a reader click seven times to find out what they are. */
            <div key={item.q} className="grid gap-s8 border-b border-[color:var(--line)] py-s24 md:grid-cols-[minmax(0,22ch)_minmax(0,1fr)] md:gap-s32">
              <h3 className="m-0 text-body1 font-medium">{item.q}</h3>
              <p className="m-0 max-w-[70ch] text-body3 text-[color:var(--ink2)]">{item.a}</p>
            </div>
          ))}
        </div>
      </Inner>
    </Band>
  )
}
