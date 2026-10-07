import { analyzeAudio } from './engine.js';
self.onmessage = ({ data }) => {
  try {
    const result = analyzeAudio(data.samples, data.sampleRate);
    self.postMessage({ id: data.id, result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message || '박자 분석에 실패했습니다.' });
  }
};
