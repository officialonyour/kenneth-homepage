import { updateGroup, deleteGroup, methodNotAllowed } from '../../../_lib/lyric-trainer.js';
export function onRequest(context) {
  if (context.request.method === 'PATCH') return updateGroup(context);
  if (context.request.method === 'DELETE') return deleteGroup(context);
  return methodNotAllowed(['PATCH', 'DELETE']);
}
