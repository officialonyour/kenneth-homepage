import { updateTrack, deleteTrack, methodNotAllowed } from '../../../_lib/lyric-trainer.js';
export function onRequest(context) {
  if (context.request.method === 'PATCH') return updateTrack(context);
  if (context.request.method === 'DELETE') return deleteTrack(context);
  return methodNotAllowed(['PATCH', 'DELETE']);
}
