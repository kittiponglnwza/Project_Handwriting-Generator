import { useEffect, useMemo, useState } from "react"
import { PipelineStateMachine, PipelineStates } from "../engine/PipelineStateMachine.js"

export function usePipeline() {
  const machine = useMemo(() => new PipelineStateMachine(), [])
  const [snapshot, setSnapshot] = useState(() => machine.getCurrentState())

  useEffect(() => {
    const unsubscribe = machine.subscribe({
      onStateChange: (state, _oldState, context) => {
        setSnapshot({ state, context })
      },
    })

    setSnapshot(machine.getCurrentState())
    return unsubscribe
  }, [machine])

  return {
    machine,
    state: snapshot.state ?? PipelineStates.IDLE,
    context: snapshot.context ?? {},
    transition: machine.transition.bind(machine),
  }
}

