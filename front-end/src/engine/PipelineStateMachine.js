export const PipelineStates = {
  IDLE: 'idle',
  CALIBRATING: 'calibrating',
  EXTRACTING: 'extracting',
  TRACING: 'tracing',
  COMPOSING: 'composing',
  DONE: 'done',
  ERROR: 'error'
}

export class PipelineStateMachine {
  constructor() {
    this.state = PipelineStates.IDLE
    this.observers = new Set()
    this.context = {}
  }
  
  transition(newState, context = {}) {
    const oldState = this.state
    this.state = newState
    this.context = { ...this.context, ...context }
    
    // Notify observers
    this.observers.forEach(observer => {
      observer.onStateChange(newState, oldState, this.context)
    })
    
  }
  
  subscribe(observer) {
    this.observers.add(observer)
    return () => this.observers.delete(observer)
  }
  
  getCurrentState() {
    return { state: this.state, context: this.context }
  }
}
