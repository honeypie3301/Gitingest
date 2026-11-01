import { handleWorkerJob } from '../../../lib/worker-proxy.js';

export const config = { maxDuration: 60 };
export default handleWorkerJob;
