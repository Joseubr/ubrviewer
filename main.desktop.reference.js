const { app, BrowserWindow, systemPreferences, dialog, ipcMain, shell, screen, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');
const { exportMp4Production } = require('./mp4-export-pipeline');

let ytdlCore = null;
try {
  ytdlCore = require('@distube/ytdl-core');
} catch (_e) {
  ytdlCore = null;
}

let YtDlpWrapLib = null;
try {
  YtDlpWrapLib = require('yt-dlp-wrap');
} catch (_e) {
  YtDlpWrapLib = null;
}

let ffmpegInstaller = null;
try {
  ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
} catch (_e) {
  ffmpegInstaller = null;
}

let ffprobeInstaller = null;
try {
  ffprobeInstaller = require('@ffprobe-installer/ffprobe');
} catch (_e) {
  ffprobeInstaller = null;
}

let isQuitting = false;
let exitFlowActive = false;
let mainWindow = null;
let presenterWindow = null;
let presenterDisplayProfile = null;
let presenterSyncFlushTimer = null;
let presenterSyncLastSentAtMs = 0;
let presenterSyncPendingPayload = null;
const BRANDO_MAX_DAYS = 100;

function isBrandoVariant() {
  try {
    const name = String(app.getName() || '');
    const execPath = String(process.execPath || '');
    const appPath = String(app.getAppPath() || '');
    return /brando/i.test(`${name} ${execPath} ${appPath}`);
  } catch (_e) {
    return false;
  }
}

function resolveRendererHtmlPath() {
  const candidates = [
    path.join(__dirname, 'Index.html'),
    path.join(__dirname, 'index.html')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_e) {}
  }
  return candidates[0];
}

function safeExecText(command) {
  try {
    return String(execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
  } catch (_e) {
    return '';
  }
}

function getMachineFingerprintRaw() {
  const nets = os.networkInterfaces && os.networkInterfaces();
  const macs = [];
  if (nets && typeof nets === 'object') {
    Object.keys(nets).forEach((name) => {
      const list = Array.isArray(nets[name]) ? nets[name] : [];
      list.forEach((item) => {
        const mac = String(item && item.mac || '').trim();
        const internal = !!(item && item.internal);
        if (!internal && mac && mac !== '00:00:00:00:00:00') macs.push(mac.toLowerCase());
      });
    });
  }
  macs.sort();
  const platformUuid = safeExecText("ioreg -rd1 -c IOPlatformExpertDevice | awk -F'\"' '/IOPlatformUUID/{print $(NF-1)}'");
  const model = safeExecText("sysctl -n hw.model");
  const cpuModel = String((os.cpus && os.cpus()[0] && os.cpus()[0].model) || '').trim();
  const host = String(os.hostname() || '').trim();
  const fields = [
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    `model=${model}`,
    `cpu=${cpuModel}`,
    `uuid=${platformUuid}`,
    `host=${host}`,
    `macs=${macs.join(',')}`
  ];
  return fields.join('|');
}

function getMachineFingerprint() {
  const raw = getMachineFingerprintRaw();
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function ensureBrandoMachineLock() {
  if (!isBrandoVariant()) return { ok: true, enabled: false };
  const fingerprint = getMachineFingerprint();
  const licensePath = path.join(app.getPath('userData'), 'brando-machine-license.json');
  try {
    const nowMs = Date.now();
    if (fs.existsSync(licensePath)) {
      const payload = JSON.parse(fs.readFileSync(licensePath, 'utf-8'));
      const saved = String(payload && payload.fingerprint || '').trim();
      if (!saved) {
        return { ok: false, reason: 'Licencia Brando corrupta o vacia.' };
      }
      if (saved !== fingerprint) {
        return { ok: false, reason: 'Esta copia de Brando esta vinculada a otra maquina.' };
      }

      const createdAtRaw = String(payload && payload.createdAt || '').trim();
      const createdAtMs = Date.parse(createdAtRaw);
      if (!Number.isFinite(createdAtMs)) {
        return { ok: false, reason: 'Licencia Brando invalida: fecha de activacion corrupta.' };
      }

      const maxAgeMs = BRANDO_MAX_DAYS * 24 * 60 * 60 * 1000;
      if ((nowMs - createdAtMs) > maxAgeMs) {
        return { ok: false, reason: `Licencia Brando caducada: supero los ${BRANDO_MAX_DAYS} dias.` };
      }

      payload.lastUsedAt = new Date(nowMs).toISOString();
      payload.version = app.getVersion();
      fs.writeFileSync(licensePath, JSON.stringify(payload, null, 2), { mode: 0o600 });

      return {
        ok: true,
        enabled: true,
        firstRun: false,
        daysRemaining: Math.max(0, Math.ceil((maxAgeMs - (nowMs - createdAtMs)) / (24 * 60 * 60 * 1000)))
      };
    }

    const payload = {
      product: app.getName(),
      version: app.getVersion(),
      fingerprint,
      createdAt: new Date(nowMs).toISOString(),
      lastUsedAt: new Date(nowMs).toISOString(),
      maxDays: BRANDO_MAX_DAYS
    };
    fs.mkdirSync(path.dirname(licensePath), { recursive: true });
    fs.writeFileSync(licensePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    return {
      ok: true,
      enabled: true,
      firstRun: true,
      daysRemaining: BRANDO_MAX_DAYS
    };
  } catch (err) {
    return {
      ok: false,
      reason: `No se pudo validar la licencia local Brando: ${String(err && err.message ? err.message : err)}`
    };
  }
}

function presenterHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VA PRO Presenter</title>
<style>
html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}
body{position:relative}
#presenterStage{position:absolute;left:50%;top:50%;width:1280px;height:720px;transform:translate(-50%,-50%);transform-origin:center center;overflow:hidden;background:#000}
video,img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
#presenterLaser{position:absolute;left:0;top:0;width:14px;height:14px;border-radius:50%;background:#ff0000;pointer-events:none;transform:translate(-9999px,-9999px);z-index:20;opacity:0;box-shadow:0 0 0 7px rgba(255,0,0,0.25),0 0 22px rgba(255,0,0,0.88);transition:transform .03s linear, opacity .06s linear}
</style>
</head>
<body>
<div id="presenterStage">
<video id="presenterVideo" playsinline muted></video>
<img id="presenterImage" alt="presenter-frame" style="display:none" />
<div id="presenterLaser" aria-hidden="true"></div>
</div>
<script>
const { ipcRenderer } = require('electron')
const stage = document.getElementById('presenterStage')
const video = document.getElementById('presenterVideo')
const image = document.getElementById('presenterImage')
const laser = document.getElementById('presenterLaser')
let activeSrc = ''
let pendingTime = null
let videoFailed = false
let stageWidth = 1280
let stageHeight = 720

video.addEventListener('error', ()=>{ videoFailed = true })
video.addEventListener('loadeddata', ()=>{ videoFailed = false })

function updateStageLayout(payload){
  if(!stage) return
  const nextW = Math.max(640, Math.round(Number(payload && payload.renderWidth) || 1280))
  const nextH = Math.max(360, Math.round(Number(payload && payload.renderHeight) || 720))
  stageWidth = nextW
  stageHeight = nextH
  const scale = Math.min(
    Math.max(0.1, (window.innerWidth || nextW) / nextW),
    Math.max(0.1, (window.innerHeight || nextH) / nextH)
  )
  stage.style.width = String(nextW) + 'px'
  stage.style.height = String(nextH) + 'px'
  stage.style.transform = 'translate(-50%,-50%) scale(' + scale.toFixed(4) + ')'
}

function applyLaser(payload){
  if(!laser){ return }
  const l = payload && payload.laser
  if(!(l && l.enabled && l.inside)){
    laser.style.opacity = '0'
    laser.style.transform = 'translate(-9999px,-9999px)'
    return
  }
  const x = Math.max(0, Math.min(1, Number(l.x) || 0.5))
  const y = Math.max(0, Math.min(1, Number(l.y) || 0.5))
  const px = stageWidth * x
  const py = stageHeight * y
  laser.style.opacity = '1'
  laser.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)'
}

function applyState(payload){
  if(!payload || !video || !image) return
  updateStageLayout(payload)
  const mediaType = String(payload.mediaType || 'video')
  const imageSrc = String(payload.imageSrc || '')
  const forceSync = !!payload.forceSync
  const driftToleranceSec = Math.max(0.1, Math.min(0.7, Number(payload.driftToleranceSec) || 0.2))
  applyLaser(payload)
  if(mediaType === 'image'){
    try{ video.pause() }catch(_e){}
    video.style.display = 'none'
    image.style.display = 'block'
    if(imageSrc) image.src = imageSrc
    return
  }
  video.style.display = 'block'
  const src = String(payload.src || '')
  const nextTime = Math.max(0, Number(payload.currentTime) || 0)
  const playbackRate = Number(payload.playbackRate) || 1
  const paused = !!payload.paused
  let shouldSeek = false
  if(!src){
    try{ video.pause() }catch(_e){}
    activeSrc = ''
    return
  }
  if(src && src !== activeSrc){
    activeSrc = src
    pendingTime = nextTime
    shouldSeek = true
    videoFailed = false
    video.src = src
    video.load()
  }else if(Number.isFinite(nextTime)){
    const curr = Number(video.currentTime) || 0
    const driftSigned = nextTime - curr
    const drift = Math.abs(driftSigned)
    const hardSeekDrift = Math.max(1.2, driftToleranceSec * 5.5)
    if(paused){
      pendingTime = nextTime
      shouldSeek = true
    }else if(forceSync && drift > hardSeekDrift){
      pendingTime = nextTime
      shouldSeek = true
    }else{
      pendingTime = null
    }
  }
  try{ video.playbackRate = playbackRate }catch(_e){}

  const syncNow = ()=>{
    try{ video.playbackRate = playbackRate }catch(_e){}
    if(shouldSeek && pendingTime !== null && Number.isFinite(pendingTime)){
      try{ video.currentTime = Math.max(0, Number(pendingTime) || 0) }catch(_e){}
    }
    pendingTime = null
    if(paused){
      if(!video.paused) try{ video.pause() }catch(_e){}
    }else{
      if(video.paused) try{ video.play().catch(()=>{}) }catch(_e){}
    }
  }

  if(video.readyState >= 1) syncNow()
  else video.onloadedmetadata = ()=> syncNow()

  if(imageSrc){
    try{ image.src = imageSrc }catch(_e){}
    if(videoFailed){
      video.style.display = 'none'
      image.style.display = 'block'
    }
  }

  if(!videoFailed && video.readyState >= 2){
    image.style.display = 'none'
    video.style.display = 'block'
  }else if(imageSrc){
    image.style.display = 'block'
  }
}

window.addEventListener('resize', ()=> updateStageLayout({ renderWidth: stageWidth, renderHeight: stageHeight }))

ipcRenderer.on('presenter-state', (_event, payload)=> applyState(payload))
</script>
</body>
</html>`;
}

function buildPresenterDisplayProfile(targetDisplay) {
  const bounds = (targetDisplay && targetDisplay.bounds) || {};
  const width = Math.max(640, Number(bounds.width) || 1280);
  const height = Math.max(360, Number(bounds.height) || 720);
  const labelRaw = String((targetDisplay && (targetDisplay.label || targetDisplay.name)) || '').trim();
  const label = labelRaw.toLowerCase();
  const hzRaw = Number((targetDisplay && (targetDisplay.displayFrequency || targetDisplay.refreshRate)) || 0);
  const guessedHz = (hzRaw > 0 ? hzRaw : 60);
  const commonHz = [24, 25, 30, 50, 60, 75, 90, 100, 120];
  let normalizedHz = 60;
  let bestHzDiff = Infinity;
  commonHz.forEach((hz) => {
    const diff = Math.abs(guessedHz - hz);
    if (diff < bestHzDiff) {
      bestHzDiff = diff;
      normalizedHz = hz;
    }
  });
  const isProjector = /(projector|proyector|epson|benq|optoma|viewsonic|christie|nec)/i.test(label);
  // Usar píxeles físicos para clasificación de resolución (macOS HiDPI reporta píxeles lógicos)
  const scaleFactor = Math.max(1, Number(targetDisplay && targetDisplay.scaleFactor) || 1);
  const physW = Math.round(width * scaleFactor);
  const physH = Math.round(height * scaleFactor);
  const physPixelCount = Math.max(1, physW * physH);
  const isTv = /(\btv\b|television|bravia|samsung|\blg\b|hisense|vizio|tcl|sony)/i.test(label) || (!isProjector && physW >= 2500);
  const deviceType = isProjector ? 'projector' : (isTv ? 'tv' : 'monitor');
  const isQhdOrAbove = physPixelCount >= (2560 * 1440);
  const is4kOrAbove = physPixelCount >= (3840 * 2160);

  let preferredFrameRate = Math.max(24, Math.min(60, Math.round(normalizedHz || 60)));
  if (isQhdOrAbove) preferredFrameRate = Math.min(preferredFrameRate, 54);
  if (is4kOrAbove) preferredFrameRate = Math.min(preferredFrameRate, 48);
  if (deviceType === 'projector' && normalizedHz <= 30) preferredFrameRate = Math.min(preferredFrameRate, 30);

  // Resolution/GPU auto-balance: reduce heavy fallback frame processing for high-res outputs.
  let renderScale = 1;
  if (deviceType === 'projector') renderScale = 0.88;
  if (isTv) renderScale = 0.82;
  if (isQhdOrAbove) renderScale = Math.min(renderScale, 0.66);
  if (is4kOrAbove) renderScale = 0.42;
  if (normalizedHz <= 30 && is4kOrAbove) renderScale = 0.34;
  if (normalizedHz <= 30 && isQhdOrAbove && !is4kOrAbove) renderScale = Math.min(renderScale, 0.54);
  if (normalizedHz >= 90 && isQhdOrAbove) renderScale = Math.max(0.34, renderScale - 0.08);
  const renderWidth = Math.max(640, Math.round(width * renderScale));
  const renderHeight = Math.max(360, Math.round(height * renderScale));

  // IPC pacing tied to display frame time: keep 720p/60Hz smooth and avoid heavy seeks on high-res displays.
  const frameMs = 1000 / Math.max(24, Math.min(120, normalizedHz || 60));
  const syncFactor = is4kOrAbove ? 3.1 : (isQhdOrAbove ? 2.35 : (deviceType === 'projector' ? 1.7 : 2.0));
  let syncIntervalMs = Math.round(frameMs * syncFactor);
  if (normalizedHz <= 30) syncIntervalMs = Math.max(syncIntervalMs, 78);
  if (normalizedHz >= 60 && !isQhdOrAbove) syncIntervalMs = Math.min(syncIntervalMs, 34);
  syncIntervalMs = Math.max(22, Math.min(160, syncIntervalMs));

  const syncDriftSec = is4kOrAbove ? 0.62 : (isQhdOrAbove ? 0.52 : (normalizedHz <= 30 ? 0.46 : 0.38));
  return {
    id: Number(targetDisplay && targetDisplay.id) || 0,
    name: labelRaw || 'Pantalla externa',
    width,
    height,
    scaleFactor,
    physWidth: physW,
    physHeight: physH,
    deviceType,
    refreshRate: guessedHz,
    normalizedRefreshRate: normalizedHz,
    preferredFrameRate,
    renderScale,
    renderWidth,
    renderHeight,
    syncIntervalMs,
    syncDriftSec
  };
}

function getPresenterTargetSendIntervalMs(payload) {
  const profileFps = Math.max(12, Number(presenterDisplayProfile && presenterDisplayProfile.preferredFrameRate) || 30);
  const runningVideo = !!(payload && payload.mediaType === 'video' && !payload.paused);
  const frameMs = 1000 / Math.max(12, profileFps);
  const baseMs = runningVideo
    ? Math.round(frameMs * 1.55)
    : Math.round(frameMs * 2.8);
  const profileMin = Math.max(18, Number(presenterDisplayProfile && presenterDisplayProfile.syncIntervalMs) || 34);
  return Math.max(profileMin, Math.min(220, baseMs));
}

function flushPresenterSyncPayload() {
  presenterSyncFlushTimer = null;
  if (!presenterWindow || presenterWindow.isDestroyed()) return;
  if (!presenterSyncPendingPayload) return;
  const payload = presenterSyncPendingPayload;
  presenterSyncPendingPayload = null;
  presenterSyncLastSentAtMs = Date.now();
  try { presenterWindow.webContents.send('presenter-state', payload || {}); } catch (_e) {}
}

function notifyPresenterMode(active) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('presenter-mode-changed', {
        active: !!active,
        displayProfile: active ? presenterDisplayProfile : null
      });
    } catch (_e) {}
  }
}

function closePresenterWindow() {
  if (presenterSyncFlushTimer) {
    clearTimeout(presenterSyncFlushTimer);
    presenterSyncFlushTimer = null;
  }
  presenterSyncPendingPayload = null;
  presenterSyncLastSentAtMs = 0;
  if (!presenterWindow || presenterWindow.isDestroyed()) {
    presenterWindow = null;
    notifyPresenterMode(false);
    return;
  }
  const win = presenterWindow;
  presenterWindow = null;
  try { win.close(); } catch (_e) {}
  notifyPresenterMode(false);
}

function ensurePresenterWindow() {
  const displays = screen.getAllDisplays();
  if (!Array.isArray(displays) || displays.length < 2) {
    return { ok: false, error: 'No se detecto una segunda pantalla para modo proyector.' };
  }
  const primary = screen.getPrimaryDisplay();
  const target = displays.find((d) => d && d.id !== primary.id) || displays[1];
  if (!target || !target.bounds) {
    return { ok: false, error: 'No se pudo obtener la pantalla externa.' };
  }
  presenterDisplayProfile = buildPresenterDisplayProfile(target);

  if (!presenterWindow || presenterWindow.isDestroyed()) {
    presenterWindow = new BrowserWindow({
      x: target.bounds.x,
      y: target.bounds.y,
      width: Math.max(640, Number(target.bounds.width) || 1280),
      height: Math.max(360, Number(target.bounds.height) || 720),
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      webPreferences: {
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false,
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    presenterWindow.setMenuBarVisibility(false);
    try { presenterWindow.webContents.setFrameRate(Math.max(30, Number(presenterDisplayProfile && presenterDisplayProfile.preferredFrameRate) || 60)); } catch (_e) {}
    presenterWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(presenterHtml()));
    presenterWindow.once('ready-to-show', () => {
      try { presenterWindow.setFullScreen(true); } catch (_e) {}
      try { presenterWindow.show(); } catch (_e) {}
      notifyPresenterMode(true);
    });
    presenterWindow.on('closed', () => {
      presenterWindow = null;
      notifyPresenterMode(false);
    });
  } else {
    presenterWindow.setBounds(target.bounds);
    presenterWindow.setMenuBarVisibility(false);
    presenterWindow.setFullScreen(true);
    presenterWindow.show();
    presenterWindow.focus();
    try { presenterWindow.webContents.setFrameRate(Math.max(30, Number(presenterDisplayProfile && presenterDisplayProfile.preferredFrameRate) || 60)); } catch (_e) {}
    notifyPresenterMode(true);
  }
  return { ok: true };
}

function getWorkspaceRoot() {
  const base = app.getPath('documents');
  return path.join(base, 'VA PRO 1.0');
}

function ensureWorkspaceFolders() {
  const root = getWorkspaceRoot();
  const folders = [root, path.join(root, 'presets'), path.join(root, 'reports')];
  folders.forEach((folder) => {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  });
  return root;
}

function qualityToCrf(quality) {
  const q = Math.max(30, Math.min(100, Number(quality || 80)));
  const crf = Math.round(30 - (q / 100) * 12);
  return Math.max(18, Math.min(28, crf));
}

function getFfmpegThreadCount() {
  const cpuCount = Number(os.cpus && os.cpus().length) || 4;
  return Math.max(2, Math.min(16, cpuCount));
}

const MIN_EXPORT_VIDEO_BITRATE_KBPS = 2000;
const PREFERRED_EXPORT_FPS = [24, 30, 60];

function normalizePreferredExportFps(rawFps) {
  const fps = Number(rawFps);
  if (!Number.isFinite(fps) || fps <= 0) return 30;
  let best = PREFERRED_EXPORT_FPS[0];
  let bestDiff = Math.abs(fps - best);
  for (const v of PREFERRED_EXPORT_FPS) {
    const d = Math.abs(fps - v);
    if (d < bestDiff) {
      best = v;
      bestDiff = d;
    }
  }
  return best;
}

function getDefaultAudioBitrateKbps(rawValue, fallback = 192) {
  const parsed = Number(rawValue);
  if (Number.isFinite(parsed) && parsed > 0) return Math.max(96, Math.min(512, Math.round(parsed)));
  return Math.max(96, Math.min(512, Math.round(Number(fallback) || 192)));
}

function estimateExportVideoBitrateKbps(width, height, fps, quality) {
  const w = Math.max(320, Number(width) || 1280);
  const h = Math.max(240, Number(height) || 720);
  const frameRate = Math.max(10, Math.min(60, Number(fps) || 30));
  const q = Math.max(30, Math.min(100, Number(quality || 80)));
  const pixels = w * h;

  let base = 4000;
  if (pixels <= 640 * 480) base = 1800;
  else if (pixels <= 1280 * 720) base = 4200;
  else if (pixels <= 1920 * 1080) base = 7800;
  else if (pixels <= 2560 * 1440) base = 13000;
  else base = 19000;

  const fpsFactor = frameRate / 30;
  const qualityFactor = 0.7 + (q / 100) * 0.7;
  return Math.max(MIN_EXPORT_VIDEO_BITRATE_KBPS, Math.round(base * fpsFactor * qualityFactor));
}

function buildAacAudioArgs(audioBitrateKbps) {
  const kbps = getDefaultAudioBitrateKbps(audioBitrateKbps, 192);
  return ['-c:a', 'aac', '-b:a', `${kbps}k`, '-ar', '48000', '-ac', '2'];
}

function shouldPrioritizeQuality(opts = {}) {
  const q = Math.max(30, Math.min(100, Number(opts.quality || 75)));
  return q >= 90;
}

function resolveTargetVideoBitrateKbps(opts = {}) {
  const requested = Math.max(MIN_EXPORT_VIDEO_BITRATE_KBPS, Number(opts.videoBitrateKbps || 5000));
  const estimated = estimateExportVideoBitrateKbps(
    Number(opts.width || 1280),
    Number(opts.height || 720),
    Number(opts.fps || 30),
    Number(opts.quality || 75)
  );
  const q = Math.max(30, Math.min(100, Number(opts.quality || 75)));
  if (q >= 70) {
    return Math.max(requested, Math.round(estimated * 0.9));
  }
  return requested;
}

function resolveFontFile() {
  const candidates = [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial.ttf',
    '/Library/Fonts/Helvetica.ttc'
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_e) {}
  }
  return '';
}

function escapeDrawtext(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

function getClockDrawtextExpr(clockStartSec = 0) {
  const base = Number(clockStartSec);
  if (Number.isFinite(base) && Math.abs(base) > 0.0005) {
    return `%{pts\\:hms\\:${base.toFixed(3)}}`;
  }
  return `%{pts\\:hms}`;
}

function runCommand(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout && child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr && child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `Command failed: ${command}`));
    });
  });
}

// Igual que runCommand pero parsea el progreso de ffmpeg vía -progress pipe:1
// onProgress(outTimeSec) se llama con el tiempo de salida actual procesado
function runCommandWithProgress(command, args, onProgress, opts = {}) {
  return new Promise((resolve, reject) => {
    // Inyectar -progress pipe:1 justo antes del último argumento (path de salida)
    const extArgs = args.length >= 2
      ? [...args.slice(0, args.length - 1), '-progress', 'pipe:1', args[args.length - 1]]
      : [...args];
    const child = spawn(command, extArgs, { windowsHide: true, ...opts });
    let stdout = '';
    let stderr = '';
    let progBuf = '';
    if (child.stdout) {
      child.stdout.on('data', (d) => {
        const chunk = String(d);
        stdout += chunk;
        progBuf += chunk;
        let nl;
        while ((nl = progBuf.indexOf('\n')) !== -1) {
          const line = progBuf.slice(0, nl).trim();
          progBuf = progBuf.slice(nl + 1);
          if (line.startsWith('out_time_ms=')) {
            const ms = parseInt(line.slice('out_time_ms='.length), 10);
            if (Number.isFinite(ms) && ms >= 0 && typeof onProgress === 'function') {
              onProgress(ms / 1000);
            }
          }
        }
      });
    }
    child.stderr && child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `Command failed: ${command}`));
    });
  });
}

function runCommandBinary(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...opts });
    const stdoutChunks = [];
    let stderr = '';
    child.stdout && child.stdout.on('data', (d) => { stdoutChunks.push(Buffer.from(d)); });
    child.stderr && child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `Command failed: ${command}`));
    });
  });
}

function normalizeFloatVector(vec) {
  const arr = Array.isArray(vec) ? vec.map((v) => Number(v) || 0) : [];
  let norm = 0;
  for (const v of arr) norm += v * v;
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm <= 1e-9) return arr.map(() => 0);
  return arr.map((v) => v / norm);
}

function parseYtDlpProgressLine(line) {
  const txt = String(line || '').trim();
  if (!txt) return null;
  const pctMatch = txt.match(/\[download\]\s+([0-9]+(?:\.[0-9]+)?)%/i);
  const percent = pctMatch ? Math.max(0, Math.min(100, Number(pctMatch[1]))) : null;
  const status = txt.replace(/^\[download\]\s*/i, '').trim() || txt;
  if (percent === null && !/^\[download\]/i.test(txt)) return null;
  return { percent, status };
}

function runYtDlpCommandWithProgress(command, args, onProgress, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...opts });
    let stdout = '';
    let stderr = '';
    let stderrBuf = '';

    const emitProgressFromText = (chunkText) => {
      stderrBuf += String(chunkText || '');
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() || '';
      lines.forEach((line) => {
        const parsed = parseYtDlpProgressLine(line);
        if (parsed && typeof onProgress === 'function') {
          try { onProgress(parsed); } catch (_e) {}
        }
      });
    };

    child.stdout && child.stdout.on('data', (d) => {
      const text = String(d);
      stdout += text;
      emitProgressFromText(text);
    });
    child.stderr && child.stderr.on('data', (d) => {
      const text = String(d);
      stderr += text;
      emitProgressFromText(text);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (stderrBuf) {
        const parsed = parseYtDlpProgressLine(stderrBuf);
        if (parsed && typeof onProgress === 'function') {
          try { onProgress(parsed); } catch (_e) {}
        }
      }
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `Command failed: ${command}`));
    });
  });
}

function buildScalePadFilter(width, height) {
  // Scale to fit (with aspect ratio), then crop to exact dimensions (centered) — no pad.
  return `scale='min(${width},${height})*dar':${height}:force_original_aspect_ratio=2:force_divisible_by=2,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2`;
}

function getFfmpegCandidatePaths() {
  const out = [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    path.join(process.resourcesPath || '', 'bin', 'ffmpeg'),
    path.join(process.resourcesPath || '', 'ffmpeg')
  ];
  const installerPath = String(ffmpegInstaller && ffmpegInstaller.path || '').trim();
  if (installerPath) out.unshift(installerPath);
  const unpackedPath = String(process.resourcesPath || '').trim()
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@ffmpeg-installer', process.platform, 'ffmpeg')
    : '';
  if (unpackedPath) out.push(unpackedPath);
  return Array.from(new Set(out.filter(Boolean)));
}

function getFfprobeCandidatePaths() {
  const out = [
    '/opt/homebrew/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    '/opt/local/bin/ffprobe',
    '/usr/bin/ffprobe',
    path.join(process.resourcesPath || '', 'bin', 'ffprobe'),
    path.join(process.resourcesPath || '', 'ffprobe')
  ];
  const installerPath = String(ffprobeInstaller && ffprobeInstaller.path || '').trim();
  if (installerPath) out.unshift(installerPath);
  const unpackedPath = String(process.resourcesPath || '').trim()
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@ffprobe-installer', process.platform, 'ffprobe')
    : '';
  if (unpackedPath) out.push(unpackedPath);
  return Array.from(new Set(out.filter(Boolean)));
}

async function ensureFfmpegAvailable() {
  const bin = resolveBinaryPath('ffmpeg', getFfmpegCandidatePaths());
  if (!bin) throw new Error('ffmpeg no disponible (instala ffmpeg o añade binario)');
  await runCommand(bin, ['-version']);
  return bin;
}

async function ensureFfprobeAvailable() {
  const bin = resolveBinaryPath('ffprobe', getFfprobeCandidatePaths());
  if (!bin) throw new Error('ffprobe no disponible');
  await runCommand(bin, ['-version']);
  return bin;
}

function parseFpsFraction(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return null;
  if (txt.includes('/')) {
    const [a, b] = txt.split('/').map((v) => Number(v));
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) return a / b;
  }
  const n = Number(txt);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function probeSourceVideoParams(ffprobeBin, sourcePath) {
  const src = String(sourcePath || '').trim();
  if (!src) return null;
  try {
    const args = [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      src
    ];
    const result = await runCommand(ffprobeBin, args);
    const parsed = JSON.parse(String(result && result.stdout || '{}'));
    const streams = Array.isArray(parsed && parsed.streams) ? parsed.streams : [];
    const video = streams.find((s) => String(s && s.codec_type || '').toLowerCase() === 'video') || null;
    const audio = streams.find((s) => String(s && s.codec_type || '').toLowerCase() === 'audio') || null;
    const width = Math.max(0, Number(video && video.width) || 0);
    const height = Math.max(0, Number(video && video.height) || 0);
    const fps = parseFpsFraction(video && (video.avg_frame_rate || video.r_frame_rate));
    const streamBitrate = Math.max(0, Number(video && video.bit_rate) || 0);
    const formatBitrate = Math.max(0, Number(parsed && parsed.format && parsed.format.bit_rate) || 0);
    const audioBitrate = Math.max(0, Number(audio && audio.bit_rate) || 0);
    const videoBitrateKbps = Math.round(((streamBitrate || formatBitrate) || 0) / 1000);
    const audioBitrateKbps = Math.round((audioBitrate || 0) / 1000);
    return {
      width: width > 0 ? width : null,
      height: height > 0 ? height : null,
      fps: (Number.isFinite(fps) && fps > 0) ? fps : null,
      videoBitrateKbps: videoBitrateKbps > 0 ? videoBitrateKbps : null,
      audioBitrateKbps: audioBitrateKbps > 0 ? audioBitrateKbps : null
    };
  } catch (_e) {
    return null;
  }
}

async function probeExportedMedia(ffprobeBin, filePath) {
  const target = String(filePath || '').trim();
  if (!target) return null;
  try {
    const args = [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      target
    ];
    const result = await runCommand(ffprobeBin, args);
    return JSON.parse(String(result && result.stdout || '{}'));
  } catch (_e) {
    return null;
  }
}

async function validateExportedMp4OrThrow(ffprobeBin, filePath, expectedMinDurationSec = 0.04) {
  const target = String(filePath || '').trim();
  if (!target) throw new Error('Archivo de salida invalido');
  if (!fs.existsSync(target)) throw new Error('No se genero archivo de salida');

  const stats = fs.statSync(target);
  if (!stats.isFile() || stats.size < 4096) {
    throw new Error('Archivo MP4 vacio o demasiado pequeno');
  }

  const probed = await probeExportedMedia(ffprobeBin, target);
  const streams = Array.isArray(probed && probed.streams) ? probed.streams : [];
  const video = streams.find((s) => String(s && s.codec_type || '').toLowerCase() === 'video') || null;
  if (!video) throw new Error('MP4 sin stream de video');

  const width = Number(video && video.width) || 0;
  const height = Number(video && video.height) || 0;
  if (width < 2 || height < 2) throw new Error('MP4 con dimensiones invalidas');

  const streamDuration = Number(video && video.duration) || 0;
  const formatDuration = Number(probed && probed.format && probed.format.duration) || 0;
  const duration = Math.max(streamDuration, formatDuration);
  const minDuration = Math.max(0.02, Number(expectedMinDurationSec) || 0.04);
  if (!(duration >= minDuration)) {
    throw new Error('MP4 con duracion invalida (posible salida vacia)');
  }
}

function resolveVlcBinaryPath() {
  return resolveBinaryPath('cvlc', [
    '/Applications/VLC.app/Contents/MacOS/VLC',
    '/opt/homebrew/bin/cvlc',
    '/usr/local/bin/cvlc',
    '/opt/local/bin/cvlc'
  ]);
}

function getUserYtDlpCandidates() {
  const out = [
    path.join(os.homedir(), '.local', 'bin', 'yt-dlp')
  ];
  try {
    const pyRoot = path.join(os.homedir(), 'Library', 'Python');
    const versions = fs.existsSync(pyRoot) ? fs.readdirSync(pyRoot) : [];
    versions.forEach((ver) => {
      const p = path.join(pyRoot, ver, 'bin', 'yt-dlp');
      out.push(p);
    });
  } catch (_e) {}
  return out;
}

async function ensureYtDlpAvailable() {
  const bin = resolveBinaryPath('yt-dlp', [
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/opt/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    ...getUserYtDlpCandidates(),
    path.join(process.resourcesPath || '', 'bin', 'yt-dlp'),
    path.join(process.resourcesPath || '', 'yt-dlp')
  ]);
  if (!bin) throw new Error('yt-dlp no disponible');
  await runCommand(bin, ['--version']);
  return bin;
}

async function ensureAria2Available() {
  const bin = resolveBinaryPath('aria2c', [
    '/opt/homebrew/bin/aria2c',
    '/usr/local/bin/aria2c',
    '/opt/local/bin/aria2c',
    '/usr/bin/aria2c',
    path.join(process.resourcesPath || '', 'bin', 'aria2c'),
    path.join(process.resourcesPath || '', 'aria2c')
  ]);
  if (!bin) throw new Error('aria2c no disponible');
  await runCommand(bin, ['--version']);
  return bin;
}

async function ensureAnyDownloaderAvailable() {
  const candidates = [
    '/opt/homebrew/bin/anydownloader',
    '/usr/local/bin/anydownloader',
    '/opt/local/bin/anydownloader',
    '/usr/bin/anydownloader',
    '/opt/homebrew/bin/any-downloader',
    '/usr/local/bin/any-downloader',
    '/opt/local/bin/any-downloader',
    '/usr/bin/any-downloader',
    path.join(process.resourcesPath || '', 'bin', 'anydownloader'),
    path.join(process.resourcesPath || '', 'bin', 'any-downloader')
  ];

  const bin = resolveBinaryPath('anydownloader', candidates)
    || resolveBinaryPath('any-downloader', candidates);
  if (!bin) throw new Error('anydownloader no disponible');

  try {
    await runCommand(bin, ['--version']);
  } catch (_e) {
    await runCommand(bin, ['-h']);
  }
  return bin;
}

async function ensureSuperTranscoderAvailable() {
  const candidates = [
    '/Applications/SuperTranscoder.app/Contents/MacOS/SuperTranscoder',
    '/Applications/Super Transcoder.app/Contents/MacOS/Super Transcoder',
    '/opt/homebrew/bin/supertranscoder',
    '/usr/local/bin/supertranscoder',
    '/opt/local/bin/supertranscoder',
    '/usr/bin/supertranscoder',
    '/opt/homebrew/bin/super-transcoder',
    '/usr/local/bin/super-transcoder',
    '/opt/local/bin/super-transcoder',
    '/usr/bin/super-transcoder',
    path.join(process.resourcesPath || '', 'bin', 'supertranscoder'),
    path.join(process.resourcesPath || '', 'bin', 'super-transcoder')
  ];

  const bin = resolveBinaryPath('supertranscoder', candidates)
    || resolveBinaryPath('super-transcoder', candidates);
  if (!bin) throw new Error('super transcoder no disponible');

  const probes = [
    ['--version'],
    ['-version'],
    ['-h']
  ];
  let ok = false;
  for (const args of probes) {
    try {
      await runCommand(bin, args);
      ok = true;
      break;
    } catch (_e) {}
  }
  if (!ok) throw new Error('super transcoder instalado pero no accesible por CLI');
  return bin;
}

function buildTurboYtDlpDownloadArgs(useAria2 = false, aria2Bin = '', aggressive = false) {
  const fragments = aggressive ? '32' : '16';
  const chunk = aggressive ? '20M' : '10M';
  const timeout = aggressive ? '45' : '30';
  const args = [
    '--concurrent-fragments', fragments,
    '--http-chunk-size', chunk,
    '--socket-timeout', timeout
  ];
  if (useAria2 && aria2Bin) {
    args.push('--downloader', aria2Bin);
    args.push('--downloader-args', `aria2c:-x${fragments} -s${fragments} -k1M --file-allocation=none --allow-overwrite=true --summary-interval=1`);
  }
  return args;
}

async function tryInstallYtDlpWithPipUser() {
  try {
    await runCommand('python3', ['-m', 'pip', 'install', '--user', '-U', 'yt-dlp']);
  } catch (_e) {
    throw new Error('No se pudo instalar yt-dlp con pip --user');
  }
  return await ensureYtDlpAvailable();
}

function getYtDlpWrapClass() {
  if (!YtDlpWrapLib) return null;
  if (typeof YtDlpWrapLib === 'function') return YtDlpWrapLib;
  if (YtDlpWrapLib && typeof YtDlpWrapLib.default === 'function') return YtDlpWrapLib.default;
  if (YtDlpWrapLib && typeof YtDlpWrapLib.YtDlpWrap === 'function') return YtDlpWrapLib.YtDlpWrap;
  return null;
}

async function ensureEmbeddedYtDlpAvailable() {
  const YtDlpWrap = getYtDlpWrapClass();
  if (!YtDlpWrap) throw new Error('yt-dlp-wrap no disponible');

  const userBinDir = path.join(app.getPath('userData'), 'bin');
  try { fs.mkdirSync(userBinDir, { recursive: true }); } catch (_e) {}
  const target = path.join(userBinDir, 'yt-dlp');

  if (isExecutableFile(target)) return target;

  if (typeof YtDlpWrap.downloadFromGithub === 'function') {
    await YtDlpWrap.downloadFromGithub(target);
  } else if (typeof YtDlpWrap.downloadFromGithHub === 'function') {
    await YtDlpWrap.downloadFromGithHub(target);
  } else {
    throw new Error('yt-dlp-wrap no soporta descarga automática');
  }

  try { fs.chmodSync(target, 0o755); } catch (_e) {}
  if (!isExecutableFile(target)) throw new Error('No se pudo preparar binario embebido yt-dlp');
  return target;
}

async function tryYtdlCoreDownload(url, outputPath, qualityPreset = 'original') {
  if (!ytdlCore) throw new Error('ytdl-core no disponible');
  if (!ytdlCore.validateURL(url)) throw new Error('URL de YouTube inválida');

  const info = await ytdlCore.getInfo(url);
  const allFormats = Array.isArray(info && info.formats) ? info.formats : [];
  const mp4Muxed = allFormats
    .filter((f) => f && f.hasVideo && f.hasAudio && f.container === 'mp4')
    .sort((a, b) => Number(b.height || 0) - Number(a.height || 0) || Number(b.bitrate || 0) - Number(a.bitrate || 0));

  if (!mp4Muxed.length) throw new Error('No hay formatos MP4 directos disponibles');

  const targetHeight = Number(qualityPreset);
  let selected = mp4Muxed[0];
  if (Number.isFinite(targetHeight)) {
    const under = mp4Muxed.find((f) => Number(f.height || 0) <= targetHeight);
    if (under) selected = under;
  }

  await new Promise((resolve, reject) => {
    const readStream = ytdlCore(url, {
      quality: selected.itag,
      requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0' } }
    });
    const writeStream = fs.createWriteStream(outputPath);

    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      try { readStream.destroy(); } catch (_e) {}
      try { writeStream.end(); } catch (_e) {}
      if (err) reject(err);
      else resolve();
    };

    readStream.on('error', done);
    writeStream.on('error', done);
    writeStream.on('finish', () => done(null));
    readStream.pipe(writeStream);
  });

  return outputPath;
}

async function resolveYoutubeDirectStreamUrl(inputValue, qualityPreset = 'high') {
  const raw = String(inputValue || '').trim();
  if (!raw) throw new Error('URL/ID de YouTube vacío');

  const fromRawId = /^[A-Za-z0-9_-]{11}$/.test(raw) ? raw : '';
  const videoId = fromRawId || extractYouTubeVideoId(raw);
  if (!videoId) throw new Error('No se pudo resolver ID de YouTube');

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const wantsBalanced = String(qualityPreset || 'high').toLowerCase().trim() === 'balanced';
  const targetHeight = wantsBalanced ? 720 : 0;

  if (ytdlCore) {
    try {
      const info = await ytdlCore.getInfo(watchUrl);
      const formats = Array.isArray(info && info.formats) ? info.formats : [];
      const muxed = formats
        .filter((f) => f && f.hasVideo && f.hasAudio && String(f.url || '').trim())
        .sort((a, b) => Number(b.height || 0) - Number(a.height || 0) || Number(b.bitrate || 0) - Number(a.bitrate || 0));

      if (muxed.length) {
        let selected = muxed[0];
        if (targetHeight > 0) {
          const under = muxed.find((f) => Number(f.height || 0) <= targetHeight);
          if (under) selected = under;
        }
        const directUrl = String(selected.url || '').trim();
        if (directUrl) return { streamUrl: directUrl, videoId, source: 'ytdl-core' };
      }
    } catch (_e) {
      // Seguimos con fallback por yt-dlp.
    }
  }

  const formatExpr = targetHeight > 0
    ? `best[height<=${targetHeight}][vcodec!=none][acodec!=none]/best[height<=${targetHeight}]/best`
    : 'best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best';

  const buildArgs = () => ([
    '--no-playlist',
    '--no-check-certificates',
    '--prefer-insecure',
    '--retries', '2',
    '--fragment-retries', '2',
    '--extractor-args', 'youtube:player_client=android,web,mweb',
    '--add-header', 'Referer:https://www.youtube.com/',
    '--add-header', 'Origin:https://www.youtube.com',
    '--add-header', 'User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    '-f', formatExpr,
    '-g',
    watchUrl
  ]);

  const tryWithBin = async (binPath) => {
    const { stdout } = await runCommand(binPath, buildArgs());
    const lines = String(stdout || '').split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    const direct = lines.find((v) => v.startsWith('http://') || v.startsWith('https://')) || '';
    if (!direct) throw new Error('yt-dlp no devolvió URL de stream');
    return direct;
  };

  try {
    const ytDlpBin = await ensureYtDlpAvailable();
    const direct = await tryWithBin(ytDlpBin);
    return { streamUrl: direct, videoId, source: 'yt-dlp' };
  } catch (_e) {
    const embeddedYtDlp = await ensureEmbeddedYtDlpAvailable();
    const direct = await tryWithBin(embeddedYtDlp);
    return { streamUrl: direct, videoId, source: 'yt-dlp-embedded' };
  }
}

async function resolveGenericDirectStreamUrl(inputValue, qualityPreset = 'high') {
  const raw = normalizeVideoInputUrl(inputValue);
  if (!raw) throw new Error('URL vacía');

  const ytId = /^[A-Za-z0-9_-]{11}$/.test(raw) ? raw : extractYouTubeVideoId(raw);
  if (ytId) {
    return await resolveYoutubeDirectStreamUrl(raw, qualityPreset);
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(raw);
  } catch (_e) {
    throw new Error('URL inválida');
  }
  if (!/^https?:$/i.test(String(parsedUrl.protocol || ''))) {
    throw new Error('Solo se aceptan URLs http/https');
  }

  const qRaw = String(qualityPreset || 'high').toLowerCase().trim();
  const wantsBalanced = qRaw === 'balanced';
  const formatExpr = wantsBalanced
    ? 'best[height<=720][vcodec!=none][acodec!=none]/best[height<=720]/best'
    : 'best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best';

  const host = String((parsedUrl && parsedUrl.hostname) || '').toLowerCase();
  const isOkHost = host === 'ok.ru' || host.endsWith('.ok.ru') || host === 'odnoklassniki.ru' || host.endsWith('.odnoklassniki.ru');

  const buildArgs = (cookieBrowser = '') => {
    const args = [
      '--no-playlist',
      '--no-check-certificates',
      '--prefer-insecure',
      '--retries', '2',
      '--fragment-retries', '2',
      '-f', formatExpr,
      '-g'
    ];
    if (isOkHost) {
      args.push('--add-header', 'Referer:https://ok.ru/');
      args.push('--add-header', 'Origin:https://ok.ru');
      args.push('--add-header', 'User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    }
    if (cookieBrowser) args.push('--cookies-from-browser', cookieBrowser);
    args.push(raw);
    return args;
  };

  const tryWithBin = async (binPath) => {
    const attempts = [''];
    if (isOkHost) attempts.push('safari', 'chrome', 'brave', 'chromium', 'firefox');
    let lastErr = null;
    for (const cookieBrowser of attempts) {
      try {
        const { stdout } = await runCommand(binPath, buildArgs(cookieBrowser));
        const lines = String(stdout || '').split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
        const direct = lines.find((v) => v.startsWith('http://') || v.startsWith('https://')) || '';
        if (!direct) throw new Error('yt-dlp no devolvió URL de stream');
        return direct;
      } catch (err) {
        lastErr = err;
      }
    }
    throw (lastErr || new Error('No se pudo resolver stream'));
  };

  try {
    const ytDlpBin = await ensureYtDlpAvailable();
    const direct = await tryWithBin(ytDlpBin);
    return { streamUrl: direct, source: 'yt-dlp' };
  } catch (_e) {
    const embeddedYtDlp = await ensureEmbeddedYtDlpAvailable();
    const direct = await tryWithBin(embeddedYtDlp);
    return { streamUrl: direct, source: 'yt-dlp-embedded' };
  }
}

function normalizeVideoInputUrl(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.startsWith('ok.ru/') || lower.startsWith('m.ok.ru/') || lower.startsWith('odnoklassniki.ru/') || lower.startsWith('m.odnoklassniki.ru/')) {
    return 'https://' + raw.replace(/^\/+/, '');
  }
  if (lower.startsWith('youtube.com/') || lower.startsWith('www.youtube.com/') || lower.startsWith('m.youtube.com/') || lower.startsWith('youtu.be/')) {
    return 'https://' + raw.replace(/^\/+/, '');
  }
  return raw;
}

function isExecutableFile(p) {
  if (!p) return false;
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch (_e) {
    return false;
  }
}

function isPythonWrapperScript(p) {
  if (!p) return false;
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = String(buf.slice(0, Math.max(0, n)) || '').toLowerCase();
    if (!head.startsWith('#!')) return false;
    return head.includes('python');
  } catch (_e) {
    return false;
  }
}

function resolveBinaryPath(name, preferred = []) {
  for (const candidate of preferred) {
    const abs = String(candidate || '').trim();
    if (!abs) continue;
    if (isExecutableFile(abs)) return abs;
  }
  const envPath = String(process.env.PATH || '');
  const parts = envPath.split(path.delimiter).filter(Boolean);
  for (const p of parts) {
    const full = path.join(p, name);
    if (isExecutableFile(full)) return full;
  }
  return null;
}

function sendToJDownloader(url, packageName = 'VA_PRO_Youtube') {
  return new Promise((resolve) => {
    try {
      const target = new URL('http://127.0.0.1:9666/flash/add');
      target.searchParams.set('autostart', '1');
      target.searchParams.set('package', String(packageName || 'VA_PRO_Youtube'));
      target.searchParams.set('source', String(url || ''));
      target.searchParams.set('urls', String(url || ''));

      const req = http.get(target.toString(), (res) => {
        let body = '';
        res.on('data', (d) => { body += String(d || ''); });
        res.on('end', () => {
          const okStatus = Number(res.statusCode) >= 200 && Number(res.statusCode) < 300;
          const okBody = /success|added|accepted|true|ok/i.test(body || '');
          resolve(okStatus || okBody);
        });
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        try { req.destroy(); } catch (_e) {}
        resolve(false);
      });
    } catch (_e) {
      resolve(false);
    }
  });
}

function httpRequestJson(url, method = 'GET', bodyObj = null, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const target = new URL(url);
      const isHttps = target.protocol === 'https:';
      const transport = isHttps ? https : http;
      const payload = bodyObj ? JSON.stringify(bodyObj) : null;
      const req = transport.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method,
        headers: Object.assign({}, headers, payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        } : {})
      }, (res) => {
        let raw = '';
        res.on('data', (d) => { raw += String(d || ''); });
        res.on('end', () => {
          const status = Number(res.statusCode || 0);
          if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status}: ${raw.slice(0, 240)}`));
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            resolve(parsed);
          } catch (_e) {
            reject(new Error('Respuesta JSON inválida'));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(7000, () => {
        try { req.destroy(); } catch (_e) {}
        reject(new Error('Timeout de red'));
      });
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

function downloadFileWithRedirects(url, outputPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Demasiadas redirecciones'));
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.get(target, (res) => {
      const status = Number(res.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        const next = new URL(res.headers.location, target).toString();
        return resolve(downloadFileWithRedirects(next, outputPath, redirects + 1));
      }
      if (status < 200 || status >= 300) {
        return reject(new Error(`Descarga HTTP ${status}`));
      }
      const file = fs.createWriteStream(outputPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(outputPath)));
      file.on('error', (err) => reject(err));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => {
      try { req.destroy(); } catch (_e) {}
      reject(new Error('Timeout descarga'));
    });
  });
}

async function tryCobaltDownload(url, outputPath) {
  const payload = {
    url: String(url || '').trim(),
    vCodec: 'h264',
    filenamePattern: 'basic',
    isAudioOnly: false
  };
  const endpoints = [
    'https://api.cobalt.tools/api/json',
    'https://api-cobalt.is-an.app/api/json',
    'https://co.wuk.sh/api/json',
    'https://api.cobalt.best/api/json'
  ];
  let lastErr = null;
  for (const endpoint of endpoints) {
    try {
      const response = await httpRequestJson(endpoint, 'POST', payload, {
        Accept: 'application/json'
      });
      const mediaUrl = String((response && (response.url || response.downloadUrl || response.directUrl)) || '').trim();
      if (!mediaUrl) throw new Error('Cobalt no devolvió URL de descarga');
      await downloadFileWithRedirects(mediaUrl, outputPath);
      return outputPath;
    } catch (err) {
      lastErr = err;
    }
  }
  throw (lastErr || new Error('Cobalt no respondió'));
}

async function tryAnyDownloaderDownload(url, outputPath, opts = {}) {
  const qualityPreset = String(opts && opts.qualityPreset || 'original').trim();
  const isYouTubeUrl = !!(opts && opts.isYouTubeUrl);
  const isOkHost = !!(opts && opts.isOkHost);

  const anyBin = await ensureAnyDownloaderAvailable();

  const height = Number(qualityPreset);
  const formatBestWithAudio = Number.isFinite(height)
    ? `bestvideo[height<=${height}][vcodec!=none]+bestaudio[acodec!=none]/best[height<=${height}][vcodec!=none][acodec!=none]/bestvideo+bestaudio/best`
    : 'bestvideo[vcodec!=none]+bestaudio[acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best';
  const formatOkDirectPreferred = Number.isFinite(height)
    ? `best[protocol^=http][ext=mp4][height<=${height}][vcodec!=none][acodec!=none]/best[protocol^=http][height<=${height}][vcodec!=none][acodec!=none]/best[ext=mp4][height<=${height}][vcodec!=none][acodec!=none]/best[height<=${height}]`
    : 'best[protocol^=http][ext=mp4][vcodec!=none][acodec!=none]/best[protocol^=http][vcodec!=none][acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]/best';
  const formatProgressivePreferred = Number.isFinite(height)
    ? `best[ext=mp4][height<=${height}][vcodec!=none][acodec!=none]/best[height<=${height}][vcodec!=none][acodec!=none]/best[ext=mp4]/best`
    : 'best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best[ext=mp4]/best';
  const formatRelaxed = Number.isFinite(height) ? `best[height<=${height}]/best` : 'best';

  const attempts = [];
  if (isOkHost) attempts.push({ format: formatOkDirectPreferred, cookieBrowser: '', label: 'ok-direct-mp4' });
  attempts.push({ format: formatBestWithAudio, cookieBrowser: '', label: 'bestvideo+bestaudio' });
  attempts.push({ format: formatProgressivePreferred, cookieBrowser: '', label: 'progressive' });
  attempts.push({ format: formatRelaxed, cookieBrowser: '', label: 'relaxed' });
  if (isYouTubeUrl) {
    attempts.push({ format: formatBestWithAudio, cookieBrowser: 'safari', label: 'yt-cookies-safari' });
    attempts.push({ format: formatBestWithAudio, cookieBrowser: 'chrome', label: 'yt-cookies-chrome' });
  } else if (isOkHost) {
    attempts.push({ format: formatOkDirectPreferred, cookieBrowser: 'safari', label: 'ok-cookies-safari' });
    attempts.push({ format: formatOkDirectPreferred, cookieBrowser: 'chrome', label: 'ok-cookies-chrome' });
  }

  const buildArgs = (attempt) => {
    const args = [
      '--no-playlist',
      '--no-check-certificates',
      '--prefer-insecure',
      '--retries', '2',
      '--fragment-retries', '2',
      '--merge-output-format', 'mp4',
      '-f', String((attempt && attempt.format) || formatRelaxed),
      '-o', outputPath
    ];
    if (isYouTubeUrl) {
      args.push('--add-header', 'Referer:https://www.youtube.com/');
      args.push('--add-header', 'Origin:https://www.youtube.com');
      args.push('--add-header', 'User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    } else if (isOkHost) {
      args.push('--add-header', 'Referer:https://ok.ru/');
      args.push('--add-header', 'Origin:https://ok.ru');
      args.push('--add-header', 'User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    }
    const cookieBrowser = String((attempt && attempt.cookieBrowser) || '').trim();
    if (cookieBrowser) args.push('--cookies-from-browser', cookieBrowser);
    args.push(String(url || '').trim());
    return args;
  };

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      await runCommand(anyBin, buildArgs(attempt));
      return { ok: true, mode: String((attempt && attempt.label) || 'default'), bin: anyBin };
    } catch (err) {
      lastErr = err;
    }
  }

  throw (lastErr || new Error('AnyDownloader no pudo completar la descarga'));
}

function extractYouTubeVideoId(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim());
    if (u.hostname.includes('youtu.be')) return String(u.pathname || '').replace(/^\//, '').trim();
    const v = u.searchParams.get('v');
    if (v) return String(v).trim();
    const m = String(u.pathname || '').match(/\/shorts\/([A-Za-z0-9_-]{6,})/);
    if (m && m[1]) return String(m[1]);
  } catch (_e) {}
  return '';
}

function parseQualityLabelToHeight(label) {
  const txt = String(label || '').toLowerCase();
  const m = txt.match(/(\d{3,4})p/);
  if (m && m[1]) return Number(m[1]);
  return 0;
}

async function tryInvidiousDownload(url, outputPath, qualityPreset = 'original') {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error('No se pudo resolver ID de YouTube');

  const endpoints = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://invidious.perennialte.ch',
    'https://invidious.private.coffee'
  ];

  const targetHeight = Number(qualityPreset);
  let lastErr = null;

  for (const base of endpoints) {
    try {
      const data = await httpRequestJson(`${base}/api/v1/videos/${encodeURIComponent(videoId)}`, 'GET', null, {
        Accept: 'application/json'
      });

      const streams = Array.isArray(data && data.formatStreams) ? data.formatStreams : [];
      const candidates = streams
        .filter((s) => {
          const mediaUrl = String((s && s.url) || '').trim();
          const container = String((s && s.container) || '').toLowerCase();
          return !!mediaUrl && (container === 'mp4' || /video\/mp4/i.test(String((s && s.type) || '')));
        })
        .map((s) => ({
          url: String(s.url || '').trim(),
          height: parseQualityLabelToHeight(s.qualityLabel || s.quality || s.resolution),
          bitrate: Number(s.bitrate || 0)
        }))
        .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);

      if (!candidates.length) throw new Error('Invidious no devolvió streams MP4');

      let selected = candidates[0];
      if (Number.isFinite(targetHeight)) {
        const under = candidates.find((s) => Number(s.height || 0) <= targetHeight);
        if (under) selected = under;
      }

      await downloadFileWithRedirects(selected.url, outputPath);
      return outputPath;
    } catch (err) {
      lastErr = err;
    }
  }

  throw (lastErr || new Error('Invidious no respondió'));
}

async function tryPipedDownload(url, outputPath, qualityPreset = 'original') {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error('No se pudo resolver ID de YouTube');

  const endpoints = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.yt'
  ];

  const targetHeight = Number(qualityPreset);
  let lastErr = null;

  for (const base of endpoints) {
    try {
      const streamInfo = await httpRequestJson(`${base}/streams/${encodeURIComponent(videoId)}`, 'GET', null, {
        Accept: 'application/json'
      });
      const streams = Array.isArray(streamInfo && streamInfo.videoStreams) ? streamInfo.videoStreams : [];
      const candidates = streams
        .filter((s) => s && !s.videoOnly && String(s.url || '').trim())
        .sort((a, b) => Number(b.height || 0) - Number(a.height || 0) || Number(b.bitrate || 0) - Number(a.bitrate || 0));

      if (!candidates.length) throw new Error('Piped no devolvió streams con audio');

      let selected = candidates[0];
      if (Number.isFinite(targetHeight)) {
        const under = candidates.find((s) => Number(s.height || 0) <= targetHeight);
        if (under) selected = under;
      }

      const mediaUrl = String(selected.url || '').trim();
      if (!mediaUrl) throw new Error('Piped stream URL vacío');
      await downloadFileWithRedirects(mediaUrl, outputPath);
      return outputPath;
    } catch (err) {
      lastErr = err;
    }
  }

  throw (lastErr || new Error('Piped no respondió'));
}

async function convertToMp4FromSource(sourcePath, outputPath, opts = {}) {
  let ffmpegBin = resolveBinaryPath('ffmpeg', getFfmpegCandidatePaths());

  if (ffmpegBin) {
    let ffprobeBin = '';
    try {
      ffprobeBin = await ensureFfprobeAvailable();
    } catch (_e) {
      ffprobeBin = '';
    }

    const res = await exportMp4Production({
      ffmpegBin,
      ffprobeBin,
      inputPath: sourcePath,
      outputPath,
      preferHardware: !!(process.platform === 'darwin' && !opts.disableHardwareAccel),
      videoCodec: String(opts.videoCodec || 'h264'),
      videoBitrateKbps: Number(opts.videoBitrateKbps || 0) || 0,
      audioBitrateKbps: Number(opts.audioBitrateKbps || 0) || 0
    });

    return {
      ok: true,
      engine: res && res.usedHardware
        ? ('ffmpeg:' + (String(opts.videoCodec || 'h264') === 'hevc' ? 'hevc_videotoolbox' : 'h264_videotoolbox'))
        : ('ffmpeg:' + (String(opts.videoCodec || 'h264') === 'hevc' ? 'libx265' : (String(opts.videoCodec || 'h264') === 'mpeg4' ? 'mpeg4' : 'libx264'))),
      outputPath,
      audioMode: res && res.usedAudioMode ? res.usedAudioMode : 'aac'
    };
  }

  const vlcBin = resolveVlcBinaryPath();
  if (!vlcBin) {
    throw new Error('No hay ffmpeg ni VLC disponibles para convertir a MP4 por CLI');
  }

  const sout = `#transcode{vcodec=h264,vb=5000,acodec=mp4a,ab=192,channels=2,samplerate=48000}:standard{access=file,mux=mp4,dst='${outputPath.replace(/'/g, "\\'")}'}`;
  await runCommand(vlcBin, ['-I', 'dummy', sourcePath, '--sout', sout, 'vlc://quit']);
  return { ok: true, engine: 'vlc', outputPath };
}

async function requestRendererSaveBeforeExit(win) {
  if (!win || win.isDestroyed()) return { ok: true, skipped: true };
  try {
    console.log('[MAIN] Requesting renderer save before exit...')
    const result = await win.webContents.executeJavaScript(`(async ()=>{
      try{
        if(window.__vapRequestSaveOnExit) return await window.__vapRequestSaveOnExit();
        return { ok:true, skipped:true };
      }catch(err){
        return { ok:false, error:String((err && err.message) || err || 'save error') };
      }
    })()`, true);
    console.log('[MAIN] Renderer save result:', result)
    return result
  } catch (_e) {
    console.error('[MAIN] Save bridge error:', _e)
    return { ok: false, error: 'save bridge error' };
  }
}

async function requestRendererHasUnsavedChanges(win) {
  if (!win || win.isDestroyed()) return true;
  try {
    const result = await win.webContents.executeJavaScript(`(async ()=>{
      try{
        if(typeof window.__vapHasUnsavedChanges === 'function') return !!window.__vapHasUnsavedChanges();
        return true;
      }catch(_err){
        return true;
      }
    })()`, true);
    return !!result;
  } catch (_e) {
    return true;
  }
}

async function requestRendererHasOpenProject(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    const result = await win.webContents.executeJavaScript(`(async ()=>{
      try{
        if(typeof window.__vapHasOpenProject === 'function') return !!window.__vapHasOpenProject();
        return false;
      }catch(_err){
        return false;
      }
    })()`, true);
    return !!result;
  } catch (_e) {
    return false;
  }
}

async function requestRendererIsExporting(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    return !!(await win.webContents.executeJavaScript(
      `(()=> !!(typeof window.__vapIsExporting === 'function' && window.__vapIsExporting()))()`, true
    ));
  } catch (_e) { return false; }
}

async function runExitDecisionFlow(win) {
  console.log('[MAIN] Starting exit decision flow...')

  const isExporting = await requestRendererIsExporting(win);
  if (isExporting) {
    const exportAnswer = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancelar cierre (esperar)', 'Forzar cierre (cancela exportación)'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Exportación en curso',
      message: 'Hay una exportación MP4 en curso.',
      detail: 'Si cierras ahora, la exportación se interrumpirá y el archivo puede quedar incompleto.\n\nEspera a que termine o fuerza el cierre.'
    });
    if (exportAnswer.response === 0) return { cancel: true };
    // response === 1: forzar cierre, continúa el flujo normal
  }

  const hasOpenProject = await requestRendererHasOpenProject(win);
  if (!hasOpenProject) {
    console.log('[MAIN] No open project, exiting directly');
    return { cancel: false };
  }

  const hasUnsavedChanges = await requestRendererHasUnsavedChanges(win);
  const answer = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Guardar y salir', 'No guardar', 'Cancelar'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'Cerrar proyecto',
    message: hasUnsavedChanges
      ? '¿Quieres guardar los cambios antes de salir?'
      : 'Hay un proyecto abierto. ¿Quieres guardar antes de salir?',
    detail: hasUnsavedChanges
      ? 'Selecciona Guardar y salir, No guardar o Cancelar.'
      : 'No se detectaron cambios pendientes, pero puedes guardar por seguridad.'
  });

  console.log('[MAIN] User chose button:', answer.response)

  if (answer.response === 2) return { cancel: true };

  if (answer.response === 0) {
    const saveResult = await requestRendererSaveBeforeExit(win);
    console.log('[MAIN] Save result from renderer:', saveResult)
    if (!saveResult || !saveResult.ok) {
      console.log('[MAIN] Save failed, showing warning...')
      await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Entendido'],
        defaultId: 0,
        title: 'No se cerró la app',
        message: 'No se pudo guardar el proyecto.',
        detail: 'La aplicación seguirá abierta para evitar pérdida de datos.'
      });
      return { cancel: true };
    }
  }

  console.log('[MAIN] Exit flow complete, proceeding to quit')
  return { cancel: false };
}

function createWindow() {
  const brandoLockedBuild = isBrandoVariant();
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      devTools: !brandoLockedBuild
    },
    icon: path.join(__dirname, 'icon.icns'),
    title: brandoLockedBuild ? 'VA PRO 1.0 Brando' : 'VA PRO 1.0'
  });
  const rendererPath = resolveRendererHtmlPath();
  win.loadFile(rendererPath).catch((err) => {
    dialog.showErrorBox('Error de carga', `No se pudo abrir la interfaz principal: ${String(err && err.message ? err.message : err)}`);
  });
  mainWindow = win;

  win.on('close', (e) => {
    if (isQuitting || exitFlowActive) return;
    e.preventDefault();
    exitFlowActive = true;
    runExitDecisionFlow(win).then((result) => {
      if (result && result.cancel) {
        exitFlowActive = false;
        return;
      }
      isQuitting = true;
      exitFlowActive = false;
      app.quit();
    }).catch(() => {
      exitFlowActive = false;
    });
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    closePresenterWindow();
  });

  return win;
}

ipcMain.handle('presenter-toggle', async () => {
  try {
    if (presenterWindow && !presenterWindow.isDestroyed()) {
      closePresenterWindow();
      return { ok: true, active: false };
    }
    const created = ensurePresenterWindow();
    if (!created.ok) return { ok: false, active: false, error: created.error };
    notifyPresenterMode(true);
    return { ok: true, active: true };
  } catch (err) {
    return { ok: false, active: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.on('presenter-sync', (_event, payload) => {
  if (!presenterWindow || presenterWindow.isDestroyed()) return;
  presenterSyncPendingPayload = payload || {};
  const forceNow = !!(payload && payload.forceSync);
  const nowMs = Date.now();
  const minInterval = getPresenterTargetSendIntervalMs(presenterSyncPendingPayload);
  const elapsed = nowMs - presenterSyncLastSentAtMs;
  if (forceNow || elapsed >= minInterval) {
    if (presenterSyncFlushTimer) {
      clearTimeout(presenterSyncFlushTimer);
      presenterSyncFlushTimer = null;
    }
    flushPresenterSyncPayload();
    return;
  }
  if (!presenterSyncFlushTimer) {
    const waitMs = Math.max(6, minInterval - elapsed);
    presenterSyncFlushTimer = setTimeout(flushPresenterSyncPayload, waitMs);
  }
});

ipcMain.on('presenter-close', () => {
  closePresenterWindow();
});

// IPC handler para abrir archivo de proyecto desde renderer:
ipcMain.handle('project-open-dialog', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Abrir proyecto',
    buttonLabel: 'Abrir',
    properties: ['openFile'],
    filters: [{ name: 'Proyectos VA PRO', extensions: ['vaproj', 'json'] }]
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return { canceled: true };
  const targetPath = result.filePaths[0];
  try {
    const raw = fs.readFileSync(targetPath, 'utf-8');
    const projectData = JSON.parse(raw);
    const name = path.basename(targetPath, path.extname(targetPath));
    return { canceled: false, path: targetPath, name, projectData };
  } catch (err) {
    return { canceled: false, error: true, message: String(err && err.message ? err.message : err) };
  }
});

// IPC handler para guardar proyecto
ipcMain.handle('project-save', async (event, opts) => {
  const { projectData, currentPath, saveAs, suggestedName } = opts || {};
  
  let targetPath = currentPath;
  if (saveAs || !currentPath) {
    const result = await dialog.showSaveDialog({
      title: 'Guardar proyecto',
      buttonLabel: 'Guardar',
      defaultPath: suggestedName || 'mi_proyecto',
      filters: [{ name: 'Proyectos VA PRO', extensions: ['vaproj'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    targetPath = result.filePath;
  }
  
  try {
    fs.writeFileSync(targetPath, JSON.stringify(projectData, null, 2), 'utf-8');
    const name = path.basename(targetPath, path.extname(targetPath));
    return { canceled: false, ok: true, path: targetPath, name };
  } catch (err) {
    return { canceled: false, ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// IPC handler para abrir proyecto desde ruta específica
ipcMain.handle('project-open-path', async (event, targetPath) => {
  try {
    const raw = fs.readFileSync(targetPath, 'utf-8');
    const projectData = JSON.parse(raw);
    const name = path.basename(targetPath, path.extname(targetPath));
    return { canceled: false, path: targetPath, name, projectData };
  } catch (err) {
    return { canceled: false, error: true, message: String(err && err.message ? err.message : err) };
  }
});

// IPC handler para resolver rutas de cámaras
ipcMain.handle('project-resolve-camera-paths', async (event, opts) => {
  const items = opts && opts.items || [];
  const resolved = [];
  const missing = [];
  
  for (const item of items) {
    const itemPath = item && item.path || '';
    if (!itemPath) continue;
    
    try {
      if (fs.existsSync(itemPath)) {
        resolved.push(item);
      } else {
        missing.push(item);
      }
    } catch (err) {
      missing.push(item);
    }
  }
  
  return { resolved, missing };
});

ipcMain.handle('pick-camera-xml-files', async (event, opts) => {
  const filters = [
    {
      name: 'Videos y XML',
      extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mts', 'm2ts', 'xml']
    },
    {
      name: 'Todos los archivos',
      extensions: ['*']
    }
  ];
  const result = await dialog.showOpenDialog({
    title: String((opts && opts.title) || 'Buscar cámaras y XML'),
    properties: [
      'openFile',
      (opts && opts.multiple) === false ? null : 'multiSelections'
    ].filter(Boolean),
    filters
  });
  if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths.length) {
    return { canceled: true, files: [] };
  }
  const files = result.filePaths.map((p) => ({
    path: p,
    name: path.basename(p),
    type: /\.xml$/i.test(String(p || '')) ? 'text/xml' : ''
  }));
  return { canceled: false, files };
});

ipcMain.handle('ensure-workspace-folders', async () => {
  try {
    const root = ensureWorkspaceFolders();
    return { ok: true, root };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('save-workspace-files', async (event, opts) => {
  try {
    const root = ensureWorkspaceFolders();
    const folder = String((opts && opts.folder) || '').trim();
    const basePathRaw = String((opts && opts.basePath) || '').trim();
    const basePath = basePathRaw ? path.resolve(basePathRaw) : root;
    const targetDir = folder ? path.join(basePath, folder) : basePath;
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const files = Array.isArray(opts && opts.files) ? opts.files : [];
    const paths = [];
    files.forEach((file) => {
      const name = String(file && file.name || '').trim();
      if (!name) return;
      const content = file && file.content !== undefined ? String(file.content) : '';
      const outPath = path.join(targetDir, name);
      fs.writeFileSync(outPath, content, 'utf-8');
      paths.push(outPath);
    });
    return { ok: true, paths, targetDir };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('generate-pdf-report', async (_event, opts) => {
  let win = null;
  try {
    const html = String((opts && opts.html) || '').trim();
    if (!html) throw new Error('HTML vacio');
    const outputRaw = String((opts && opts.outputPath) || '').trim();
    if (!outputRaw) throw new Error('Ruta de salida invalida');
    const outputPath = /\.pdf$/i.test(outputRaw) ? outputRaw : (outputRaw + '.pdf');
    const title = String((opts && opts.title) || 'Reporte').trim() || 'Reporte';

    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    const htmlDoc = html.includes('<title>')
      ? html
      : html.replace('<head>', '<head><title>' + title.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</title>');
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlDoc);
    await win.loadURL(dataUrl);

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });
    fs.writeFileSync(outputPath, pdfBuffer);
    return { ok: true, outputPath };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    if (win && !win.isDestroyed()) {
      try { win.close(); } catch (_e) {}
    }
  }
});

ipcMain.handle('generate-map-pdf-report', async (_event, opts) => {
  try {
    const {
      PDFDocument, PDFRawStream, PDFName, PDFString, PDFNumber, rgb, StandardFonts
    } = require('pdf-lib');

    const mapImageDataUrl = String(opts && opts.mapImageDataUrl || '');
    const clipsData = Array.isArray(opts && opts.clips) ? opts.clips : [];
    const outputPath = String(opts && opts.outputPath || '');
    const reportTitle = String(opts && opts.title || 'Reporte de Campo').slice(0, 80);
    const deleteSourcesAfterEmbed = !!(opts && opts.deleteSourcesAfterEmbed);
    const toWinAnsiSafe = (value) => {
      // Helvetica estándar de pdf-lib usa WinAnsi; limpiamos símbolos fuera de ese rango.
      return String(value == null ? '' : value)
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[\u2022\u25CF]/g, 'o')
        .replace(/[^\x20-\x7E\xA1-\xFF]/g, '?');
    };

    if (!mapImageDataUrl || !outputPath) throw new Error('Datos de entrada incompletos');

    const b64 = mapImageDataUrl.replace(/^data:image\/[^;]+;base64,/, '');
    const mapBytes = Buffer.from(b64, 'base64');
    const isJpeg = /^data:image\/jpe?g/i.test(mapImageDataUrl);

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(reportTitle);
    pdfDoc.setCreator('VA PRO');

    // A4 apaisado
    const PW = 841.89;
    const PH = 595.28;
    const page = pdfDoc.addPage([PW, PH]);

    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const margin  = 18;
    const titleH  = 26;
    const mapX    = margin;
    const mapY    = margin;
    const mapW    = PW - margin * 2;
    const mapH    = PH - margin * 2 - titleH;

    // Cabecera
    page.drawRectangle({ x: mapX, y: mapY + mapH, width: mapW, height: titleH, color: rgb(0.06, 0.09, 0.16) });
    const safeReportTitle = toWinAnsiSafe(reportTitle);
    page.drawText(safeReportTitle, { x: mapX + 12, y: mapY + mapH + 8, size: 13, font: fontBold, color: rgb(1, 1, 1) });
    const dateStr = new Date().toLocaleDateString('es-ES');
    page.drawText(toWinAnsiSafe(dateStr), { x: PW - margin - 65, y: mapY + mapH + 8, size: 9, font: fontReg, color: rgb(0.75, 0.8, 0.9) });

    // Imagen de campo
    let mapImage;
    try {
      mapImage = isJpeg ? await pdfDoc.embedJpg(mapBytes) : await pdfDoc.embedPng(mapBytes);
    } catch (_e) {
      try { mapImage = await pdfDoc.embedPng(mapBytes); } catch (_e2) { mapImage = await pdfDoc.embedJpg(mapBytes); }
    }
    page.drawImage(mapImage, { x: mapX, y: mapY, width: mapW, height: mapH });

    const annoRefs = [];
    const embeddedFilesNamePairs = [];
    const embeddedFileSpecRefs = [];
    const DOT_R = 8;

    for (let i = 0; i < clipsData.length; i++) {
      const clip = clipsData[i];
      if (!clip) continue;
      const pt = clip.mapPoint;
      const hasPoint = pt && Number.isFinite(Number(pt.x)) && Number.isFinite(Number(pt.y));

      // Coordenadas en la página (canvas y=0 arriba → PDF y=0 abajo)
      const dotX = hasPoint ? (mapX + Number(pt.x) * mapW) : (mapX + 24 + (i % 12) * 60);
      const dotY = hasPoint ? (mapY + (1 - Number(pt.y)) * mapH) : (mapY + mapH - 24 - Math.floor(i / 12) * 24);

      // Punto rojo con borde blanco
      page.drawCircle({ x: dotX, y: dotY, size: DOT_R, color: rgb(0.94, 0.27, 0.27), borderColor: rgb(1, 1, 1), borderWidth: 1.8 });

      // Número pequeño dentro del punto
      if (i < 99) {
        const numStr = String(i + 1);
        const numSize = i < 9 ? 7 : 6;
        const numOffX = i < 9 ? -2.5 : -4.5;
        page.drawText(numStr, { x: dotX + numOffX, y: dotY - 3, size: numSize, font: fontBold, color: rgb(1, 1, 1) });
      }

      // Etiqueta con nombre del corte
      const label = toWinAnsiSafe(String(clip.name || ('Accion ' + (i + 1))).slice(0, 30));
      const labelFs = 8.5;
      const labelW  = Math.max(52, Math.min(185, label.length * 5.2 + 18));
      const labelH2 = 15;
      let lx = dotX + DOT_R + 4;
      let ly = dotY - labelH2 / 2;
      // Ajustar para no salirse del mapa
      if (lx + labelW > mapX + mapW - 3) lx = dotX - labelW - DOT_R - 4;
      if (ly < mapY + 2)                  ly = dotY + DOT_R;
      if (ly + labelH2 > mapY + mapH - 2) ly = dotY - labelH2 - DOT_R;

      page.drawRectangle({ x: lx, y: ly, width: labelW, height: labelH2, color: rgb(0.06, 0.09, 0.16), opacity: 0.85, borderRadius: 2 });
      page.drawText(label, { x: lx + 6, y: ly + 3.5, size: labelFs, font: fontBold, color: rgb(1, 1, 1) });

      // Nota de mapa opcional debajo de la etiqueta
      const mapNote = toWinAnsiSafe(String(clip.mapNote || '').trim());
      if (mapNote) {
        const noteStr = mapNote.slice(0, 45);
        const noteW = Math.max(52, Math.min(210, noteStr.length * 4.5 + 14));
        page.drawRectangle({ x: lx, y: ly - 13, width: noteW, height: 12, color: rgb(0.12, 0.22, 0.38), opacity: 0.82, borderRadius: 2 });
        page.drawText(noteStr, { x: lx + 5, y: ly - 10, size: 7, font: fontReg, color: rgb(0.82, 0.9, 1) });
      }

      // Embedding MP4 como FileAttachment (clickeable en Acrobat/Preview)
      const videoPath = String(clip.videoPath || '');
      if (videoPath && fs.existsSync(videoPath)) {
        try {
          const videoBytes = fs.readFileSync(videoPath);
          const fileName   = path.basename(videoPath);

          // Stream del archivo embebido
          const streamDict = pdfDoc.context.obj({
            Type:   PDFName.of('EmbeddedFile'),
            Subtype: PDFName.of('video/mp4'),
            Length: PDFNumber.of(videoBytes.length),
          });
          const embStream = PDFRawStream.of(streamDict, new Uint8Array(videoBytes));
          const embRef    = pdfDoc.context.register(embStream);

          // Filespec
          const fileSpec = pdfDoc.context.obj({
            Type: PDFName.of('Filespec'),
            F:    PDFString.of(fileName),
            UF:   PDFString.of(fileName),
            EF:   pdfDoc.context.obj({ F: embRef }),
          });
          const fileSpecRef = pdfDoc.context.register(fileSpec);
          embeddedFilesNamePairs.push(PDFString.of(fileName), fileSpecRef);
          embeddedFileSpecRefs.push(fileSpecRef);

          // Acción Launch al archivo embebido (mejor compatibilidad que JS en varios lectores).
          const launchAction = pdfDoc.context.obj({
            Type: PDFName.of('Action'),
            S:    PDFName.of('Launch'),
            F:    fileSpecRef,
          });
          const launchActionRef = pdfDoc.context.register(launchAction);

          const nativeAbs = path.resolve(videoPath).replace(/\\/g, '/');
          const fileUri = encodeURI('file://' + (nativeAbs.startsWith('/') ? nativeAbs : ('/' + nativeAbs)));
          const uriAction = pdfDoc.context.obj({
            Type: PDFName.of('Action'),
            S:    PDFName.of('URI'),
            URI:  PDFString.of(fileUri),
          });
          const uriActionRef = pdfDoc.context.register(uriAction);

          // Anotación FileAttachment centrada en el punto (icono de película)
          const attachAnnot = pdfDoc.context.obj({
            Type:     PDFName.of('Annot'),
            Subtype:  PDFName.of('FileAttachment'),
            Rect:     pdfDoc.context.obj([dotX - DOT_R, dotY - DOT_R, dotX + DOT_R, dotY + DOT_R]),
            FS:       fileSpecRef,
            Name:     PDFName.of('Movie'),
            Contents: PDFString.of(label + (mapNote ? (' · ' + mapNote) : '')),
            T:        PDFString.of(String(i + 1) + '. ' + label),
            F:        PDFNumber.of(4),
          });
          annoRefs.push(pdfDoc.context.register(attachAnnot));

          // También hacemos la etiqueta clickeable como adjunto nativo (sin JavaScript)
          // para que funcione en Preview y lectores que bloquean acciones JS.
          const labelAttachAnnot = pdfDoc.context.obj({
            Type:     PDFName.of('Annot'),
            Subtype:  PDFName.of('FileAttachment'),
            Rect:     pdfDoc.context.obj([lx, ly, lx + labelW, ly + labelH2]),
            FS:       fileSpecRef,
            Name:     PDFName.of('Paperclip'),
            Contents: PDFString.of('Abrir video: ' + label),
            T:        PDFString.of(String(i + 1) + '. ' + label),
            F:        PDFNumber.of(4),
          });
          annoRefs.push(pdfDoc.context.register(labelAttachAnnot));

          // Link invisible sobre el nombre: abrir siempre el MP4 local exportado.
          const labelLaunchLink = pdfDoc.context.obj({
            Type:    PDFName.of('Annot'),
            Subtype: PDFName.of('Link'),
            Rect:    pdfDoc.context.obj([lx, ly, lx + labelW, ly + labelH2]),
            A:       uriActionRef,
            Border:  pdfDoc.context.obj([0, 0, 0]),
            H:       PDFName.of('P'),
          });
          annoRefs.push(pdfDoc.context.register(labelLaunchLink));

        } catch (_embErr) { /* no bloquear si falla embedding de un clip */ }
      }
    }

    if (annoRefs.length) {
      page.node.set(PDFName.of('Annots'), pdfDoc.context.obj(annoRefs));
    }

    // Registrar adjuntos en Names/EmbeddedFiles + AF del catálogo para máxima compatibilidad.
    if (embeddedFilesNamePairs.length) {
      const embeddedFilesDict = pdfDoc.context.obj({
        Names: pdfDoc.context.obj(embeddedFilesNamePairs),
      });
      const namesDict = pdfDoc.context.obj({
        EmbeddedFiles: embeddedFilesDict,
      });
      pdfDoc.catalog.set(PDFName.of('Names'), namesDict);
      pdfDoc.catalog.set(PDFName.of('AF'), pdfDoc.context.obj(embeddedFileSpecRefs));
    }

    // Leyenda pie de página
    page.drawText('Mapa de anotaciones exportado desde VA PRO - ' + safeReportTitle, {
      x: mapX + 4, y: mapY - 12, size: 7, font: fontReg, color: rgb(0.5, 0.55, 0.65),
    });

    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);

    if (deleteSourcesAfterEmbed) {
      // Limpieza segura de MP4 temporales: se borra solo lo listado en clipsData.
      for (const clip of clipsData) {
        const vp = String(clip && clip.videoPath || '').trim();
        if (!vp) continue;
        try {
          if (fs.existsSync(vp) && fs.statSync(vp).isFile()) fs.unlinkSync(vp);
        } catch (_e) {}
      }
      // Intentar borrar carpeta videos si queda vacía.
      try {
        const firstPath = String(clipsData[0] && clipsData[0].videoPath || '').trim();
        if (firstPath) {
          const maybeDir = path.dirname(firstPath);
          if (/[/\\]videos$/i.test(maybeDir) && fs.existsSync(maybeDir)) {
            const left = fs.readdirSync(maybeDir);
            if (!left.length) fs.rmdirSync(maybeDir);
          }
        }
      } catch (_e) {}
    }

    return { ok: true, outputPath };

  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('pick-folder', async (event, opts) => {
  const result = await dialog.showOpenDialog({
    title: String(opts && opts.title || 'Seleccionar carpeta'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle('media-access-status', async () => {
  try {
    if (process.platform !== 'darwin') return { camera: 'not-applicable', microphone: 'not-applicable' };
    const camera = systemPreferences.getMediaAccessStatus('camera');
    const microphone = systemPreferences.getMediaAccessStatus('microphone');
    return { camera, microphone };
  } catch (_e) {
    return { camera: 'unknown', microphone: 'unknown' };
  }
});

ipcMain.handle('media-access-request', async () => {
  try {
    if (process.platform !== 'darwin') return { camera: 'not-applicable', microphone: 'not-applicable' };
    const camera = await systemPreferences.askForMediaAccess('camera');
    const microphone = await systemPreferences.askForMediaAccess('microphone');
    return { camera: camera ? 'granted' : 'denied', microphone: microphone ? 'granted' : 'denied' };
  } catch (_e) {
    return { camera: 'unknown', microphone: 'unknown' };
  }
});

ipcMain.handle('open-media-privacy-settings', async () => {
  try {
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
      return { ok: true };
    }
    return { ok: false };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('youtube-download-video', async (event, opts) => {
  try {
    const url = String(opts && opts.url || '').trim();
    if (!url) throw new Error('URL vacía');
    const qualityPreset = String(opts && opts.qualityPreset || 'original').trim();
    const allowJDownloader = (opts && Object.prototype.hasOwnProperty.call(opts, 'allowJDownloader'))
      ? !!opts.allowJDownloader
      : true;
    const forceOkDirect = !!(opts && opts.forceOkDirect);
    const isYouTubeUrl = !!extractYouTubeVideoId(url);
    const parsedUrl = (() => { try { return new URL(url); } catch (_e) { return null; } })();
    const host = String((parsedUrl && parsedUrl.hostname) || '').toLowerCase();
    const isOkHost = host === 'ok.ru' || host.endsWith('.ok.ru') || host === 'odnoklassniki.ru' || host.endsWith('.odnoklassniki.ru');

    let ytDlpReady = true;
    let ytDlpBin = '';
    try {
      ytDlpBin = await ensureYtDlpAvailable();
    } catch (_e) {
      ytDlpReady = false;
    }

    let aria2Bin = '';
    let hasAria2 = false;
    try {
      aria2Bin = await ensureAria2Available();
      hasAria2 = !!aria2Bin;
    } catch (_e) {
      hasAria2 = false;
    }

    const height = Number(qualityPreset);
    const notifyRendererProgress = (percent, status, phase = 'download') => {
      try {
        if (!event || !event.sender) return;
        event.sender.send('youtube-download-progress', {
          percent: Number.isFinite(Number(percent)) ? Number(percent) : null,
          status: String(status || ''),
          phase: String(phase || 'download')
        });
      } catch (_e) {}
    };

    notifyRendererProgress(1, 'Preparando descarga...', 'prepare');

    const formatBestWithAudio = Number.isFinite(height)
      ? `bestvideo[height<=${height}][vcodec!=none]+bestaudio[acodec!=none]/best[height<=${height}][vcodec!=none][acodec!=none]/bestvideo+bestaudio/best`
      : 'bestvideo[vcodec!=none]+bestaudio[acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best';
    const formatOkDirectPreferred = Number.isFinite(height)
      ? `best[protocol^=http][ext=mp4][height<=${height}][vcodec!=none][acodec!=none]/best[protocol^=http][height<=${height}][vcodec!=none][acodec!=none]/best[ext=mp4][height<=${height}][vcodec!=none][acodec!=none]/best[height<=${height}]`
      : 'best[protocol^=http][ext=mp4][vcodec!=none][acodec!=none]/best[protocol^=http][vcodec!=none][acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]/best';
    const formatProgressivePreferred = Number.isFinite(height)
      ? `best[ext=mp4][height<=${height}][vcodec!=none][acodec!=none]/best[height<=${height}][vcodec!=none][acodec!=none]/best[ext=mp4]/best`
      : 'best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best[ext=mp4]/best';
    const formatRelaxed = Number.isFinite(height)
      ? `best[height<=${height}]/best`
      : 'best';

    const defaultName = (isYouTubeUrl ? 'youtube_video_' : 'video_') + new Date().toISOString().replace(/[:.]/g, '-') + '.mp4';
    const result = await dialog.showSaveDialog({
      title: isYouTubeUrl ? 'Guardar MP4 de YouTube' : 'Guardar MP4',
      defaultPath: path.join(app.getPath('downloads'), defaultName),
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const outputPath = result.filePath.endsWith('.mp4') ? result.filePath : (result.filePath + '.mp4');
    const fallbackErrors = [];
    const shortErr = (err) => String(err && err.message ? err.message : err).replace(/\s+/g, ' ').slice(0, 220);
    const pushErr = (engine, err) => {
      fallbackErrors.push(`${engine}: ${shortErr(err)}`);
    };

    const buildYtDlpArgs = (formatExpr, cookieBrowser = '') => {
      const out = [
        '--no-playlist',
        '--geo-bypass',
        '--no-check-certificates',
        '--prefer-insecure',
        '--retries', '2',
        '--fragment-retries', '2',
        '--merge-output-format', 'mp4',
        '--newline',
        ...buildTurboYtDlpDownloadArgs(hasAria2, aria2Bin, isOkHost),
        '-f', formatExpr,
        '-o', outputPath
      ];
      if (isYouTubeUrl) {
        out.push('--extractor-args', 'youtube:player_client=android,web,mweb');
        out.push('--add-header', 'Referer:https://www.youtube.com/');
        out.push('--add-header', 'Origin:https://www.youtube.com');
        out.push('--add-header', 'User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        if (cookieBrowser) out.push('--cookies-from-browser', cookieBrowser);
      } else if (isOkHost) {
        out.push('--add-header', 'Referer:https://ok.ru/');
        out.push('--add-header', 'Origin:https://ok.ru');
        out.push('--add-header', 'User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        if (cookieBrowser) out.push('--cookies-from-browser', cookieBrowser);
      }
      out.push(url);
      return out;
    };

    const tryYtDlpWithBin = async (binPath, engineLabel) => {
      const attempts = [];
      if (isOkHost) attempts.push({ format: formatOkDirectPreferred, cookieBrowser: '', label: 'ok-direct-mp4' });
      if (!(isOkHost && forceOkDirect)) {
        attempts.push({ format: formatBestWithAudio, cookieBrowser: '', label: 'bestvideo+bestaudio' });
        attempts.push({ format: formatProgressivePreferred, cookieBrowser: '', label: 'progressive' });
        attempts.push({ format: formatRelaxed, cookieBrowser: '', label: 'relaxed' });
      }
      if (isYouTubeUrl) {
        attempts.push({ format: formatBestWithAudio, cookieBrowser: 'safari', label: 'bestvideo+bestaudio-cookies-safari' });
        attempts.push({ format: formatBestWithAudio, cookieBrowser: 'chrome', label: 'bestvideo+bestaudio-cookies-chrome' });
        attempts.push({ format: formatBestWithAudio, cookieBrowser: 'brave', label: 'bestvideo+bestaudio-cookies-brave' });
        attempts.push({ format: formatBestWithAudio, cookieBrowser: 'chromium', label: 'bestvideo+bestaudio-cookies-chromium' });
        attempts.push({ format: formatBestWithAudio, cookieBrowser: 'firefox', label: 'bestvideo+bestaudio-cookies-firefox' });
      } else if (isOkHost) {
        attempts.push({ format: formatOkDirectPreferred, cookieBrowser: 'safari', label: 'ok-direct-mp4-cookies-safari' });
        attempts.push({ format: formatOkDirectPreferred, cookieBrowser: 'chrome', label: 'ok-direct-mp4-cookies-chrome' });
        attempts.push({ format: formatOkDirectPreferred, cookieBrowser: 'brave', label: 'ok-direct-mp4-cookies-brave' });
        attempts.push({ format: formatOkDirectPreferred, cookieBrowser: 'chromium', label: 'ok-direct-mp4-cookies-chromium' });
        attempts.push({ format: formatOkDirectPreferred, cookieBrowser: 'firefox', label: 'ok-direct-mp4-cookies-firefox' });
      }
      let lastErr = null;
      for (const attempt of attempts) {
        try {
          notifyRendererProgress(null, `Descargando (${attempt.label}${hasAria2 ? ' · turbo aria2' : ' · turbo interno'})...`, 'download');
          await runYtDlpCommandWithProgress(
            binPath,
            buildYtDlpArgs(attempt.format, attempt.cookieBrowser),
            (prog) => {
              const pct = Number.isFinite(Number(prog && prog.percent)) ? Number(prog.percent) : null;
              const msg = String((prog && prog.status) || 'Descargando...');
              notifyRendererProgress(pct, msg, 'download');
            }
          );
          notifyRendererProgress(100, 'Descarga completada', 'done');
          return { ok: true, mode: attempt.label };
        } catch (err) {
          lastErr = err;
          pushErr(`${engineLabel}/${attempt.label}`, err);
        }
      }
      throw (lastErr || new Error(`${engineLabel} falló`));
    };

    if (ytDlpReady && ytDlpBin) {
      try {
        await tryYtDlpWithBin(ytDlpBin, 'yt-dlp');
        return { canceled: false, outputPath, engine: hasAria2 ? 'yt-dlp+aria2' : 'yt-dlp-turbo' };
      } catch (err) {
        pushErr('yt-dlp/binario', err);
      }
    }

    if (!ytDlpReady) {
      try {
        const pipYtDlp = await tryInstallYtDlpWithPipUser();
        await tryYtDlpWithBin(pipYtDlp, 'yt-dlp-pip-user');
        return { canceled: false, outputPath, fallback: 'yt-dlp-pip-user' };
      } catch (err) {
        pushErr('yt-dlp-pip-user', err);
      }
    }

    try {
      const embeddedYtDlp = await ensureEmbeddedYtDlpAvailable();
      await tryYtDlpWithBin(embeddedYtDlp, 'yt-dlp-embedded');
      return { canceled: false, outputPath, fallback: 'yt-dlp-embedded' };
    } catch (err) {
      pushErr('yt-dlp-embedded', err);
    }

    try {
      notifyRendererProgress(null, 'Probando motor AnyDownloader...', 'download');
      const anyResult = await tryAnyDownloaderDownload(url, outputPath, {
        qualityPreset,
        isYouTubeUrl,
        isOkHost
      });
      notifyRendererProgress(100, 'Descarga completada', 'done');
      return { canceled: false, outputPath, fallback: 'anydownloader', mode: anyResult && anyResult.mode ? anyResult.mode : 'default' };
    } catch (err) {
      pushErr('anydownloader', err);
    }

    if (isYouTubeUrl) {
      try {
        await tryPipedDownload(url, outputPath, qualityPreset);
        return { canceled: false, outputPath, fallback: 'piped' };
      } catch (err) {
        pushErr('piped', err);
      }

      try {
        await tryInvidiousDownload(url, outputPath, qualityPreset);
        return { canceled: false, outputPath, fallback: 'invidious' };
      } catch (err) {
        pushErr('invidious', err);
      }

      try {
        await tryYtdlCoreDownload(url, outputPath, qualityPreset);
        return { canceled: false, outputPath, fallback: 'ytdl-core' };
      } catch (err) {
        pushErr('ytdl-core', err);
      }
    }

    if (allowJDownloader) {
      const sent = await sendToJDownloader(url, 'VA_PRO_Youtube');
      if (sent) return { canceled: false, jdownloader: true, fallback: 'jdownloader' };
      pushErr('jdownloader', 'No respondió en 127.0.0.1:9666');
    }

    try {
      await tryCobaltDownload(url, outputPath);
      return { canceled: false, outputPath, fallback: 'cobalt' };
    } catch (err) {
      pushErr('cobalt', err);
      const detail = fallbackErrors.length ? (' Detalle: ' + fallbackErrors.join(' | ')) : '';
      throw new Error('No se pudo descargar YouTube en esta red/equipo.' + detail);
    }
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    return { canceled: false, error: message };
  }
});

ipcMain.handle('youtube-resolve-stream-url', async (event, opts) => {
  try {
    const input = String(opts && (opts.input || opts.url || opts.videoId) || '').trim();
    const qualityPreset = String(opts && opts.quality || 'high').trim().toLowerCase();
    const resolved = await resolveYoutubeDirectStreamUrl(input, qualityPreset);
    return { ok: true, streamUrl: resolved.streamUrl, videoId: resolved.videoId, source: resolved.source };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('resolve-video-stream-url', async (event, opts) => {
  try {
    const input = normalizeVideoInputUrl(String(opts && (opts.input || opts.url || '') || '').trim());
    const qualityPreset = String(opts && opts.quality || 'high').trim().toLowerCase();
    const resolved = await resolveGenericDirectStreamUrl(input, qualityPreset);
    return { ok: true, streamUrl: resolved.streamUrl, source: resolved.source };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('download-video-temp-source', async (event, opts) => {
  try {
    const input = normalizeVideoInputUrl(String(opts && (opts.input || opts.url || '') || '').trim());
    if (!input) throw new Error('URL vacía');
    const qualityPreset = String(opts && opts.quality || 'high').trim().toLowerCase();
    const isYouTubeUrl = !!extractYouTubeVideoId(input);
    const tempDir = path.join(app.getPath('temp'), 'va-pro-stream-cache');
    try { fs.mkdirSync(tempDir, { recursive: true }); } catch (_e) {}
    const stamp = Date.now();
    const prefix = `src_${stamp}_`;
    const outTemplate = path.join(tempDir, prefix + '%(id)s.%(ext)s');
    const formatExpr = (qualityPreset === 'balanced')
      ? 'best[height<=720][vcodec!=none][acodec!=none]/best[height<=720]/best'
      : 'best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best';

    const parsedInput = (()=>{ try{ return new URL(input) }catch(_e){ return null } })();
    const host = String((parsedInput && parsedInput.hostname) || '').toLowerCase();
    const isOkHost = host === 'ok.ru' || host.endsWith('.ok.ru') || host === 'odnoklassniki.ru' || host.endsWith('.odnoklassniki.ru');

    let aria2Bin = '';
    let hasAria2 = false;
    try {
      aria2Bin = await ensureAria2Available();
      hasAria2 = !!aria2Bin;
    } catch (_e) {
      hasAria2 = false;
    }

    const buildArgs = (cookieBrowser = '') => {
      const args = [
        '--no-playlist',
        '--no-check-certificates',
        '--prefer-insecure',
        '--retries', '2',
        '--fragment-retries', '2',
        '--merge-output-format', 'mp4',
        '--newline',
        ...buildTurboYtDlpDownloadArgs(hasAria2, aria2Bin, isOkHost),
        '-f', formatExpr,
        '-o', outTemplate
      ];
      if (isYouTubeUrl) {
        args.push('--extractor-args', 'youtube:player_client=android,web,mweb');
        args.push('--add-header', 'Referer:https://www.youtube.com/');
        args.push('--add-header', 'Origin:https://www.youtube.com');
        args.push('--add-header', 'User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
      } else if (isOkHost) {
        args.push('--add-header', 'Referer:https://ok.ru/');
        args.push('--add-header', 'Origin:https://ok.ru');
        args.push('--add-header', 'User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
      }
      if (cookieBrowser) args.push('--cookies-from-browser', cookieBrowser);
      args.push(input);
      return args;
    };

    const runWith = async (binPath) => {
      const attempts = [''];
      if (isOkHost) attempts.push('safari', 'chrome', 'brave', 'chromium', 'firefox');
      let lastErr = null;
      for (const cookieBrowser of attempts) {
        try {
          await runCommand(binPath, buildArgs(cookieBrowser));
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      throw (lastErr || new Error('yt-dlp falló para descarga temporal'));
    };

    let ytdlpError = null;
    try {
      const ytDlpBin = await ensureYtDlpAvailable();
      await runWith(ytDlpBin);
    } catch (errPrimary) {
      ytdlpError = errPrimary;
      try {
        const embeddedYtDlp = await ensureEmbeddedYtDlpAvailable();
        await runWith(embeddedYtDlp);
        ytdlpError = null;
      } catch (errEmbedded) {
        ytdlpError = errEmbedded;
      }
    }

    // Fallback AnyDownloader when yt-dlp path fails.
    if (ytdlpError) {
      const anyOut = path.join(tempDir, `${prefix}anydownloader.mp4`);
      try {
        await tryAnyDownloaderDownload(input, anyOut, {
          qualityPreset,
          isYouTubeUrl,
          isOkHost
        });
        return { ok: true, filePath: anyOut, source: 'anydownloader-temp' };
      } catch (_e) {}
    }

    // For non-YouTube providers (e.g. OK.ru), try Cobalt fallback when yt-dlp path fails.
    if (ytdlpError && !isYouTubeUrl) {
      const cobaltOut = path.join(tempDir, `${prefix}cobalt.mp4`);
      try {
        await tryCobaltDownload(input, cobaltOut);
        return { ok: true, filePath: cobaltOut, source: 'cobalt-temp' };
      } catch (_e) {
        throw ytdlpError;
      }
    }

    if (ytdlpError) {
      throw ytdlpError;
    }

    const files = fs.readdirSync(tempDir)
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({
        name,
        full: path.join(tempDir, name),
        mtime: (() => { try { return fs.statSync(path.join(tempDir, name)).mtimeMs; } catch (_e) { return 0; } })()
      }))
      .sort((a, b) => Number(b.mtime || 0) - Number(a.mtime || 0));

    if (!files.length) throw new Error('No se generó archivo temporal');
    return { ok: true, filePath: files[0].full, source: 'yt-dlp-temp' };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('convert-to-mp4-from-file', async (event, opts) => {
  try {
    const sourcePath = String(opts && opts.sourcePath || '').trim();
    if (!sourcePath) throw new Error('Fuente inválida para conversión');
    if (!fs.existsSync(sourcePath)) throw new Error('Archivo fuente no encontrado');

    const suggestedNameRaw = String(opts && opts.suggestedName || 'exportacion').trim() || 'exportacion';
    const suggestedName = suggestedNameRaw.replace(/[\\/:*?"<>|]+/g, '_');
    const result = await dialog.showSaveDialog({
      title: 'Guardar MP4',
      defaultPath: path.join(app.getPath('downloads'), suggestedName + '.mp4'),
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const outputPath = result.filePath.endsWith('.mp4') ? result.filePath : (result.filePath + '.mp4');

    const conv = await convertToMp4FromSource(sourcePath, outputPath);

    const removeSource = !!(opts && opts.removeSource);
    if (removeSource) {
      try { fs.unlinkSync(sourcePath); } catch (_e) {}
    }

    return { canceled: false, outputPath, engine: conv.engine, silent: !!conv.silent };
  } catch (err) {
    return { canceled: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('convert-to-mp4-from-file-auto', async (_event, opts) => {
  try {
    const sourcePath = String(opts && opts.sourcePath || '').trim();
    if (!sourcePath) throw new Error('Fuente inválida para conversión');
    if (!fs.existsSync(sourcePath)) throw new Error('Archivo fuente no encontrado');

    const suggestedNameRaw = String(opts && opts.suggestedName || 'grabacion').trim() || 'grabacion';
    const baseName = suggestedNameRaw.replace(/[\\/:*?"<>|]+/g, '_');
    const downloadsDir = app.getPath('downloads');
    let outputPath = path.join(downloadsDir, baseName + '.mp4');
    let suffix = 1;
    while (fs.existsSync(outputPath)) {
      outputPath = path.join(downloadsDir, baseName + '_' + String(suffix) + '.mp4');
      suffix += 1;
      if (suffix > 9999) throw new Error('No se pudo reservar nombre de salida en Descargas');
    }

    const conv = await convertToMp4FromSource(sourcePath, outputPath, {
      disableHardwareAccel: !!(opts && opts.disableHardwareAccel),
      videoCodec: String((opts && opts.videoCodec) || 'h264'),
      videoBitrateKbps: Number(opts && opts.videoBitrateKbps || 0) || 0,
      audioBitrateKbps: Number(opts && opts.audioBitrateKbps || 0) || 0
    });

    const removeSource = !!(opts && opts.removeSource);
    if (removeSource) {
      try { fs.unlinkSync(sourcePath); } catch (_e) {}
    }

    return { canceled: false, outputPath, engine: conv.engine, silent: !!conv.silent, autoSaved: true };
  } catch (err) {
    return { canceled: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('save-recording-direct', async (_event, opts) => {
  try {
    const sourcePath = String(opts && opts.sourcePath || '').trim();
    if (!sourcePath) return { ok: false, error: 'sourcePath vacío' };
    if (!fs.existsSync(sourcePath)) return { ok: false, error: 'Archivo fuente no encontrado' };
    const baseName = String(opts && opts.baseName || 'grabacion').replace(/[\\/:*?"<>|]+/g, '_') || 'grabacion';
    const downloadsDir = app.getPath('downloads');
    let outputPath = path.join(downloadsDir, baseName + '.mp4');
    let suffix = 1;
    while (fs.existsSync(outputPath)) {
      outputPath = path.join(downloadsDir, baseName + '_' + String(suffix) + '.mp4');
      suffix++;
      if (suffix > 9999) throw new Error('No se pudo reservar nombre de salida');
    }
    fs.copyFileSync(sourcePath, outputPath);
    return { ok: true, outputPath };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('ffmpeg-export-cut', async (event, opts) => {
  try {
    const ffmpegBin = await ensureFfmpegAvailable();
    const sourcePath = String(opts && opts.sourcePath || '').trim();
    if (!sourcePath) throw new Error('Fuente invalida');
    const start = Number(opts && opts.start || 0);
    const duration = Number(opts && opts.duration || 0);
    if (!(duration > 0)) throw new Error('Duracion invalida');
    const audioSourcePath = String(opts && opts.audioSourcePath || '').trim();
    const audioStart = Number(opts && opts.audioStart || 0);
    const width = Number(opts && opts.width || 1280);
    const height = Number(opts && opts.height || 720);
    const includeLabel = !!(opts && opts.includeLabel);
    const includeClock = !!(opts && opts.includeClock);
    const clockStartSec = Number(opts && opts.clockStartSec || 0);
    const includeAudio = (opts && Object.prototype.hasOwnProperty.call(opts, 'includeAudio')) ? !!opts.includeAudio : true;
    const labelText = String(opts && opts.labelText || '').trim();
    const fps = Math.max(10, Math.min(60, Number(opts && opts.fps || 30)));
    const crf = qualityToCrf(opts && opts.quality);

    const defaultName = String(opts && opts.cutName || 'corte').trim().replace(/[^\w\-\.]+/g, '_') + '.mp4';
    const result = await dialog.showSaveDialog({
      title: 'Guardar MP4',
      defaultPath: path.join(app.getPath('downloads'), defaultName),
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const outputPath = result.filePath.endsWith('.mp4') ? result.filePath : (result.filePath + '.mp4');

    const filters = [buildScalePadFilter(width, height)];
    filters.push(`trim=duration=${Math.max(0.01, duration)}`);
    filters.push('setpts=PTS-STARTPTS');
    if (includeLabel && labelText) {
      const font = resolveFontFile();
      const txt = escapeDrawtext(labelText);
      const fontOpt = font ? `:fontfile=${font}` : '';
      filters.push(`drawtext=text='${txt}'${fontOpt}:x=w-tw-12:y=h-48:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=6`);
    }
    if (includeClock) {
      const font = resolveFontFile();
      const fontOpt = font ? `:fontfile=${font}` : '';
      const clockExpr = getClockDrawtextExpr(clockStartSec);
      filters.push(`drawtext=text='${clockExpr}'${fontOpt}:x=12:y=h-48:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=6`);
    }

    const videoBitrateKbps = estimateExportVideoBitrateKbps(width, height, fps, opts && opts.quality);
    const videoCandidates = buildTranscoderVideoArgsCandidates({
      videoCodec: 'h264',
      h264Profile: 'high',
      quality: opts && opts.quality,
      fps,
      videoBitrateKbps,
      disableHardwareAccel: !!(opts && opts.disableHardwareAccel)
    });

    const hasExternalAudio = includeAudio && !!audioSourcePath;
    const argsPrefix = hasExternalAudio
      ? [
          '-y',
          '-ss', String(start),
          '-t', String(duration),
          '-i', sourcePath,
          '-ss', String(Math.max(0, audioStart)),
          '-t', String(duration),
          '-i', audioSourcePath,
          '-fflags', '+genpts',
          '-avoid_negative_ts', 'make_zero',
          '-vf', filters.join(','),
          '-r', String(fps),
          '-vsync', 'cfr'
        ]
      : [
          '-y',
          '-ss', String(start),
          '-t', String(duration),
          '-i', sourcePath,
          '-fflags', '+genpts',
          '-avoid_negative_ts', 'make_zero',
          '-vf', filters.join(','),
          '-r', String(fps),
          '-vsync', 'cfr'
        ];

    const sendProgress = (percent) => {
      try {
        if (event && event.sender) event.sender.send('ffmpeg-export-progress', { percent: Math.max(0, Math.min(100, Number(percent) || 0)) });
      } catch (_e) {}
    };
    const safeDuration = Math.max(0.01, duration);
    sendProgress(1);

    let lastErr = null;
    for (const candidate of videoCandidates) {
      const argsBase = argsPrefix.concat(candidate.args || [], ['-movflags', '+faststart']);
      try {
        if (includeAudio) {
          try {
            const audioMapArgs = hasExternalAudio ? ['-map', '0:v:0', '-map', '1:a:0'] : [];
            const audioFilterArgs = hasExternalAudio
              ? []
              : ['-af', `atrim=duration=${Math.max(0.01, duration)},asetpts=PTS-STARTPTS`];
            await runCommandWithProgress(
              ffmpegBin,
              argsBase.concat(audioMapArgs, audioFilterArgs, buildAacAudioArgs(opts && opts.audioBitrateKbps), ['-shortest', outputPath]),
              (outTimeSec) => sendProgress(Math.min(99, Math.round((Math.max(0, Math.min(safeDuration, Number(outTimeSec) || 0)) / safeDuration) * 99)))
            );
          } catch (_eAudio) {
            await runCommandWithProgress(
              ffmpegBin,
              argsBase.concat(['-an', outputPath]),
              (outTimeSec) => sendProgress(Math.min(99, Math.round((Math.max(0, Math.min(safeDuration, Number(outTimeSec) || 0)) / safeDuration) * 99)))
            );
          }
        } else {
          await runCommandWithProgress(
            ffmpegBin,
            argsBase.concat(['-an', outputPath]),
            (outTimeSec) => sendProgress(Math.min(99, Math.round((Math.max(0, Math.min(safeDuration, Number(outTimeSec) || 0)) / safeDuration) * 99)))
          );
        }
        lastErr = null;
        break;
      } catch (errCandidate) {
        lastErr = errCandidate;
      }
    }
    if (lastErr) throw lastErr;
    sendProgress(100);
    return { canceled: false, outputPath };
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    return { canceled: false, error: message };
  }
});

async function renderSegmentToTemp(segment, idx, opts) {
    const ffmpegBin = String(opts && opts.ffmpegBin || '').trim() || (await ensureFfmpegAvailable());
  const isBlack = !!(segment && segment.isBlack);
  const sourcePath = String(segment && segment.sourcePath || '').trim();
  if (!isBlack && !sourcePath) throw new Error('Segmento sin fuente');
  const start = Number(segment && segment.start || 0);
  const duration = Number(segment && segment.duration || 0);
  if (!(duration > 0)) throw new Error('Segmento con duracion invalida');
  const audioSourcePath = String(segment && segment.audioSourcePath || '').trim();
  const audioStart = Number(segment && segment.audioStart || 0);

  const width = Number(opts && opts.width || 1280);
  const height = Number(opts && opts.height || 720);
  const fps = Math.max(10, Math.min(60, Number(opts && opts.fps || 30)));
  const includeLabel = !!(opts && opts.includeLabel);
  const includeClock = !!(opts && opts.includeClock);
  const clockStartSec = Number(segment && segment.clockStartSec || 0);
  const includeAudio = (opts && Object.prototype.hasOwnProperty.call(opts, 'includeAudio')) ? !!opts.includeAudio : true;
  const labelText = String(segment && segment.labelText || '').trim();
  const progressCallback = (opts && typeof opts.progressCallback === 'function') ? opts.progressCallback : null;

  const filters = [buildScalePadFilter(width, height)];
  filters.push(`trim=duration=${Math.max(0.01, duration)}`);
  filters.push('setpts=PTS-STARTPTS');
  if (includeLabel && labelText) {
    const font = resolveFontFile();
    const txt = escapeDrawtext(labelText);
    const fontOpt = font ? `:fontfile=${font}` : '';
    filters.push(`drawtext=text='${txt}'${fontOpt}:x=w-tw-12:y=h-48:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=6`);
  }
  if (includeClock) {
    const font = resolveFontFile();
    const fontOpt = font ? `:fontfile=${font}` : '';
    const clockExpr = getClockDrawtextExpr(clockStartSec);
    filters.push(`drawtext=text='${clockExpr}'${fontOpt}:x=12:y=h-48:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=6`);
  }

  const tmpDir = opts && opts.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'va-pro-'));
  const outPath = path.join(tmpDir, `seg_${idx}.mp4`);
  const videoBitrateKbps = estimateExportVideoBitrateKbps(width, height, fps, opts && opts.quality);
  const videoCandidates = buildTranscoderVideoArgsCandidates({
    videoCodec: 'h264',
    h264Profile: 'high',
    quality: opts && opts.quality,
    fps,
    videoBitrateKbps,
    disableHardwareAccel: !!(opts && opts.disableHardwareAccel)
  });

  if (isBlack) {
    const blackFilters = [];
    if (includeClock) {
      const font = resolveFontFile();
      const fontOpt = font ? `:fontfile=${font}` : '';
      const clockExpr = getClockDrawtextExpr(clockStartSec);
      blackFilters.push(`drawtext=text='${clockExpr}'${fontOpt}:x=12:y=h-48:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=6`);
    }
    const argsPrefix = includeAudio
      ? [
          '-y',
          '-f', 'lavfi',
          '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${Math.max(0.01, duration)}`,
          '-f', 'lavfi',
          '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
          ...(blackFilters.length ? ['-vf', blackFilters.join(',')] : []),
          '-r', String(fps),
          '-vsync', 'cfr'
        ]
      : [
          '-y',
          '-f', 'lavfi',
          '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${Math.max(0.01, duration)}`,
          ...(blackFilters.length ? ['-vf', blackFilters.join(',')] : []),
          '-r', String(fps),
          '-vsync', 'cfr'
        ];

    let blackErr = null;
    for (const candidate of videoCandidates) {
      const args = includeAudio
        ? argsPrefix.concat(candidate.args || [], buildAacAudioArgs(opts && opts.audioBitrateKbps), ['-shortest', '-movflags', '+faststart', outPath])
        : argsPrefix.concat(candidate.args || [], ['-an', '-movflags', '+faststart', outPath]);
      try {
        await runCommandWithProgress(ffmpegBin, args, (outTimeSec) => {
          if (progressCallback) progressCallback(Math.max(0, Math.min(duration, Number(outTimeSec) || 0)), duration);
        });
        blackErr = null;
        break;
      } catch (errCandidate) {
        blackErr = errCandidate;
      }
    }
    if (blackErr) throw blackErr;
    return { outPath, tmpDir };
  }

  const hasExternalAudio = includeAudio && !!audioSourcePath;
  const argsPrefix = hasExternalAudio
    ? [
        '-y',
        '-ss', String(start),
        '-t', String(duration),
        '-i', sourcePath,
        '-ss', String(Math.max(0, audioStart)),
        '-t', String(duration),
        '-i', audioSourcePath,
        '-fflags', '+genpts',
        '-avoid_negative_ts', 'make_zero',
        '-vf', filters.join(','),
        '-r', String(fps),
        '-vsync', 'cfr'
      ]
    : [
        '-y',
        '-ss', String(start),
        '-t', String(duration),
        '-i', sourcePath,
        '-fflags', '+genpts',
        '-avoid_negative_ts', 'make_zero',
        '-vf', filters.join(','),
        '-r', String(fps),
        '-vsync', 'cfr'
      ];

  let lastErr = null;
  for (const candidate of videoCandidates) {
    const argsBase = argsPrefix.concat(candidate.args || [], ['-movflags', '+faststart']);
    try {
      if (includeAudio) {
        try {
          const audioMapArgs = hasExternalAudio ? ['-map', '0:v:0', '-map', '1:a:0'] : [];
          const audioFilterArgs = hasExternalAudio
            ? []
            : ['-af', `atrim=duration=${Math.max(0.01, duration)},asetpts=PTS-STARTPTS`];
          await runCommandWithProgress(
            ffmpegBin,
            argsBase.concat(audioMapArgs, audioFilterArgs, buildAacAudioArgs(opts && opts.audioBitrateKbps), ['-shortest', outPath]),
            (outTimeSec) => {
              if (progressCallback) progressCallback(Math.max(0, Math.min(duration, Number(outTimeSec) || 0)), duration);
            }
          );
        } catch (_eAudio) {
          await runCommandWithProgress(
            ffmpegBin,
            argsBase.concat(['-an', outPath]),
            (outTimeSec) => {
              if (progressCallback) progressCallback(Math.max(0, Math.min(duration, Number(outTimeSec) || 0)), duration);
            }
          );
        }
      } else {
        await runCommandWithProgress(
          ffmpegBin,
          argsBase.concat(['-an', outPath]),
          (outTimeSec) => {
            if (progressCallback) progressCallback(Math.max(0, Math.min(duration, Number(outTimeSec) || 0)), duration);
          }
        );
      }
      lastErr = null;
      break;
    } catch (errCandidate) {
      lastErr = errCandidate;
    }
  }
  if (lastErr) throw lastErr;
  return { outPath, tmpDir };
}

function buildTranscoderVideoArgs(opts = {}) {
  const codec = String(opts.videoCodec || 'h264');
  const quality = qualityToCrf(opts.quality);
  const videoBitrateKbps = resolveTargetVideoBitrateKbps(opts);
  const keyintFrames = Math.max(0, Math.round(Number(opts.keyintSec || 0) * Math.max(1, Number(opts.fps || 24))));
  const threads = String(getFfmpegThreadCount());

  if (codec === 'hevc') {
    return ['-c:v', 'libx265', '-preset', 'superfast', '-crf', String(Math.max(20, Math.min(34, quality + 2))), '-b:v', `${videoBitrateKbps}k`, '-threads', threads];
  }
  if (codec === 'mpeg4') {
    return ['-c:v', 'mpeg4', '-q:v', String(Math.max(2, Math.min(7, Math.round((quality - 10) / 15)))), '-b:v', `${videoBitrateKbps}k`, '-threads', threads];
  }

  const profile = ['baseline', 'main', 'high'].includes(String(opts.h264Profile || '').toLowerCase())
    ? String(opts.h264Profile || 'high').toLowerCase()
    : 'high';
  const args = ['-c:v', 'libx264', '-preset', 'superfast', '-crf', String(quality), '-profile:v', profile, '-b:v', `${videoBitrateKbps}k`, '-threads', threads];
  if (keyintFrames > 0) args.push('-g', String(keyintFrames));
  return args;
}

function buildTranscoderVideoArgsCandidates(opts = {}) {
  const codec = String(opts.videoCodec || 'h264');
  const fps = Math.max(1, Number(opts.fps || 24));
  const keyintFrames = Math.max(0, Math.round(Number(opts.keyintSec || 0) * fps));
  const videoBitrateKbps = resolveTargetVideoBitrateKbps(opts);
  const sw = buildTranscoderVideoArgs(opts);
  const out = [{ tag: 'software', args: sw }];

  if (process.platform !== 'darwin') return out;
  if (opts && opts.disableHardwareAccel) return out;

  if (codec === 'h264') {
    const hw = [
      '-c:v', 'h264_videotoolbox',
      '-allow_sw', '1',
      '-realtime', 'true',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      '-b:v', `${videoBitrateKbps}k`,
      '-maxrate', `${Math.round(videoBitrateKbps * 1.25)}k`,
      '-bufsize', `${Math.round(videoBitrateKbps * 2.4)}k`
    ];
    if (keyintFrames > 0) hw.push('-g', String(keyintFrames));
    return [{ tag: 'videotoolbox-h264', args: hw }, ...out];
  }
  if (codec === 'hevc') {
    const hw = [
      '-c:v', 'hevc_videotoolbox',
      '-allow_sw', '1',
      '-realtime', 'true',
      '-pix_fmt', 'yuv420p',
      '-b:v', `${videoBitrateKbps}k`,
      '-maxrate', `${Math.round(videoBitrateKbps * 1.25)}k`,
      '-bufsize', `${Math.round(videoBitrateKbps * 2.4)}k`
    ];
    if (keyintFrames > 0) hw.push('-g', String(keyintFrames));
    return [{ tag: 'videotoolbox-hevc', args: hw }, ...out];
  }
  return out;
}

async function renderTranscoderSegmentToTemp(segment, idx, opts = {}) {
    const ffmpegBin = String(opts.ffmpegBin || '').trim() || (await ensureFfmpegAvailable());
  const sourcePath = String(segment && segment.sourcePath || '').trim();
  if (!sourcePath) throw new Error('Segmento sin fuente');
  const start = Number(segment && segment.start || 0);
  const duration = Number(segment && segment.duration || 0);
  if (!(duration > 0.01)) throw new Error('Segmento con duracion invalida');

  const width = Number(opts.width || 1280);
  const height = Number(opts.height || 720);
  const fps = Math.max(10, Math.min(60, Number(opts.fps || 24)));
  const audioBitrateKbps = getDefaultAudioBitrateKbps(opts.audioBitrateKbps, 192);
  const muteAudio = !!opts.muteAudio;
  const tmpDir = opts.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'va-pro-'));
  const outPath = path.join(tmpDir, `trans_seg_${idx}.mp4`);

  const basePrefix = [
    '-y',
    '-ss', String(start),
    '-t', String(duration),
    '-i', sourcePath,
    '-vf', buildScalePadFilter(width, height),
    '-r', String(fps),
    '-vsync', 'cfr'
  ];

  const videoCandidates = buildTranscoderVideoArgsCandidates(opts);
  let usedSilentAudioFallback = false;
  let usedVideoEngine = 'software';
  let lastErr = null;

  for (const candidate of videoCandidates) {
    const baseArgs = basePrefix.concat(candidate.args || [], ['-movflags', '+faststart']);
    const withAudioArgs = baseArgs.concat(buildAacAudioArgs(audioBitrateKbps), [outPath]);
    const muteArgs = baseArgs.concat(['-an', outPath]);
    try {
      if (muteAudio) {
        await runCommand(ffmpegBin, muteArgs);
      } else {
        try {
          await runCommand(ffmpegBin, withAudioArgs);
        } catch (_errAudio) {
          await runCommand(ffmpegBin, muteArgs);
          usedSilentAudioFallback = true;
        }
      }
      usedVideoEngine = String(candidate && candidate.tag || 'software');
      lastErr = null;
      break;
    } catch (errCandidate) {
      lastErr = errCandidate;
    }
  }

  if (lastErr) throw lastErr;
  return { outPath, tmpDir, usedSilentAudioFallback, usedVideoEngine };
}

async function renderBlackGapToTemp(duration, idx, opts = {}) {
    const ffmpegBin = String(opts.ffmpegBin || '').trim() || (await ensureFfmpegAvailable());
  const gapDuration = Number(duration || 0);
  if (!(gapDuration > 0.01)) throw new Error('Gap invalido');
  const width = Number(opts.width || 1280);
  const height = Number(opts.height || 720);
  const fps = Math.max(10, Math.min(60, Number(opts.fps || 24)));
  const tmpDir = opts.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'va-pro-'));
  const outPath = path.join(tmpDir, `trans_gap_${idx}.mp4`);

  const argsPrefix = [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${gapDuration}`,
    '-f', 'lavfi',
    '-i', `anullsrc=channel_layout=stereo:sample_rate=48000`
  ];

  const videoCandidates = buildTranscoderVideoArgsCandidates(opts);
  let lastErr = null;
  let usedVideoEngine = 'software';
  for (const candidate of videoCandidates) {
    const args = argsPrefix
      .concat(candidate.args || [])
      .concat([
        ...buildAacAudioArgs(getDefaultAudioBitrateKbps(opts.audioBitrateKbps, 192)),
        '-shortest',
        '-movflags', '+faststart',
        outPath
      ]);
    try {
      await runCommand(ffmpegBin, args);
      usedVideoEngine = String(candidate && candidate.tag || 'software');
      lastErr = null;
      break;
    } catch (errCandidate) {
      lastErr = errCandidate;
    }
  }

  if (lastErr) throw lastErr;
  return { outPath, tmpDir, usedSilentAudioFallback: false, usedVideoEngine };
}

ipcMain.handle('ffmpeg-transcoder-export', async (event, opts) => {
  let tmpDir = '';
  try {
    let ffmpegBin = '';
    let ffprobeBin = '';
    try {
      ffmpegBin = await ensureFfmpegAvailable();
    } catch (_e) {
      ffmpegBin = '';
    }
    try {
      ffprobeBin = await ensureFfprobeAvailable();
    } catch (_e) {
      ffprobeBin = '';
    }
    if (!ffmpegBin) {
      throw new Error('No hay ffmpeg disponible para exportar MP4 por prompt/CLI');
    }
    const segmentsInput = Array.isArray(opts && opts.segments) ? opts.segments : [];
    if (!segmentsInput.length) throw new Error('Sin segmentos para transcoder');

    const outputName = String(opts && opts.name || 'transcoder_export').trim() || 'transcoder_export';
    const result = await dialog.showSaveDialog({
      title: 'Guardar MP4 (Transcoder)',
      defaultPath: path.join(app.getPath('downloads'), outputName + '.mp4'),
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const outputPath = result.filePath.endsWith('.mp4') ? result.filePath : (result.filePath + '.mp4');

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-pro-trans-'));
    const sorted = segmentsInput
      .map((s) => ({ ...s }))
      .filter((s) => String(s && s.sourcePath || '').trim())
      .sort((a, b) => Number(a.timelineStart || 0) - Number(b.timelineStart || 0));
    if (!sorted.length) throw new Error('No hay segmentos válidos');

    let exportOpts = { ...(opts || {}) };
    const preserveSourceParams = !Object.prototype.hasOwnProperty.call(exportOpts, 'preserveSourceParams') || !!exportOpts.preserveSourceParams;
    if (preserveSourceParams && ffprobeBin) {
      const primarySource = String(sorted[0] && sorted[0].sourcePath || '').trim();
      const sourceParams = await probeSourceVideoParams(ffprobeBin, primarySource);
      if (sourceParams) {
        if (Number(sourceParams.width) > 0) exportOpts.width = Number(sourceParams.width);
        if (Number(sourceParams.height) > 0) exportOpts.height = Number(sourceParams.height);
        if (!(Number(exportOpts.fps) > 0) && Number(sourceParams.fps) > 0) exportOpts.fps = Number(sourceParams.fps);
        if (Number(sourceParams.videoBitrateKbps) > 0) exportOpts.videoBitrateKbps = Number(sourceParams.videoBitrateKbps);
        if (!(Number(exportOpts.audioBitrateKbps) > 0) && Number(sourceParams.audioBitrateKbps) > 0) exportOpts.audioBitrateKbps = Number(sourceParams.audioBitrateKbps);
      }
    }
    exportOpts.videoCodec = 'h264';
    exportOpts.h264Profile = 'high';
    exportOpts.fps = normalizePreferredExportFps(Number(exportOpts.fps || 30));
    exportOpts.videoBitrateKbps = Math.max(MIN_EXPORT_VIDEO_BITRATE_KBPS, Number(exportOpts.videoBitrateKbps || 0) || estimateExportVideoBitrateKbps(exportOpts.width, exportOpts.height, exportOpts.fps, exportOpts.quality));

    const withGaps = [];
    const keepGaps = !!(opts && opts.keepGaps);
    let cursor = 0;
    for (const seg of sorted) {
      const segStart = Math.max(0, Number(seg.timelineStart || 0));
      const segDuration = Math.max(0, Number(seg.duration || 0));
      const segEnd = Math.max(segStart, Number(seg.timelineEnd || (segStart + segDuration)));

      if (keepGaps && segStart > cursor + 0.01) {
        withGaps.push({ kind: 'gap', duration: segStart - cursor });
      }
      withGaps.push({ kind: 'segment', segment: seg });
      cursor = Math.max(cursor, segEnd);
    }

    const rendered = [];
    let usedSilentAudioFallback = false;
    const usedVideoEngines = new Set();
    for (let i = 0; i < withGaps.length; i++) {
      const item = withGaps[i];
      if (item.kind === 'gap') {
        const gapResult = await renderBlackGapToTemp(item.duration, i, { ...exportOpts, tmpDir, ffmpegBin });
        rendered.push(gapResult.outPath);
        if (gapResult && gapResult.usedVideoEngine) usedVideoEngines.add(String(gapResult.usedVideoEngine));
      } else {
        const segResult = await renderTranscoderSegmentToTemp(item.segment, i, { ...exportOpts, tmpDir, ffmpegBin });
        rendered.push(segResult.outPath);
        usedSilentAudioFallback = usedSilentAudioFallback || !!segResult.usedSilentAudioFallback;
        if (segResult && segResult.usedVideoEngine) usedVideoEngines.add(String(segResult.usedVideoEngine));
      }
    }

    if (!rendered.length) throw new Error('No se generaron segmentos de salida');

    const listFile = path.join(tmpDir, 'concat.txt');
    const listContent = rendered.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listFile, listContent, 'utf-8');

    const fps = normalizePreferredExportFps(Number(exportOpts && exportOpts.fps || 30));
    const width = Number(exportOpts && exportOpts.width || 1280);
    const height = Number(exportOpts && exportOpts.height || 720);
    const finalVideoBitrateKbps = Math.max(MIN_EXPORT_VIDEO_BITRATE_KBPS, Number(exportOpts && exportOpts.videoBitrateKbps || estimateExportVideoBitrateKbps(width, height, fps, exportOpts && exportOpts.quality)));
    const finalVideoCandidates = buildTranscoderVideoArgsCandidates({
      ...exportOpts,
      videoBitrateKbps: finalVideoBitrateKbps,
      fps,
      disableHardwareAccel: !!(exportOpts && exportOpts.disableHardwareAccel)
    });

    let concatErr = null;
    for (const candidate of finalVideoCandidates) {
      const concatArgs = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        '-r', String(fps),
        '-vsync', 'cfr',
        ...(candidate.args || []),
        ...(exportOpts && exportOpts.muteAudio ? ['-an'] : buildAacAudioArgs(exportOpts && exportOpts.audioBitrateKbps)),
        '-movflags', '+faststart',
        outputPath
      ];
      try {
        await runCommand(ffmpegBin, concatArgs);
        concatErr = null;
      } catch (errCandidate) {
        concatErr = errCandidate;
      }
      if (!concatErr) {
        break;
      }
    }
    if (concatErr) throw concatErr;

    const baseEngine = Array.from(usedVideoEngines).join('+') || 'software';
    return { canceled: false, outputPath, usedSilentAudioFallback, engine: baseEngine };
  } catch (err) {
    return { canceled: false, error: String(err && err.message ? err.message : err) };
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) {}
    }
  }
});

ipcMain.handle('ffmpeg-export-playlist', async (event, opts) => {
  let tmpDir = '';
  try {
    const ffmpegBin = await ensureFfmpegAvailable();
    const segments = Array.isArray(opts && opts.segments) ? opts.segments : [];
    if (!segments.length) throw new Error('Lista vacia');
    const listName = String(opts && opts.listName || 'playlist').trim();
    const outputPathRaw = String(opts && opts.outputPath || '').trim();

    let outputPath = outputPathRaw;
    if (!outputPath) {
      const result = await dialog.showSaveDialog({
        title: 'Guardar MP4',
        defaultPath: path.join(app.getPath('downloads'), listName + '.mp4'),
        filters: [{ name: 'MP4', extensions: ['mp4'] }]
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      outputPath = result.filePath.endsWith('.mp4') ? result.filePath : (result.filePath + '.mp4');
    }

    const sendProgress = (percent) => {
      try {
        if (event && event.sender) event.sender.send('ffmpeg-export-progress', { percent: Math.max(0, Math.min(100, Number(percent) || 0)) });
      } catch (_e) {}
    };
    sendProgress(1);
    const totalDuration = Math.max(0.01, segments.reduce((acc, s) => acc + Math.max(0, Number(s && s.duration) || 0), 0));
    let renderedDuration = 0;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-pro-'));
    const rendered = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segDuration = Math.max(0, Number(seg && seg.duration) || 0);
      const r = await renderSegmentToTemp(seg, i, {
        ...opts,
        tmpDir,
        ffmpegBin,
        progressCallback: (outTimeSec, fullDuration) => {
          const d = Math.max(0.01, Number(fullDuration) || segDuration || 0.01);
          const current = renderedDuration + Math.max(0, Math.min(d, Number(outTimeSec) || 0));
          const frac = Math.max(0, Math.min(1, current / totalDuration));
          sendProgress(Math.min(85, Math.round(frac * 85)));
        }
      });
      rendered.push(r.outPath);
      renderedDuration += segDuration;
      const fracDone = Math.max(0, Math.min(1, renderedDuration / totalDuration));
      sendProgress(Math.min(85, Math.round(fracDone * 85)));
    }

    const listFile = path.join(tmpDir, 'concat.txt');
    const listContent = rendered.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listFile, listContent, 'utf-8');

    const includeAudio = (opts && Object.prototype.hasOwnProperty.call(opts, 'includeAudio')) ? !!opts.includeAudio : true;

    const fps = Math.max(10, Math.min(60, Number(opts && opts.fps || 30)));
    const width = Number(opts && opts.width || 1280);
    const height = Number(opts && opts.height || 720);
    const videoBitrateKbps = estimateExportVideoBitrateKbps(width, height, fps, opts && opts.quality);
    const videoCandidates = buildTranscoderVideoArgsCandidates({
      videoCodec: 'h264',
      h264Profile: 'high',
      quality: opts && opts.quality,
      fps,
      videoBitrateKbps,
      disableHardwareAccel: !!(opts && opts.disableHardwareAccel)
    });

    let lastErr = null;
    for (const candidate of videoCandidates) {
      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listFile,
        '-fflags', '+genpts',
        '-avoid_negative_ts', 'make_zero',
        '-r', String(fps),
        '-vsync', 'cfr',
        ...(candidate.args || []),
        ...(includeAudio ? buildAacAudioArgs(opts && opts.audioBitrateKbps) : ['-an']),
        '-shortest',
        '-movflags', '+faststart',
        outputPath
      ];
      try {
        await runCommandWithProgress(ffmpegBin, args, (outTimeSec) => {
          const frac = Math.max(0, Math.min(1, (Number(outTimeSec) || 0) / totalDuration));
          sendProgress(Math.min(99, 85 + Math.round(frac * 15)));
        });
        lastErr = null;
        break;
      } catch (errCandidate) {
        lastErr = errCandidate;
      }
    }
    if (lastErr) throw lastErr;
    sendProgress(100);
    return { canceled: false, outputPath };
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    return { canceled: false, error: message };
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) {}
    }
  }
});

ipcMain.handle('ffmpeg-merge', async (event, opts) => {
  let tmpDir = '';
  try {
    const ffmpegBin = await ensureFfmpegAvailable();
    const segments = Array.isArray(opts && opts.segments) ? opts.segments : [];
    if (!segments.length) throw new Error('Sin segmentos');
    const outputName = String(opts && opts.outputName || 'merge').trim();

    const result = await dialog.showSaveDialog({
      title: 'Guardar MP4',
      defaultPath: path.join(app.getPath('downloads'), outputName + '.mp4'),
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const outputPath = result.filePath.endsWith('.mp4') ? result.filePath : (result.filePath + '.mp4');

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-pro-'));
    const rendered = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const duration = Number(seg && seg.end || 0) - Number(seg && seg.start || 0);
      const r = await renderSegmentToTemp({
        sourcePath: seg.sourcePath,
        start: seg.start,
        duration,
        labelText: ''
      }, i, { ...opts, tmpDir, includeLabel: false, ffmpegBin });
      rendered.push(r.outPath);
    }

    const listFile = path.join(tmpDir, 'concat.txt');
    const listContent = rendered.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listFile, listContent, 'utf-8');

    const args = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      outputPath
    ];
    await runCommand(ffmpegBin, args);
    return { canceled: false, outputPath };
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    return { canceled: false, error: message };
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) {}
    }
  }
});

// ─── Multiview mosaic export via FFmpeg xstack ────────────────────────────────
ipcMain.handle('ffmpeg-export-multiview', async (event, opts) => {
  let tmpDir = '';
  try {
    const ffmpegBin = await ensureFfmpegAvailable();
    const cameras = Array.isArray(opts && opts.cameras) ? opts.cameras : [];
    if (cameras.length < 2) throw new Error('Se necesitan al menos 2 cámaras para multivista');

    const rects   = Array.isArray(opts && opts.rects) ? opts.rects : [];
    const totalW  = Math.max(2, Number(opts && opts.width  || 1280));
    const totalH  = Math.max(2, Number(opts && opts.height || 720));
    const fps     = Math.max(10, Math.min(60, Number(opts && opts.fps || 24)));
    const quality = Number(opts && opts.quality || 75);
    const includeAudio  = (opts && Object.prototype.hasOwnProperty.call(opts, 'includeAudio')) ? !!opts.includeAudio : true;
    const audioCamIndex = Number.isFinite(Number(opts && opts.audioCamera)) ? Number(opts.audioCamera) : 0;
    const listName = String(opts && opts.listName || 'multivista').trim();

    const result = await dialog.showSaveDialog({
      title: 'Guardar multivista MP4',
      defaultPath: path.join(app.getPath('downloads'), listName + '.mp4'),
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const outputPath = result.filePath.endsWith('.mp4') ? result.filePath : (result.filePath + '.mp4');

    const sendProgress = (percent) => {
      try {
        if (event && event.sender) event.sender.send('ffmpeg-export-progress', { percent: Math.max(0, Math.min(100, Number(percent) || 0)) });
      } catch (_e) {}
    };
    sendProgress(2);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-pro-mv-'));
    const camConcat = []; // one concat .mp4 per camera (tile-sized, no audio)

    const totalCamSegments = cameras.reduce((a, c) => a + ((Array.isArray(c && c.segments) ? c.segments.length : 0)), 0);
    let renderedSegments = 0;

    for (let ci = 0; ci < cameras.length; ci++) {
      const cam = cameras[ci];
      const segments = Array.isArray(cam && cam.segments) ? cam.segments : [];
      const rect = rects[ci] || { x: 0, y: 0, w: Math.round(totalW / cameras.length), h: totalH };
      const tileW = Math.max(2, Math.round(Number(rect.w) || Math.round(totalW / cameras.length)));
      const tileH = Math.max(2, Math.round(Number(rect.h) || totalH));

      const renderedSegs = [];
      for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        const segDuration = Math.max(0, Number(seg && seg.duration) || 0);
        if (segDuration < 0.05) continue;
        const r = await renderSegmentToTemp({
          sourcePath: String(seg.sourcePath || ''),
          start: Number(seg.start || 0),
          duration: segDuration,
          labelText: '',
          clockStartSec: 0,
          isBlack: !!(seg.isBlack)
        }, ci * 1000 + si, {
          tmpDir,
          ffmpegBin,
          width: tileW,
          height: tileH,
          fps,
          quality,
          includeAudio: false,
          includeLabel: false,
          includeClock: false
        });
        renderedSegs.push(r.outPath);
        renderedSegments++;
        sendProgress(Math.min(60, Math.round((renderedSegments / Math.max(1, totalCamSegments)) * 60)));
      }

      if (!renderedSegs.length) {
        // generate solid black placeholder for this camera
        const totalDuration = segments.reduce((a, s) => a + Math.max(0, Number(s && s.duration) || 0), 0) || 1;
        const r = await renderSegmentToTemp({ isBlack: true, duration: totalDuration, labelText: '', clockStartSec: 0 },
          ci * 1000 + 9999, { tmpDir, ffmpegBin, width: tileW, height: tileH, fps, quality, includeAudio: false, includeLabel: false, includeClock: false });
        renderedSegs.push(r.outPath);
      }

      const camConcatFile = path.join(tmpDir, `cam_${ci}_concat.txt`);
      fs.writeFileSync(camConcatFile, renderedSegs.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8');
      const camOut = path.join(tmpDir, `cam_${ci}.mp4`);
      await runCommand(ffmpegBin, [
        '-y', '-f', 'concat', '-safe', '0', '-i', camConcatFile,
        '-fflags', '+genpts', '-avoid_negative_ts', 'make_zero',
        '-r', String(fps), '-vsync', 'cfr',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-an', '-movflags', '+faststart', camOut
      ]);
      camConcat.push(camOut);
      sendProgress(60 + Math.round(((ci + 1) / cameras.length) * 20));
    }

    // Build xstack filter_complex
    // scale each camera to exact tile size (already done), just position them
    const inputArgs = [];
    camConcat.forEach(p => { inputArgs.push('-i', p); });

    // Build filter chains: each input already at tile size
    const filterParts = [];
    const labels = [];
    for (let ci = 0; ci < camConcat.length; ci++) {
      const rect = rects[ci] || { x: 0, y: 0, w: Math.round(totalW / cameras.length), h: totalH };
      const tileW = Math.max(2, Math.round(Number(rect.w) || Math.round(totalW / cameras.length)));
      const tileH = Math.max(2, Math.round(Number(rect.h) || totalH));
      filterParts.push(`[${ci}:v]scale='min(${tileW},${tileH})*dar':${tileH}:force_original_aspect_ratio=2:force_divisible_by=2,crop=${tileW}:${tileH}:(iw-${tileW})/2:(ih-${tileH})/2[v${ci}]`);
      labels.push(`[v${ci}]`);
    }
    const xstackLayout = rects.map((r, i) => {
      const x = Number(r && r.x) || 0;
      const y = Number(r && r.y) || 0;
      return `${x}_${y}`;
    }).join('|');
    filterParts.push(`${labels.join('')}xstack=inputs=${camConcat.length}:layout=${xstackLayout}:fill=black,scale=${totalW}:${totalH}[vout]`);
    const filterComplex = filterParts.join(';');

    // Audio: take from selected camera concat (already has no audio - re-extract from original source)
    const audioSegments = Array.isArray(cameras[audioCamIndex] && cameras[audioCamIndex].segments) ? cameras[audioCamIndex].segments : [];
    let audioInputArgs = [];
    let audioMapArg = [];
    let audioFilterArg = [];
    if (includeAudio && audioSegments.length) {
      // build audio concat from original source segments for the chosen camera
      const audioRendered = [];
      for (let si = 0; si < audioSegments.length; si++) {
        const seg = audioSegments[si];
        const segDuration = Math.max(0, Number(seg && seg.duration) || 0);
        if (segDuration < 0.05) continue;
        if (seg.isBlack || !seg.sourcePath) continue;
        const aOut = path.join(tmpDir, `audio_${si}.aac`);
        try {
          await runCommand(ffmpegBin, [
            '-y', '-ss', String(Number(seg.start || 0)), '-t', String(segDuration),
            '-i', String(seg.sourcePath),
            '-vn', '-acodec', 'aac', '-b:a', '128k', '-ac', '2', aOut
          ]);
          audioRendered.push(aOut);
        } catch (_e) {}
      }
      if (audioRendered.length) {
        const audioConcatFile = path.join(tmpDir, 'audio_concat.txt');
        fs.writeFileSync(audioConcatFile, audioRendered.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8');
        const audioCombinedOut = path.join(tmpDir, 'audio_combined.aac');
        try {
          await runCommand(ffmpegBin, [
            '-y', '-f', 'concat', '-safe', '0', '-i', audioConcatFile,
            '-c', 'copy', audioCombinedOut
          ]);
          audioInputArgs = ['-i', audioCombinedOut];
          audioMapArg = ['-map', '0:v', '-map', String(camConcat.length) + ':a'];
          audioFilterArg = [...buildAacAudioArgs(opts && opts.audioBitrateKbps)];
        } catch (_e) {}
      }
    }

    sendProgress(85);

    const videoBitrateKbps = estimateExportVideoBitrateKbps(totalW, totalH, fps, quality);
    const videoCandidates = buildTranscoderVideoArgsCandidates({
      videoCodec: 'h264', h264Profile: 'high', quality, fps, videoBitrateKbps,
      disableHardwareAccel: !!(opts && opts.disableHardwareAccel)
    });

    let lastErr = null;
    for (const candidate of videoCandidates) {
      const args = [
        '-y',
        ...inputArgs,
        ...audioInputArgs,
        '-filter_complex', filterComplex,
        '-map', '[vout]',
        ...audioMapArg,
        ...(candidate.args || []),
        ...audioFilterArg,
        ...((!includeAudio || !audioMapArg.length) ? ['-an'] : []),
        '-shortest',
        '-movflags', '+faststart',
        outputPath
      ];
      try {
        await runCommand(ffmpegBin, args);
        lastErr = null;
        break;
      } catch (errC) {
        lastErr = errC;
      }
    }
    if (lastErr) throw lastErr;

    sendProgress(100);
    return { canceled: false, outputPath };
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    return { canceled: false, error: message };
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) {}
    }
  }
});
// ─────────────────────────────────────────────────────────────────────────────

function buildHeuristicScenePoints(durationSec, maxPoints) {
  const duration = Math.max(0, Number(durationSec) || 0);
  const cap = Math.max(20, Math.min(2000, Math.round(Number(maxPoints) || 300)));
  if (!Number.isFinite(duration) || duration < 12) return [];

  const minSpacing = 6;
  const estimated = Math.max(12, Math.floor(duration / 9));
  const total = Math.max(8, Math.min(cap, estimated));
  const step = Math.max(minSpacing, duration / (total + 1));
  const out = [];
  for (let i = 1; i <= total; i++) {
    const t = Math.max(0, Math.min(duration - 0.5, i * step));
    out.push(Number(t.toFixed(3)));
  }
  return out;
}

ipcMain.handle('ai-detect-scenes', async (event, opts) => {
  try {
    const sourcePath = String(opts && opts.sourcePath || '').trim();
    if (!sourcePath) throw new Error('sourcePath vacío');
    if (!fs.existsSync(sourcePath)) throw new Error('No existe archivo de video para IA');

    const durationRaw = Number(opts && opts.durationSec);
    const durationSec = Number.isFinite(durationRaw) ? Math.max(0, durationRaw) : 0;
    const thresholdRaw = Number(opts && opts.threshold);
    const threshold = Number.isFinite(thresholdRaw) ? Math.max(0.05, Math.min(0.8, thresholdRaw)) : 0.32;
    const maxPointsRaw = Number(opts && opts.maxPoints);
    const maxPoints = Number.isFinite(maxPointsRaw) ? Math.max(20, Math.min(2000, Math.round(maxPointsRaw))) : 300;

    let ffmpegBin = '';
    try {
      ffmpegBin = await ensureFfmpegAvailable();
    } catch (_e) {
      const fallbackPoints = buildHeuristicScenePoints(durationSec, maxPoints);
      if (fallbackPoints.length) {
        return {
          ok: true,
          threshold,
          fallback: true,
          engine: 'heuristic-no-ffmpeg',
          warning: 'ffmpeg no disponible',
          scenePoints: fallbackPoints
        };
      }
      throw new Error('ffmpeg no disponible (instala ffmpeg o añade binario)');
    }

    const filterExpr = `select=gt(scene\\,${threshold.toFixed(3)}),showinfo`;
    const args = [
      '-hide_banner',
      '-nostats',
      '-i', sourcePath,
      '-an',
      '-filter:v', filterExpr,
      '-f', 'null',
      '-'
    ];

    let stderr = '';
    try {
      const r = await runCommand(ffmpegBin, args);
      stderr = String(r && r.stderr || '');
    } catch (_e) {
      const fallbackPoints = buildHeuristicScenePoints(durationSec, maxPoints);
      if (fallbackPoints.length) {
        return {
          ok: true,
          threshold,
          fallback: true,
          engine: 'heuristic-scene-fallback',
          warning: 'análisis ffmpeg falló',
          scenePoints: fallbackPoints
        };
      }
      throw _e;
    }
    const lines = String(stderr || '').split(/\r?\n/);
    const out = [];
    const seen = new Set();
    for (const line of lines) {
      const m = line.match(/pts_time:([0-9]+(?:\.[0-9]+)?)/i);
      if (!m) continue;
      const t = Number(m[1]);
      if (!Number.isFinite(t) || t < 0) continue;
      const rounded = Number(t.toFixed(3));
      const key = String(rounded);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rounded);
      if (out.length >= maxPoints) break;
    }

    if (!out.length) {
      const fallbackPoints = buildHeuristicScenePoints(durationSec, maxPoints);
      if (fallbackPoints.length) {
        return {
          ok: true,
          threshold,
          fallback: true,
          engine: 'heuristic-empty-ffmpeg',
          warning: 'sin escenas detectadas por ffmpeg',
          scenePoints: fallbackPoints
        };
      }
    }

    return { ok: true, threshold, fallback: false, engine: 'ffmpeg-scene', scenePoints: out };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('ai-extract-frame-hashes', async (event, opts) => {
  try {
    const ffmpegBin = await ensureFfmpegAvailable();
    const rawSamples = Array.isArray(opts && opts.samples) ? opts.samples : [];
    const sizeRaw = Number(opts && opts.size);
    const side = Number.isFinite(sizeRaw) ? Math.max(8, Math.min(32, Math.round(sizeRaw))) : 16;
    const maxSamples = Math.max(1, Math.min(1500, Number(opts && opts.maxSamples) || 500));
    const samples = rawSamples.slice(0, maxSamples);

    const rows = [];
    for (const sample of samples) {
      const sourcePath = String(sample && sample.videoPath || '').trim();
      const timeSecRaw = Number(sample && sample.timeSec);
      const timeSec = Number.isFinite(timeSecRaw) ? Math.max(0, timeSecRaw) : 0;
      const label = String(sample && sample.label || '').trim();
      const sampleId = String(sample && sample.id || '').trim();
      if (!sourcePath || !fs.existsSync(sourcePath)) continue;

      try {
        const vf = `scale=${side}:${side},format=gray`;
        const args = [
          '-hide_banner',
          '-loglevel', 'error',
          '-ss', timeSec.toFixed(3),
          '-i', sourcePath,
          '-frames:v', '1',
          '-vf', vf,
          '-f', 'rawvideo',
          '-pix_fmt', 'gray',
          '-'
        ];
        const { stdout } = await runCommandBinary(ffmpegBin, args);
        const expected = side * side;
        if (!stdout || stdout.length < expected) continue;
        const frame = stdout.subarray(0, expected);
        const vec = new Array(expected);
        for (let i = 0; i < expected; i++) vec[i] = Number(frame[i]) / 255;
        rows.push({
          id: sampleId,
          label,
          side,
          hash: normalizeFloatVector(vec)
        });
      } catch (_e) {
        // Saltamos muestras puntuales que no se pudieron decodificar.
      }
    }

    return { ok: true, side, count: rows.length, rows };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});


function writeBrandoErrorReport(reason) {
  try {
    const desktop = path.join(os.homedir(), 'Desktop');
    const stamp = (() => {
      const d = new Date();
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
    })();
    const reportPath = path.join(desktop, `VA-PRO-Brando-error-${stamp}.txt`);
    const platformUuid = safeExecText("ioreg -rd1 -c IOPlatformExpertDevice | awk -F'\"' '/IOPlatformUUID/{print $(NF-1)}'");
    const model = safeExecText('sysctl -n hw.model');
    const lines = [
      '==============================',
      '  VA PRO 1.0 Brando - Informe de error de acceso',
      '==============================',
      `Fecha/Hora : ${new Date().toISOString()}`,
      `Motivo     : ${reason}`,
      '',
      '--- Informacion del equipo ---',
      `Plataforma : ${process.platform}`,
      `Arquitectura: ${process.arch}`,
      `Modelo     : ${model || '(no disponible)'}`,
      `UUID HW    : ${platformUuid || '(no disponible)'}`,
      `Hostname   : ${os.hostname()}`,
      `Version OS : ${safeExecText('sw_vers -productVersion') || '(no disponible)'}`,
      '',
      '--- Nota ---',
      'Si Gatekeeper bloquea la app antes de abrirla, este archivo NO se genera.',
      'En ese caso ejecuta en Terminal: xattr -cr "/Applications/VA PRO 1.0 Brando.app"',
      'O haz clic derecho -> Abrir sobre el .app y confirma en el dialogo.',
      '==============================',
    ];
    fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
    return reportPath;
  } catch (_e) {
    return null;
  }
}

app.whenReady().then(() => {
  const lockStatus = ensureBrandoMachineLock();
  if (!lockStatus.ok) {
    const reason = String(lockStatus.reason || 'No se pudo validar esta licencia.');
    const reportPath = writeBrandoErrorReport(reason);
    const reportMsg = reportPath ? `\n\nInforme guardado en:\n${reportPath}` : '';
    dialog.showErrorBox('Licencia Brando', reason + reportMsg);
    app.quit();
    return;
  }
  try {
    if (session && session.defaultSession && typeof session.defaultSession.setDisplayMediaRequestHandler === 'function') {
      session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 0, height: 0 },
            fetchWindowIcons: false
          });
          const list = Array.isArray(sources) ? sources : [];
          const displays = screen.getAllDisplays();
          const primary = screen.getPrimaryDisplay();
          const externalDisplay = displays.find((d) => d && primary && d.id !== primary.id) || null;
          const preferredDisplayId = Number(presenterDisplayProfile && presenterDisplayProfile.id) || Number(externalDisplay && externalDisplay.id) || 0;
          let source = null;
          if (preferredDisplayId) {
            source = list.find((s) => Number(s && s.display_id) === preferredDisplayId) || null;
          }
          if (!source) {
            source = list.find((s) => Number(s && s.display_id) === Number(externalDisplay && externalDisplay.id)) || null;
          }
          if (!source) {
            source = list[0] || null;
          }
          if (!source) {
            callback({ video: null, audio: null });
            return;
          }
          callback({ video: source, audio: 'loopback' });
        } catch (_err) {
          callback({ video: null, audio: null });
        }
      }, { useSystemPicker: false });
    }
  } catch (_err) {}

  // Crear ventana lo antes posible
  createWindow();
  if (lockStatus.enabled) {
    const daysRemaining = Math.max(0, Number(lockStatus.daysRemaining || 0));
    const title = lockStatus.firstRun ? 'Licencia Brando activada' : 'Licencia Brando';
    const detail = `Instalacion activa en este equipo. Dias restantes: ${daysRemaining}.`;
    setTimeout(() => {
      const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      dialog.showMessageBox(owner, {
        type: 'info',
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
        title,
        message: detail,
        detail: 'Esta licencia Brando queda vinculada a este equipo y caduca a los 100 dias desde la primera activacion.'
      }).catch(() => {});
    }, 350);
  }
  // Solicitar permisos en segundo plano para no romper el arranque/UI.
  if (process.platform === 'darwin') {
    setTimeout(() => {
      systemPreferences.askForMediaAccess('camera').catch(() => {});
      systemPreferences.askForMediaAccess('microphone').catch(() => {});
    }, 900);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (e) => {
  if (isQuitting || exitFlowActive) return;
  e.preventDefault();

  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win) {
    isQuitting = true;
    app.quit();
    return;
  }

  exitFlowActive = true;
  runExitDecisionFlow(win).then((result) => {
    if (result && result.cancel) {
      exitFlowActive = false;
      return;
    }
    isQuitting = true;
    exitFlowActive = false;
    closePresenterWindow();
    app.quit();
  }).catch(() => {
    exitFlowActive = false;
  });
});

