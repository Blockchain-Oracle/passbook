import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ActivityEntry } from '@strk20/protocol/activity-entry'
import type { PipelineStage } from '@strk20/protocol/pipeline-stage'
import { activityCategory, type Transaction } from '@strk20/protocol/transaction'

import type { BoundaryKind } from '@/app/boundary'
import { usePipeline, type RunningPipeline } from '@/mutations'
import { activityReadQuery, type ActivityRead } from '@/queries'

/** The chain's rows, untouched: one settled transaction per decoded entry. */
export function settledTransactions(entries: readonly ActivityEntry[]): Transaction[] {
  return entries.map((entry) => ({ id: entry.id, chain: { state: 'settled', entry }, surface: null, label: null }))
}

/**
 * The running pipeline as the feed's newest row. Its label and hash are the pipeline's own, so the
 * row above the outlet and the row in the feed describe one action.
 */
export function pipelineTransaction(pipeline: RunningPipeline | null): Transaction | null {
  if (!pipeline) return null
  const stage = (pipeline.reached[pipeline.reached.length - 1] ?? 'build') as PipelineStage
  if (pipeline.terminal === 'failed' || pipeline.failedAt !== null) {
    return {
      id: pipeline.id,
      chain: {
        state: 'failed',
        retryable: !pipeline.submitted,
        reason: `Stopped at ${pipeline.failedAt ?? stage}.`,
        transactionHash: pipeline.transactionHash,
        submitted: pipeline.submitted,
      },
      surface: 'wallet',
      label: pipeline.label,
    }
  }
  return {
    id: pipeline.id,
    chain: { state: 'optimistic', submittedAt: pipeline.startedAt, stage, transactionHash: pipeline.transactionHash },
    surface: 'wallet',
    label: pipeline.label,
  }
}

export interface TransactionsView {
  transactions: Transaction[]
  /** False until a read has completed — the feed is unread, not empty. */
  initialized: boolean
  read: ActivityRead | undefined
  problem: string | null
  loading: boolean
}

/** The feed's rows: the record, plus whatever this tab is submitting right now. */
export function useTransactions(address: string | undefined, accountKey: string | undefined): TransactionsView {
  const query = useQuery(activityReadQuery(address, accountKey))
  const pipeline = usePipeline()
  const transactions = useMemo(() => {
    const settled = settledTransactions(query.data?.entries ?? [])
    const live = pipelineTransaction(pipeline)
    // Once the chain has the row the pipeline's optimistic twin is a duplicate.
    const liveHash = live && live.chain.state !== 'settled' ? (live.chain.transactionHash ?? null) : null
    const seen =
      liveHash !== null && settled.some((tx) => tx.chain.state === 'settled' && tx.chain.entry.transactionHash === liveHash)
    return live && !seen ? [live, ...settled] : settled
  }, [query.data, pipeline])
  return {
    transactions,
    initialized: query.data !== undefined,
    read: query.data,
    problem: query.isError ? (query.error instanceof Error ? query.error.message : 'The record could not be read.') : null,
    loading: query.isPending,
  }
}

/** Where a row's money ended up, for the receipt's badge. */
export function boundaryFor(tx: Transaction): BoundaryKind {
  switch (activityCategory(tx)) {
    case 'deposit':
      return 'publicEntry'
    case 'withdrawal':
    case 'bridge':
      return 'publicExit'
    case 'registration':
      return 'readOnly'
    default:
      return 'shielded'
  }
}
