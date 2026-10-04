/**
 * Vercel entry point: every /api/* request is routed here (see vercel.json)
 * and handled by the same Express app used in local development.
 *
 * The server is compiled to server/dist during the Vercel build.
 * On Vercel there is no Socket.IO and no background timer — see
 * server/src/middleware/lazySessionMonitor.ts for how sessions are settled.
 */
import { createApp } from '../server/dist/app.js';

export default createApp();
