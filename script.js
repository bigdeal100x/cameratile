const video = document.getElementById('preview');
  const grid = document.getElementById('grid');
  const cap = document.getElementById('cap');
  const ctx = cap.getContext('2d');
  const dot = document.getElementById('dot');
  const countEl = document.getElementById('count');
  const emptyEl = document.getElementById('empty');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const resetBtn = document.getElementById('resetBtn');
  const stampsChk = document.getElementById('stamps');

  const FRAME_W = 320, FRAME_H = 240;   // stored size of each snap (4:3)
  let stream = null, timer = null;
  const frames = [];                    // { img, time }

    const gazeEl = document.getElementById('gaze');
  const YAW_LIMIT = 0.25;   // lower = more sensitive to turning away
  let model = null, lookingAway = false, detecting = false;

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
      gazeEl.textContent = lookingAway ? 'NOT LOOKING — snapping' : 'LOOKING — paused';
      dot.classList.toggle('live', lookingAway);
    }
    requestAnimationFrame(detect);
  }

  async function startCamera() {
    if (stream) return;
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
  }

  function snap() {
    if (!video.videoWidth) return;
    cap.width = FRAME_W;
    cap.height = FRAME_H;

    // Crop the centre of the feed to 4:3, mirrored like a selfie view
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

    const img = new Image();
    img.src = cap.toDataURL('image/jpeg', 0.85);
    const time = new Date();
    frames.push({ img, time });

    const cell = document.createElement('div');
    cell.className = 'frame';
    cell.appendChild(img);
    grid.appendChild(cell);

    emptyEl.style.display = 'none';
    countEl.textContent = `${frames.length} frame${frames.length === 1 ? '' : 's'}`;
    saveBtn.disabled = false;

    // Keep the newest row in view
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

    function startLoop() {
    clearInterval(timer);
    timer = setInterval(() => { if (lookingAway) snap(); }, 100);
  }

  function stopLoop() {
    clearInterval(timer);
    timer = null;
    dot.classList.remove('live');
  }

   async function run() {
    try {
      await startCamera();
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

    // Fully release the current camera
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      video.srcObject = null;
    }

    // If permission was blocked, the browser won't re-prompt on its own
    try {
      const perm = await navigator.permissions.query({ name: 'camera' });
      if (perm.state === 'denied') {
        alert('Camera is blocked for this page.\nClick the camera or lock icon in the address bar, set Camera to "Allow", then press Reset camera again.');
        return;
      }
    } catch (e) { /* permissions API not supported, just try */ }

    run();
  }

  function clearAll() {
    frames.length = 0;
    grid.innerHTML = '';
    countEl.textContent = '0 frames';
    saveBtn.disabled = true;
  }

  // Export the whole grid as one contact-sheet PNG
  function saveSheet() {
    const cols = Number(colsSel.value);
    const rows = Math.ceil(frames.length / cols);
    const gap = 2;
    const sheet = document.createElement('canvas');
    sheet.width = cols * FRAME_W + (cols + 1) * gap;
    sheet.height = rows * FRAME_H + (rows + 1) * gap;
    const s = sheet.getContext('2d');
    s.fillStyle = '#0b0b0b';
    s.fillRect(0, 0, sheet.width, sheet.height);
    s.font = '14px Courier New, monospace';

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

  clearBtn.addEventListener('click', clearAll);
  saveBtn.addEventListener('click', saveSheet);
  resetBtn.addEventListener('click', resetCamera);

  colsSel.addEventListener('change', () => {
    document.documentElement.style.setProperty('--cols', colsSel.value);
  });

  // Start automatically on page load
  run();