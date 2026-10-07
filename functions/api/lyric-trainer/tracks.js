import { listTracks, uploadTrack, methodNotAllowed } from '../../_lib/lyric-trainer.js';
export function onRequest(context) {
  if (context.request.method === 'GET') return listTracks(context);
  if (context.request.method === 'POST') return uploadTrack(context);
  return methodNotAllowed(['GET', 'POST']);
}
