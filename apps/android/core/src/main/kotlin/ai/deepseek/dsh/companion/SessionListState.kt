package ai.deepseek.dsh.companion

/** Session-list request state; failures retain Gateway details separately from the fixed diagnostic category. */
sealed interface SessionListState {
    data object Idle : SessionListState
    data object Loading : SessionListState
    data object Ready : SessionListState
    data class Failed(val category: ConnectionFailure, val refusal: GatewayFailureEnvelope?) : SessionListState
}
