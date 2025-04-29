// main.js
// モールス信号送受信アプリ - リファクタ済み・コメント付き

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
const thresholdSlider = document.getElementById("thresholdSlider");
const thresholdValue = document.getElementById("thresholdValue");
const brightnessTimeline = document.getElementById("brightnessTimeline");
const histogramCanvas = document.getElementById("histogramCanvas");
const ctxTimeline = brightnessTimeline.getContext("2d");
const ctxHistogram = histogramCanvas.getContext("2d");

// 初期設定
let brightnessHistory = [];
let decodedText = "";
let threshold = parseInt(thresholdSlider.value, 10);
let capturing = true;

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

// カメラの起動
navigator.mediaDevices.getUserMedia({ video: true })
  .then(stream => {
    video.srcObject = stream;
  })
  .catch(error => {
    console.error("カメラの起動に失敗:", error);
  });

// ヒストグラム描画（以前の表示方法に戻す）
function drawHistogram(data) {
  ctxHistogram.clearRect(0, 0, histogramCanvas.width, histogramCanvas.height);
  ctxHistogram.fillStyle = "gray";
  const binWidth = histogramCanvas.width / data.length;
  data.forEach((val, i) => {
    ctxHistogram.fillRect(i * binWidth, histogramCanvas.height - val, binWidth, val);
  });
}

// タイムライン描画（以前の表示方法に戻す）
function drawTimeline() {
  ctxTimeline.clearRect(0, 0, brightnessTimeline.width, brightnessTimeline.height);
  ctxTimeline.beginPath();
  ctxTimeline.strokeStyle = "lime";
  ctxTimeline.lineWidth = 1;
  for (let i = 0; i < brightnessHistory.length; i++) {
    const y = brightnessTimeline.height - (brightnessHistory[i] / 255) * brightnessTimeline.height;
    ctxTimeline.lineTo(i, y);
  }
  ctxTimeline.stroke();
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
  const imageData = ctxOverlay.getImageData(0, 0, width, height);

  // 明るさ計算
  let brightnessSum = 0;
  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    brightnessSum += brightness;
  }
  const avgBrightness = brightnessSum / (imageData.data.length / 4);

  // タイムラインデータ更新
  brightnessHistory.push(avgBrightness);
  if (brightnessHistory.length > brightnessTimeline.width) {
    brightnessHistory.shift();
  }
  drawTimeline();

  // ヒストグラム更新
  const histogramBins = new Array(256).fill(0);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const brightness = Math.floor(0.299 * imageData.data[i] + 0.587 * imageData.data[i + 1] + 0.114 * imageData.data[i + 2]);
    histogramBins[brightness]++;
  }
  const maxVal = Math.max(...histogramBins);
  const scaledBins = histogramBins.map(v => (v / maxVal) * histogramCanvas.height);
  drawHistogram(scaledBins);

  // しきい値による判定（例: 点灯しているか）
  if (avgBrightness > threshold) {
    decodedText += "."; // 明るい → 点
  } else {
    decodedText += " "; // 暗い → 区切り
  }
  output.textContent = `受信結果: ${decodedText.trim()}`;
}

// イベントリスナー
thresholdSlider.addEventListener("input", () => {
  threshold = parseInt(thresholdSlider.value, 10);
  thresholdValue.textContent = threshold;
});

clearBtn.addEventListener("click", () => {
  decodedText = "";
  output.textContent = "受信結果: ";
});

// モールス信号をLEDで点滅表示（オーバーレイ）
function flashMorseCode(morse) {
  let i = 0;
  const unit = 200; // 基本単位（ms）

  function next() {
    if (i >= morse.length) {
      ctxOverlay.clearRect(0, 0, overlay.width, overlay.height);
      return;
    }
    const symbol = morse[i];
    ctxOverlay.clearRect(0, 0, overlay.width, overlay.height);
    if (symbol === "." || symbol === "-") {
      ctxOverlay.fillStyle = "white";
      ctxOverlay.fillRect(0, 0, overlay.width, overlay.height);
    }
    const delay = symbol === "." ? unit : symbol === "-" ? unit * 3 : unit;
    i++;
    setTimeout(() => {
      ctxOverlay.clearRect(0, 0, overlay.width, overlay.height);
      setTimeout(next, unit); // 次の記号へ（間隔）
    }, delay);
  }
  next();
}

sendBtn.addEventListener("click", () => {
  const text = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  console.log("送信:", text);
  // テキストをモールス信号に変換
  const morse = text.split("").map(char => morseCodeMap[char] || "").join(" ");
  flashMorseCode(morse);
});

// フレーム更新ループ
function loop() {
  processFrame();
  requestAnimationFrame(loop);
}
loop();
