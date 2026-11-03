import { handleWorkerJob } from '../../../lib/worker-proxy';

export const config = { maxDuration: 60 };
export default handleWorkerJob;
