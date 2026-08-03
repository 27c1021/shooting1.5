"use strict";

import {
  connectToFirebase,
  describeError
} from "./shared/firebase.js";

import {
  normalizeRoomCode,
  isValidRoomCode,
  getRoomCodeFromUrl
} from "./shared/room-code.js";




// =============================================================
// スマホ側コントローラー
//
// 改造ポイント：
// ・「スタート」ボタンは廃止しました。
//   ゲームの開始は、画面(PC側)に出てくる「START」のまとを
//   この「発射」ボタンでねらい撃ちすることで行います。
// ・そのため、ここでは常時「発射」だけを送信します。
//   PC側が今スタート待ちなのか、プレイ中なのかを判断して
//   処理を振り分けます。
// =============================================================

const params = new URLSearchParams(window.location.search);
const requestedPlayer = params.get("player") || "?";
const roomFromUrl = getRoomCodeFromUrl() || "";

const roomSetup = document.getElementById("roomSetup");
const roomForm = document.getElementById("roomForm");
const roomCodeInput = document.getElementById("roomCodeInput");
const roomError = document.getElementById("roomError");
const controller = document.getElementById("controller");
const roomBadgeText = document.getElementById("roomBadgeText");
const playerText = document.getElementById("playerText");
const fireButton = document.getElementById("fireButton");
const statusText = document.getElementById("status");
const startGyroButton = document.getElementById("startGyroButton");
const recalibrateButton = document.getElementById("recalibrateButton");
const aimDot = document.getElementById("aimDot");

let roomId = "";
let firebase = null;
let connected = false;
let sendingShot = false;
let lastBeta = 0;
let lastGamma = 0;
let baseBeta = null;
let baseGamma = null;
let aimX = 0.5;
let aimY = 0.5;
let gyroActive = false;
let sendTimer = null;

playerText.textContent = `PLAYER ${requestedPlayer}`;







function activateRoom(code) {
  roomId = code;
  roomBadgeText.textContent = roomId;
  roomSetup.style.display = "none";
  controller.style.display = "flex";
  initializeFirebase();
}

if (isValidRoomCode(roomFromUrl)) {
  activateRoom(roomFromUrl);
} else {
  roomSetup.style.display = "flex";
}

roomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = normalizeRoomCode(roomCodeInput.value);
  if (!isValidRoomCode(code)) {
    roomError.textContent = "4文字のコードを入力してください";
    return;
  }
  roomError.textContent = "";
  activateRoom(code);
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = normalizeRoomCode(roomCodeInput.value);
});

function computeAim() {
  if (baseBeta === null || baseGamma === null) return;
  aimX = Math.min(1, Math.max(0, 0.5 + (lastGamma - baseGamma) / 40));
  aimY = Math.min(1, Math.max(0, 0.5 - (lastBeta - baseBeta) / 35));
}

function handleOrientation(event) {
  if (typeof event.beta === "number") lastBeta = event.beta;
  if (typeof event.gamma === "number") lastGamma = event.gamma;
  if (baseBeta === null || baseGamma === null) {
    baseBeta = lastBeta;
    baseGamma = lastGamma;
    recalibrateButton.disabled = false;
  }
  computeAim();
}

async function startGyro() {
  if (gyroActive) return;
  try {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") {
        throw new Error("モーションセンサーが許可されませんでした");
      }
    }
    window.addEventListener("deviceorientation", handleOrientation);
    gyroActive = true;
    startGyroButton.textContent = "ジャイロ有効";
    startGyroButton.disabled = true;
    statusText.textContent = connected ? "接続済み・ジャイロ有効" : "ジャイロ有効・接続中";
  } catch (error) {
    statusText.textContent = `ジャイロ起動エラー：${describeError(error)}`;
  }
}

function recalibrate() {
  baseBeta = lastBeta;
  baseGamma = lastGamma;
  aimX = 0.5;
  aimY = 0.5;
}

function renderAimDot() {
  aimDot.style.left = `${aimX * 100}%`;
  aimDot.style.top = `${aimY * 100}%`;
  requestAnimationFrame(renderAimDot);
}
renderAimDot();



function startAimSendLoop() {
  if (sendTimer) return;
  sendTimer = setInterval(() => {
    if (!connected || !firebase) return;
    firebase
      .set(firebase.ref(firebase.database, `rooms/${roomId}/aim`), {
        x: aimX,
        y: aimY,
        updatedAt: Date.now()
      })
      .catch(() => {});
  }, 60);
}

// 発射ボタン：ゲーム開始前は「STARTのまと」を狙うのに使い、
// ゲーム中は風船を狙って撃つのに使う。PC側が状況に応じて
// この発射カウンターの変化を振り分ける。
async function sendShot() {
  if (!connected || sendingShot || !firebase) return;
  sendingShot = true;
  try {
    const counterRef = firebase.ref(firebase.database, `rooms/${roomId}/fireCounter`);
    await firebase.runTransaction(counterRef, (value) => (Number(value) || 0) + 1);
    if (navigator.vibrate) navigator.vibrate(35);
  } catch (error) {
    statusText.textContent = `発射送信エラー：${describeError(error)}`;
  } finally {
    setTimeout(() => {
      sendingShot = false;
    }, 85);
  }
}

async function initializeFirebase() {
  try {
    firebase = await connectToFirebase();
    connected = true;
    fireButton.disabled = false;
    statusText.textContent = "接続済み";

    const presenceRef = firebase.ref(
      firebase.database,
      `rooms/${roomId}/phoneConnected`
    );
    firebase.onDisconnect(presenceRef).set(false);
    await firebase.set(presenceRef, true);

    startAimSendLoop();
  } catch (error) {
    statusText.textContent = `接続できません：${describeError(error)}`;
    console.error(error);
  }
}

startGyroButton.addEventListener("click", startGyro);
recalibrateButton.addEventListener("click", recalibrate);
fireButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  sendShot();
});
