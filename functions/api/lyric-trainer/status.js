import { status, methodNotAllowed } from '../../_lib/lyric-trainer.js';
export function onRequest(context) {
  return context.request.method === 'GET' ? status(context) : methodNotAllowed(['GET']);
}
