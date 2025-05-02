// main.js
// モールス信号送受信アプリ - リファクタ済み・コメント付き

// ▼ バージョン番号をここで管理
const APP_VERSION = "0.1.0";

// コンソールにバージョンを表示
console.log(`モールス信号アプリ バージョン: ${APP_VERSION}`);

// バージョン番号をHTMLに表示（該当要素がある場合）
const versionLabel = document.getElementById("versionLabel");
if (versionLabel) {
  versionLabel.textContent = `バージョン: ${APP_VERSION}`;
}

// CSSを別ファイルに分離（style.css に記述）
// index.html に以下を追加:
// <link rel="stylesheet" href="style.css">

// DOM要素の取得
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctxOverlay = overlay.getContext("2d");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const output = document.getElementById("output");
const brightnessLevelSlider = document.getElementById("brightnessLevelSlider");
const brightnessLevelValue = document.getElementById("brightnessLevelValue");
const brightnessGainSlider = document.getElementById("brightnessGainSlider");
const brightnessGainlValue = document.getElementById("brightnessGainValue");
const brightnessTimeline = document.getElementById("brightnessTimeline");
const brightnessHistogram = document.getElementById("brightnessHistogram");
const histogramCanvas = document.getElementById("histogramCanvas");
const ctxTimeline = brightnessTimeline.getContext("2d");
const ctxBrightnessHistogram = brightnessHistogram.getContext("2d");
const ctxHistogram = histogramCanvas.getContext("2d");
const dThresholdSlider = document.getElementById("dThresholdSlider");
const dThresholdValue = document.getElementById("dThresholdValue");

// 初期設定
let brightnessHistory = [];
let brightnessLevel = 50;
let brightnessGain = 200;
let morseText = "";
let decodedText = "";
let brightnessLevel = parseInt(brightnessLevelSlider.value, 10);
let capturing = true;
let videoTrack = null;

let signalHistory = [];
let lastSignal = null;
let lastChangeTime = Date.now();

let lightDurations = [];
let darkDurations = [];

let dotDuration = parseInt(dThresholdSlider.value, 10);

// モールス信号辞書（送信用）
const morseCodeMap = {
  A: ".-",    B: "-...",  C: "-.-.",  D: "-..",
  E: ".",     F: "..-.",  G: "--.",   H: "....",
  I: "..",    J: ".---",  K: "-.-",   L: ".-..",
  M: "--",    N: "-.",    O: "---",   P: ".--.",
  Q: "--.-",  R: ".-.",   S: "...",   T: "-",
  U: "..-",   V: "...-",  W: ".--",   X: "-..-",
  Y: "-.--",  Z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--",
  4: "....-", 5: ".....", 6: "-....", 7: "--...",
  8: "---..", 9: "----."
};

// モールス信号逆引き辞書（受信用）
const codeMorseMap = Object.fromEntries(Object.entries(morseCodeMap).map(([k, v]) => [v, k]));

const CPM = 10;
const UNIT = 60000 / CPM / 50;
const DOT = UNIT;
const DASH = UNIT * 3;
const SPACE = UNIT;
const LETTER_SPACE = UNIT * 3;
const WORD_SPACE = UNIT * 7;

// カメラの起動
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    videoTrack = stream.getVideoTracks()[0];
    video.onloadedmetadata = () => {
      video.play();
    };
  } catch (error) {
    console.error("カメラの起動に失敗:", error);
  }
}

// sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// モールス信号をLEDで点滅表示
async function blinkMorse(text) {
  text = text.toUpperCase();
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === ' ') {
      await sleep(WORD_SPACE);
      continue;
    }
    const code = morseCodeMap[char];
    if (!code) continue;

    for (let j = 0; j < code.length; j++) {
      const signal = code[j];
      await videoTrack.applyConstraints({ advanced: [{ torch: true }] });
      await sleep(signal === '.' ? DOT : DASH);
      await videoTrack.applyConstraints({ advanced: [{ torch: false }] });
      if (j < code.length - 1) await sleep(SPACE);
    }
    await sleep(LETTER_SPACE);
  }
}

// ヒストグラム描画
function drawHistogram() {
  const HIST_SIZE = 4;
  const width = histogramCanvas.width;
  const height = histogramCanvas.height;
  const arraySize = Math.ceil(width/HIST_SIZE);

  // 明るい時間のヒストグラム
  const lightHistogram = new Array(arraySize).fill(0);
  lightDurations.forEach(duration => {
    const index = Math.floor(duration / 10); // 10ms単位でカウント
    if (index < lightHistogram.length) {
      lightHistogram[index]++;
    }
  });

  // 暗い時間のヒストグラム
  const darkHistogram = new Array(arraySize).fill(0);
  darkDurations.forEach(duration => {
    const index = Math.floor(duration / 10); // 10ms単位でカウント
    if (index < darkHistogram.length) {
      darkHistogram[index]++;
    }
  });

  // ヒストグラムの描画
  ctxHistogram.clearRect(0, 0, histogramCanvas.width, histogramCanvas.height);

  // しきい値
  ctxHistogram.fillStyle = '#00ff00'; // 緑色
  let index = Math.floor(dotDuration / 10);
  ctxHistogram.fillRect(index * HIST_SIZE, 0, HIST_SIZE, histogramCanvas.height);

  // 明るい時間のヒストグラム
  ctxHistogram.fillStyle = '#ff0000'; // 赤色
  lightHistogram.forEach((count, index) => {
    if (count > 0) {
      ctxHistogram.fillRect(index * HIST_SIZE, histogramCanvas.height/2 - count*HIST_SIZE, HIST_SIZE, count*HIST_SIZE);
    }
  });

  // 暗い時間のヒストグラム
  ctxHistogram.fillStyle = '#0000ff'; // 青色
  darkHistogram.forEach((count, index) => {
    if (count > 0) {
      ctxHistogram.fillRect(index * HIST_SIZE, histogramCanvas.height/2, HIST_SIZE, count*HIST_SIZE);
    }
  });
}

// タイムライン描画
function drawTimeline() {
  const width = brightnessTimeline.width;
  const height = brightnessTimeline.height;
  const length = brightnessHistory.length;
  ctxTimeline.clearRect(0, 0, width, height);
  for (let i = 0, x = width - length; i < length; i++, x++) {
    ctxTimeline.fillStyle = brightnessHistory[i].isLight ? '#fff' : '#000';
    ctxTimeline.fillRect(x, 0, 1, height);

    ctxTimeline.fillStyle = "rgb(255 128 0 / 50%)";
    const h = Math.min(Math.max(0, brightnessHistory[i].val), height);
    ctxTimeline.fillRect(x, height-h, 1, h);

    ctxTimeline.fillStyle = "#0f0";
    h = brightnessLevel;
    ctxTimeline.fillRect(x, height-h, 1, 1);
  }
}

// 明度ヒストグラム描画
function drawBrightnessHistogram(bdata) {
  const width = brightnessHistogram.width;
  const height = brightnessHistogram.height;
  const length = bdata.length;
  const size = width / bdata.length;
  ctxBrightnessHistogram.clearRect(0, 0, width, height);
  // しきい値
  ctxBrightnessHistogram.fillStyle = '#00ff00'; // 緑色
  let index = brightnessGain;
  ctxBrightnessHistogram.fillRect(index * size, 0, size, height);

  // 明度ヒストグラム
  ctxBrightnessHistogram.fillStyle = '#ffaa00'; // オレンジ色
  bdata.forEach((count, index) => {
    if (count > 0) {
      ctxBrightnessHistogram.fillRect(index * size, height-count*size, size, count*size);
    }
  });
}

// フレームごとの処理
function processFrame() {
  if (!capturing || video.readyState !== video.HAVE_ENOUGH_DATA) return;

  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;

  overlay.width = width;
  overlay.height = height;
  ctxOverlay.drawImage(video, 0, 0, width, height);

  const detectSize = 64;
  const centerX = Math.floor((overlay.width - detectSize) / 2);
  const centerY = Math.floor((overlay.height - detectSize) / 2);
  const imageData = ctxOverlay.getImageData(centerX, centerY, detectSize, detectSize);

  // 明るさ判定領域の表示
  ctxOverlay.strokeStyle = 'red';
  ctxOverlay.lineWidth = 2;
  ctxOverlay.strokeRect(centerX, centerY, detectSize, detectSize);

  // 明るさ計算
  let brightnessSum = 0;
  const bdata = new Array(256).fill(0);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];
    const brightness = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    if(brightness >= brightnessGain){
      brightnessSum += 1;
    }
    bdata[brightness] += 1;
  }
  drawBrightnessHistogram(bdata)

  // 明滅データ更新
  const now = Date.now();
  const isLight = brightnessSum >= brightnessLevel;

  // タイムラインデータ更新
  brightnessHistory.push({isLight, val:brightnessSum});
  if (brightnessHistory.length > brightnessTimeline.width) {
    brightnessHistory.shift();
  }
  drawTimeline();

  // 受信解析＆間隔ヒストグラム更新
  if (lastSignal !== null) {
    const duration = now - lastChangeTime;
    if (isLight !== lastSignal) {
      // 変更があった場合
      if (lastSignal) {
        // 明るい時間が終了した時
        morseText += (duration < dotDuration) ? "." : "-";
        lightDurations.push(duration);
      } else {
        // 暗い時間が終了した時
        darkDurations.push(duration);
      }
      // 状態が変わった時間を更新
      lastChangeTime = now;
    } else if (!isLight) {
      // 暗い時間が続いたらデコード
      if ((duration > dotDuration) && (morseText.length > 0)) {
        // 文字区切り
        decodedText += codeMorseMap[morseText] ?? "?";
        morseText = "";
      }
      if ((duration > dotDuration * 3) && (decodedText.at(-1) != " ")) {
        // 単語区切り
        decodedText += " ";
      }
    } else {
      // 明るい時間が続いても何もしない
    }
  }
  lastSignal = isLight;
  drawHistogram();

  output.value = `${decodedText.trim()}`;
}

// イベントリスナー
// レベルスライダー
brightnessLevelSlider.addEventListener("input", () => {
  brightnessLevel = parseInt(brightnessLevelSlider.value, 10);
  brightnessLevelValue.textContent = brightnessLevel;
});

// 感度スライダー
brightnessGainSlider.addEventListener("input", () => {
  brightnessGain = parseInt(brightnessGainSlider.value, 10);
  brightnessGainValue.textContent = brightnessGain;
});

// 間隔スライダー
dThresholdSlider.addEventListener("input", () => {
  dotDuration = parseInt(dThresholdSlider.value, 10);
  dThresholdValue.textContent = dotDuration
});


clearBtn.addEventListener("click", () => {
  morseText = "";
  decodedText = "";
  output.value = `${decodedText.trim()}`;
  lightDurations = [];
  darkDurations = [];
});

sendBtn.addEventListener("click", () => {
  const text = input.value.toUpperCase().replace(/\s+/g, " ").replace(/[^A-Z0-9 ]/g, "");
  console.log("送信:", text);
  blinkMorse(text);
});

// フレーム更新ループ
function loop() {
  processFrame();
  requestAnimationFrame(loop);
}

initCamera();
loop();
