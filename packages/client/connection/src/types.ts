/** Payload-free observations owned by the browser's Connection generation loop. */

/** A value snapshot of one controller lifetime; counts saturate at the unsigned 32-bit limit. */
export interface ConnectionDiagnosticSnapshot {
  /** Readiness of the current generation, or whether stopped source work is still settling. */
  readonly state: 'idle' | 'opening' | 'connected' | 'reconnecting' | 'stopping' | 'stopped'
  /** Generation attempts allocated since this controller was created. */
  readonly attempts: number
  /** Unexpected generation endings observed while their loop still owned the connection. */
  readonly interruptions: number
  /** At least one count reached the unsigned 32-bit limit. */
  readonly countsSaturated: boolean
}
