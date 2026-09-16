/** Operator-facing diagnostics composed only from controlled, non-secret data. */
export class DeploymentError extends Error {}

/** A recognized container-engine publication failure, without upstream output. */
export class PortBindingConflict extends DeploymentError {}
