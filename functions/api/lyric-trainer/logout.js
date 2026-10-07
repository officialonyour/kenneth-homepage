import { logout, methodNotAllowed } from '../../_lib/lyric-trainer.js';
export function onRequest(context) {
  return context.request.method === 'POST' ? logout(context) : methodNotAllowed(['POST']);
}
