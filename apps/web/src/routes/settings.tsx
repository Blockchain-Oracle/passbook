// A second leaf exists so the route contract has a non-index path to pin. A one-route tree cannot
// tell "codegen ran" apart from "codegen produced a stale tree".
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

// See `index.tsx` for what `data-route-id` is and why the gate refuses to pass without it.
function Settings() {
  return (
    <main data-route-id="/settings">
      <p>Nothing here yet.</p>
    </main>
  )
}
