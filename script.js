document.addEventListener('DOMContentLoaded', () => {
  const MORSE_CODE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.',
    F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
    K: '-.-', L: '.-..', M: '--', N: '-.', O: '---',
    P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
    U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--',
    Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
    5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.'
  };

  const REVERSE_MORSE = Object.fromEntries(Object.entries(MORSE_CODE).map(([k, v]) => [v, k]));

  const UNIT = 60000 / 10 / 50;
  const DOT = UNIT;
  const DASH = UNIT * 3;
  const SPACE = UNIT;
  const LETTER_SPACE = UNIT * 3;
  const WORD_SPACE = UNIT * 7;
  const HIST_SIZE = 4;

  let track;
  let detecting = false;
  let decodedText = '';
  const lightDurations = [];
  const darkDurations = [];
  let brightnessThreshold = 200;

  async function initCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = document.getElementById('video');
    video.srcObject = stream;
    track = stream.getVideoTracks()[0];
    video.onloadedmetadata = () => {
      video.play();
      startLightDetection(video);
    };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function blinkMorse(text) {
    text = text.toUpperCase();
    for (const char of text) {
      if (char === ' ') {
        await sleep(WORD_SPACE);
        continue;
      }
      const code = MORSE_CODE[char];
      if (!code) continue;

      for (let j = 0; j < code.length; j++) {
        const signal = code[j];
        await track.applyConstraints({ advanced: [{ torch: true }] });
        await sleep(signal === '.' ? DOT : DASH);
        await track.applyConstraints({ advanced: [{ torch: false }] });
        if (j < code.length - 1) await sleep(SPACE);
      }
      await sleep(LETTER_SPACE);
    }
  }

  document.getElementById('sendBtn').addEventListener('click', async () => {
    const input = document.getElementById('input').value;
    if (!/^[a-zA-Z0-9 ]+$/.test(input)) {
      alert('英数字のみ入力してください');
      return;
    }
    await blinkMorse(input);
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    document.getElementById('output').textContent = '受信結果: ';
    decodedText = '';
    lightDurations.length = 0;
    darkDurations.length = 0;
  });

  document.getElementById('thresholdSlider').addEventListener('input', (e) => {
    brightnessThreshold = parseInt(e.target.value, 10);
    document.getElementById('thresholdValue').textContent = brightnessThreshold;
  });

  function startLightDetection(video) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const overlay = document.getElementById('overlay');
    const overlayCtx = overlay.getContext('2d');
    const brightnessHistory = [];
    const timelineCanvas = document.getElementById('brightnessTimeline');
    const timelineCtx = timelineCanvas.getContext('2d');

    let lastSignal = null;
    let lastChangeTime = Date.now();
    let currentDuration = 0;

    function detectLoop() {
      if (!detecting) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const centerX = Math.floor(canvas.width / 2 - 64);
      const centerY = Math.floor(canvas.height / 2 - 64);
      const imageData = ctx.getImageData(centerX, centerY, 128, 128);

      let brightness = 0;
      for (let i = 0; i < imageData.data.length; i += 4) {
        brightness += imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2];
      }
      const avgBrightness = brightness / (imageData.data.length / 4);

      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      overlayCtx.strokeStyle = 'red';
      overlayCtx.lineWidth = 2;
      overlayCtx.strokeRect(centerX, centerY, 128, 128);

      const now = Date.now();
      const isLight = avgBrightness > brightnessThreshold;

      brightnessHistory.push(isLight ? 1 : 0);
      if (brightnessHistory.length > 300) brightnessHistory.shift();

      timelineCtx.clearRect(0, 0, timelineCanvas.width, timelineCanvas.height);
      for (let i = 0; i < brightnessHistory.length; i++) {
        timelineCtx.fillStyle = brightnessHistory[i] ? '#fff' : '#000';
        timelineCtx.fillRect(i, 0, 1, timelineCanvas.height);
      }

      if (lastSignal !== null && isLight !== lastSignal) {
        const duration = now - lastChangeTime;
        
        if (lastSignal) {
          if (duration <= WORD_SPACE) lightDurations.push(currentDuration);
        } else {
          if (duration <= WORD_SPACE) darkDurations.push(currentDuration);
        }

        currentDuration = 0;
        lastChangeTime = now;
      }

      currentDuration += 10;
      lastSignal = isLight;

      updateHistogram();
      document.getElementById('output').textContent = '受信結果: ' + decodedText;
      requestAnimationFrame(detectLoop);
    }

    function updateHistogram() {
      const lightHistogram = new Array(300).fill(0);
      lightDurations.forEach(duration => {
        if (duration <= WORD_SPACE) {
          const index = Math.floor(duration / 10);
          if (index < lightHistogram.length) lightHistogram[index]++;
        }
      });

      const darkHistogram = new Array(300).fill(0);
      darkDurations.forEach(duration => {
        if (duration <= WORD_SPACE) {
          const index = Math.floor(duration / 10);
          if (index < darkHistogram.length) darkHistogram[index]++;
        }
      });

      const histogramCanvas = document.getElementById('histogramCanvas');
      const histogramCtx = histogramCanvas.getContext('2d');
      histogramCtx.clearRect(0, 0, histogramCanvas.width, histogramCanvas.height);

      histogramCtx.fillStyle = '#ff0000';
      lightHistogram.forEach((count, index) => {
        if (count > 0) {
          histogramCtx.fillRect(index * 2 * HIST_SIZE, histogramCanvas.height - count * HIST_SIZE, 2 * HIST_SIZE, count * HIST_SIZE);
        }
      });

      histogramCtx.fillStyle = '#0000ff';
      darkHistogram.forEach((count, index) => {
        if (count > 0) {
          histogramCtx.fillRect(index * 2 * HIST_SIZE, histogramCanvas.height - count * HIST_SIZE, 2 * HIST_SIZE, count * HIST_SIZE);
        }
      });
    }

    detecting = true;
    detectLoop();
  }

  initCamera();
});
