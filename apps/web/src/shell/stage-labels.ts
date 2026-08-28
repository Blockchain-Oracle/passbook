//
// The pipeline's stage words, once — four surfaces had four hand-typed copies of this table,
// which is four chances for "Proving…" to drift into "proving" on exactly one button.
//
// Only `build` differs between surfaces (it names what is being built), so that is the one
// parameter. `relay` says what actually happens there: the submitter signs — the embedded key
// silently, the connected Ready wallet with its own popup — and the batch goes on-chain.
//
import type { SendStage } from '@strk20/protocol/pipeline-stage'

/**
 * The five user-facing status lines, shared by every money flow.
 *
 * The optional argument is retained for source compatibility with older call sites, but the
 * first stage is deliberately no longer surface-specific. A route saying "Building the bet"
 * while the shell said "Prepare" created two narrators for one operation.
 */
const LABEL: Record<SendStage, string> = {
  build: 'Preparing…',
  prove: 'Proving…',
  relay: 'Signing and broadcasting…',
  mature: 'Waiting for the pool to accept it…',
  confirmed: 'Confirming…',
}

/** One canonical lookup; routes never materialize their own stage-label table. */
export function stageLabel(stage: SendStage): string {
  return LABEL[stage]
}
