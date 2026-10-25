// camera tile — shared room version
// Looking at the screen: you spectate, nothing is captured.
// Looking away: your frames are sent to everyone else in the room.
// Your grid only ever shows other people.

import { joinRoom } from 'https://esm.run/trystero@0.26';

const video = document.getElementById('preview');
const grid = document.getElementById('grid');
const cap = document.getElementById('cap');
const ctx = cap.getContext('2d');
const dot = document.getElementById('dot');
const gazeEl = document.getElementById('gaze');
const peersEl = document.getElementById('peers');
const countEl = document.getElementById('count');
const emptyEl = document.getElementById('empty');
const colsSel = document.getElementById('cols');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const resetBtn = document.getElementById('resetBtn');

// ---------- settings ----------
const APP_ID = 'cameratile-bigdeal100x';  // keeps this piece's rooms separate from other Trystero apps
const FRAME_W = 320, FRAME_H = 240;       // size of each snap (4:3)
const SNAP_MS = 100;                      // ~10 frames per second while looking away
const JPEG_QUALITY = 0.6;
const MAX_FRAMES = 600;                   // oldest frames drop off after this
const YAW_LIMIT = 0.25;                   // lower = more sensitive to turning away

// Optional TURN relay for networks that block device-to-device traffic.
// Leave empty to use the defaults (STUN only).
const ICE_SERVERS = [];

// ---------- state ----------
let stream = null, timer = null, model = null;
let lookingAway = false, detecting = false, sending = false;
let room = null, sendFrame = null;
const frames = [];                        // { img, url, peer }
const peerLabels = new Map();             // peerId -> "P1", "P2", …
let peerCounter = 0;

// ---------- room ----------
// Everyone on the same wifi shares a public IP, so a hash of it becomes the room name.
// Add ?room=anything to the URL to force a specific room instead (good for installations).
async function getRoomId() {
  const forced = new URLSearchParams(location.search).get('room');
  if (forced) return 'manual-' + forced;
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const { ip } = await res.json();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(APP_ID + ip));
    return 'net-' + [...new Uint8Array(hash)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return 'lobby';                       // fallback if the IP lookup is blocked
  }
}

function labelFor(peerId) {
  if (!peerLabels.has(peerId)) peerLabels.set(peerId, 'P' + (++peerCounter));
  return peerLabels.get(peerId);
}

function updatePeers() {
  const n = room ? Object.keys(room.getPeers()).length : 0;
  peersEl.textContent = n === 0 ? 'alone in room' : `${n} other${n === 1 ? '' : 's'} here`;
}

async function connect() {
  const roomId = await getRoomId();
  const config = { appId: APP_ID };
  if (ICE_SERVERS.length) config.rtcConfig = { iceServers: ICE_SERVERS };
  room = joinRoom(config, roomId);

  const frameAction = room.makeAction('frame');
  sendFrame = data => frameAction.send(data);
  frameAction.onMessage = (data, { peerId }) => addFrame(data, peerId);

  room.onPeerJoin = id => { labelFor(id); updatePeers(); };
  room.onPeerLeave = () => updatePeers();
  updatePeers();
}

// ---------- gaze detection ----------
async function detect() {
  if (model && video.readyState >= 2) {
    const faces = await model.estimateFaces(video, false);
    if (faces.length === 0) {
      lookingAway = true;
    } else {
      const [rEye, lEye, nose] = faces[0].landmarks;
      const eyeMidX = (rEye[0] + lEye[0]) / 2;
      const eyeDist = Math.abs(rEye[0] - lEye[0]) || 1;
      const yaw = (nose[0] - eyeMidX) / eyeDist;
      lookingAway = Math.abs(yaw) > YAW_LIMIT;
    }
    gazeEl.textContent = lookingAway ? 'NOT LOOKING — being watched' : 'LOOKING — spectating';
    dot.classList.toggle('live', lookingAway);
  }
  requestAnimationFrame(detect);
}

// ---------- camera ----------
async function startCamera() {
  if (stream) return;
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
}

// Capture one frame and send it to everyone else. It is never added to your own grid.
async function snapAndSend() {
  if (!video.videoWidth || !sendFrame || sending) return;
  if (Object.keys(room.getPeers()).length === 0) return;  // nobody watching, nothing to send
  sending = true;

  cap.width = FRAME_W;
  cap.height = FRAME_H;
  const vw = video.videoWidth, vh = video.videoHeight;
  const target = FRAME_W / FRAME_H;
  let sw = vw, sh = vh;
  if (vw / vh > target) sw = vh * target; else sh = vw / target;
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2;

  ctx.save();
  ctx.translate(FRAME_W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, FRAME_W, FRAME_H);
  ctx.restore();

  try {
    const blob = await new Promise(r => cap.toBlob(r, 'image/jpeg', JPEG_QUALITY));
    if (blob) await sendFrame(blob);
  } finally {
    sending = false;
  }
}

// ---------- grid ----------
function addFrame(data, peerId) {
  const url = URL.createObjectURL(new Blob([data], { type: 'image/jpeg' }));
  const img = new Image();
  img.src = url;
  const peer = labelFor(peerId);
  frames.push({ img, url, peer });

  const cell = document.createElement('div');
  cell.className = 'frame';
  const tag = document.createElement('span');
  tag.textContent = peer;
  cell.append(img, tag);
  grid.appendChild(cell);

  // Drop the oldest frames so memory stays bounded
  while (frames.length > MAX_FRAMES) {
    URL.revokeObjectURL(frames.shift().url);
    grid.firstElementChild.remove();
  }

  emptyEl.style.display = 'none';
  countEl.textContent = `${frames.length} frame${frames.length === 1 ? '' : 's'}`;
  saveBtn.disabled = false;
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function clearAll() {
  frames.forEach(f => URL.revokeObjectURL(f.url));
  frames.length = 0;
  grid.innerHTML = '';
  countEl.textContent = '0 frames';
  saveBtn.disabled = true;
}

// Export everything you've watched as one contact-sheet PNG
function saveSheet() {
  if (!frames.length) return;
  const cols = Number(colsSel.value);
  const rows = Math.ceil(frames.length / cols);
  const gap = 2;
  const sheet = document.createElement('canvas');
  sheet.width = cols * FRAME_W + (cols + 1) * gap;
  sheet.height = rows * FRAME_H + (rows + 1) * gap;
  const s = sheet.getContext('2d');
  s.fillStyle = '#0b0b0b';
  s.fillRect(0, 0, sheet.width, sheet.height);

  frames.forEach((f, i) => {
    const x = gap + (i % cols) * (FRAME_W + gap);
    const y = gap + Math.floor(i / cols) * (FRAME_H + gap);
    s.drawImage(f.img, x, y, FRAME_W, FRAME_H);
  });

  const a = document.createElement('a');
  a.download = `contact-sheet-${Date.now()}.png`;
  a.href = sheet.toDataURL('image/png');
  a.click();
}

// ---------- loop ----------
function startLoop() {
  clearInterval(timer);
  timer = setInterval(() => { if (lookingAway) snapAndSend(); }, SNAP_MS);
}

function stopLoop() {
  clearInterval(timer);
  timer = null;
  dot.classList.remove('live');
}

async function run() {
  try {
    await startCamera();
    emptyEl.textContent = 'No one else here yet. Frames appear when someone in your room looks away.';
    if (!model) {
      gazeEl.textContent = 'loading model…';
      model = await blazeface.load();
    }
    startLoop();
    if (!detecting) { detecting = true; detect(); }
  } catch (err) {
    stopLoop();
    emptyEl.style.display = '';
    emptyEl.textContent = 'Camera unavailable: ' + err.message + '. Press Reset camera to try again.';
  }
}

async function resetCamera() {
  stopLoop();
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
  }
  try {
    const perm = await navigator.permissions.query({ name: 'camera' });
    if (perm.state === 'denied') {
      alert('Camera is blocked for this page.\nClick the camera or lock icon in the address bar, set Camera to "Allow", then press Reset camera again.');
      return;
    }
  } catch (e) { /* permissions API not supported, just try */ }
  run();
}

// ---------- wiring ----------
clearBtn.addEventListener('click', clearAll);
saveBtn.addEventListener('click', saveSheet);
resetBtn.addEventListener('click', resetCamera);
colsSel.addEventListener('change', () => {
  document.documentElement.style.setProperty('--cols', colsSel.value);
});

connect().catch(err => { peersEl.textContent = 'room error: ' + err.message; });
run();
