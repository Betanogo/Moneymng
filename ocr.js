/* ============================================================
 * ocr.js — OCR 추상화 레이어
 * 나중에 Capacitor + ML Kit로 갈아탈 때 이 파일만 교체하면 됨.
 * 계약(반드시 유지):
 *   OCR.recognizeText(imageBlob, onProgress) -> Promise<{
 *     words: [{ text, x, y, w, h }],   // 좌상단 기준 픽셀 좌표
 *     width, height                    // 처리된 이미지 크기
 *   }>
 * ============================================================ */

const OCR = (() => {
  let workerPromise = null;
  let progressCb = null; // 현재 인식 작업의 진행률 콜백

  function getWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker("eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text" && progressCb) {
            progressCb(m.progress);
          }
        },
      });
    }
    return workerPromise;
  }

  /* 영수증 사진 전처리: 축소 + 그레이스케일 + 대비 강화.
     열전사 영수증의 흐린 글씨 인식률을 올려준다. */
  async function preprocess(blob) {
    const bmp = await createImageBitmap(blob);
    const maxW = 1400;
    const scale = Math.min(1, maxW / bmp.width);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      g = (g - 128) * 1.35 + 128; // 대비 강화
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
    return { canvas, width: w, height: h };
  }

  async function recognizeText(blob, onProgress) {
    const { canvas, width, height } = await preprocess(blob);
    const worker = await getWorker();
    progressCb = onProgress || null;
    try {
      const { data } = await worker.recognize(canvas);
      const words = (data.words || [])
        .filter((w) => w.text && w.text.trim())
        .map((w) => ({
          text: w.text.trim(),
          x: w.bbox.x0,
          y: w.bbox.y0,
          w: w.bbox.x1 - w.bbox.x0,
          h: w.bbox.y1 - w.bbox.y0,
        }));
      return { words, width, height };
    } finally {
      progressCb = null;
    }
  }

  return { recognizeText };
})();
