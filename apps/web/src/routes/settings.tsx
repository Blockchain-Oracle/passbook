// A second leaf exists so the route contract has a non-index path to pin. A one-route tree cannot
// tell "codegen ran" apart from "codegen produced a stale tree".
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  return <p>Nothing here yet.</p>
}
