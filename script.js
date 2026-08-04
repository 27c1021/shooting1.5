"use strict";

import {
  connectToFirebase,
  describeError
} from "./shared/firebase.js";

import {
  generateRoomCode,
  buildPhoneUrl
} from "./shared/room-code.js";


// =============================================================
// 2人用 ジャングルバルーンシューティング（PC側）
//
// 今回の改造ポイント：
// ・PLAYER 1 / PLAYER 2 はそれぞれ完全に独立して遊べる
//   （相手の接続やスタート状況を待つ必要はありません）
// ・スタートは「STARTのまと」をねらって発射することで開始する
//   （マウスクリックやタップでのスタートは廃止）
// ・金の風船は廃止。残った風船はすべて1個10点
// ・風船を割ると、ドロップアイテムを入手できることがある
// =============================================================



const GAME_TIME = 20;
const START_BALLOON_COUNT_PER_SIDE = 3;
const LAST_BALLOON_COUNT_PER_SIDE = 4;
const ADD_BALLOON_AT_SECONDS = 10;
const BALLOON_WIDTH = 170;
const BALLOON_HEIGHT = 230;
const TOP_MARGIN = 125;
const SIDE_MARGIN = 18;

// 結果発表からスタートのまとに戻るまでの待ち時間
const RESULT_DISPLAY_MS = 450000;

const normalBalloons = [
  { image: "images/redballoon.png", points: 10 },
  { image: "images/blueballoon.png", points: 10 },
  { image: "images/yellowballoon.png", points: 10 }
];

// ==============================================================
// ドロップアイテム設定
//
// ・最初に割った風船では、必ず GUARANTEED_FIRST_ITEM_ID のアイテムが
//   ドロップする（今回は "clothes"）
// ・2個目以降は、まだ手に入れていないアイテムの中からランダムに
//   1種類、40%の確率でドロップする
// ・各アイテムは1プレイにつき1回しかドロップしない
//
// 今後アイテムが増える場合は、この配列に追加するだけでOKです。
// ==============================================================
const DROP_ITEMS = [
  { id: "clothes", image: "images/clothes.png", name: "探検服" },
  { id: "cap", image: "images/cap.png", name: "探検帽" },
  { id: "compass", image: "images/compass.png", name: "コンパス" },
  { id: "glass", image: "images/glass.png", name: "虫めがね" },
  { id: "map", image: "images/map.png", name: "たからの地図" },
  { id: "pickaxe", image: "images/pickaxe.png", name: "つるはし" }
];
const GUARANTEED_FIRST_ITEM_ID = "clothes";
const OTHER_ITEM_DROP_RATE = 0.4;

const sounds = {
  shot: new Audio("sound/shot.mp3"),
  hit: new Audio("sound/hit.mp3"),
  miss: new Audio("sound/miss.mp3"),
  clear: new Audio("sound/clear.mp3")
};

const game = document.getElementById("game");
const firebaseStatus = document.getElementById("firebaseStatus");
const regenerateButton = document.getElementById("regenerateRoomButton");
const pageWarning = document.getElementById("pageWarning");

const players = [1, 2].map((number) => ({
  number,
  roomId: "",
  connected: false,
  state: "connecting", // connecting -> waiting-start -> countdown -> playing -> ended -> waiting-start ...
  score: 0,
  aimX: 0.5,
  aimY: 0.5,
  screenX: 0,
  screenY: 0,
  lastFireCounter: null,
  balloons: [],
  balloonsPopped: 0,
  droppedItemIds: new Set(),
  timer: null,
  remainingTime: GAME_TIME,
  extraBalloonAdded: false,
  side: document.getElementById(`player${number}Side`),
  balloonArea: document.getElementById(`balloonArea${number}`),
  itemArea: document.getElementById(`itemArea${number}`),
  scope: document.getElementById(`scope${number}`),
  flash: document.getElementById(`shotFlash${number}`),
  scoreElement: document.getElementById(`score${number}`),
  timeElement: document.getElementById(`time${number}`),
  hintElement: document.getElementById(`hint${number}`),
  countdownElement: document.getElementById(`countdown${number}`),
  resultOverlay: document.getElementById(`resultOverlay${number}`),
  message: document.getElementById(`message${number}`),
  startTarget: document.getElementById(`startTarget${number}`),
  qrElement: document.getElementById(`qrCode${number}`),
  codeElement: document.getElementById(`roomCode${number}`),
  connectElement: document.getElementById(`connect${number}`)
}));

let firebase = null;




function renderQrCode(container, text) {
  container.innerHTML = "";
  try {
    if (typeof window.qrcode !== "function") {
      throw new Error("QRライブラリ未読込");
    }
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    container.innerHTML = qr.createImgTag(5, 4);
    const image = container.querySelector("img");
    if (image) image.alt = "スマホ接続用QRコード";
  } catch (error) {
    const fallback = document.createElement("div");
    fallback.className = "qrError";
    fallback.textContent = "QRを表示できません。下の接続コードを入力してください。";
    container.appendChild(fallback);
    console.error(error);
  }
}

function makeRooms() {
  const room1 = generateRoomCode();
  let room2 = generateRoomCode();
  while (room2 === room1) room2 = generateRoomCode();

  players[0].roomId = room1;
  players[1].roomId = room2;

  players.forEach((player) => {
    player.codeElement.textContent = player.roomId;
    const phoneUrl = new URL(buildPhoneUrl(player.roomId));
    phoneUrl.searchParams.set("player", String(player.number));

    renderQrCode(
      player.qrElement,
      phoneUrl.toString()
    );
  });
}

function showPageWarning() {
  if (location.protocol === "file:") {
    pageWarning.hidden = false;
    pageWarning.textContent =
      "QRと接続コードの確認はできますが、スマホ接続とジャイロ操作にはGitHub PagesなどのHTTPS公開が必要です。";
  }
}

// =============================================================
// プレイヤーの状態切り替え
//
// state-* クラスをその側の画面(playerSide)に付け替えることで、
// スタートのまと／照準／のこり時間／案内文などの表示・非表示を
// CSS側にまとめてコントロールしています。
// =============================================================
function setPlayerState(player, newState) {
  player.side.classList.remove(
    "state-connecting",
    "state-waiting-start",
    "state-countdown",
    "state-playing",
    "state-ended"
  );
  player.side.classList.add(`state-${newState}`);
  player.state = newState;

  if (newState === "waiting-start") {
    player.hintElement.textContent = "STARTのまとをねらって発射しよう！";
  } else if (newState === "playing") {
    player.hintElement.textContent = "風船をねらって発射しよう！";
  } else {
    player.hintElement.textContent = "";
  }
}

function updateConnectionView(player) {
  player.connectElement.textContent = player.connected
    ? "スマホ接続済み"
    : "スマホ接続待ち";
  player.connectElement.classList.toggle("connected", player.connected);

  if (player.connected) {
    if (player.state === "connecting") {
      setPlayerState(player, "waiting-start");
    }
  } else if (player.state !== "connecting") {
    // 接続が切れたら、その側だけ最初の接続待ちからやり直す
    clearInterval(player.timer);
    player.timer = null;
    removeAllBalloonsForPlayer(player);
    setPlayerState(player, "connecting");
  }
}

function listenToPlayer(player) {
  const roomPath = `rooms/${player.roomId}`;

  firebase.onValue(
    firebase.ref(firebase.database, `${roomPath}/phoneConnected`),
    (snapshot) => {
      player.connected = snapshot.val() === true;
      updateConnectionView(player);
    }
  );

  firebase.onValue(
    firebase.ref(firebase.database, `${roomPath}/aim`),
    (snapshot) => {
      const value = snapshot.val();
      if (!value || typeof value.x !== "number" || typeof value.y !== "number") return;
      player.aimX = Math.max(0, Math.min(1, value.x));
      player.aimY = Math.max(0, Math.min(1, value.y));
      player.scope.classList.add("detected");
    }
  );

  firebase.onValue(
    firebase.ref(firebase.database, `${roomPath}/fireCounter`),
    (snapshot) => {
      const value = Number(snapshot.val()) || 0;
      if (player.lastFireCounter === null) {
        player.lastFireCounter = value;
        return;
      }
      if (value !== player.lastFireCounter) {
        player.lastFireCounter = value;
        handleFire(player);
      }
    }
  );
}

async function initializeFirebase() {
  try {
    firebase = await connectToFirebase();
    firebaseStatus.textContent = "Firebase接続完了";
    players.forEach(listenToPlayer);
  } catch (error) {
    firebaseStatus.textContent = `Firebase接続エラー：${describeError(error)}`;
    console.error(error);
  }
}

function updateScopePositions() {
  const halfWidth = window.innerWidth / 2;
  players.forEach((player) => {
    player.screenX = (player.number === 1 ? 0 : halfWidth) + player.aimX * halfWidth;
    player.screenY = player.aimY * window.innerHeight;
    player.scope.style.left = `${player.aimX * 100}%`;
    player.scope.style.top = `${player.aimY * 100}%`;
  });
  requestAnimationFrame(updateScopePositions);
}

function playSound(audio, volume = 0.6) {
  const copy = audio.cloneNode();
  copy.volume = volume;
  copy.play().catch(() => {});
}

function chooseBalloonData() {
  return normalBalloons[Math.floor(Math.random() * normalBalloons.length)];
}

function placeBalloon(player, balloon) {
  const width = player.side.clientWidth;
  const height = player.side.clientHeight;
  const maxX = Math.max(1, width - BALLOON_WIDTH - SIDE_MARGIN * 2);
  const maxY = Math.max(1, height - BALLOON_HEIGHT - TOP_MARGIN - 45);
  balloon.style.left = `${SIDE_MARGIN + Math.random() * maxX}px`;
  balloon.style.top = `${TOP_MARGIN + Math.random() * maxY}px`;
}

function createBalloon(player) {
  const data = chooseBalloonData();
  const balloon = document.createElement("img");
  balloon.className = "balloon";
  balloon.src = data.image;
  balloon.alt = "風船";
  balloon.dataset.points = String(data.points);
  placeBalloon(player, balloon);
  player.balloonArea.appendChild(balloon);
  player.balloons.push(balloon);
}

function setBalloonCount(player, count) {
  while (player.balloons.length < count) createBalloon(player);
  while (player.balloons.length > count) {
    const balloon = player.balloons.pop();
    balloon.remove();
  }
}

function removeAllBalloonsForPlayer(player) {
  player.balloons.forEach((balloon) => balloon.remove());
  player.balloons = [];
}

// 円形／楕円形の的に、照準(px,py)が重なっているかどうかを調べる
function isAimInsideEllipse(px, py, rect, xRadiusFactor, yRadiusFactor, centerYFactor) {
  if (rect.width === 0 && rect.height === 0) return false;
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * centerYFactor;
  const normalizedX = (px - centerX) / (rect.width * xRadiusFactor);
  const normalizedY = (py - centerY) / (rect.height * yRadiusFactor);
  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

function findHitBalloon(player) {
  for (let i = player.balloons.length - 1; i >= 0; i -= 1) {
    const balloon = player.balloons[i];
    const rect = balloon.getBoundingClientRect();
    if (isAimInsideEllipse(player.screenX, player.screenY, rect, 0.27, 0.29, 0.30)) {
      return balloon;
    }
  }
  return null;
}

function isStartTargetHit(player) {
  const rect = player.startTarget.getBoundingClientRect();
  return isAimInsideEllipse(player.screenX, player.screenY, rect, 0.48, 0.48, 0.5);
}

function showShotFlash(player) {
  player.flash.style.left = `${player.aimX * 100}%`;
  player.flash.style.top = `${player.aimY * 100}%`;
  player.flash.classList.remove("show");
  void player.flash.offsetWidth;
  player.flash.classList.add("show");
}

// =============================================================
// 発射を受け取ったときの振り分け
//
// ・スタート待ち：STARTのまとに当たったらゲーム開始
// ・プレイ中　　：風船を狙って撃つ（今まで通り）
// ・それ以外　　：カウントダウン中・結果表示中は発射を無視
// =============================================================
function handleFire(player) {
  if (!player.connected) return;

  if (player.state === "waiting-start") {
    attemptStartShot(player);
  } else if (player.state === "playing") {
    shoot(player);
  }
}

function attemptStartShot(player) {
  playSound(sounds.shot, 0.42);
  showShotFlash(player);

  if (isStartTargetHit(player)) {
    playSound(sounds.hit, 0.55);
    startGameForPlayer(player);
  } else {
    playSound(sounds.miss, 0.5);
  }
}

// =============================================================
// ドロップアイテム処理
// =============================================================
function decideDroppedItem(player) {
  player.balloonsPopped += 1;

  if (player.balloonsPopped === 1) {
    // 最初の1個目は必ず指定アイテムがドロップ
    return DROP_ITEMS.find((item) => item.id === GUARANTEED_FIRST_ITEM_ID) || null;
  }

  const remainingItems = DROP_ITEMS.filter((item) => !player.droppedItemIds.has(item.id));
  if (remainingItems.length === 0) return null;
  if (Math.random() >= OTHER_ITEM_DROP_RATE) return null;

  return remainingItems[Math.floor(Math.random() * remainingItems.length)];
}

function spawnItemDrop(player, item, originRect) {
  const sideRect = player.side.getBoundingClientRect();
  const wrapper = document.createElement("div");
  wrapper.className = "dropItemPop";
  wrapper.style.left = `${originRect.left - sideRect.left + originRect.width / 2}px`;
  wrapper.style.top = `${originRect.top - sideRect.top + originRect.height * 0.35}px`;
  wrapper.innerHTML =
    `<img src="${item.image}" alt="${item.name}" class="dropItemImage">` +
    `<span class="dropItemLabel">GET！${item.name}</span>`;
  player.itemArea.appendChild(wrapper);
  setTimeout(() => wrapper.remove(), 2000);
}

function handleItemDrop(player, originRect) {
  const item = decideDroppedItem(player);
  if (!item || player.droppedItemIds.has(item.id)) return;
  player.droppedItemIds.add(item.id);
  spawnItemDrop(player, item, originRect);
}

function shoot(player) {
  playSound(sounds.shot, 0.42);
  showShotFlash(player);
  const balloon = findHitBalloon(player);

  if (!balloon) {
    playSound(sounds.miss, 0.5);
    return;
  }

  playSound(sounds.hit, 0.68);
  const points = Number(balloon.dataset.points) || 10;
  player.score += points;
  player.scoreElement.textContent = String(player.score);
  player.scoreElement.classList.remove("bump");
  void player.scoreElement.offsetWidth;
  player.scoreElement.classList.add("bump");

  const rect = balloon.getBoundingClientRect();
  const sideRect = player.side.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.className = "scorePopup";
  popup.textContent = `+${points}`;
  popup.style.left = `${rect.left - sideRect.left + rect.width / 2}px`;
  popup.style.top = `${rect.top + rect.height * 0.3}px`;
  player.side.appendChild(popup);
  setTimeout(() => popup.remove(), 750);

  handleItemDrop(player, rect);

  player.balloons = player.balloons.filter((item) => item !== balloon);
  balloon.classList.add("hit");
  balloon.style.transform = `translate(${(Math.random() - 0.5) * 360}px, -380px) rotate(${Math.random() * 700}deg) scale(0.3)`;

  setTimeout(() => {
    balloon.remove();
    if (player.state === "playing") createBalloon(player);
  }, 480);
}

function showCountdownText(element, text) {
  return new Promise((resolve) => {
    element.textContent = text;
    setTimeout(() => {
      element.textContent = "";
      resolve();
    }, 700);
  });
}

// =============================================================
// プレイヤーごとに独立したゲーム開始／終了処理
// =============================================================
async function startGameForPlayer(player) {
  if (player.state === "countdown" || player.state === "playing") return;

  setPlayerState(player, "countdown");
  player.resultOverlay.classList.remove("show");
  player.message.classList.remove("show");

  player.score = 0;
  player.scoreElement.textContent = "0";
  player.balloonsPopped = 0;
  player.droppedItemIds = new Set();
  player.itemArea.innerHTML = "";

  player.remainingTime = GAME_TIME;
  player.timeElement.textContent = String(player.remainingTime);
  player.timeElement.classList.remove("danger");
  player.extraBalloonAdded = false;
  removeAllBalloonsForPlayer(player);

  await showCountdownText(player.countdownElement, "3");
  await showCountdownText(player.countdownElement, "2");
  await showCountdownText(player.countdownElement, "1");
  await showCountdownText(player.countdownElement, "GO!");

  // カウントダウン中に接続が切れていたら開始しない
  if (!player.connected) {
    setPlayerState(player, "connecting");
    return;
  }

  setPlayerState(player, "playing");
  setBalloonCount(player, START_BALLOON_COUNT_PER_SIDE);

  player.timer = setInterval(() => {
    player.remainingTime -= 1;
    player.timeElement.textContent = String(player.remainingTime);
    if (player.remainingTime <= 5) player.timeElement.classList.add("danger");

    if (!player.extraBalloonAdded && player.remainingTime <= ADD_BALLOON_AT_SECONDS) {
      player.extraBalloonAdded = true;
      setBalloonCount(player, LAST_BALLOON_COUNT_PER_SIDE);
    }

    if (player.remainingTime <= 0) endGameForPlayer(player);
  }, 1000);
}

function buildItemSummaryHtml(player) {
  const collectedIcons = DROP_ITEMS
    .filter((item) => player.droppedItemIds.has(item.id))
    .map(
      (item) =>
        `<img src="${item.image}" alt="${item.name}" title="${item.name}" class="itemIcon">`
    )
    .join("");

  return (
    `<div class="itemSummary">` +
    `アイテム ${player.droppedItemIds.size} / ${DROP_ITEMS.length} 種類ゲット！` +
    `<div class="itemIconRow">${collectedIcons}</div>` +
    `</div>`
  );
}

function endGameForPlayer(player) {
  if (player.state !== "playing") return;

  clearInterval(player.timer);
  player.timer = null;
  playSound(sounds.clear, 0.72);
  removeAllBalloonsForPlayer(player);
  setPlayerState(player, "ended");

  player.resultOverlay.classList.add("show");
  player.message.innerHTML =
    `ゲームしゅうりょう！<br>` +
    `スコア：${player.score} 点<br>` +
    buildItemSummaryHtml(player) +
    `<small>もう一度あそぶときは、STARTのまとをねらって発射！</small>`;
  player.message.classList.add("show");

  setTimeout(() => {
    player.resultOverlay.classList.remove("show");
    player.message.classList.remove("show");
    if (player.connected) {
      setPlayerState(player, "waiting-start");
    } else {
      setPlayerState(player, "connecting");
    }
  }, RESULT_DISPLAY_MS);
}

regenerateButton.addEventListener("click", () => {
  window.location.reload();
});

window.addEventListener("resize", () => {
  setTimeout(() => {
    players.forEach((player) =>
      player.balloons.forEach((balloon) => placeBalloon(player, balloon))
    );
  }, 50);
});

// QRと接続コードを最優先で表示する。
makeRooms();
showPageWarning();
players.forEach((player) => setPlayerState(player, "connecting"));
updateScopePositions();
initializeFirebase();
