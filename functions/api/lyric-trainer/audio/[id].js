import { serveAudio, methodNotAllowed } from '../../../_lib/lyric-trainer.js';
export function onRequest(context) {
  return ['GET', 'HEAD'].includes(context.request.method) ? serveAudio(context) : methodNotAllowed(['GET', 'HEAD']);
}
