/** Minimal runtime stand-in for importing a Durable Object in Node unit tests. */
export class DurableObject<WorkerEnv = Env> {
	protected ctx: DurableObjectState;
	protected env: WorkerEnv;

	constructor(ctx: DurableObjectState, env: WorkerEnv) {
		this.ctx = ctx;
		this.env = env;
	}
}
