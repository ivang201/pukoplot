// Генерация звуков пука в отдельном потоке — чтобы игра не подвисала
import { genFart } from './audio.js';
self.onmessage = (e) => {
  const { list, sr } = e.data;
  for (const k of list) { const d = genFart(k, sr); self.postMessage({ k, d }, [d.buffer]); }
};
