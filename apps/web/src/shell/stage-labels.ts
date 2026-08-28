//
// The pipeline's stage words, once — four surfaces had four hand-typed copies of this table,
// which is four chances for "Proving…" to drift into "proving" on exactly one button.
//
// Only `build` differs between surfaces (it names what is being built), so that is the one
// parameter. `relay` says what actually happens there: the submitter signs — the embedded key
// silently, the connected Ready wallet with its own popup — and the batch goes on-chain.
//
import type { SendStage } from '@strk20/protocol/pipeline-stage'

export function stageLabels(building: string): Record<SendStage, string> {
  return {
    build: building,
    prove: 'Proving…',
    relay: 'Waiting for the signature, then broadcasting…',
    mature: 'Waiting for the pool to accept it…',
    confirmed: 'Confirming on chain…',
  }
}
