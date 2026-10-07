import { login, methodNotAllowed } from '../../_lib/lyric-trainer.js';
export function onRequest(context) {
  return context.request.method === 'POST' ? login(context) : methodNotAllowed(['POST']);
}
