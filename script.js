import * as THREE from 'three';
import { FaceLandmarker, GestureRecognizer, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { uploadCapture, ensureAnonSession } from './supabase.js';

/* ============================================================
   BOOT SEQUENCE
   ============================================================ */
const loaderText = document.getElementById('loader-text');
const loaderBarFill = document.getElementById('loader-bar-fill');
const loaderSteps = ['Initializing systems', 'Loading neural models', 'Calibrating sensors', 'Ready'];

async function runLoader() {
  for (let i = 0; i < loaderSteps.length; i++) {
    loaderText.textContent = loaderSteps[i];
    loaderBarFill.style.width = `${((i + 1) / loaderSteps.length) * 100}%`;
    await wait(380);
  }
  document.getElementById('loader').classList.add('hidden');
  document.getElementById('landing').classList.remove('hidden');
  initLandingFX();
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
runLoader();

/* ============================================================
   TOAST
   ============================================================ */
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', isError);
  toastEl.classList.add('glass', 'show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

/* ============================================================
   THREE.JS PARTICLE FIELD (reused for landing + app background)
   ============================================================ */
function createParticleField(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight || 1, 0.1, 100);
  camera.position.z = 14;

  const COUNT = 700;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const cCyan = new THREE.Color(0x4cf3ff);
  const cViolet = new THREE.Color(0xb084ff);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 26;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 16;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
    const c = Math.random() > 0.5 ? cCyan : cViolet;
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 0.055, vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.clientHeight || canvas.parentElement.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  let raf;
  function animate() {
    points.rotation.y += 0.0009;
    points.rotation.x += 0.0003;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(animate);
  }
  animate();
  return { stop: () => cancelAnimationFrame(raf) };
}

function initLandingFX() {
  createParticleField(document.getElementById('landing-canvas'));
}

/* ============================================================
   ENTER APP
   ============================================================ */
document.getElementById('enter-btn').addEventListener('click', async () => {
  document.getElementById('landing').classList.add('hidden');
  document.getElementById('app').classList.add('active');
  createParticleField(document.getElementById('three-bg'));
  ensureAnonSession().catch(() => {});
  await startPipeline();
});

document.getElementById('back-btn').addEventListener('click', () => {
  stopCamera();
  document.getElementById('app').classList.remove('active');
  document.getElementById('landing').classList.remove('hidden');
});

document.getElementById('fullscreen-btn').addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
});

/* ============================================================
   CAMERA
   ============================================================ */
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
let currentStream = null;
let facingMode = 'user';

async function startCamera() {
  stopCamera();
  const constraints = {
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: true
  };
  currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = currentStream;
  video.classList.toggle('mirrored-off', facingMode === 'environment');
  await new Promise(res => { video.onloadedmetadata = () => { video.play(); res(); }; });
  resizeCanvases();
}
function stopCamera() {
  if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
}
function resizeCanvases() {
  const w = video.videoWidth || window.innerWidth;
  const h = video.videoHeight || window.innerHeight;
  overlay.width = w; overlay.height = h;
  captureCanvas.width = w; captureCanvas.height = h;
  document.getElementById('tel-res').textContent = `${w}x${h}`;
}
window.addEventListener('resize', () => { if (video.videoWidth) resizeCanvases(); });

document.getElementById('switch-cam-btn').addEventListener('click', async () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  try { await startCamera(); } catch (e) { toast('Camera switch failed', true); }
});

async function startPipeline() {
  const gate = document.getElementById('permission-gate');
  const grantBtn = document.getElementById('grant-btn');
  const gateError = document.getElementById('gate-error');
  async function attempt() {
    try {
      await startCamera();
      await initModels();
      gate.classList.add('hidden');
      requestAnimationFrame(trackLoop);
    } catch (err) {
      gateError.textContent = err.message || 'Camera access denied.';
    }
  }
  grantBtn.addEventListener('click', attempt);
  attempt();
}

/* ============================================================
   MEDIAPIPE MODELS
   ============================================================ */
let faceLandmarker, gestureRecognizer;
async function initModels() {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true
  });
  gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2
  });
}

/* ============================================================
   TRACK LOOP
   ============================================================ */
let lastTime = -1, fpsAcc = 0, fpsFrames = 0, lastFpsUpdate = performance.now();
const drawer = new DrawingUtils(octx);
let lockedSince = 0;

function trackLoop(t) {
  requestAnimationFrame(trackLoop);
  if (!video.videoWidth || video.readyState < 2) return;
  const now = performance.now();
  if (now === lastTime) return;
  lastTime = now;

  octx.clearRect(0, 0, overlay.width, overlay.height);

  let faceResult = null, gestureResult = null;
  try { faceResult = faceLandmarker.detectForVideo(video, now); } catch (e) {}
  try { gestureResult = gestureRecognizer.recognizeForVideo(video, now); } catch (e) {}

  drawFace(faceResult);
  drawHands(gestureResult);
  updateFPS(now);
  updateGestureTrail(now);
  updateGestureInteraction(now);

  fpsFrames++;
}

function updateFPS(now) {
  fpsAcc++;
  if (now - lastFpsUpdate >= 500) {
    const fps = Math.round((fpsAcc * 1000) / (now - lastFpsUpdate));
    document.getElementById('tel-fps').textContent = fps;
    fpsAcc = 0; lastFpsUpdate = now;
  }
}

/* ---------- FACE ---------- */
function drawFace(result) {
  const hasFace = result && result.faceLandmarks && result.faceLandmarks.length > 0;
  document.getElementById('tel-face').textContent = hasFace ? 'LOCKED' : 'NONE';
  document.getElementById('status-text').textContent = hasFace ? 'TARGET ACQUIRED' : 'SCANNING';

  if (!hasFace) {
    setReticle(null);
    document.getElementById('tel-conf').textContent = '--';
    document.getElementById('tel-conf-bar').style.width = '0%';
    document.getElementById('tel-yaw').textContent = '0.0°';
    document.getElementById('tel-pitch').textContent = '0.0°';
    document.getElementById('tel-roll').textContent = '0.0°';
    document.getElementById('tel-gazex').textContent = '0.00';
    document.getElementById('tel-gazey').textContent = '0.00';
    return;
  }

  const lm = result.faceLandmarks[0];
  octx.strokeStyle = 'rgba(76,243,255,0.55)';
  octx.lineWidth = 1;
  drawer.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: 'rgba(76,243,255,0.28)', lineWidth: 0.6 });
  drawer.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_CONTOURS, { color: 'rgba(255,255,255,0.55)', lineWidth: 1.2 });
  drawer.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, { color: '#ff6a3d', lineWidth: 1.4 });
  drawer.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, { color: '#ff6a3d', lineWidth: 1.4 });

  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of lm) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const mirrored = facingMode === 'user';
  const bx = mirrored ? (1 - maxX) : minX;
  setReticle({ x: bx * overlay.width, y: minY * overlay.height, w: (maxX - minX) * overlay.width, h: (maxY - minY) * overlay.height, label: 'FACE_01' });

  const conf = 0.7 + Math.random() * 0.28;
  document.getElementById('tel-conf').textContent = `${Math.round(conf * 100)}%`;
  document.getElementById('tel-conf-bar').style.width = `${Math.round(conf * 100)}%`;

  if (result.facialTransformationMatrixes && result.facialTransformationMatrixes[0]) {
    const { yaw, pitch, roll } = matrixToEuler(result.facialTransformationMatrixes[0].data);
    document.getElementById('tel-yaw').textContent = `${yaw.toFixed(1)}°`;
    document.getElementById('tel-pitch').textContent = `${pitch.toFixed(1)}°`;
    document.getElementById('tel-roll').textContent = `${roll.toFixed(1)}°`;
  }

  const leftIris = lm[473], rightIris = lm[468];
  if (leftIris && rightIris) {
    const gazeX = ((leftIris.x + rightIris.x) / 2 - 0.5) * 2;
    const gazeY = ((leftIris.y + rightIris.y) / 2 - 0.5) * 2;
    document.getElementById('tel-gazex').textContent = gazeX.toFixed(2);
    document.getElementById('tel-gazey').textContent = gazeY.toFixed(2);
  }
}

function matrixToEuler(m) {
  const r00 = m[0], r10 = m[1], r20 = m[2];
  const r21 = m[6], r22 = m[10];
  const pitch = Math.atan2(r21, r22) * (180 / Math.PI);
  const yaw = Math.atan2(-r20, Math.sqrt(r21 * r21 + r22 * r22)) * (180 / Math.PI);
  const roll = Math.atan2(r10, r00) * (180 / Math.PI);
  return { yaw, pitch, roll };
}

/* ---------- HANDS + GESTURES ---------- */
const gestureMap = { Thumb_Up: 'g-thumb', Victory: 'g-peace', Open_Palm: 'g-palm', Closed_Fist: 'g-fist' };
let currentPinch = null;      // { x, y } normalized 0..1, mirror-corrected, or null when not pinching
let currentFingertip = null;  // { x, y } normalized 0..1, mirror-corrected, tracked whenever a hand is visible
let anyHandDetected = false;

function drawHands(result) {
  const hasHands = result && result.landmarks && result.landmarks.length > 0;
  document.getElementById('tel-hands').textContent = hasHands ? result.landmarks.length : '0';
  Object.values(gestureMap).forEach(id => document.getElementById(id).classList.remove('active'));
  document.getElementById('g-pinch').classList.remove('active');
  currentPinch = null;
  anyHandDetected = hasHands;
  if (!hasHands) currentFingertip = null;

  if (!hasHands) { document.getElementById('gesture-name').textContent = '—'; return; }

  let displayName = '—';
  result.landmarks.forEach((lm, i) => {
    drawer.drawConnectors(lm, GestureRecognizer.HAND_CONNECTIONS, { color: 'rgba(176,132,255,0.65)', lineWidth: 2 });
    drawer.drawLandmarks(lm, { color: '#4cf3ff', radius: 2.4 });

    const thumbTip = lm[4], indexTip = lm[8];
    const dist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
    const isPinch = dist < 0.045;

    currentFingertip = { x: facingMode === 'user' ? 1 - indexTip.x : indexTip.x, y: indexTip.y };

    if (isPinch) {
      document.getElementById('g-pinch').classList.add('active');
      displayName = 'Pinch';
      const midX = (thumbTip.x + indexTip.x) / 2;
      const midY = (thumbTip.y + indexTip.y) / 2;
      currentPinch = { x: facingMode === 'user' ? 1 - midX : midX, y: midY };
    } else if (result.gestures && result.gestures[i] && result.gestures[i][0]) {
      const cat = result.gestures[i][0].categoryName;
      if (gestureMap[cat]) {
        document.getElementById(gestureMap[cat]).classList.add('active');
        displayName = cat.replace('_', ' ');
      }
    }
  });
  document.getElementById('gesture-name').textContent = displayName;
}

/* ---------- RETICLE ---------- */
let reticleEl = null;
function setReticle(box) {
  if (!box) {
    if (reticleEl) { reticleEl.style.opacity = '0'; }
    return;
  }
  if (!reticleEl) {
    reticleEl = document.createElement('div');
    reticleEl.className = 'reticle';
    reticleEl.innerHTML = `<div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div><div class="label"></div>`;
    document.querySelector('.camera-stage').appendChild(reticleEl);
  }
  reticleEl.style.opacity = '1';
  reticleEl.style.left = `${(box.x / overlay.width) * 100}%`;
  reticleEl.style.top = `${(box.y / overlay.height) * 100}%`;
  reticleEl.style.width = `${(box.w / overlay.width) * 100}%`;
  reticleEl.style.height = `${(box.h / overlay.height) * 100}%`;
  reticleEl.querySelector('.label').textContent = box.label;
  if (!lockedSince) lockedSince = performance.now();
  reticleEl.classList.toggle('locked', performance.now() - lockedSince > 900);
}

/* ============================================================
   GESTURE TRAIL — always-visible fading path of the tracked hand,
   so users can see exactly where the tracking is moving.
   ============================================================ */
const trailCanvas = document.getElementById('gesture-trail');
const tctx = trailCanvas.getContext('2d');
let trailPoints = []; // { x, y, t } in px, most recent last
function resizeTrailCanvas() {
  trailCanvas.width = window.innerWidth;
  trailCanvas.height = window.innerHeight;
}
resizeTrailCanvas();
window.addEventListener('resize', resizeTrailCanvas);

function updateGestureTrail(now) {
  const point = currentFingertip || currentPinch;
  if (point) {
    trailPoints.push({ x: point.x * window.innerWidth, y: point.y * window.innerHeight, t: now, pinch: !!currentPinch });
  }
  const maxAge = 550;
  trailPoints = trailPoints.filter(p => now - p.t < maxAge);

  tctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
  if (trailPoints.length < 2) return;
  for (let i = 1; i < trailPoints.length; i++) {
    const a = trailPoints[i - 1], b = trailPoints[i];
    const age = (now - b.t) / maxAge;
    const alpha = Math.max(0, 1 - age);
    tctx.beginPath();
    tctx.moveTo(a.x, a.y);
    tctx.lineTo(b.x, b.y);
    tctx.strokeStyle = b.pinch ? `rgba(255,106,61,${alpha * 0.85})` : `rgba(76,243,255,${alpha * 0.6})`;
    tctx.lineWidth = b.pinch ? 3 : 1.6;
    tctx.lineCap = 'round';
    tctx.stroke();
  }
}

/* ============================================================
   GESTURE INTERACTION STATE MACHINE
   Camera view  -> hold a pinch to trigger the shutter (hands-free capture)
   Puzzle view  -> pinch a tile and drag it onto another to swap them
   ============================================================ */
const CAPTURE_HOLD_MS = 700;
let pinchWasActive = false;
let pinchStartAt = 0;
let captureArmed = false;

function updateGestureInteraction(now) {
  const puzzleOpen = !document.getElementById('preview-modal').classList.contains('hidden');
  const pinching = !!currentPinch;

  if (pinching || (currentFingertip && anyHandDetected)) {
    gestureCursor.classList.remove('hidden');
  } else {
    gestureCursor.classList.add('hidden');
  }

  if (pinching) {
    const px = currentPinch.x * window.innerWidth;
    const py = currentPinch.y * window.innerHeight;
    gestureCursor.style.left = `${px}px`;
    gestureCursor.style.top = `${py}px`;
    gestureCursor.classList.add('pinching');

    if (!pinchWasActive) {
      pinchStartAt = now;
      if (puzzleOpen) tryGrabTile(px, py);
    } else if (puzzleOpen) {
      moveGrabbedTile(px, py);
    } else {
      const pct = Math.min(1, (now - pinchStartAt) / CAPTURE_HOLD_MS);
      gestureCursor.style.background = `conic-gradient(rgba(76,243,255,.9) ${pct * 360}deg, transparent 0deg)`;
      document.getElementById('status-text').textContent = pct >= 1 ? 'CAPTURING' : `HOLD TO CAPTURE ${Math.round(pct * 100)}%`;
      if (pct >= 1 && !captureArmed) {
        captureArmed = true;
        takePhoto();
      }
    }
  } else {
    gestureCursor.classList.remove('pinching');
    gestureCursor.style.background = 'conic-gradient(rgba(76,243,255,.9) 0deg, transparent 0deg)';
    if (pinchWasActive && puzzleOpen) releaseGrabbedTile();
    captureArmed = false;
  }
  pinchWasActive = pinching;
}

/* ============================================================
   MODE SWITCH
   ============================================================ */
/* Video capture disabled — app runs in Photo · Puzzle mode only. */

/* ============================================================
   CAPTURE (composited video + HUD overlay)
   ============================================================ */
const captureCanvas = document.getElementById('capture-canvas');
const cctx = captureCanvas.getContext('2d');
let lastBlobUrl = null, lastBlob = null, lastFileType = null, lastExt = null;

function composeFrame() {
  cctx.save();
  if (facingMode === 'user') { cctx.translate(captureCanvas.width, 0); cctx.scale(-1, 1); }
  cctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
  cctx.restore();
  cctx.drawImage(overlay, 0, 0, captureCanvas.width, captureCanvas.height);
}

const shutterBtn = document.getElementById('shutter-btn');

shutterBtn.addEventListener('click', () => {
  takePhoto();
});

function takePhoto() {
  composeFrame();
  captureCanvas.toBlob(blob => {
    lastBlob = blob; lastFileType = 'image'; lastExt = 'png';
    lastBlobUrl = URL.createObjectURL(blob);
    updateThumb(lastBlobUrl, 'image');
    flashShutter();
    autoUploadToCloud(blob);
    startPuzzle(lastBlobUrl);
  }, 'image/png');
}

async function autoUploadToCloud(blob) {
  try {
    await uploadCapture({ blob, fileType: 'image', ext: 'png' });
    toast('Uploaded to cloud');
  } catch (e) {
    toast(e.message || 'Cloud upload failed', true);
  }
}

function flashShutter() {
  const f = document.createElement('div');
  f.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:.7;z-index:8;pointer-events:none;transition:opacity .25s;';
  document.querySelector('.camera-stage').appendChild(f);
  requestAnimationFrame(() => { f.style.opacity = '0'; setTimeout(() => f.remove(), 260); });
}



/* ============================================================
   PREVIEW MODAL HOST
   ============================================================ */
const previewModal = document.getElementById('preview-modal');

function updateThumb(url, type) {
  const thumb = document.getElementById('thumb-preview');
  thumb.innerHTML = '';
  const el = document.createElement(type === 'image' ? 'img' : 'video');
  el.src = url; el.muted = true;
  thumb.appendChild(el);
}

document.getElementById('preview-close').addEventListener('click', () => {
  previewModal.classList.add('hidden');
});

document.getElementById('preview-download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = lastBlobUrl;
  a.download = `oriscan_${Date.now()}.${lastExt}`;
  a.click();
  toast('Download started');
});

/* ============================================================
   PUZZLE GAME — the captured photo is cut into tiles that start
   shuffled anywhere on the board. Drag any tile onto any other
   tile to swap them — by pinch gesture, or by touch/mouse.
   ============================================================ */
const GRID = 3;
const puzzleBoard = document.getElementById('puzzle-board');
const puzzleStatus = document.getElementById('puzzle-status');
const gestureCursor = document.getElementById('gesture-cursor');
let puzzleOrder = [];       // puzzleOrder[slot] = tile value shown in that slot
let puzzleImageUrl = null;
let slotSize = 0;
let grabbedTile = null;     // currently-dragged tile element
let grabbedFromSlot = -1;

function startPuzzle(imageUrl) {
  puzzleImageUrl = imageUrl;
  buildPuzzle();
  previewModal.classList.remove('hidden');
}

document.getElementById('puzzle-shuffle').addEventListener('click', buildPuzzle);

function buildPuzzle() {
  puzzleOrder = Array.from({ length: GRID * GRID }, (_, i) => i);
  do { shuffleArray(puzzleOrder); } while (puzzleOrder.every((v, i) => v === i));
  puzzleStatus.textContent = 'PINCH A TILE AND DRAG IT ONTO ANOTHER TO SWAP';
  puzzleStatus.classList.remove('solved');
  puzzleBoard.classList.remove('solved');
  renderPuzzle();
}
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function layoutMetrics() {
  slotSize = puzzleBoard.clientWidth / GRID;
  return slotSize;
}

function renderPuzzle() {
  layoutMetrics();
  puzzleBoard.innerHTML = '';

  // ghost slot outlines showing target positions
  for (let slot = 0; slot < GRID * GRID; slot++) {
    const row = Math.floor(slot / GRID), col = slot % GRID;
    const ghost = document.createElement('div');
    ghost.className = 'puzzle-slot-ghost';
    ghost.style.left = `${col * slotSize}px`;
    ghost.style.top = `${row * slotSize}px`;
    ghost.style.width = `${slotSize}px`;
    ghost.style.height = `${slotSize}px`;
    const num = document.createElement('span');
    num.className = 'tile-num';
    num.textContent = slot + 1;
    ghost.appendChild(num);
    puzzleBoard.appendChild(ghost);
  }

  puzzleOrder.forEach((value, slot) => {
    const row = Math.floor(slot / GRID), col = slot % GRID;
    const tile = document.createElement('div');
    tile.className = 'puzzle-tile';
    tile.dataset.slot = slot;
    tile.dataset.value = value;
    if (value === slot) tile.classList.add('correct');
    tile.style.left = `${col * slotSize}px`;
    tile.style.top = `${row * slotSize}px`;
    tile.style.width = `${slotSize}px`;
    tile.style.height = `${slotSize}px`;
    const sx = (value % GRID) * (100 / (GRID - 1));
    const sy = Math.floor(value / GRID) * (100 / (GRID - 1));
    tile.style.backgroundImage = `url(${puzzleImageUrl})`;
    tile.style.backgroundSize = `${GRID * 100}% ${GRID * 100}%`;
    tile.style.backgroundPosition = `${sx}% ${sy}%`;
    const num = document.createElement('span');
    num.className = 'tile-num';
    num.textContent = value + 1;
    tile.appendChild(num);

    tile.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      tile.setPointerCapture(e.pointerId);
      tryGrabTile(e.clientX, e.clientY);
    });
    tile.addEventListener('pointermove', (e) => {
      if (grabbedTile === tile) moveGrabbedTile(e.clientX, e.clientY);
    });
    tile.addEventListener('pointerup', (e) => {
      if (grabbedTile === tile) releaseGrabbedTile();
    });

    puzzleBoard.appendChild(tile);
  });
}

function tryGrabTile(px, py) {
  const el = document.elementFromPoint(px, py);
  const tile = el && el.closest ? el.closest('.puzzle-tile') : null;
  if (!tile) return;
  grabbedTile = tile;
  grabbedFromSlot = Number(tile.dataset.slot);
  tile.classList.add('grabbed');
  tile.style.transition = 'none';
  moveGrabbedTile(px, py);
}

function moveGrabbedTile(px, py) {
  if (!grabbedTile) return;
  const boardRect = puzzleBoard.getBoundingClientRect();
  grabbedTile.style.left = `${px - boardRect.left - slotSize / 2}px`;
  grabbedTile.style.top = `${py - boardRect.top - slotSize / 2}px`;
}

function releaseGrabbedTile() {
  if (!grabbedTile) return;
  const boardRect = puzzleBoard.getBoundingClientRect();
  const left = parseFloat(grabbedTile.style.left) || 0;
  const top = parseFloat(grabbedTile.style.top) || 0;
  let col = Math.round((left + slotSize / 2) / slotSize);
  let row = Math.round((top + slotSize / 2) / slotSize);
  col = Math.min(GRID - 1, Math.max(0, col));
  row = Math.min(GRID - 1, Math.max(0, row));
  const targetSlot = row * GRID + col;

  [puzzleOrder[grabbedFromSlot], puzzleOrder[targetSlot]] = [puzzleOrder[targetSlot], puzzleOrder[grabbedFromSlot]];

  grabbedTile.classList.remove('grabbed');
  grabbedTile.style.transition = '';
  grabbedTile = null;
  grabbedFromSlot = -1;
  renderPuzzle();
  checkSolved();
}

function checkSolved() {
  const solved = puzzleOrder.every((v, i) => v === i);
  if (solved) {
    puzzleStatus.textContent = '✓ PUZZLE SOLVED';
    puzzleStatus.classList.add('solved');
    puzzleBoard.classList.add('solved');
  }
}
window.addEventListener('resize', () => { if (!previewModal.classList.contains('hidden')) renderPuzzle(); });

