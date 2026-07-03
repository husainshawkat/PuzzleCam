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
let currentPinch = null; // { x, y } normalized 0..1, mirror-corrected, or null when not pinching

function drawHands(result) {
  const hasHands = result && result.landmarks && result.landmarks.length > 0;
  document.getElementById('tel-hands').textContent = hasHands ? result.landmarks.length : '0';
  Object.values(gestureMap).forEach(id => document.getElementById(id).classList.remove('active'));
  document.getElementById('g-pinch').classList.remove('active');
  currentPinch = null;

  if (!hasHands) { document.getElementById('gesture-name').textContent = '—'; return; }

  let displayName = '—';
  result.landmarks.forEach((lm, i) => {
    drawer.drawConnectors(lm, GestureRecognizer.HAND_CONNECTIONS, { color: 'rgba(176,132,255,0.65)', lineWidth: 2 });
    drawer.drawLandmarks(lm, { color: '#4cf3ff', radius: 2.4 });

    const thumbTip = lm[4], indexTip = lm[8];
    const dist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
    const isPinch = dist < 0.045;

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
  stopPuzzleGestureLoop();
});

document.getElementById('preview-download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = lastBlobUrl;
  a.download = `oriscan_${Date.now()}.${lastExt}`;
  a.click();
  toast('Download started');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPuzzleGestureLoop();
});

/* ============================================================
   PUZZLE GAME — sliding tile puzzle built from the captured photo,
   playable by touch/click or by pinch gesture.
   ============================================================ */
const GRID = 3;
const puzzleBoard = document.getElementById('puzzle-board');
const puzzleStatus = document.getElementById('puzzle-status');
const gestureCursor = document.getElementById('gesture-cursor');
let puzzleOrder = [];      // tile values currently in each cell, blank = GRID*GRID-1
let puzzleImageUrl = null;
let blankIndex = GRID * GRID - 1;

function startPuzzle(imageUrl) {
  puzzleImageUrl = imageUrl;
  buildPuzzle();
  previewModal.classList.remove('hidden');
  startPuzzleGestureLoop();
}

document.getElementById('puzzle-shuffle').addEventListener('click', buildPuzzle);

function buildPuzzle() {
  puzzleOrder = Array.from({ length: GRID * GRID }, (_, i) => i);
  shuffleSolvable(puzzleOrder);
  blankIndex = puzzleOrder.indexOf(GRID * GRID - 1);
  puzzleStatus.textContent = 'PINCH A TILE NEXT TO THE GAP TO SLIDE';
  puzzleStatus.classList.remove('solved');
  puzzleBoard.classList.remove('solved');
  renderPuzzle();
}

function shuffleSolvable(arr) {
  // start solved, then apply randomized legal slide-moves so it's always solvable
  let blank = arr.length - 1;
  for (let n = 0; n < 140; n++) {
    const neighbors = getNeighbors(blank);
    const swap = neighbors[Math.floor(Math.random() * neighbors.length)];
    [arr[blank], arr[swap]] = [arr[swap], arr[blank]];
    blank = swap;
  }
}
function getNeighbors(idx) {
  const row = Math.floor(idx / GRID), col = idx % GRID;
  const out = [];
  if (row > 0) out.push(idx - GRID);
  if (row < GRID - 1) out.push(idx + GRID);
  if (col > 0) out.push(idx - 1);
  if (col < GRID - 1) out.push(idx + 1);
  return out;
}

function renderPuzzle() {
  puzzleBoard.innerHTML = '';
  const neighbors = getNeighbors(blankIndex);
  puzzleOrder.forEach((value, cell) => {
    const tile = document.createElement('div');
    tile.className = 'puzzle-tile';
    tile.dataset.cell = cell;
    if (value === GRID * GRID - 1) {
      tile.classList.add('blank');
    } else {
      const sx = (value % GRID) * (100 / (GRID - 1));
      const sy = Math.floor(value / GRID) * (100 / (GRID - 1));
      tile.style.backgroundImage = `url(${puzzleImageUrl})`;
      tile.style.backgroundSize = `${GRID * 100}% ${GRID * 100}%`;
      tile.style.backgroundPosition = `${sx}% ${sy}%`;
      const num = document.createElement('span');
      num.className = 'tile-num';
      num.textContent = value + 1;
      tile.appendChild(num);
      if (neighbors.includes(cell)) tile.classList.add('adjacent');
      tile.addEventListener('click', () => trySlide(cell));
    }
    puzzleBoard.appendChild(tile);
  });
}

function trySlide(cell) {
  if (!getNeighbors(blankIndex).includes(cell)) return;
  [puzzleOrder[blankIndex], puzzleOrder[cell]] = [puzzleOrder[cell], puzzleOrder[blankIndex]];
  blankIndex = cell;
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

/* ---------- gesture (pinch) control for the puzzle ---------- */
let puzzleGestureRAF = null;
let pinchDownEdge = false;

function startPuzzleGestureLoop() {
  gestureCursor.classList.remove('hidden');
  const loop = () => {
    updateGestureCursor();
    puzzleGestureRAF = requestAnimationFrame(loop);
  };
  loop();
}
function stopPuzzleGestureLoop() {
  cancelAnimationFrame(puzzleGestureRAF);
  gestureCursor.classList.add('hidden');
  pinchDownEdge = false;
}

function updateGestureCursor() {
  if (!currentPinch) {
    gestureCursor.classList.remove('pinching');
    pinchDownEdge = false;
    return;
  }
  const px = currentPinch.x * window.innerWidth;
  const py = currentPinch.y * window.innerHeight;
  gestureCursor.style.left = `${px}px`;
  gestureCursor.style.top = `${py}px`;
  gestureCursor.classList.add('pinching');

  if (!pinchDownEdge) {
    pinchDownEdge = true;
    const el = document.elementFromPoint(px, py);
    const tile = el && el.closest ? el.closest('.puzzle-tile') : null;
    if (tile && !tile.classList.contains('blank')) {
      tile.classList.add('grabbed');
      trySlide(Number(tile.dataset.cell));
      setTimeout(() => tile.classList.remove('grabbed'), 150);
    }
  }
}

