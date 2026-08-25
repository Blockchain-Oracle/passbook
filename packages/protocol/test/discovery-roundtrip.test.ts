import { describe, it, expect } from 'vitest'
import { hash } from 'starknet'
import {
  ERC20,
  MockContracts,
  MockPoolContract,
  compute_channel_key,
  compute_note_id,
  compute_nullifier,
} from '@starkware-libs/starknet-privacy-sdk/testing'
import { discoverWallet, outgoingTotalFrom, presenceOf } from '../src/discovery.js'
import { balancesFrom, hasDust, KNOWN_TOKEN_DECIMALS } from '../src/balances.js'
import { buildActivity, personalKeysFrom } from '../src/activity.js'
import { deriveViewingKey } from '../src/identity.js'
import { NET, STRK_TOKEN } from '../src/constants.js'
import { generateIdentity } from '../src/identity.js'

//
// THE POSITIVE HALF OF THE PROBE (story 1.9). `discovery-live.test.ts` proves the walk reaches
// mainnet and decodes real note values; this proves it DECRYPTS — that a note created for us is
// found, with the right token, the right amount, the right sender and the right note id.
//
// Against the SDK's own `MockPoolContract`, which is not a stub of the crypto: it stores real
// `encryptChannelInfo` / `encryptNoteAmount` output and answers the same view entrypoints the
// live pool does, through the same `PoolContractInterface`. What differs from mainnet is the
// transport, and the transport is exactly what the live suite exercises. Splitting the proof
// this way is forced: there is no mainnet identity whose notes we hold (see the live file), and
// manufacturing one costs a real pool fee plus gas.
//

const POOL = 0x99n
const SENDER = 0xa11cen
const RECIPIENT = 0xb0bn

/** A pool with one real encrypted note sent from SENDER to RECIPIENT, through the real pipeline. */
function poolWithOneNote(amount: bigint, token = BigInt(STRK_TOKEN)) {
  const erc20 = new ERC20(token)
  erc20.setBalance(SENDER, 10n ** 30n)
  const pool = new MockPoolContract(POOL, new MockContracts(erc20), true)

  // The recipient's Account Key is a real one, and the viewing key is OUR derivation — so this
  // exercises `deriveViewingKey` rather than a convenient integer. The pool's public key is
  // derived from whatever viewing key registers, which is what binds the two together.
  const recipientAccountKey = generateIdentity().privateKey
  const recipientViewingKey = deriveViewingKey(recipientAccountKey, NET.chainId, NET.pool)
  const senderAccountKey = generateIdentity().privateKey
  const senderViewingKey = deriveViewingKey(senderAccountKey, NET.chainId, NET.pool)

  // `compile_actions` is a view and rolls its own state back; replaying is what commits.
  const commit = (from: bigint, key: bigint, ...actions: Parameters<typeof pool.execute>[2][]) =>
    pool.apply_actions(pool.execute(from, key, ...actions))

  commit(SENDER, senderViewingKey, { type: 'SetViewingKey', input: { random: 1n } })
  commit(RECIPIENT, recipientViewingKey, { type: 'SetViewingKey', input: { random: 2n } })

  const recipientPublicKey = pool.get_public_key(RECIPIENT)
  const channelKey = compute_channel_key(SENDER, senderViewingKey, RECIPIENT, recipientPublicKey)

  commit(
    SENDER,
    senderViewingKey,
    { type: 'OpenChannel', input: { recipient_addr: RECIPIENT, index: 0, random: 3n, salt: 4n } },
    {
      type: 'OpenSubchannel',
      input: {
        recipient_addr: RECIPIENT,
        recipient_public_key: recipientPublicKey,
        channel_key: channelKey,
        index: 0,
        token,
        salt: 5n,
      },
    },
    { type: 'Deposit', input: { token, amount } },
    {
      type: 'CreateEncNote',
      input: {
        recipient_addr: RECIPIENT,
        recipient_public_key: recipientPublicKey,
        token,
        amount,
        index: 0,
        salt: 6n,
      },
    },
  )

  return {
    pool,
    recipientAccountKey,
    recipientViewingKey,
    senderAccountKey,
    senderViewingKey,
    channelKey,
    recipientPublicKey,
    token,
  }
}

describe('discovery finds a note that was really created for us', () => {
  it('decrypts the note with its exact token, amount and sender', async () => {
    const amount = 7_000_000_000_000_000_000n
    const { pool, recipientAccountKey } = poolWithOneNote(amount)

    const result = await discoverWallet(`0x${RECIPIENT.toString(16)}`, recipientAccountKey, {
      pool,
      blockNumber: 13_800_000,
    })

    expect(result.state).toBe('walked')
    if (result.state !== 'walked') return

    expect(result.notes).toHaveLength(1)
    const note = result.notes[0]!
    expect(note.amount).toBe(amount)
    expect(BigInt(note.token)).toBe(BigInt(STRK_TOKEN))
    expect(BigInt(note.sender)).toBe(SENDER)
    expect(note.open).toBe(false)
    expect(note.witness.nonce).toBe(0)
    expect(note.id).toBeGreaterThan(0n)

    expect(result.presence).toBe('present')
    expect(presenceOf(result)).toBe('present')
    expect(result.registered).toBe(true)
    expect(result.blockNumber).toBe(13_800_000)
  })

  it('produces the SendWalletData shape story 1.16 takes, without growing it', async () => {
    const { pool, recipientAccountKey } = poolWithOneNote(5n)
    const result = await discoverWallet(`0x${RECIPIENT.toString(16)}`, recipientAccountKey, {
      pool,
      blockNumber: 1,
    })
    if (result.state !== 'walked') throw new Error('expected a completed walk')

    // The wallet's notes are the discovered notes minus `open` — `SendNoteData` is a frozen
    // shape and this story produces it rather than changing it.
    expect(result.wallet.notes).toHaveLength(1)
    expect(Object.keys(result.wallet.notes[0]!).sort()).toEqual(
      ['amount', 'id', 'sender', 'token', 'witness'].sort(),
    )
    expect(result.wallet.notes[0]).not.toHaveProperty('open')
    expect(result.wallet.notes[0]!.witness).toEqual(result.notes[0]!.witness)
  })

  it('sees the sender\'s OUTGOING channel with its live index — the FR-060 seam', async () => {
    const { pool, senderAccountKey } = poolWithOneNote(5n)
    // Walked with the SENDER'S OWN key, so the outgoing scan actually decrypts. This number is
    // the index a new channel must open at: the pool asserts it equals its stored count and
    // reverts INDEX_NOT_SEQUENTIAL otherwise, on a batch already paid to prove. The fixture
    // opened exactly one channel, so anything but 1 here is a send that fails for every account
    // that has ever opened one — which a `>= 0` assertion would have waved straight through.
    const result = await discoverWallet(`0x${SENDER.toString(16)}`, senderAccountKey, {
      pool,
      blockNumber: 1,
    })
    if (result.state !== 'walked') throw new Error('expected a completed walk')
    expect(result.registry.outgoingTotal).toBe(1)
    expect(result.registry.outgoing).toHaveLength(1)
    expect(BigInt(result.registry.outgoing[0]!.address)).toBe(RECIPIENT)
    expect(result.registry.outgoing[0]!.key).toBeDefined()
    expect(result.wallet.channels).toEqual(result.registry.outgoing)
  })

  it('refuses a walk whose channel count the SDK did not report', () => {
    // A bare `?? 0` cannot be right: `undefined` is both "no outgoing channels" and "the field
    // was renamed", and pinning both to zero silently reintroduces INDEX_NOT_SEQUENTIAL on a
    // green suite. The two are told apart by the KEY, which the SDK always writes.
    expect(() => outgoingTotalFrom({} as { total?: number }, 0)).toThrow(/no `total`/)
    // Present-but-undefined is a genuine zero.
    expect(outgoingTotalFrom({ total: undefined }, 0)).toBe(0)
    expect(outgoingTotalFrom({ total: 3 }, 2)).toBe(3)
    // A count below the channels actually handed back is internally inconsistent.
    expect(() => outgoingTotalFrom({ total: 1 }, 2)).toThrow(/internally inconsistent/)
    expect(() => outgoingTotalFrom({ total: -1 }, 0)).toThrow(/nonsensical/)
    expect(() => outgoingTotalFrom({ total: 1.5 }, 0)).toThrow(/nonsensical/)
  })

  it('a different Account Key on the same address finds nothing at all', async () => {
    const { pool } = poolWithOneNote(7n)
    const stranger = generateIdentity().privateKey

    const result = await discoverWallet(`0x${RECIPIENT.toString(16)}`, stranger, {
      pool,
      blockNumber: 1,
    })
    expect(result.state).toBe('walked')
    if (result.state !== 'walked') return
    // The note is there; this key cannot reach it. An empty book, not somebody else's money.
    expect(result.notes).toHaveLength(0)
    expect(result.presence).toBe('absent')
  })
})

describe('the registry recomputes every id and nullifier the account can produce', () => {
  it('recomputes the discovered note\'s own id from the cursor', async () => {
    const { pool, recipientAccountKey, recipientViewingKey } = poolWithOneNote(11n)
    const result = await discoverWallet(`0x${RECIPIENT.toString(16)}`, recipientAccountKey, {
      pool,
      blockNumber: 1,
    })
    if (result.state !== 'walked') throw new Error('expected a completed walk')

    const keys = personalKeysFrom(result.registry, recipientViewingKey)
    const discovered = result.notes[0]!

    // THIS IS THE PERSONAL FEED, in one assertion: the id the walk returned is an id we can
    // recompute from nothing but the registry. That is what lets a public `EncNoteCreated`
    // stream be matched without persisting anything between sessions.
    expect(keys.byNoteId.has(discovered.id.toString())).toBe(true)
    expect(keys.byNoteId.get(discovered.id.toString())!.counterparty).toBe(discovered.sender)
    expect(keys.byNoteId.get(discovered.id.toString())!.token).toBe(discovered.token)

    // And every id has a matching nullifier, which is the half that needs the viewing key —
    // the reason a nullifier proves ownership and a public note id does not.
    expect(keys.byNullifier.size).toBe(keys.byNoteId.size)
    expect(keys.byNullifier.size).toBeGreaterThan(0)
  })

  it('a wrong viewing key produces different nullifiers for the same ids', async () => {
    const { pool, recipientAccountKey, recipientViewingKey } = poolWithOneNote(11n)
    const result = await discoverWallet(`0x${RECIPIENT.toString(16)}`, recipientAccountKey, {
      pool,
      blockNumber: 1,
    })
    if (result.state !== 'walked') throw new Error('expected a completed walk')

    const mine = personalKeysFrom(result.registry, recipientViewingKey)
    const theirs = personalKeysFrom(result.registry, recipientViewingKey + 1n)

    // Ids do not depend on the viewing key; nullifiers do. If this ever collapses, a spend by
    // one account would be attributed to another.
    expect([...theirs.byNoteId.keys()]).toEqual([...mine.byNoteId.keys()])
    expect([...theirs.byNullifier.keys()]).not.toEqual([...mine.byNullifier.keys()])
  })
})

describe('balances over a real walk', () => {
  it('sums to the exact wei and stamps the block', async () => {
    const amount = 7_000_000_000_000_000_000n
    const { pool, recipientAccountKey } = poolWithOneNote(amount)
    const result = await discoverWallet(`0x${RECIPIENT.toString(16)}`, recipientAccountKey, {
      pool,
      blockNumber: 13_818_013,
    })

    const balance = balancesFrom(result)
    expect(balance.presence).toBe('present')
    expect(balance.book).toBe('holdings')
    expect(balance.blockNumber).toBe(13_818_013)
    expect(balance.tokens).toHaveLength(1)
    expect(balance.tokens[0]!.wei).toBe(amount)
    expect(balance.tokens[0]!.noteCount).toBe(1)
    expect(balance.tokens[0]!.openNoteCount).toBe(0)
    // STRK's decimals are the one entry we have verified live, so a verdict is available.
    expect(balance.tokens[0]!.decimals).toBe(KNOWN_TOKEN_DECIMALS[STRK_TOKEN])
    expect(balance.tokens[0]!.isDust).toBe(false)
    expect(hasDust(balance)).toBe(false)
  })

  it('a real dust balance is exact and flagged, never a zero', async () => {
    // 400 wei of an 18-decimal token: real money, and smaller than four decimal places shows.
    const { pool, recipientAccountKey } = poolWithOneNote(400n)
    const result = await discoverWallet(`0x${RECIPIENT.toString(16)}`, recipientAccountKey, {
      pool,
      blockNumber: 1,
    })

    const balance = balancesFrom(result)
    expect(balance.tokens[0]!.wei).toBe(400n)
    expect(balance.tokens[0]!.isDust).toBe(true)
    expect(hasDust(balance)).toBe(true)
    // The model never rounds. Whatever epic 6 renders, it renders from this number.
    expect(balance.tokens[0]!.wei).not.toBe(0n)
  })
})

describe('the Personal-feed keystone: a SPENT note stays recomputable', () => {
  // The claim the whole Personal feed rests on — the walk returns only UNSPENT notes, yet a
  // spend has to appear in the feed. This spends a real note through the mock pool's real
  // action pipeline and then proves the nullifier a `NoteUsed` would carry is still derivable
  // from the post-spend registry, with nothing persisted between the two walks.
  //
  // THE ONE SYNTHETIC PART, named rather than hidden: `MockPoolContract` keeps no event log, so
  // the `NoteUsed` row is constructed from the nullifier the pool actually stored. The event's
  // wire shape is pinned separately against live mainnet data in `discovery-live.test.ts`.
  async function spendTheNote() {
    const amount = 9_000_000_000_000_000_000n
    const fixture = poolWithOneNote(amount)
    const { pool, recipientAccountKey, recipientViewingKey, channelKey, token } = fixture

    const before = await discoverWallet(`0x${RECIPIENT.toString(16)}`, recipientAccountKey, {
      pool,
      blockNumber: 1,
    })
    if (before.state !== 'walked') throw new Error('expected a completed walk')
    expect(before.notes).toHaveLength(1)

    // The recipient spends it and withdraws the value, which keeps the pool's token totals
    // balanced — the mock validates them exactly as the contract does.
    pool.apply_actions(
      pool.execute(
        RECIPIENT,
        recipientViewingKey,
        { type: 'UseNote', input: { channel_key: channelKey, token, index: 0 } },
        { type: 'Withdraw', input: { to_addr: RECIPIENT, token, amount, random: 7n } },
      ),
    )

    const after = await discoverWallet(`0x${RECIPIENT.toString(16)}`, recipientAccountKey, {
      pool,
      blockNumber: 2,
    })
    if (after.state !== 'walked') throw new Error('expected a completed walk')
    return { ...fixture, before, after, amount }
  }

  it('the walk stops holding it, and says so with `absent`', async () => {
    const { after } = await spendTheNote()
    expect(after.notes).toHaveLength(0)
    expect(after.presence).toBe('absent')
    expect(balancesFrom(after).book).toBe('no-activity')
  })

  it('the registry still covers the spent slot', async () => {
    const { after, before } = await spendTheNote()
    // The note is gone from the holdings but its index is still inside the cursor's bound —
    // which is the whole mechanism. A cursor that shrank with the balance would lose history.
    expect(after.registry.incoming).toHaveLength(1)
    expect(after.registry.incoming[0]!.noteSlots[0]!.nextIndex).toBeGreaterThanOrEqual(1)
    expect(after.registry.incoming[0]!.channelKey).toBe(before.registry.incoming[0]!.channelKey)
  })

  it('a NoteUsed carrying the pool-stored nullifier is recognised as ours', async () => {
    const { after, recipientViewingKey, channelKey, token, before, pool } = await spendTheNote()

    const keys = personalKeysFrom(after.registry, recipientViewingKey)
    const spentNullifier = compute_nullifier(channelKey, token, 0, recipientViewingKey)
    const spentNoteId = compute_note_id(channelKey, token, 0)

    // The pool really holds this nullifier — the spend above wrote it.
    expect(await pool.nullifier_exists(spentNullifier)).toBe(true)
    expect(keys.byNullifier.has(spentNullifier.toString())).toBe(true)
    expect(keys.byNoteId.get(spentNoteId.toString())?.noteId).toBe(before.notes[0]!.id)

    const entries = buildActivity(
      [
        {
          keys: [
            `0x${hash.starknetKeccak('NoteUsed').toString(16)}`,
            `0x${spentNullifier.toString(16)}`,
          ],
          data: [],
          blockNumber: 2,
          transactionHash: '0xspend',
        },
      ],
      { personal: keys, amountsByNoteId: new Map([[spentNoteId.toString(), before.notes[0]!.amount]]) },
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]!.mine).toBe(true)
    expect(entries[0]!.kind).toBe('note-spent')
    expect(entries[0]!.noteCommitment).toBe(`0x${spentNoteId.toString(16)}`)
    expect(entries[0]!.amount).toBe(before.notes[0]!.amount)
    expect(entries[0]!.counterparty).toBe(`0x${SENDER.toString(16)}`)
  })

  it("a stranger's NoteUsed in the same feed stays theirs", async () => {
    const { after, recipientViewingKey } = await spendTheNote()
    const keys = personalKeysFrom(after.registry, recipientViewingKey)
    const entries = buildActivity(
      [
        {
          keys: [`0x${hash.starknetKeccak('NoteUsed').toString(16)}`, '0xfeedface'],
          data: [],
          blockNumber: 2,
          transactionHash: '0xsomeoneelse',
        },
      ],
      { personal: keys },
    )
    expect(entries[0]!.mine).toBe(false)
    expect(entries[0]!.noteCommitment).toBeNull()
  })
})
