// main.js
// モールス信号送受信アプリ - リファクタ済み・コメント付き

// ▼ バージョン番号をここで管理
const APP_VERSION = "0.1.8";

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
const ctxOverlay = overlay.getContext("2d", {willReadFrequently: true});
const input = document.getElementById("input");
const sendLightBtn = document.getElementById("sendLightBtn");
const sendSpeakerBtn = document.getElementById("sendSpeakerBtn");
const sendStopBtn = document.getElementById("sendStopBtn");
const sendMorseTimeline = document.getElementById("sendMorseTimeline");
const ctxSendMorseTimeline = sendMorseTimeline.getContext("2d");
const receiveMorseTimeline = document.getElementById("receiveMorseTimeline");
const ctxReceiveMorseTimeline = receiveMorseTimeline.getContext("2d");
const clearBtn = document.getElementById("clearBtn");
const output = document.getElementById("output");
const brightnessLevelSlider = document.getElementById("brightnessLevelSlider");
const brightnessLevelValue = document.getElementById("brightnessLevelValue");
const brightnessGainSlider = document.getElementById("brightnessGainSlider");
const brightnessGainlValue = document.getElementById("brightnessGainValue");
const brightnessLevel = document.getElementById("brightnessLevel");
const ctxBrightnessLevel = brightnessLevel.getContext("2d");
const brightnessHistogram = document.getElementById("brightnessHistogram");
const frequencySpectrum = document.getElementById("frequencySpectrum");
const durationHistogram = document.getElementById("durationHistogram");
const ctxBrightnessHistogram = brightnessHistogram.getContext("2d");
const ctxFrequencySpectrum = frequencySpectrum.getContext("2d");
const ctxDurationHistogram = durationHistogram.getContext("2d");
const durationSlider = document.getElementById("durationSlider");
const durationValue = document.getElementById("durationValue");

// メディアコントローラー
let Video = null;
let Audio = null;

// 初期設定
let noVideoDebug = false;
let sendMorseHistory = [];
let receiveMorseHistory = [];
let brightnessLevelThreshold = 10;
let brightnessGain = 220;
const brightnessRange = {
  min: 0,
  max: 100,
  last: undefined,
};
let morseText = "";
let decodedText = "";
let capturing = true;

let audioVolume = 0.3
let audioTone = 880;
let audioRxFrequency = 880;

let signalHistory = [];
let lastSignal = null;
let lastChangeTime = Date.now();

let lightDurations = [];
let darkDurations = [];

let dotDuration = 230;

// UIに反映
brightnessLevelSlider.value = brightnessLevelThreshold;
brightnessLevelValue.textContent = brightnessLevelThreshold;
brightnessGainSlider.value = brightnessGain;
brightnessGainValue.textContent = brightnessGain;
frequencySlider.value = audioRxFrequency;
frequencyValue.textContent = audioRxFrequency;
durationSlider.value = dotDuration;
durationValue.textContent = dotDuration;

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

// カメラの起動
async function initVideo(videoElement) {
  let video = null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    videoElement.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    videoElement.onloadedmetadata = () => {
      videoElement.play();
    };
    video = {track};
  } catch (error) {
    console.error("カメラの起動に失敗:", error);
  }
  return video;
}

// オーディオの起動
async function initAudio() {
  let audio = null;
  try {
    // マイクにアクセス
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const source = context.createMediaStreamSource(stream);

    // AnalyserNodeを作成
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024; // FFTのサイズ（周波数分解能に影響）

    source.connect(analyser);
    audio = {context, analyser};
  } catch (error) {
    console.error("オーディオの起動に失敗:", error);
  }
  return audio;
}

// sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// モールス信号停止フラグ
let isStopMorse = false;

let stateSendMorse = false;

// モールス信号を送信
async function sendMorse(text, control, wpm=10) {
  const UNIT = 60000 / wpm / 50;
  const DOT = UNIT;
  const DASH = UNIT * 3;
  const SPACE = UNIT;
  const LETTER_SPACE = UNIT * 3;
  const WORD_SPACE = UNIT * 7;

  text = text.toUpperCase().replace(/\s+/g, " ").replace(/[^A-Z0-9 ]/g, "");
  console.log("送信:", text);

  isStopMorse = false;
  for (let i = 0; (i < text.length) && !isStopMorse; i++) {
    const char = text[i];
    if (char === ' ') {
      await sleep(WORD_SPACE);
      continue;
    }
    const code = morseCodeMap[char];
    if (!code) continue;

    for (let j = 0; (j < code.length) && !isStopMorse; j++) {
      const signal = code[j];
      stateSendMorse = true;
      await control(true);
      await sleep(signal === '.' ? DOT : DASH);
      stateSendMorse = false;
      await control(false);
      if (j < code.length - 1) await sleep(SPACE);
    }
    if (!isStopMorse) await sleep(LETTER_SPACE);
  }
}

// モールス信号を停止
function stopMorse() {
  isStopMorse = true;
  console.log("送信停止");
}

// ライト制御
const controlLight = async (on) => {
  Video.track.applyConstraints({ advanced: [{ torch: on }] });
};

// スピーカー制御
const controlSpeaker = (() => {
  let oscillator = null;
  let gainNode = null;

  return async (on) => {
    const now = Audio.context.currentTime;
    const fadeTime = 0.01; // 10ms のフェード

    if (on) {
      if (!oscillator) {
        oscillator = Audio.context.createOscillator();
        gainNode = Audio.context.createGain();
        gainNode.gain.setValueAtTime(0, now); // 最初は音量ゼロ
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(audioTone, now);
        oscillator.connect(gainNode).connect(Audio.context.destination);
        oscillator.start();

        // フェードイン
        gainNode.gain.linearRampToValueAtTime(audioVolume, now + fadeTime);
      }
    } else {
      if (oscillator && gainNode) {
        // フェードアウト → 停止
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + fadeTime);

        // stop() は少し遅らせて実行
        oscillator.stop(now + fadeTime + 0.01);
        oscillator.disconnect();
        gainNode.disconnect();
        oscillator = null;
        gainNode = null;
      }
    }
  };
})();

// ヒストグラム描画
function drawHistogram() {
  const HIST_SIZE = 4;
  const width = durationHistogram.width;
  const height = durationHistogram.height;
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
  ctxDurationHistogram.clearRect(0, 0, durationHistogram.width, durationHistogram.height);

  // しきい値
  ctxDurationHistogram.fillStyle = '#00ff00'; // 緑色
  let index = Math.floor(dotDuration / 10);
  ctxDurationHistogram.fillRect(index * HIST_SIZE, 0, HIST_SIZE, durationHistogram.height);

  // 明るい時間のヒストグラム
  ctxDurationHistogram.fillStyle = '#ff0000'; // 赤色
  lightHistogram.forEach((count, index) => {
    if (count > 0) {
      ctxDurationHistogram.fillRect(index * HIST_SIZE, durationHistogram.height/2 - count*HIST_SIZE, HIST_SIZE, count*HIST_SIZE);
    }
  });

  // 暗い時間のヒストグラム
  ctxDurationHistogram.fillStyle = '#0000ff'; // 青色
  darkHistogram.forEach((count, index) => {
    if (count > 0) {
      ctxDurationHistogram.fillRect(index * HIST_SIZE, durationHistogram.height/2, HIST_SIZE, count*HIST_SIZE);
    }
  });
}

// タイムライン描画
function drawTimeline(canvas, context, history) {
  const width = canvas.width;
  const height = canvas.height;
  const length = history.length;
  context.clearRect(0, 0, width, height);
  for (let i = 0, x = width - length; i < length; i++, x++) {
    context.fillStyle = history[i] ? '#fff' : '#000';
    context.fillRect(x, 0, 1, height);
  }
}

// レベル描画
function drawLevel(canvas, context, level, slider) {
  const width = canvas.width;
  const height = canvas.height;
  const min = slider.min;
  const max = slider.max;
  const value = slider.value;
  const xl = (level-min)/(max-min) * width;
  const xv = (value-min)/(max-min) * width;

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, xl, height);
  
  context.fillStyle = "#0f0";
  context.fillRect(xv, 0, 1, height);
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
      ctxBrightnessHistogram.fillRect(index*size, height-count*size, size, count*size);
    }
  });
}

// 周波数スペクトル描画
async function drawFrequencySpectrum() {
  if (!Audio.analyser) return;

  const width = frequencySpectrum.width;
  const height = frequencySpectrum.height;
  const length = Audio.analyser.frequencyBinCount;
  const size = width / length;

  const dataArray = new Uint8Array(length);
  Audio.analyser.getByteFrequencyData(dataArray);

  ctxFrequencySpectrum.clearRect(0, 0, width, height);

  // 受信周波数
  ctxFrequencySpectrum.fillStyle = '#00ff00'; // 緑色
  // hz = index * Audio.context.sampleRate / 2 / length;
  let index = Math.round(audioRxFrequency / (Audio.context.sampleRate / 2 / length));
  ctxFrequencySpectrum.fillRect(index * size, 0, size, height);

  // 周波数スペクトル
  dataArray.forEach((value, index) => {
    if (value > 0) {
      ctxFrequencySpectrum.fillStyle = `rgb(${value + 100}, 255, ${255 - value})`;
      ctxFrequencySpectrum.fillRect(index*size, height-value, size, value);
    }
  });
}

// フレームごとの処理
function processFrame() {
  if ((!capturing || video.readyState !== video.HAVE_ENOUGH_DATA) && !noVideoDebug) return;

  const width = noVideoDebug ? 600 : video.videoWidth;
  const height = noVideoDebug ? 480 : video.videoHeight;
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

  // 明滅データ更新
  const now = Date.now();
  if (noVideoDebug) brightnessSum = now % 100;
  const isLight = brightnessSum >= brightnessLevelThreshold;

  // 送信タイムラインデータ更新
  sendMorseHistory.push(stateSendMorse);
  if (sendMorseHistory.length > sendMorseTimeline.width) {
    sendMorseHistory.shift();
  }
  drawTimeline(sendMorseTimeline, ctxSendMorseTimeline, sendMorseHistory);

  // 受信タイムラインデータ更新
  receiveMorseHistory.push(isLight);
  if (receiveMorseHistory.length > receiveMorseTimeline.width) {
    receiveMorseHistory.shift();
  }
  drawTimeline(receiveMorseTimeline, ctxReceiveMorseTimeline, receiveMorseHistory);

  // 輝度スペクトル更新
  drawBrightnessHistogram(bdata)
  // 輝度レベル更新
  if (!brightnessRange.last || now-brightnessRange.last >= 2000) {
    brightnessLevelSlider.min = Math.floor(brightnessRange.min/10)*10;
    brightnessLevelSlider.max = Math.ceil(brightnessRange.max/10)*10;
    brightnessLevelThreshold = (brightnessLevelSlider.min + brightnessLevelSlider.max) / 2; //自動調整
    brightnessLevelValue.textContent = `${brightnessRange.max - brightnessRange.min}`;
    brightnessRange.min = brightnessSum;
    brightnessRange.max = brightnessSum;
    brightnessRange.last = now;
  } else {
    brightnessRange.min = Math.min(brightnessRange.min, brightnessSum);
    brightnessRange.max = Math.max(brightnessRange.max, brightnessSum);
  }
  drawLevel(brightnessLevel, ctxBrightnessLevel, brightnessSum, brightnessLevelSlider);

  // 周波数スペクトル更新
  drawFrequencySpectrum();

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
  output.scrollTop = output.scrollHeight;
}

// イベントリスナー
// レベルスライダー
brightnessLevelSlider.addEventListener("input", () => {
  brightnessLevelThreshold = parseInt(brightnessLevelSlider.value, 10);
  brightnessLevelValue.textContent = brightnessLevelThreshold;
});

// 感度スライダー
brightnessGainSlider.addEventListener("input", () => {
  brightnessGain = parseInt(brightnessGainSlider.value, 10);
  brightnessGainValue.textContent = brightnessGain;
});

// 周波数スライダー
frequencySlider.addEventListener("input", () => {
  audioRxFrequency = parseInt(frequencySlider.value, 10);
  frequencyValue.textContent = audioRxFrequency;
});

// 間隔スライダー
durationSlider.addEventListener("input", () => {
  dotDuration = parseInt(durationSlider.value, 10);
  durationValue.textContent = dotDuration;
});


clearBtn.addEventListener("click", () => {
  morseText = "";
  decodedText = "";
  output.value = `${decodedText.trim()}`;
  lightDurations = [];
  darkDurations = [];
});

sendLightBtn.addEventListener("click", () => {
  sendMorse(input.value, controlLight);
});

sendSpeakerBtn.addEventListener("click", () => {
  sendMorse(input.value, controlSpeaker, 20);
});

sendStopBtn.addEventListener("click", () => {
  stopMorse();
});

// フレーム更新ループ
function loop() {
  processFrame();
  requestAnimationFrame(loop);
}

// スクリーンセーバーの無効化
// https://developer.mozilla.org/ja/docs/Web/API/Screen_Wake_Lock_API
async function preventSleep() {
  if ('wakeLock' in navigator) {
    // isSupported
    try {
      const wakeLock = await navigator.wakeLock.request('screen');

      // listen for our release event
      wakeLock.onrelease = (event) => {
        console.warn(event);
      }
    } catch (err) {
      console.error(`${err.name}, ${err.message}`);
    }
  } else {
    console.error('Wake lock is not supported by this browser.');
  }
}

// TODO
// *レスポンシブデザインで縦横対応
// *設定周りを隠す
// *設定値を自動で割り当てる
// *音でやる
//  参考：Web Audio API
//        https://developer.mozilla.org/ja/docs/Web/API/Web_Audio_API

initVideo(video).then((result) => {Video = result;});
initAudio().then((result) => {Audio = result;});
preventSleep();
loop();
