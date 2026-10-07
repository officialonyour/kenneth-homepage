import { listGroups, createGroup, methodNotAllowed } from '../../_lib/lyric-trainer.js';
export function onRequest(context) {
  if (context.request.method === 'GET') return listGroups(context);
  if (context.request.method === 'POST') return createGroup(context);
  return methodNotAllowed(['GET', 'POST']);
}
