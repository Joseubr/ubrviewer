(function () {
  if (window.__UBR_WEB_BOOT__) return;
  window.__UBR_WEB_BOOT__ = true;

  var API_SCRIPT_ID = 'ubr-yt-iframe-api';
  var PLAYER_ID = 'ubr-main-youtube-player';
  var PROJECTS_ID = 'ubr-web-projects';

  var state = {
    manifest: [],
    manifestAll: [],
    project: null,
    list: null,
    viewerLists: [],
    player: null,
    ytApiReady: false,
    mappedClips: [],
    selectedCategory: '__all__',
    selectedEvent: '__all__',
    activeCamIdx: 0,
    multiviewActive: false,
    multiviewPlayers: [],
    lastTimelineTime: 0,
    localProjects: [],
    sortMode: 'date-desc',
    hiddenProjectIds: [],
    folderFilter: '__all__',
    folderList: [],
    projectFolderMap: {},
    folderCollapsedMap: {},
    selectedProjectId: '',
    playbackRate: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function ensureStyles() {
    if (document.getElementById('ubr-web-style')) return;
    var style = document.createElement('style');
    style.id = 'ubr-web-style';
    style.textContent = [
      '#videoSection{position:relative;}',
      '#videoSection #video{opacity:0 !important;pointer-events:none !important;}',
      '#' + PLAYER_ID + '-host{position:absolute;inset:0;z-index:4;background:#020617;border-radius:8px;overflow:hidden;}',
      '#' + PLAYER_ID + '{width:100%;height:100%;}',
      '#' + PLAYER_ID + ' iframe{pointer-events:none !important;}',
      '#' + PLAYER_ID + '-hitlock{position:absolute;inset:0;z-index:12;background:transparent;pointer-events:auto;}',
      '#' + PLAYER_ID + '-host::before,#' + PLAYER_ID + '-host::after{content:"";position:absolute;z-index:9;pointer-events:none;background:#020617;}',
      '#' + PLAYER_ID + '-host::before{left:0;top:0;width:90px;height:32px;}',
      '#' + PLAYER_ID + '-host::after{right:0;bottom:0;width:120px;height:42px;}',
      '#' + PLAYER_ID + '-host.zoomed{cursor:grab;}',
      '#' + PLAYER_ID + '-host.zoomed.dragging{cursor:grabbing;}',
      /* role-based edit controls */
      'body.ubr-viewer-mode #cutsDeleteSelectedBtn,body.ubr-viewer-mode #cutsExportSelectedBtn,body.ubr-viewer-mode #cutsGamePartsBtn,body.ubr-viewer-mode #cutUndoBar{display:none !important;}',
      'body.ubr-viewer-mode .cut-delete{display:none !important;}',
      '.cuts-timeline-item{cursor:pointer !important;}',
      '#ubr-cam-switcher{display:none;gap:4px;flex-wrap:wrap;padding:4px 8px;background:#f0f4f8;border-bottom:1px solid #d2dbe5;}',
      '.ubr-cam-btn{height:26px;padding:0 10px;border:1px solid #94a3b8;border-radius:6px;background:#fff;color:#1e3a5f;font-size:11px;font-weight:600;cursor:pointer;}',
      '.ubr-cam-btn.active{background:#0e7490;color:#fff;border-color:#0e7490;}',
      '.ubr-cam-btn:hover:not(.active){background:#e0f2fe;}',
      '#ubr-cam-switcher-label{font-size:10px;font-weight:700;color:#64748b;display:flex;align-items:center;white-space:nowrap;}',
      '#ubr-inline-project-switcher + #ubr-cam-switcher{margin-top:4px;}',
      '#ubr-multiview{position:absolute;inset:0;z-index:6;background:#020617;display:none;gap:6px;padding:6px;box-sizing:border-box;}',
      '#ubr-multiview.active{display:grid;}',
      '.ubr-mv-cell{position:relative;background:#000;border:1px solid #334155;border-radius:8px;overflow:hidden;}',
      '.ubr-mv-cell iframe{width:100%;height:100%;border:0;pointer-events:none !important;}',
      '.ubr-mv-hitlock{position:absolute;inset:0;z-index:12;background:transparent;pointer-events:auto;}',
      '.ubr-mv-cell::before,.ubr-mv-cell::after{content:"";position:absolute;z-index:9;pointer-events:none;background:#020617;}',
      '.ubr-mv-cell::before{left:0;top:0;width:72px;height:24px;}',
      '.ubr-mv-cell::after{right:0;bottom:0;width:96px;height:32px;}',
      '.ubr-mv-label{position:absolute;left:6px;top:6px;background:rgba(2,6,23,0.72);color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:999px;z-index:1;}',

      '.ubr-inline-projects select{flex:1 1 auto;min-width:0;height:24px;font-size:10px;padding:2px 6px;border:1px solid #a9b7c9;border-radius:6px;background:#f8fbff;color:#1f2937;}',
      '.ubr-inline-projects button{height:24px;padding:0 8px;border:1px solid #94a3b8;border-radius:6px;background:#e2e8f0;color:#0f172a;font-size:10px;font-weight:700;cursor:pointer;}',
      '.ubr-inline-projects{display:flex;align-items:center;gap:4px;}',
      '.ubr-inline-projects .ubr-icon-btn{min-width:28px;width:28px;padding:0;display:inline-flex;align-items:center;justify-content:center;font-size:13px;}',
      '.ubr-inline-projects .ubr-actions-right{margin-left:auto;display:inline-flex;gap:4px;}',
      '.ubr-folder-plus-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;line-height:1;}',
      '.ubr-folder-plus-icon .f{font-size:14px;line-height:1;}',
      '.ubr-folder-plus-icon .p{position:absolute;right:-1px;top:-4px;font-size:10px;font-weight:900;color:#0f766e;line-height:1;}',
      '.ubr-inline-move-menu{position:fixed;z-index:100100;height:28px;min-width:170px;border:1px solid #94a3b8;border-radius:8px;background:#fff;color:#0f172a;font-size:11px;padding:0 8px;}',
      '#recentProjectsBar .recent-projects-head{display:none !important;}',
      '#recentProjectsList{display:none !important;}',
      'body.ubr-viewer-mode #ubr-inline-viewer-pass,body.ubr-viewer-mode #ubr-inline-project-delete,body.ubr-viewer-mode #ubr-inline-project-rename,body.ubr-viewer-mode #ubr-inline-folder-target,body.ubr-viewer-mode #ubr-inline-folder-new,body.ubr-viewer-mode #ubr-inline-folder-move{display:none !important;}',
      '#ubr-inline-project-rename{color:#0e7490;}',
      '#ubr-publish-status{font-size:10px;padding:3px 6px;border-radius:6px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;display:none;}',
      '#ubr-publish-status.error{background:#fef2f2;color:#991b1b;border-color:#fecaca;}',
      'body.ubr-admin-mode #ubr-viewer-help-btn{display:none !important;}',
      'body.ubr-viewer-mode #cutsPanel,body.ubr-viewer-mode #resizer1{display:block !important;}',
      'body.ubr-viewer-mode #buttonsPanelContent{display:none !important;}',
      'body.ubr-viewer-mode #buttonsToggle{display:none !important;}',
      'body.ubr-viewer-mode #cutsTimeline{display:block !important;}',
      '#ubr-role-badge{font-size:10px;font-weight:800;line-height:1;padding:4px 7px;border-radius:999px;border:1px solid transparent;white-space:nowrap;}',
      'body.ubr-viewer-mode #ubr-role-badge{background:#fff7ed;color:#9a3412;border-color:#fed7aa;}',
      'body.ubr-admin-mode #ubr-role-badge{background:#ecfeff;color:#155e75;border-color:#a5f3fc;}',
      '#ubr-project-folder-tree{margin-top:6px;border:1px solid #d2dbe5;border-radius:8px;background:#f8fafc;max-height:180px;overflow:auto;}',
      '.ubr-folder-group{border-bottom:1px solid #e2e8f0;}',
      '.ubr-folder-group:last-child{border-bottom:none;}',
      '.ubr-folder-head{width:100%;height:26px;border:0;background:#eef2f7;color:#334155;font-size:11px;font-weight:700;text-align:left;padding:0 8px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;}',
      '.ubr-folder-items{display:grid;gap:2px;padding:4px 4px 6px 4px;}',
      '.ubr-folder-item{height:24px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;color:#1f2937;font-size:10px;font-weight:600;text-align:left;padding:0 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.ubr-folder-item.active{background:#0e7490;color:#fff;border-color:#0e7490;}',
      'body.ubr-admin-mode .ubr-folder-item{cursor:grab;}',
      'body.ubr-admin-mode .ubr-folder-item:active{cursor:grabbing;}',
      '.ubr-folder-head.drop-target,.ubr-folder-items.drop-target{box-shadow:inset 0 0 0 2px #0ea5e9;background:#e0f2fe;}',
      '.ubr-event-filter-wrap{display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid #d2dbe5;flex-wrap:wrap;}',
      '.ubr-event-filter-wrap label{font-size:11px;font-weight:700;color:#334155;}',
      '.ubr-event-filter-wrap select{flex:1 1 auto;height:26px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#111827;font-size:11px;padding:2px 6px;}',
      /* admin modal */
      '#ubr-admin-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:100000;}',
      '#ubr-admin-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100001;width:min(540px,95vw);max-height:90vh;overflow:auto;background:#fff;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.35);font:13px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#111;}',
      '#ubr-admin-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#0f172a;color:#fff;border-radius:12px 12px 0 0;font-weight:700;font-size:14px;}',
      '#ubr-admin-close{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;}',
      '#ubr-admin-body{padding:16px;display:grid;gap:14px;}',
      '.ubr-admin-section{display:grid;gap:8px;padding-bottom:12px;border-bottom:1px solid #e2e8f0;}',
      '.ubr-admin-section h3{margin:0;font-size:12px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:.04em;}',
      '.ubr-admin-section label{display:grid;gap:3px;font-size:11px;font-weight:600;color:#334155;}',
      '.ubr-admin-section input[type=text],.ubr-admin-section input[type=date],.ubr-admin-section input[type=number]{height:30px;border:1px solid #cbd5e1;border-radius:6px;padding:0 8px;font-size:12px;color:#111;}',
      '.ubr-adm-cam-row{display:grid;grid-template-columns:1fr 1fr auto auto;gap:6px;align-items:center;margin-bottom:6px;}',
      '.ubr-adm-cam-row input{height:28px;border:1px solid #cbd5e1;border-radius:6px;padding:0 6px;font-size:11px;}',
      '.ubr-adm-btn-sm{height:28px;padding:0 10px;border:1px solid #94a3b8;border-radius:6px;background:#f1f5f9;color:#0f172a;font-size:11px;font-weight:700;cursor:pointer;}',
      '.ubr-adm-btn-primary{height:34px;padding:0 16px;border:none;border-radius:8px;background:#0e7490;color:#fff;font-size:13px;font-weight:700;cursor:pointer;}',
      '.ubr-adm-btn-warn{height:34px;padding:0 16px;border:1px solid #fca5a5;border-radius:8px;background:#fef2f2;color:#991b1b;font-size:12px;font-weight:700;cursor:pointer;}',
      '.ubr-adm-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}',
      '.ubr-adm-status{font-size:11px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px 8px;}',
      '#ubr-admin-open-json{height:30px;padding:0 10px;border:1px solid #94a3b8;border-radius:6px;background:#eef2ff;color:#1e1b4b;font-size:12px;font-weight:700;cursor:pointer;}',
      '#ubr-access-gate{position:fixed;inset:0;z-index:110000;background:linear-gradient(160deg,#0f172a 0%,#1e293b 100%);display:flex;align-items:center;justify-content:center;padding:20px;}',
      '#ubr-access-card{width:min(420px,95vw);background:#fff;border-radius:12px;box-shadow:0 22px 60px rgba(0,0,0,.45);padding:18px;display:grid;gap:10px;}',
      '#ubr-access-title{font-size:16px;font-weight:800;color:#0f172a;}',
      '#ubr-access-desc{font-size:12px;color:#475569;}',
      '#ubr-access-input{height:34px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font-size:13px;}',
      '#ubr-access-remember-wrap{display:flex;align-items:center;gap:8px;font-size:12px;color:#334155;}',
      '#ubr-access-remember{margin:0;}',
      '#ubr-access-submit{height:34px;border:none;border-radius:8px;background:#0e7490;color:#fff;font-weight:700;cursor:pointer;}',
      '#ubr-access-error{font-size:12px;color:#b91c1c;min-height:16px;}',
      '#ubr-viewer-help-backdrop{position:fixed;inset:0;background:rgba(2,6,23,0.65);z-index:120000;display:flex;align-items:center;justify-content:center;padding:16px;}',
      '#ubr-viewer-help-card{width:min(640px,96vw);max-height:88vh;overflow:auto;background:#ffffff;border-radius:12px;box-shadow:0 28px 64px rgba(0,0,0,0.45);border:1px solid #dbe3ee;}',
      '#ubr-viewer-help-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#0f172a;color:#fff;border-radius:12px 12px 0 0;font-size:14px;font-weight:800;}',
      '#ubr-viewer-help-close{background:none;border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;}',
      '#ubr-viewer-help-body{padding:14px;display:grid;gap:10px;font-size:12px;color:#0f172a;}',
      '.ubr-viewer-help-box{border:1px solid #dbe3ee;border-radius:10px;background:#f8fafc;padding:10px;}',
      '.ubr-viewer-help-box h4{margin:0 0 6px 0;font-size:12px;color:#0f172a;}',
      '.ubr-viewer-help-box p{margin:0;line-height:1.45;color:#334155;}',
    ].join('');
    document.head.appendChild(style);
    // Ajuste: reducir tamaño de texto de proyectos en modo viewer
    var viewerStyle = document.createElement('style');
    viewerStyle.id = 'ubr-viewer-projects-style';
    viewerStyle.textContent = [
      'body.ubr-viewer-mode .ubr-folder-item,',
      'body.ubr-viewer-mode #ubr-inline-project-select option,',
      'body.ubr-viewer-mode #ubr-inline-project-select,',
      'body.ubr-viewer-mode .proyectos-lista .proyecto-nombre,',
      'body.ubr-viewer-mode .proyectos-lista .proyecto-titulo,',
      'body.ubr-viewer-mode .proyectos-lista .proyecto-item,',
      'body.ubr-viewer-mode .proyectos-lista .list-group-item',
      '{',
      '  font-size: 11px !important;',
      '  line-height: 1.15;',
      '  font-weight: 500;',
      '}',
    ].join('\n');
    document.head.appendChild(viewerStyle);
  }

  function applyRoleUiMode() {
    if (!document.body) return;
    if (isAdminUnlocked()) {
      document.body.classList.remove('ubr-viewer-mode');
      document.body.classList.add('ubr-admin-mode');
    } else {
      document.body.classList.remove('ubr-admin-mode');
      document.body.classList.add('ubr-viewer-mode');
    }
    var badge = $('ubr-role-badge');
    if (badge) {
      badge.textContent = isAdminUnlocked() ? 'ADMIN' : 'VIEWER';
      badge.title = isAdminUnlocked() ? 'Permisos completos' : 'Solo visualizacion';
    }
    var roleSwitch = $('ubr-role-switch-btn');
    if (roleSwitch) {
      roleSwitch.title = isAdminUnlocked() ? 'Pasar a Viewer' : 'Pasar a Admin';
      roleSwitch.textContent = isAdminUnlocked() ? 'V' : 'A';
    }

    if (!isAdminUnlocked()) {
      var cutsPanel = $('cutsPanel');
      if (cutsPanel && cutsPanel.classList) cutsPanel.classList.remove('collapsed');
      if (cutsPanel) cutsPanel.style.flex = '1 1 auto';
      var buttonsSection = $('buttonsSection');
      if (buttonsSection && buttonsSection.classList) buttonsSection.classList.remove('timeline-panel-collapsed');
      var buttonsToggle = $('buttonsToggle');
      if (buttonsToggle) buttonsToggle.style.display = 'none';
      var buttonsPanelContent = $('buttonsPanelContent');
      if (buttonsPanelContent) buttonsPanelContent.style.display = 'none';
      var timeline = $('cutsTimeline');
      if (timeline) timeline.style.display = 'block';
    } else {
      closeViewerHelpModal();
      // Expand cuts panel when returning to Admin mode
      var cutsPanel = $('cutsPanel');
      if (cutsPanel && cutsPanel.classList) cutsPanel.classList.remove('collapsed');
      if (cutsPanel) cutsPanel.style.flex = '1 1 auto';
      var buttonsToggle = $('buttonsToggle');
      if (buttonsToggle) buttonsToggle.style.display = '';
      var buttonsPanelContent = $('buttonsPanelContent');
      if (buttonsPanelContent) buttonsPanelContent.style.display = '';
    }
  }

  function setStatus(msg, isError) {
    console[isError ? 'error' : 'log']('[UBR]', msg || '');
  }

  function loadProjectPreferences() {
    try {
      var sortMode = String(localStorage.getItem('ubr_project_sort') || 'date-desc').trim();
      state.sortMode = sortMode || 'date-desc';
    } catch (_) {
      state.sortMode = 'date-desc';
    }
    try {
      var hidden = JSON.parse(localStorage.getItem('ubr_hidden_projects') || '[]');
      state.hiddenProjectIds = Array.isArray(hidden) ? hidden.map(function (x) { return String(x || '').trim(); }).filter(Boolean) : [];
    } catch (_) {
      state.hiddenProjectIds = [];
    }
    try {
      var ff = String(localStorage.getItem('ubr_project_folder_filter') || '__all__').trim();
      state.folderFilter = ff || '__all__';
    } catch (_) {
      state.folderFilter = '__all__';
    }
    try {
      var folders = JSON.parse(localStorage.getItem('ubr_project_folders') || '[]');
      state.folderList = Array.isArray(folders) ? folders.map(function (x) { return String(x || '').trim(); }).filter(Boolean) : [];
    } catch (_) {
      state.folderList = [];
    }
    try {
      var folderMap = JSON.parse(localStorage.getItem('ubr_project_folder_map') || '{}');
      state.projectFolderMap = (folderMap && typeof folderMap === 'object') ? folderMap : {};
    } catch (_) {
      state.projectFolderMap = {};
    }
    try {
      var collapsed = JSON.parse(localStorage.getItem('ubr_project_folder_collapsed') || '{}');
      state.folderCollapsedMap = (collapsed && typeof collapsed === 'object') ? collapsed : {};
    } catch (_) {
      state.folderCollapsedMap = {};
    }
  }

  function saveProjectSortMode(mode) {
    state.sortMode = String(mode || 'date-desc');
    try { localStorage.setItem('ubr_project_sort', state.sortMode); } catch (_) {}
  }

  function saveProjectFolderPrefs() {
    try { localStorage.setItem('ubr_project_folders', JSON.stringify(state.folderList || [])); } catch (_) {}
    try { localStorage.setItem('ubr_project_folder_map', JSON.stringify(state.projectFolderMap || {})); } catch (_) {}
    try { localStorage.setItem('ubr_project_folder_filter', String(state.folderFilter || '__all__')); } catch (_) {}
    try { localStorage.setItem('ubr_project_folder_collapsed', JSON.stringify(state.folderCollapsedMap || {})); } catch (_) {}
  }

  function normalizeFolderName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 48);
  }

  function getProjectId(entry) {
    return String(entry && entry.id || '').trim();
  }

  function getProjectFolder(entry) {
    var id = getProjectId(entry);
    if (!id) return '';
    return normalizeFolderName(state.projectFolderMap[id] || '');
  }

  function getAllFolderNames() {
    var set = Object.create(null);
    var out = [];
    (state.folderList || []).forEach(function (name) {
      var n = normalizeFolderName(name);
      if (!n || set[n]) return;
      set[n] = true;
      out.push(n);
    });
    Object.keys(state.projectFolderMap || {}).forEach(function (id) {
      var n = normalizeFolderName(state.projectFolderMap[id]);
      if (!n || set[n]) return;
      set[n] = true;
      out.push(n);
    });
    out.sort(function (a, b) { return a.localeCompare(b); });
    return out;
  }

  function applyFolderFilter(list) {
    var arr = Array.isArray(list) ? list : [];
    var f = String(state.folderFilter || '__all__');
    if (f === '__all__') return arr;
    if (f === '__none__') {
      return arr.filter(function (entry) { return !getProjectFolder(entry); });
    }
    return arr.filter(function (entry) { return getProjectFolder(entry) === f; });
  }

  function saveHiddenProjectIds() {
    try { localStorage.setItem('ubr_hidden_projects', JSON.stringify(state.hiddenProjectIds || [])); } catch (_) {}
  }

  function parseProjectDateValue(entry) {
    var raw = String(entry && entry.date || '').trim();
    if (!raw) return 0;
    var t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }

  function sortProjects(list) {
    var arr = Array.isArray(list) ? list.slice() : [];
    var mode = String(state.sortMode || 'date-desc');
    arr.sort(function (a, b) {
      var an = String(a && a.name || '').toLowerCase();
      var bn = String(b && b.name || '').toLowerCase();
      var ad = parseProjectDateValue(a);
      var bd = parseProjectDateValue(b);
      if (mode === 'date-asc') return ad - bd || an.localeCompare(bn);
      if (mode === 'name-asc') return an.localeCompare(bn) || (bd - ad);
      if (mode === 'name-desc') return bn.localeCompare(an) || (bd - ad);
      return bd - ad || an.localeCompare(bn);
    });
    return arr;
  }

  function isHiddenProject(entry) {
    var id = String(entry && entry.id || '').trim();
    if (!id) return false;
    return Array.isArray(state.hiddenProjectIds) && state.hiddenProjectIds.includes(id);
  }

  function normalizeYoutubeId(input) {
    if (!input) return '';
    var s = String(input).trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
    var m = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m && m[1]) return m[1];
    var m2 = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (m2 && m2[1]) return m2[1];
    return '';
  }

  function ensurePanel() {
    var videoSection = $('videoSection');
    if (!videoSection) return;
    if (!document.getElementById(PLAYER_ID + '-host')) {
      var host = document.createElement('div');
      host.id = PLAYER_ID + '-host';
      host.innerHTML = '<div id="' + PLAYER_ID + '"></div><div id="' + PLAYER_ID + '-hitlock"></div>';
      videoSection.appendChild(host);
    }
    if (!document.getElementById('ubr-multiview')) {
      var multi = document.createElement('div');
      multi.id = 'ubr-multiview';
      videoSection.appendChild(multi);
    }
  }

  function ensureYoutubeApi() {
    if (window.YT && window.YT.Player) {
      state.ytApiReady = true;
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var existing = document.getElementById(API_SCRIPT_ID);
      if (!existing) {
        var s = document.createElement('script');
        s.id = API_SCRIPT_ID;
        s.src = 'https://www.youtube.com/iframe_api';
        s.async = true;
        s.onerror = function () { reject(new Error('No se pudo cargar YouTube IFrame API')); };
        document.head.appendChild(s);
      }
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === 'function') prev();
        state.ytApiReady = true;
        resolve();
      };
    });
  }

  function createOrLoadPlayer(youtubeId, startAtSec) {
    return ensureYoutubeApi().then(function () {
      if (!youtubeId) throw new Error('El proyecto no tiene youtubeId valido');
      var startAt = Math.max(0, Number(startAtSec) || 0);
      if (state.player && typeof state.player.loadVideoById === 'function') {
        try {
          state.player.loadVideoById({ videoId: youtubeId, startSeconds: startAt });
        } catch (_) {
          state.player.loadVideoById(youtubeId, startAt);
        }
        setPlayerPlaybackRate(state.player, state.playbackRate);
        return;
      }
      state.player = new YT.Player(PLAYER_ID, {
        videoId: youtubeId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          controls: 0,
          disablekb: 1,
          iv_load_policy: 3,
          fs: 0,
          playsinline: 1,
        },
        events: {
          onReady: function (ev) {
            setPlayerPlaybackRate(ev && ev.target, state.playbackRate);
            if (!Number.isFinite(startAt) || startAt <= 0) return;
            try { ev.target.seekTo(startAt, true); } catch (_) {}
          },
        },
      });
    });
  }

  function seekPlayerWithRetry(player, targetSec) {
    if (!player || typeof player.seekTo !== 'function') return;
    var t = Math.max(0, Number(targetSec) || 0);
    try { player.seekTo(t, true); } catch (_) {}
    setTimeout(function () {
      try { player.seekTo(t, true); } catch (_) {}
    }, 180);
    setTimeout(function () {
      try { player.seekTo(t, true); } catch (_) {}
    }, 520);
  }

  function getAllPlayers() {
    var out = [];
    if (state.player) out.push(state.player);
    if (Array.isArray(state.multiviewPlayers)) {
      state.multiviewPlayers.forEach(function (entry) {
        if (entry && entry.player) out.push(entry.player);
      });
    }
    return out;
  }

  function getNearestPlaybackRate(player, desired) {
    var rate = Math.max(0.25, Math.min(2, Number(desired) || 1));
    if (!player || typeof player.getAvailablePlaybackRates !== 'function') return rate;
    try {
      var list = player.getAvailablePlaybackRates();
      if (!Array.isArray(list) || !list.length) return rate;
      var nearest = Number(list[0]) || rate;
      var bestDiff = Math.abs(nearest - rate);
      for (var i = 1; i < list.length; i += 1) {
        var candidate = Number(list[i]);
        var diff = Math.abs(candidate - rate);
        if (diff < bestDiff) {
          nearest = candidate;
          bestDiff = diff;
        }
      }
      return Number(nearest) || rate;
    } catch (_) {
      return rate;
    }
  }

  function setPlayerPlaybackRate(player, desired) {
    if (!player || typeof player.setPlaybackRate !== 'function') return;
    var rate = getNearestPlaybackRate(player, desired);
    try { player.setPlaybackRate(rate); } catch (_) {}
  }

  function applyPlaybackRateToAll(desired) {
    var clamped = Math.max(0.25, Math.min(2, Number(desired) || 1));
    state.playbackRate = clamped;
    getAllPlayers().forEach(function (player) {
      setPlayerPlaybackRate(player, clamped);
    });
  }

  function isPlayerRunning(player) {
    if (!player || typeof player.getPlayerState !== 'function') return false;
    try {
      var st = Number(player.getPlayerState());
      return st === 1 || st === 3;
    } catch (_) {
      return false;
    }
  }

  function isAnyPlayerRunning() {
    return getAllPlayers().some(isPlayerRunning);
  }

  function playAllPlayers() {
    getAllPlayers().forEach(function (player) {
      if (!player || typeof player.playVideo !== 'function') return;
      try { player.playVideo(); } catch (_) {}
    });
  }

  function pauseAllPlayers() {
    getAllPlayers().forEach(function (player) {
      if (!player || typeof player.pauseVideo !== 'function') return;
      try { player.pauseVideo(); } catch (_) {}
    });
  }

  function getActiveCam() {
    var cams = state.project && Array.isArray(state.project.cameras) ? state.project.cameras : [];
    return cams[state.activeCamIdx] || cams[0] || null;
  }

  function getCamOffsetByIdx(idx) {
    var cams = state.project && Array.isArray(state.project.cameras) ? state.project.cameras : [];
    var cam = cams[idx];
    return Number(cam && cam.offset) || 0;
  }

  function getCurrentPlayerTime() {
    if (state.player && typeof state.player.getCurrentTime === 'function') {
      try { return Math.max(0, Number(state.player.getCurrentTime()) || 0); } catch (_) {}
    }
    return 0;
  }

  function timelineToCamTime(timelineTime, camIdx) {
    return Math.max(0, (Number(timelineTime) || 0) + getCamOffsetByIdx(camIdx));
  }

  function camToTimelineTime(camTime, camIdx) {
    return Math.max(0, (Number(camTime) || 0) - getCamOffsetByIdx(camIdx));
  }

  function getCurrentTimelineTime() {
    if (state.multiviewActive) return Math.max(0, Number(state.lastTimelineTime) || 0);
    return camToTimelineTime(getCurrentPlayerTime(), state.activeCamIdx);
  }

  function exitMultiview() {
    state.multiviewActive = false;
    pauseAllPlayers();
    if (Array.isArray(state.multiviewPlayers)) {
      state.multiviewPlayers.forEach(function (entry) {
        if (!entry || !entry.player || typeof entry.player.destroy !== 'function') return;
        try { entry.player.destroy(); } catch (_) {}
      });
    }
    state.multiviewPlayers = [];
    var mv = $('ubr-multiview');
    if (mv) {
      mv.classList.remove('active');
      mv.innerHTML = '';
    }
    var host = document.getElementById(PLAYER_ID + '-host');
    if (host) host.style.display = '';
  }

  function promptMultiviewOrientation() {
    var ans = window.prompt('Multivista: escribe H (horizontal) o V (vertical)', 'H');
    if (ans === null) return '';
    var key = String(ans || '').trim().toUpperCase();
    return key === 'V' ? 'vertical' : 'horizontal';
  }

  function openMultiview(orientation) {
    var cams = state.project && Array.isArray(state.project.cameras) ? state.project.cameras : [];
    var valid = [];
    cams.forEach(function (cam, idx) {
      var id = normalizeYoutubeId(cam && (cam.youtubeId || cam.url || cam.video));
      if (!id) return;
      valid.push({ cam: cam, idx: idx, youtubeId: id });
    });
    if (valid.length < 2) return;

    var timelineNow = getCurrentTimelineTime();
    state.lastTimelineTime = timelineNow;

    /* Avoid hidden main player continuing with audio */
    if (state.player && typeof state.player.pauseVideo === 'function') {
      try { state.player.pauseVideo(); } catch (_) {}
    }

    var host = document.getElementById(PLAYER_ID + '-host');
    if (host) host.style.display = 'none';

    var mv = $('ubr-multiview');
    if (!mv) return;
    mv.innerHTML = '';
    mv.classList.add('active');
    state.multiviewActive = true;

    var count = valid.length;
    var cols = 1;
    if (count === 2) {
      cols = orientation === 'vertical' ? 1 : 2;
    } else if (count === 3) {
      cols = orientation === 'vertical' ? 1 : 3;
    } else {
      cols = 2;
    }
    mv.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';

    ensureYoutubeApi().then(function () {
      state.multiviewPlayers = [];
      valid.forEach(function (entry, i) {
        var cam = entry.cam;
        var id = entry.youtubeId;
        var start = Math.max(0, Math.floor(timelineToCamTime(timelineNow, entry.idx)));
        var playerId = 'ubr-mv-player-' + i;
        var cell = document.createElement('div');
        cell.className = 'ubr-mv-cell';
        cell.innerHTML = '' +
          '<span class="ubr-mv-label">' + (cam.label || ('Cam ' + (i + 1))) + '</span>' +
          '<div id="' + playerId + '"></div>' +
          '<div class="ubr-mv-hitlock"></div>';
        mv.appendChild(cell);

        var p = new YT.Player(playerId, {
          videoId: id,
          playerVars: {
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            controls: 0,
            disablekb: 1,
            iv_load_policy: 3,
            fs: 0,
          },
          events: {
            onReady: function (ev) {
              try { ev.target.mute(); } catch (_) {}
              setPlayerPlaybackRate(ev && ev.target, state.playbackRate);
              try { ev.target.seekTo(start, true); } catch (_) {}
              try { ev.target.playVideo(); } catch (_) {}
            },
          },
        });
        state.multiviewPlayers.push({ player: p, camIdx: entry.idx });
      });
    }).catch(function () {
      setStatus('No se pudo iniciar multivista (YouTube API).', true);
    });
  }

  function switchCamera(idx) {
    var cams = state.project && Array.isArray(state.project.cameras) ? state.project.cameras : [];
    if (!cams.length) return;
    var prevIdx = state.activeCamIdx;
    idx = Math.max(0, Math.min(cams.length - 1, Number(idx) || 0));
    if (idx === prevIdx && !state.multiviewActive) {
      renderCameraSwitcher();
      return;
    }

    var timelineNow = Number(state.lastTimelineTime);
    if (!Number.isFinite(timelineNow) || timelineNow <= 0) {
      timelineNow = getCurrentTimelineTime();
    }
    state.lastTimelineTime = timelineNow;
    var targetCamTime = timelineToCamTime(timelineNow, idx);

    exitMultiview();
    state.activeCamIdx = idx;
    var cam = cams[idx];
    var ytId = normalizeYoutubeId(cam && (cam.youtubeId || cam.url || cam.video));
    if (!ytId) return;
    createOrLoadPlayer(ytId, targetCamTime).then(function () {
      if (state.player && typeof state.player.seekTo === 'function') {
        seekPlayerWithRetry(state.player, targetCamTime);
      }
    });
    renderCameraSwitcher();
  }

  function renderCameraSwitcher() {
    var wrap = $('ubr-cam-switcher');
    if (!wrap) return;
    var cams = state.project && Array.isArray(state.project.cameras) ? state.project.cameras : [];
    wrap.innerHTML = '';
    if (cams.length <= 1) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    cams.forEach(function (cam, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ubr-cam-btn' + (i === state.activeCamIdx ? ' active' : '');
      btn.textContent = cam.label || ('Cam ' + (i + 1));
      btn.onclick = function () { switchCamera(i); };
      wrap.appendChild(btn);
    });

    var mvBtn = document.createElement('button');
    mvBtn.type = 'button';
    mvBtn.className = 'ubr-cam-btn' + (state.multiviewActive ? ' active' : '');
    mvBtn.textContent = 'Multi';
    mvBtn.title = 'Multivista';
    mvBtn.onclick = function () {
      var orientation = promptMultiviewOrientation();
      if (!orientation) return;
      openMultiview(orientation);
    };
    wrap.appendChild(mvBtn);
  }

  function seekTo(seconds) {
    if (!state.player || typeof state.player.seekTo !== 'function') return;
    state.player.seekTo(Math.max(0, Number(seconds) || 0), true);
    try { state.player.playVideo(); } catch (_) {}
  }

  function applyMainViewportTransform() {
    var host = document.getElementById(PLAYER_ID + '-host');
    if (!host) return;
    var zoom = Math.max(1, Math.min(4, Number(state.zoom) || 1));
    var panX = Number(state.panX) || 0;
    var panY = Number(state.panY) || 0;
    if (zoom <= 1.001) {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      host.style.transform = '';
      host.classList.remove('zoomed');
      return;
    }
    host.style.transformOrigin = '50% 50%';
    host.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
    host.classList.add('zoomed');
  }

  function clampPanByZoom(boundsW, boundsH) {
    var zoom = Math.max(1, Number(state.zoom) || 1);
    if (zoom <= 1) {
      state.panX = 0;
      state.panY = 0;
      return;
    }
    var maxX = Math.max(0, (boundsW * (zoom - 1)) / 2);
    var maxY = Math.max(0, (boundsH * (zoom - 1)) / 2);
    state.panX = Math.max(-maxX, Math.min(maxX, Number(state.panX) || 0));
    state.panY = Math.max(-maxY, Math.min(maxY, Number(state.panY) || 0));
  }

  function resetMainViewport() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    applyMainViewportTransform();
  }

  function ensureZoomPanControls() {
    if (window.__UBR_ZOOM_PAN__) return;
    window.__UBR_ZOOM_PAN__ = true;

    var host = document.getElementById(PLAYER_ID + '-host');
    var hit = document.getElementById(PLAYER_ID + '-hitlock');
    var surface = hit || host;
    if (!host || !surface) return;

    var dragging = false;
    var dragStartX = 0;
    var dragStartY = 0;
    var panStartX = 0;
    var panStartY = 0;

    surface.addEventListener('wheel', function (ev) {
      if (!ev.metaKey && !ev.ctrlKey) return;
      try { ev.preventDefault(); } catch (_) {}
      var rect = host.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;

      var oldZoom = Math.max(1, Number(state.zoom) || 1);
      var step = ev.deltaY < 0 ? 0.1 : -0.1;
      var newZoom = Math.max(1, Math.min(4, oldZoom + step));
      if (Math.abs(newZoom - oldZoom) < 0.0001) return;

      var dx = ev.clientX - (rect.left + rect.width / 2);
      var dy = ev.clientY - (rect.top + rect.height / 2);
      var ratio = newZoom / oldZoom;

      state.panX = (Number(state.panX) || 0) * ratio + dx * (1 - ratio);
      state.panY = (Number(state.panY) || 0) * ratio + dy * (1 - ratio);
      state.zoom = newZoom;
      clampPanByZoom(rect.width, rect.height);
      applyMainViewportTransform();
    }, { passive: false });

    surface.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0) return;
      if ((Number(state.zoom) || 1) <= 1.001) return;
      dragging = true;
      host.classList.add('dragging');
      dragStartX = ev.clientX;
      dragStartY = ev.clientY;
      panStartX = Number(state.panX) || 0;
      panStartY = Number(state.panY) || 0;
      try { ev.preventDefault(); } catch (_) {}
    });

    window.addEventListener('mousemove', function (ev) {
      if (!dragging) return;
      var rect = host.getBoundingClientRect();
      state.panX = panStartX + (ev.clientX - dragStartX);
      state.panY = panStartY + (ev.clientY - dragStartY);
      clampPanByZoom(rect.width, rect.height);
      applyMainViewportTransform();
    });

    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      host.classList.remove('dragging');
    });

    surface.addEventListener('dblclick', function () {
      resetMainViewport();
    });
  }

  function clipStartWithOffset(clip) {
    var start = Number(clip && clip.start) || 0;
    if (!clip || !state.project || !Array.isArray(state.project.cameras)) return start;
    var camId = clip.cameraId;
    var cam = state.project.cameras.find(function (c) { return c && c.id === camId; });
    var offset = Number(cam && cam.offset) || 0;
    return start + offset;
  }

  function normalizeKey(text) {
    return String(text || '').trim().toUpperCase();
  }

  function getClipCategory(clip) {
    var raw = normalizeKey((clip && (clip.attr || clip.label || clip.name)) || '');
    if (!raw) return 'OTROS';
    if (raw.indexOf('SCRUM') >= 0) return 'SCRUM';
    if (raw.indexOf('LINE') >= 0 || raw.indexOf('TO ') >= 0 || raw === 'TO OUR' || raw === 'TO OPP') return 'LINEOUT';
    if (raw.indexOf('TRY') >= 0 || raw.indexOf('CONV') >= 0 || raw.indexOf('GOAL') >= 0) return 'PUNTUACION';
    if (raw.indexOf('PENAL') >= 0 || raw.indexOf('FK') >= 0) return 'PENAL';
    if (raw.indexOf('KICK') >= 0 || raw.indexOf('SALIDA') >= 0) return 'KICK';
    if (raw.indexOf('RUCK') >= 0 || raw.indexOf('MAUL') >= 0) return 'FASES';
    if (raw.indexOf('BREAKLINE') >= 0 || raw.indexOf('KILLER') >= 0 || raw.indexOf('P OUR') >= 0 || raw.indexOf('P OPP') >= 0) return 'ATAQUE';
    if (raw.indexOf('PAUSA') >= 0 || raw.indexOf('JUEGO') >= 0 || raw.indexOf('SUSTITUCIONES') >= 0) return 'CONTROL';
    return 'OTROS';
  }

  function buildViewerLists(project) {
    var sourceLists = project && Array.isArray(project.lists) ? project.lists : [];
    var flatClips = [];
    sourceLists.forEach(function (list) {
      var clips = list && Array.isArray(list.clips) ? list.clips : [];
      clips.forEach(function (clip) { flatClips.push(clip); });
    });

    if (!flatClips.length) return sourceLists;

    var grouped = {};
    flatClips.forEach(function (clip) {
      var category = getClipCategory(clip);
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(clip);
    });

    var ordered = ['SCRUM', 'LINEOUT', 'KICK', 'PENAL', 'FASES', 'ATAQUE', 'PUNTUACION', 'CONTROL', 'OTROS'];
    var lists = [{ id: 'all-events', name: 'Todos los eventos', clips: flatClips.slice() }];
    ordered.forEach(function (name) {
      if (grouped[name] && grouped[name].length) {
        lists.push({ id: 'cat-' + name.toLowerCase(), name: name, clips: grouped[name].slice() });
      }
    });
    return lists;
  }

  function renderClipButtons() {}

  function renderListsSelector() {}

  function getFirstYoutubeId(project) {
    var cams = project && Array.isArray(project.cameras) ? project.cameras : [];
    for (var i = 0; i < cams.length; i += 1) {
      var id = normalizeYoutubeId(cams[i] && (cams[i].youtubeId || cams[i].url || cams[i].video));
      if (id) return id;
    }
    return '';
  }

  function resolveProjectFile(entry) {
    if (!entry) return '';
    return String(entry.file || entry.url || '').trim();
  }

  function populateProjectSelector() {
    var inlineSelect = $('ubr-inline-project-select');
    if (!inlineSelect) return;
    inlineSelect.innerHTML = '';
    if (!state.manifest.length) {
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'No hay proyectos';
      inlineSelect.appendChild(empty);
      return;
    }
    var selectedIdx = 0;
    state.manifest.forEach(function (p, idx) {
      var option = document.createElement('option');
      option.value = String(idx);
      var folder = getProjectFolder(p);
      var label = p.name ? String(p.name) : ('Proyecto ' + (idx + 1));
      option.textContent = folder ? ('[' + folder + '] ' + label) : label;
      if (String(getProjectId(p) || '') === String(state.selectedProjectId || '')) selectedIdx = idx;
      inlineSelect.appendChild(option);
    });
    inlineSelect.value = String(selectedIdx);
    var selectedEntry = state.manifest[selectedIdx];
    if (selectedEntry) state.selectedProjectId = getProjectId(selectedEntry);

    var sortSel = $('ubr-inline-project-sort');
    if (sortSel) sortSel.value = String(state.sortMode || 'date-desc');

    var folderFilterSel = $('ubr-inline-folder-filter');
    var folders = getAllFolderNames();
    if (folderFilterSel) {
      folderFilterSel.innerHTML = '';
      var allOpt = document.createElement('option');
      allOpt.value = '__all__';
      allOpt.textContent = 'Carpeta: Todas';
      folderFilterSel.appendChild(allOpt);
      var noneOpt = document.createElement('option');
      noneOpt.value = '__none__';
      noneOpt.textContent = 'Carpeta: Sin carpeta';
      folderFilterSel.appendChild(noneOpt);
      folders.forEach(function (name) {
        var o = document.createElement('option');
        o.value = name;
        o.textContent = 'Carpeta: ' + name;
        folderFilterSel.appendChild(o);
      });
      folderFilterSel.value = String(state.folderFilter || '__all__');
      if (folderFilterSel.value !== String(state.folderFilter || '__all__')) folderFilterSel.value = '__all__';
    }
    var folderTargetSel = $('ubr-inline-folder-target');
    if (folderTargetSel) folderTargetSel.remove();
  }

  function createProjectFolder() {
    if (!isAdminUnlocked()) {
      alert('Solo admin puede crear carpetas.');
      return;
    }
    var raw = window.prompt('Nombre de carpeta (ej: Rivales, UBR Masc, UBR Fem):', 'Rivales');
    if (raw === null) return;
    var name = normalizeFolderName(raw);
    if (!name) return;
    var exists = getAllFolderNames().includes(name);
    if (!exists) {
      state.folderList.push(name);
      state.folderList = getAllFolderNames();
      saveProjectFolderPrefs();
    }
    loadManifest();
  }

  function moveProjectByIdToFolder(projectId, folderName) {
    if (!isAdminUnlocked()) return;
    var id = String(projectId || '').trim();
    if (!id) return;
    var folder = normalizeFolderName(folderName || '');
    if (!folder) {
      delete state.projectFolderMap[id];
    } else {
      state.projectFolderMap[id] = folder;
      if (!state.folderList.includes(folder)) state.folderList.push(folder);
    }
    saveProjectFolderPrefs();
    loadManifest();
  }

  function onFolderDragOver(ev) {
    if (!isAdminUnlocked()) return;
    if (!ev || !ev.dataTransfer) return;
    try { ev.preventDefault(); } catch (_) {}
    ev.dataTransfer.dropEffect = 'move';
    var target = ev.currentTarget;
    if (target && target.classList) target.classList.add('drop-target');
  }

  function onFolderDragLeave(ev) {
    var target = ev && ev.currentTarget;
    if (target && target.classList) target.classList.remove('drop-target');
  }

  function onFolderDrop(ev, folderName) {
    if (!isAdminUnlocked()) return;
    if (!ev || !ev.dataTransfer) return;
    try { ev.preventDefault(); } catch (_) {}
    var target = ev.currentTarget;
    if (target && target.classList) target.classList.remove('drop-target');
    var pid = String(ev.dataTransfer.getData('text/ubr-project-id') || '').trim();
    if (!pid) return;
    moveProjectByIdToFolder(pid, folderName || '');
  }

  function moveSelectedProjectToFolder() {
    return moveSelectedProjectToFolderFromButton(null);
  }

  function moveSelectedProjectToFolderFromButton(anchorEl) {
    if (!isAdminUnlocked()) {
      alert('Solo admin puede mover proyectos entre carpetas.');
      return;
    }
    var sel = $('ubr-inline-project-select');
    if (!sel || !state.manifest.length) return;
    var idx = Number(sel.value || 0);
    var entry = state.manifest[idx];
    if (!entry) return;
    var id = getProjectId(entry);
    if (!id) return;
    var folders = getAllFolderNames();
    if (!folders.length) {
      alert('No hay carpetas creadas. Crea una primero.');
      return;
    }

    var prev = $('ubr-inline-move-menu');
    if (prev) prev.remove();

    var menu = document.createElement('select');
    menu.id = 'ubr-inline-move-menu';
    menu.className = 'ubr-inline-move-menu';
    menu.innerHTML = '<option value="" disabled selected>Mover a...</option><option value="__none__">Sin carpeta</option>';
    folders.forEach(function (name) {
      var o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      menu.appendChild(o);
    });

    var rect = null;
    if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
      rect = anchorEl.getBoundingClientRect();
    }
    var top = rect ? (rect.bottom + 6) : 120;
    var left = rect ? Math.max(8, rect.right - 180) : 24;
    menu.style.top = String(Math.max(8, top)) + 'px';
    menu.style.left = String(Math.max(8, left)) + 'px';

    var closeMenu = function () {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    };

    menu.onchange = function () {
      var target = String(menu.value || '');
      moveProjectByIdToFolder(id, target === '__none__' ? '' : target);
      closeMenu();
    };
    menu.onblur = closeMenu;

    document.body.appendChild(menu);
    setTimeout(function () {
      try { menu.focus(); } catch (_) {}
    }, 0);
  }

  function deleteSelectedProject() {
    if (!isAdminUnlocked()) {
      alert('Solo admin puede borrar/ocultar proyectos.');
      return;
    }
    var sel = $('ubr-inline-project-select');
    if (!sel || !state.manifest.length) return;
    var idx = Number(sel.value || 0);
    var entry = state.manifest[idx];
    if (!entry) return;

    var name = String(entry.name || entry.id || 'proyecto').trim();
    if (!window.confirm('¿Borrar/ocultar proyecto "' + name + '" del selector?')) return;

    if (entry.inlineProject) {
      var locals = [];
      try { locals = JSON.parse(localStorage.getItem('ubr_local_projects') || '[]'); } catch (_) { locals = []; }
      if (!Array.isArray(locals)) locals = [];
      locals = locals.filter(function (it) { return String(it && it.id || '') !== String(entry.id || ''); });
      try { localStorage.setItem('ubr_local_projects', JSON.stringify(locals)); } catch (_) {}
    } else {
      var id = String(entry.id || '').trim();
      if (id && !state.hiddenProjectIds.includes(id)) {
        state.hiddenProjectIds.push(id);
        saveHiddenProjectIds();
      }
    }

    loadManifest();
    setStatus('Proyecto ocultado del selector: ' + name, false);
  }

  function buildFolderBuckets(entries) {
    var buckets = Object.create(null);
    var order = [];
    (entries || []).forEach(function (entry) {
      var folder = getProjectFolder(entry) || 'Sin carpeta';
      if (!buckets[folder]) {
        buckets[folder] = [];
        order.push(folder);
      }
      buckets[folder].push(entry);
    });
    order.sort(function (a, b) {
      if (a === 'Sin carpeta') return 1;
      if (b === 'Sin carpeta') return -1;
      return a.localeCompare(b);
    });
    return { buckets: buckets, order: order };
  }

  function renderProjectFolderTree() {
    var host = $('ubr-project-folder-tree');
    if (!host) return;
    host.innerHTML = '';

    var data = applyFolderFilter(state.manifestAll || state.manifest || []);
    if (!data.length) {
      host.innerHTML = '<div style="padding:8px;font-size:11px;color:#64748b;">Sin proyectos en esta carpeta/filtro.</div>';
      return;
    }

    var grouped = buildFolderBuckets(data);
    grouped.order.forEach(function (folder) {
      var items = grouped.buckets[folder] || [];
      var key = 'folder:' + folder;
      var collapsed = !!state.folderCollapsedMap[key];

      var group = document.createElement('div');
      group.className = 'ubr-folder-group';

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'ubr-folder-head';
      head.innerHTML = '<span>' + folder + '</span><span>' + (collapsed ? '▶' : '▼') + ' ' + items.length + '</span>';
      head.ondragover = onFolderDragOver;
      head.ondragleave = onFolderDragLeave;
      head.ondrop = function (ev) { onFolderDrop(ev, folder === 'Sin carpeta' ? '' : folder); };
      head.onclick = function () {
        state.folderCollapsedMap[key] = !collapsed;
        saveProjectFolderPrefs();
        renderProjectFolderTree();
      };
      group.appendChild(head);

      if (!collapsed) {
        var list = document.createElement('div');
        list.className = 'ubr-folder-items';
        list.ondragover = onFolderDragOver;
        list.ondragleave = onFolderDragLeave;
        list.ondrop = function (ev) { onFolderDrop(ev, folder === 'Sin carpeta' ? '' : folder); };
        items.forEach(function (entry) {
          var pid = String(getProjectId(entry) || '');
          var itemBtn = document.createElement('button');
          itemBtn.type = 'button';
          itemBtn.className = 'ubr-folder-item' + (String(state.selectedProjectId || '') === String(getProjectId(entry) || '') ? ' active' : '');
          itemBtn.title = String(entry && entry.name || 'Proyecto');
          itemBtn.textContent = String(entry && entry.name || getProjectId(entry) || 'Proyecto');
          if (isAdminUnlocked()) {
            itemBtn.draggable = true;
            itemBtn.addEventListener('dragstart', function (ev) {
              if (!ev.metaKey) {
                try { ev.preventDefault(); } catch (_) {}
                setStatus('Para mover: mantén Cmd y arrastra el proyecto.', true);
                return;
              }
              try {
                ev.dataTransfer.effectAllowed = 'move';
                ev.dataTransfer.setData('text/ubr-project-id', pid);
              } catch (_) {}
            });
          }
          itemBtn.onclick = function () {
            loadProjectEntry(entry);
          };
          list.appendChild(itemBtn);
        });
        group.appendChild(list);
      }

      host.appendChild(group);
    });
  }

  function loadProjectEntry(entry) {
    if (!entry) return Promise.resolve();
    state.selectedProjectId = getProjectId(entry);
    setStatus('Cargando proyecto...', false);
    if (entry.inlineProject) {
      exitMultiview();
      state.project = entry.inlineProject;
      state.activeCamIdx = 0;
      state.viewerLists = buildViewerLists(state.project);
      renderListsSelector();
      var inlineYtId = getFirstYoutubeId(state.project);
      return Promise.all([
        createOrLoadPlayer(inlineYtId, 0),
        applyProjectToNativeUi(state.project),
      ]).then(function () {
        renderCameraSwitcher();
        renderProjectFolderTree();
        setStatus('Proyecto local cargado: ' + (state.project.name || entry.name || 'Sin nombre'), false);
      }).catch(function (err) {
        setStatus(String(err && err.message ? err.message : err), true);
      });
    }
    var url = resolveProjectFile(entry);
    if (!url) {
      setStatus('Entrada de manifest sin file/url', true);
      return Promise.resolve();
    }
    return loadProjectFromUrl(url)
      .then(function (project) {
        exitMultiview();
        state.project = project;
        state.activeCamIdx = 0;
        state.viewerLists = buildViewerLists(project);
        renderListsSelector();
        var ytId = getFirstYoutubeId(project);
        return Promise.all([
          createOrLoadPlayer(ytId),
          applyProjectToNativeUi(project),
        ]).then(function () {
          renderCameraSwitcher();
          renderProjectFolderTree();
          setStatus('Proyecto cargado: ' + (project.name || entry.name || 'Sin nombre'), false);
        });
      })
      .catch(function (err) {
        setStatus(String(err && err.message ? err.message : err), true);
      });
  }

  function parseMaybeJson(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function loadProjectFromUrl(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('No se pudo cargar proyecto: ' + res.status);
      return res.text();
    }).then(function (text) {
      var parsed = parseMaybeJson(text);
      if (!parsed) throw new Error('Proyecto no es JSON valido. Para XML, se requiere parser web.');
      return parsed;
    });
  }

  function toNativeClip(clip, idx) {
    var start = Number(clip && clip.start);
    var end = Number(clip && clip.end);
    var attr = String((clip && (clip.attr || clip.label || clip.name)) || ('evento_' + (idx + 1))).trim();
    return {
      name: String((clip && (clip.label || clip.name || clip.attr)) || ('Clip ' + (idx + 1))).trim() || ('Clip ' + (idx + 1)),
      attr: attr || ('evento_' + (idx + 1)),
      start: Number.isFinite(start) ? Math.max(0, start) : 0,
      end: Number.isFinite(end) ? Math.max(Number.isFinite(start) ? start : 0, end) : ((Number.isFinite(start) ? start : 0) + 1),
      camera: 0,
      offset: 0,
      free: false,
      qualifierZoneEnabled: false,
      qualifierTypeEnabled: false,
      qualifierPolarityEnabled: false,
      qualifierZone: 'N',
      qualifierType: 'N',
      qualifierPolarity: 'N',
      playerTags: [],
      playerTagId: '',
      playerTagResult: '0',
    };
  }

  function collectProjectClips(project) {
    var lists = project && Array.isArray(project.lists) ? project.lists : [];
    var out = [];
    lists.forEach(function (list) {
      var clips = list && Array.isArray(list.clips) ? list.clips : [];
      clips.forEach(function (clip) {
        out.push(clip);
      });
    });
    return out;
  }

  function applyProjectToNativeUi(project) {
    if (typeof window.applyProjectData !== 'function') {
      setStatus('No se encontro applyProjectData; se mantiene modo panel MVP.', true);
      return Promise.resolve();
    }
    state.mappedClips = collectProjectClips(project).map(toNativeClip);
    if (!state.mappedClips.length) {
      return Promise.resolve();
    }
    return window.applyProjectData({
      clips: state.mappedClips,
      playlists: [],
      xmlTabs: [],
      activeXmlTabIdx: -1,
    }, {}).then(function () {
      if (typeof window.refresh === 'function') window.refresh();
      if (typeof window.renderCutsTimeline === 'function') window.renderCutsTimeline();
      ensureEventFilterUi();
      renderCategoryOptions();
      renderEventFilterOptions();
      applyCombinedFilter('__all__', '__all__');
    });
  }

  function ensureSidebarIntegration() {
    var videosHeader = document.querySelector('#videosPanel .panel-header span');
    if (videosHeader) {
      videosHeader.textContent = 'Proyectos';
    }

    var cameraCard = $('cameraPanelCard');
    if (cameraCard) cameraCard.style.display = 'none';

    /* Collapse Listas instead of display:none so resizer1 keeps working */
    var playlistsPanel = $('playlistsPanel');
    if (playlistsPanel) playlistsPanel.style.display = 'none';
    /* Hide resizer2 (cutsPanel <-> playlistsPanel) */
    var resizer2 = $('resizer2');
    if (resizer2) resizer2.style.display = 'none';

    /* Give cutsPanel all remaining flex space and clear any saved fixed height */
    var cutsPanel = $('cutsPanel');
    if (cutsPanel) {
      cutsPanel.style.flex = '1 1 auto';
      cutsPanel.style.height = '';
      try {
        var saved = JSON.parse(localStorage.getItem('vap_panelsHeights') || '{}');
        delete saved.playlistsPanel;
        delete saved.cutsPanel;
        localStorage.setItem('vap_panelsHeights', JSON.stringify(saved));
      } catch (_) {}
    }

    var buttonsSection = $('buttonsSection');
    if (buttonsSection && buttonsSection.classList) {
      buttonsSection.classList.remove('timeline-panel-collapsed');
    }

    var timeline = $('cutsTimeline');
    if (timeline) timeline.style.display = '';

    var recentsHead = document.querySelector('#recentProjectsBar .recent-projects-head');
    if (recentsHead) recentsHead.style.display = 'none';
    var recentsList = $('recentProjectsList');
    if (recentsList) recentsList.style.display = 'none';

    ensureInlineProjectSelector();
    bridgeMainVideoWithYoutube();
    ensureZoomPanControls();
    ensureCameraHotkeys();
  }

  function ensureCameraHotkeys() {
    if (window.__UBR_CAM_HOTKEYS__) return;
    window.__UBR_CAM_HOTKEYS__ = true;

    document.addEventListener('keydown', function (ev) {
      if (!state.project || !Array.isArray(state.project.cameras)) return;
      var tag = String(ev && ev.target && ev.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      var key = String(ev.key || '').trim();
      if (!/^[0-9]$/.test(key)) return;
      var num = Number(key);
      if (!Number.isFinite(num) || num < 1) return;

      var cams = state.project.cameras || [];
      var camCount = cams.length;
      if (!camCount) return;

      if (num >= 1 && num <= camCount) {
        ev.preventDefault();
        switchCamera(num - 1);
        return;
      }

      var multiKey = camCount + 1;
      if (num === multiKey && camCount >= 2) {
        ev.preventDefault();
        var orientation = promptMultiviewOrientation();
        if (!orientation) return;
        openMultiview(orientation);
      }
    }, true);
  }

  function ensureInlineProjectSelector() {
    var host = $('recentProjectsBody');
    if (!host) return;
    if ($('ubr-inline-project-switcher')) return;

    var wrap = document.createElement('div');
    wrap.id = 'ubr-inline-project-switcher';
    wrap.className = 'ubr-inline-projects';
    wrap.innerHTML = '' +
      '<select id="ubr-inline-project-select"></select>' +
      '<div class="ubr-actions-right">' +
        '<button id="ubr-inline-viewer-pass" class="ubr-icon-btn" type="button" title="Claves viewer">🔑</button>' +
        '<button id="ubr-inline-project-rename" class="ubr-icon-btn" type="button" title="Renombrar proyecto (solo admin)">✏️</button>' +
        '<button id="ubr-inline-project-load" class="ubr-icon-btn" type="button" title="Cargar proyecto">📂</button>' +
        '<button id="ubr-inline-project-delete" class="ubr-icon-btn" type="button" title="Ocultar del selector">🗑</button>' +
      '</div>';

    var folderWrap = document.createElement('div');
    folderWrap.className = 'ubr-inline-projects';
    folderWrap.style.marginTop = '4px';
    folderWrap.innerHTML = '' +
      '<select id="ubr-inline-project-sort" title="Ordenar proyectos">' +
        '<option value="date-desc">Fecha: nuevas primero</option>' +
        '<option value="date-asc">Fecha: antiguas primero</option>' +
        '<option value="name-asc">Nombre: A-Z</option>' +
        '<option value="name-desc">Nombre: Z-A</option>' +
      '</select>' +
      '<select id="ubr-inline-folder-filter" title="Filtrar por carpeta"></select>' +
      '<div class="ubr-actions-right">' +
        '<button id="ubr-inline-folder-new" class="ubr-icon-btn" type="button" title="Crear carpeta"><span class="ubr-folder-plus-icon"><span class="f">📁</span><span class="p">+</span></span></button>' +
        '<button id="ubr-inline-folder-move" class="ubr-icon-btn" type="button" title="Mover proyecto">⇄</button>' +
      '</div>';

    var treeWrap = document.createElement('div');
    treeWrap.id = 'ubr-project-folder-tree';

    var publishStatusDiv = document.createElement('div');
    publishStatusDiv.id = 'ubr-publish-status';
    host.insertBefore(wrap, host.firstChild);
    host.insertBefore(publishStatusDiv, wrap.nextSibling);
    host.insertBefore(folderWrap, publishStatusDiv.nextSibling);
    host.insertBefore(treeWrap, folderWrap.nextSibling);

    var btn = $('ubr-inline-project-load');
    if (btn) {
      btn.onclick = function () {
        loadSelectedProject();
      };
    }

    var viewerPassBtn = $('ubr-inline-viewer-pass');
    if (viewerPassBtn) {
      viewerPassBtn.onclick = function () {
        openViewerPasswordsManager();
      };
    }

    var delBtn = $('ubr-inline-project-delete');
    if (delBtn) {
      delBtn.onclick = function () {
        deleteSelectedProject();
      };
    }

    var renameBtn = $('ubr-inline-project-rename');
    if (renameBtn) {
      renameBtn.onclick = function () {
        renameSelectedProject();
      };
    }

    var sortSel = $('ubr-inline-project-sort');
    if (sortSel) {
      sortSel.value = String(state.sortMode || 'date-desc');
      sortSel.onchange = function () {
        saveProjectSortMode(sortSel.value);
        loadManifest();
      };
    }

    var folderFilterSel = $('ubr-inline-folder-filter');
    if (folderFilterSel) {
      folderFilterSel.onchange = function () {
        state.folderFilter = String(folderFilterSel.value || '__all__');
        saveProjectFolderPrefs();
        loadManifest();
      };
    }

    var folderNewBtn = $('ubr-inline-folder-new');
    if (folderNewBtn) {
      folderNewBtn.onclick = function () {
        createProjectFolder();
      };
    }

    var folderMoveBtn = $('ubr-inline-folder-move');
    if (folderMoveBtn) {
      folderMoveBtn.onclick = function () {
        moveSelectedProjectToFolderFromButton(folderMoveBtn);
      };
    }

    /* Camera switcher bar — injected right after the project selector */
    if (!$('ubr-cam-switcher')) {
      var camBar = document.createElement('div');
      camBar.id = 'ubr-cam-switcher';
      camBar.innerHTML = '<span id="ubr-cam-switcher-label">📷&nbsp;Cámara:</span>';
      wrap.parentNode.insertBefore(camBar, wrap.nextSibling);
    }
  }

  function bridgeMainVideoWithYoutube() {
    if (window.__UBR_YT_BRIDGE__) return;
    window.__UBR_YT_BRIDGE__ = true;

    /* Intercept video.currentTime so item.onclick in the timeline also drives YouTube */
    var videoEl = document.getElementById('video');
    if (videoEl) {
      var proto = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(videoEl, 'currentTime', {
        configurable: true,
        set: function (val) {
          var timelineT = Math.max(0, Number(val) || 0);
          state.lastTimelineTime = timelineT;
          if (state.multiviewActive && Array.isArray(state.multiviewPlayers) && state.multiviewPlayers.length) {
            state.multiviewPlayers.forEach(function (entry) {
              if (!entry || !entry.player || typeof entry.player.seekTo !== 'function') return;
              try { entry.player.seekTo(timelineToCamTime(timelineT, entry.camIdx), true); } catch (_) {}
            });
          } else if (state.player && typeof state.player.seekTo === 'function') {
            try { state.player.seekTo(timelineToCamTime(timelineT, state.activeCamIdx), true); } catch (_) {}
          }
          if (proto && proto.set) { try { proto.set.call(videoEl, val); } catch (_) {} }
        },
        get: function () {
          if (state.multiviewActive) {
            return Math.max(0, Number(state.lastTimelineTime) || 0);
          }
          if (state.player && typeof state.player.getCurrentTime === 'function') {
            try { return camToTimelineTime(state.player.getCurrentTime(), state.activeCamIdx); } catch (_) {}
          }
          if (proto && proto.get) { try { return proto.get.call(videoEl); } catch (_) {} }
          return 0;
        },
      });

      /* Intercept video.paused so keepPlaying checks reflect YouTube state */
      var protoPaused = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'paused');
      Object.defineProperty(videoEl, 'paused', {
        configurable: true,
        get: function () {
          return !isAnyPlayerRunning();
          if (protoPaused && protoPaused.get) { try { return protoPaused.get.call(videoEl); } catch (_) {} }
          return true;
        },
      });

      /* Intercept play/pause from native controls so they affect all active cameras */
      videoEl.play = function () {
        playAllPlayers();
        return Promise.resolve();
      };
      videoEl.pause = function () {
        pauseAllPlayers();
      };

      var protoRate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      Object.defineProperty(videoEl, 'playbackRate', {
        configurable: true,
        set: function (val) {
          applyPlaybackRateToAll(val);
          if (protoRate && protoRate.set) { try { protoRate.set.call(videoEl, val); } catch (_) {} }
        },
        get: function () {
          if (state.player && typeof state.player.getPlaybackRate === 'function') {
            try { return Number(state.player.getPlaybackRate()) || state.playbackRate || 1; } catch (_) {}
          }
          if (protoRate && protoRate.get) { try { return protoRate.get.call(videoEl); } catch (_) {} }
          return state.playbackRate || 1;
        },
      });
    }

    /* Block editing mutations only in viewer mode */
    var originalDeleteSelectedCuts = window.deleteSelectedCuts;
    var originalDeleteSelectedButtons = window.deleteSelectedButtons;
    var originalDeleteSelectedComposerCuts = window.deleteSelectedComposerCuts;
    window.deleteSelectedCuts = function () {
      if (!isAdminUnlocked()) return false;
      return typeof originalDeleteSelectedCuts === 'function' ? originalDeleteSelectedCuts.apply(this, arguments) : false;
    };
    window.deleteSelectedButtons = function () {
      if (!isAdminUnlocked()) return false;
      return typeof originalDeleteSelectedButtons === 'function' ? originalDeleteSelectedButtons.apply(this, arguments) : false;
    };
    window.deleteSelectedComposerCuts = function () {
      if (!isAdminUnlocked()) return false;
      return typeof originalDeleteSelectedComposerCuts === 'function' ? originalDeleteSelectedComposerCuts.apply(this, arguments) : false;
    };

    /* Block Delete/Backspace key from removing clips */
    document.addEventListener('keydown', function (ev) {
      if (!state.project) return;
      var tag = String(ev && ev.target && ev.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      var key = String(ev && ev.key || '');
      if ((key === 'Delete' || key === 'Backspace') && !isAdminUnlocked()) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
      }
    }, true);

    if (!window.__UBR_READONLY_GUARDS__) {
      window.__UBR_READONLY_GUARDS__ = true;
      /* Block qualifier/tag context editing in viewer mode */
      document.addEventListener('contextmenu', function (ev) {
        if (isAdminUnlocked()) return;
        var target = ev && ev.target;
        if (!target || !target.closest) return;
        if (target.closest('#cutsList') || target.closest('#cutsTimeline') || target.closest('.cuts-timeline-item') || target.closest('.cut-item')) {
          try {
            ev.preventDefault();
            ev.stopImmediatePropagation();
          } catch (_) {}
        }
      }, true);

      /* Block shift-drag trim editing on timeline items in viewer mode */
      document.addEventListener('mousedown', function (ev) {
        if (isAdminUnlocked()) return;
        var target = ev && ev.target;
        if (!target || !target.closest) return;
        if (ev.shiftKey && target.closest('.cuts-timeline-item')) {
          try {
            ev.preventDefault();
            ev.stopImmediatePropagation();
          } catch (_) {}
        }
      }, true);
    }

    window.seekToTimelineTime = function (targetTimeline, opts) {
      var target = Math.max(0, Number(targetTimeline) || 0);
      var keepPlaying = !!(opts && opts.keepPlaying);
      state.lastTimelineTime = target;
      if (state.multiviewActive && Array.isArray(state.multiviewPlayers) && state.multiviewPlayers.length) {
        state.multiviewPlayers.forEach(function (entry) {
          if (!entry || !entry.player || typeof entry.player.seekTo !== 'function') return;
          try {
            entry.player.seekTo(timelineToCamTime(target, entry.camIdx), true);
            if (keepPlaying && typeof entry.player.playVideo === 'function') entry.player.playVideo();
            if (!keepPlaying && typeof entry.player.pauseVideo === 'function') entry.player.pauseVideo();
          } catch (_) {}
        });
      } else if (state.player && typeof state.player.seekTo === 'function') {
        try {
          state.player.seekTo(timelineToCamTime(target, state.activeCamIdx), true);
          if (keepPlaying && typeof state.player.playVideo === 'function') state.player.playVideo();
          if (!keepPlaying && typeof state.player.pauseVideo === 'function') state.player.pauseVideo();
        } catch (_) {}
      }
      if (typeof window.updateCutsTimelinePlayheadOnly === 'function') window.updateCutsTimelinePlayheadOnly(target, { force: true });
      if (typeof window.renderVideoTimelineClock === 'function') window.renderVideoTimelineClock(target);
      if (typeof window.requestCutsTimelineRender === 'function') window.requestCutsTimelineRender();
      return true;
    };

    var playBtn = $('videoPlayPauseBtn');
    if (playBtn) {
      playBtn.addEventListener('click', function (ev) {
        try {
          ev.preventDefault();
          ev.stopImmediatePropagation();
        } catch (_) {}

        if (isAnyPlayerRunning()) pauseAllPlayers();
        else playAllPlayers();
      }, true);
    }

    if (typeof window.setInterval === 'function') {
      window.setInterval(function () {
        var now = getCurrentTimelineTime();
        state.lastTimelineTime = now;
        if (typeof window.updateCutsTimelinePlayheadOnly === 'function') window.updateCutsTimelinePlayheadOnly(now);
        if (typeof window.renderVideoTimelineClock === 'function') window.renderVideoTimelineClock(now);
      }, 400);
    }
  }

  function ensureEventFilterUi() {
    var cutsFilterBar = $('cutsFilterBar');
    if (!cutsFilterBar) return;
    if ($('ubr-event-filter')) return;

    var wrap = document.createElement('div');
    wrap.className = 'ubr-event-filter-wrap';
    wrap.innerHTML = '' +
      '<label for="ubr-category-filter">Categoria:</label>' +
      '<select id="ubr-category-filter"></select>' +
      '<label for="ubr-event-filter">Evento:</label>' +
      '<select id="ubr-event-filter"></select>';
    cutsFilterBar.appendChild(wrap);

    var catSel = $('ubr-category-filter');
    if (catSel) {
      catSel.onchange = function () {
        state.selectedCategory = String(catSel.value || '__all__');
        renderEventFilterOptions();
        applyCombinedFilter(state.selectedCategory, state.selectedEvent);
      };
    }

    var sel = $('ubr-event-filter');
    if (sel) {
      sel.onchange = function () {
        state.selectedEvent = String(sel.value || '__all__');
        applyCombinedFilter(state.selectedCategory, state.selectedEvent);
      };
    }
  }

  function renderCategoryOptions() {
    var sel = $('ubr-category-filter');
    if (!sel) return;

    var seen = Object.create(null);
    var categories = [];
    state.mappedClips.forEach(function (clip) {
      var key = getClipCategory(clip);
      if (!key || seen[key]) return;
      seen[key] = true;
      categories.push(key);
    });

    var ordered = ['SCRUM', 'LINEOUT', 'KICK', 'PENAL', 'FASES', 'ATAQUE', 'PUNTUACION', 'CONTROL', 'OTROS'];
    categories.sort(function (a, b) {
      return ordered.indexOf(a) - ordered.indexOf(b);
    });

    sel.innerHTML = '';
    var all = document.createElement('option');
    all.value = '__all__';
    all.textContent = 'Todas';
    sel.appendChild(all);

    categories.forEach(function (category) {
      var o = document.createElement('option');
      o.value = category;
      o.textContent = category;
      sel.appendChild(o);
    });

    sel.value = state.selectedCategory;
  }

  function renderEventFilterOptions() {
    var sel = $('ubr-event-filter');
    if (!sel) return;

    var seen = Object.create(null);
    var attrs = [];
    state.mappedClips.forEach(function (clip) {
      if (state.selectedCategory !== '__all__' && getClipCategory(clip) !== state.selectedCategory) return;
      var key = String(clip && clip.attr || '').trim();
      if (!key) return;
      if (seen[key]) return;
      seen[key] = true;
      attrs.push(key);
    });
    attrs.sort();

    sel.innerHTML = '';
    var all = document.createElement('option');
    all.value = '__all__';
    all.textContent = 'Todos';
    sel.appendChild(all);

    attrs.forEach(function (attr) {
      var o = document.createElement('option');
      o.value = attr;
      o.textContent = attr;
      sel.appendChild(o);
    });

    if (!seen[state.selectedEvent] && state.selectedEvent !== '__all__') {
      state.selectedEvent = '__all__';
    }
    sel.value = state.selectedEvent;
  }

  function applyCombinedFilter(category, attr) {
    state.selectedCategory = category || '__all__';
    state.selectedEvent = attr || '__all__';
    if (typeof window.applyProjectData !== 'function') return;
    var clips = state.mappedClips.filter(function (clip) {
      if (state.selectedCategory !== '__all__' && getClipCategory(clip) !== state.selectedCategory) return false;
      if (state.selectedEvent !== '__all__' && String(clip && clip.attr || '') !== state.selectedEvent) return false;
      return true;
    });

    window.applyProjectData({
      clips: clips,
      playlists: [],
      xmlTabs: [],
      activeXmlTabIdx: -1,
    }, {}).then(function () {
      if (typeof window.refresh === 'function') window.refresh();
      if (typeof window.renderCutsTimeline === 'function') window.renderCutsTimeline();
    });
  }

  function loadSelectedProject() {
    var sel = $('ubr-inline-project-select');
    if (!sel || !state.manifest.length) return;
    var idx = Number(sel.value || 0);
    var entry = state.manifest[idx];
    return loadProjectEntry(entry);
  }

  /* ── API helpers ─────────────────────────────────────────────────────── */

  var API_BASE = '';  // mismo origen que el servidor; vacío = relativo

  function publishProject(projectData, metaOverride) {
    var meta = metaOverride || {};
    var apiKey = ensureAdminApiKey();
    if (!apiKey) return Promise.reject(new Error('API Key de admin requerida'));
    return fetch(API_BASE + '/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': apiKey },
      body: JSON.stringify({ project: projectData, meta: meta })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || 'Error desconocido');
      return data;
    });
  }

  function apiRenameProject(id, newName) {
    var apiKey = ensureAdminApiKey();
    if (!apiKey) return Promise.reject(new Error('API Key de admin requerida'));
    return fetch(API_BASE + '/api/rename-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': apiKey },
      body: JSON.stringify({ id: id, name: newName })
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.ok) throw new Error(data.error || 'Error desconocido');
      return data;
    });
  }

  function showPublishStatus(msg, isError) {
    var el = $('ubr-publish-status');
    if (!el) return;
    el.textContent = msg;
    el.className = isError ? 'error' : '';
    el.style.display = 'block';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () { el.style.display = 'none'; }, isError ? 6000 : 4000);
  }

  /* ── Renombrar proyecto seleccionado ──────────────────────────────────── */

  function renameSelectedProject() {
    if (!isAdminUnlocked()) return;
    var sel = $('ubr-inline-project-select');
    if (!sel || !state.manifest.length) return;
    var idx = Number(sel.value || 0);
    var entry = state.manifest[idx];
    if (!entry) return;
    var currentName = String(entry.name || entry.id || '').trim();
    var newName = window.prompt('Nuevo nombre para el proyecto:', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;
    newName = newName.trim();
    var projId = String(entry.id || '').trim();

    // Actualizar en memoria y localStorage inmediatamente
    entry.name = newName;
    if (entry.inlineProject && entry.inlineProject.name !== undefined) {
      entry.inlineProject.name = newName;
    }
    // Sincronizar en localProjects si aplica
    var locals = [];
    try { locals = JSON.parse(localStorage.getItem('ubr_local_projects') || '[]'); } catch (_) { locals = []; }
    locals = locals.map(function (it) {
      if (String(it && it.id || '') === projId) return Object.assign({}, it, { name: newName });
      return it;
    });
    try { localStorage.setItem('ubr_local_projects', JSON.stringify(locals)); } catch (_) {}
    populateProjectSelector();
    renderProjectFolderTree();

    // Intentar persistir en servidor
    apiRenameProject(projId, newName)
      .then(function () {
        showPublishStatus('✅ Renombrado: ' + newName, false);
      })
      .catch(function () {
        // Sin servidor: OK, solo es local
        showPublishStatus('✏️ Renombrado localmente (servidor no disponible)', false);
      });
  }

  function loadManifest() {
    setStatus('Cargando manifest...', false);
    fetch(API_BASE + '/api/manifest', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('No se pudo cargar /api/manifest: ' + res.status);
        return res.json();
      })
      .catch(function () {
        // Fallback para entorno local estático
        return fetch('./projects/manifest.json', { cache: 'no-store' }).then(function (res) {
          if (!res.ok) throw new Error('No se pudo cargar manifest local: ' + res.status);
          return res.json();
        });
      })
      .then(function (json) {
        var base = Array.isArray(json) ? json : [];
        var locals = [];
        try {
          locals = JSON.parse(localStorage.getItem('ubr_local_projects') || '[]');
          if (!Array.isArray(locals)) locals = [];
        } catch (_) { locals = []; }
        state.localProjects = locals;
        var merged = base.concat(locals);
        merged = merged.filter(function (entry) { return !isHiddenProject(entry); });
        state.manifestAll = sortProjects(merged);
        state.manifest = applyFolderFilter(state.manifestAll);
        populateProjectSelector();
        renderProjectFolderTree();
        if (!state.project && state.manifest.length) {
          loadProjectEntry(state.manifest[0]);
        }
        setStatus('Manifest cargado (' + state.manifest.length + ' proyectos)', false);
      })
      .catch(function (err) {
        var localsFallback = [];
        try {
          localsFallback = JSON.parse(localStorage.getItem('ubr_local_projects') || '[]');
          if (!Array.isArray(localsFallback)) localsFallback = [];
        } catch (_) { localsFallback = []; }
        state.localProjects = localsFallback;
        var fallback = localsFallback.filter(function (entry) { return !isHiddenProject(entry); });
        state.manifestAll = sortProjects(fallback);
        state.manifest = applyFolderFilter(state.manifestAll);
        populateProjectSelector();
        renderProjectFolderTree();
        if (!state.project && state.manifest.length) {
          loadProjectEntry(state.manifest[0]);
        }
        setStatus(String(err && err.message ? err.message : err), true);
      });
  }

  function installWebFallbacks() {
    var fallback = {
      projectOpenDialog: function () { return Promise.resolve({ canceled: true }); },
      projectSave: function () { return Promise.resolve({ ok: false, message: 'No disponible en web' }); },
      projectOpenPath: function () { return Promise.resolve(null); },
      projectResolveCameraPaths: function () { return Promise.resolve({ ok: false, message: 'No disponible en web' }); },
      pickCameraXmlFiles: function () { return Promise.resolve({ canceled: true, files: [] }); },
      youtubeResolveStreamUrl: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      resolveVideoStreamUrl: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      downloadVideoTempSource: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      ffmpegTranscoderExport: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      ffmpegExportCut: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      ffmpegExportPlaylist: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      ffmpegExportMultiview: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      generatePdfReport: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      generateMapPdfReport: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      ffmpegMerge: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      aiDetectScenes: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      aiExtractFrameHashes: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      convertToMp4FromFile: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      convertToMp4FromFileAuto: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      saveRecordingDirect: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      pickFolder: function () { return Promise.resolve({ canceled: true }); },
      saveWorkspaceFiles: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      ensureWorkspaceFolders: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      getMediaAccessStatus: function () { return Promise.resolve({ ok: true, status: 'granted' }); },
      requestMediaAccess: function () { return Promise.resolve({ ok: true, status: 'granted' }); },
      openMediaPrivacySettings: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      presenterToggle: function () { return Promise.resolve({ ok: false, error: 'No disponible en web' }); },
      presenterSync: function () {},
      presenterClose: function () {},
      onPresenterModeChanged: function () { return function () {}; },
      getPathForFile: function () { return Promise.resolve(''); },
    };

    if (!window.electronAPI) {
      window.electronAPI = fallback;
      return;
    }

    Object.keys(fallback).forEach(function (key) {
      if (typeof window.electronAPI[key] !== 'function') {
        window.electronAPI[key] = fallback[key];
      }
    });
  }

  /* ─────────────────────────────────────────
     ADMIN PANEL
  ───────────────────────────────────────── */

  var ADMIN_PASS_KEY = 'ubr_admin_session';
  var ADMIN_API_KEY_SESSION = 'ubr_admin_api_key';
  /* Admin password (editing features) */
  var ADMIN_PASSWORD = 'ubradmin2026';
  var ACCESS_PASS_KEY = 'ubr_site_access';
  var ACCESS_REMEMBER_KEY = 'ubr_site_access_remember';
  var ACCESS_REMEMBER_ROLE_KEY = 'ubr_site_access_role';
  var VIEWER_PASSWORDS_KEY = 'ubr_viewer_passwords';
  /* Viewer password (site access) */
  var ACCESS_PASSWORD = 'ubr2026';

  function getAdminApiKey() {
    try { return String(sessionStorage.getItem(ADMIN_API_KEY_SESSION) || '').trim(); } catch (_) { return ''; }
  }

  function setAdminApiKey(value) {
    var val = String(value || '').trim();
    try {
      if (val) sessionStorage.setItem(ADMIN_API_KEY_SESSION, val);
      else sessionStorage.removeItem(ADMIN_API_KEY_SESSION);
    } catch (_) {}
  }

  function ensureAdminApiKey() {
    var current = getAdminApiKey();
    if (current) return current;
    var typed = window.prompt('API Key Admin (Cloudflare):', '');
    if (typed === null) return '';
    var clean = String(typed || '').trim();
    if (!clean) return '';
    setAdminApiKey(clean);
    return clean;
  }

  function getViewerPasswords() {
    try {
      var saved = JSON.parse(localStorage.getItem(VIEWER_PASSWORDS_KEY) || '[]');
      if (Array.isArray(saved)) {
        var clean = saved.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
        if (clean.length) return clean;
      }
    } catch (_) {}
    return [ACCESS_PASSWORD];
  }

  function setViewerPasswords(list) {
    var clean = Array.isArray(list)
      ? list.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
      : [];
    if (!clean.length) clean = [ACCESS_PASSWORD];
    try { localStorage.setItem(VIEWER_PASSWORDS_KEY, JSON.stringify(clean)); } catch (_) {}
    return clean;
  }

  function isValidViewerPassword(value) {
    var val = String(value || '');
    if (!val) return false;
    if (val === ACCESS_PASSWORD) return true;
    return getViewerPasswords().includes(val);
  }

  function getRememberedRole() {
    try { return String(localStorage.getItem(ACCESS_REMEMBER_ROLE_KEY) || '').trim(); } catch (_) { return ''; }
  }

  function isSiteUnlocked() {
    try {
      if (sessionStorage.getItem(ACCESS_PASS_KEY) === '1') return true;
      return localStorage.getItem(ACCESS_REMEMBER_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setSiteUnlocked(val, opts) {
    var remember = !!(opts && opts.remember);
    var role = String(opts && opts.role || 'viewer');
    try {
      if (val) {
        sessionStorage.setItem(ACCESS_PASS_KEY, '1');
        if (remember) {
          localStorage.setItem(ACCESS_REMEMBER_KEY, '1');
          localStorage.setItem(ACCESS_REMEMBER_ROLE_KEY, role === 'admin' ? 'admin' : 'viewer');
        } else {
          localStorage.removeItem(ACCESS_REMEMBER_KEY);
          localStorage.removeItem(ACCESS_REMEMBER_ROLE_KEY);
        }
      } else {
        sessionStorage.removeItem(ACCESS_PASS_KEY);
        localStorage.removeItem(ACCESS_REMEMBER_KEY);
        localStorage.removeItem(ACCESS_REMEMBER_ROLE_KEY);
      }
    } catch (_) {}
  }

  function ensureAccessGate(onGranted) {
    if (isSiteUnlocked()) {
      setAdminUnlocked(getRememberedRole() === 'admin');
      onGranted();
      return;
    }
    if ($('ubr-access-gate')) return;
    var gate = document.createElement('div');
    gate.id = 'ubr-access-gate';
    gate.innerHTML = '' +
      '<div id="ubr-access-card">' +
        '<div id="ubr-access-title">Acceso privado UBRViewer</div>' +
        '<div id="ubr-access-desc">Introduce la clave para abrir el visor.</div>' +
        '<input id="ubr-access-input" type="password" placeholder="Clave de acceso">' +
        '<label id="ubr-access-remember-wrap" for="ubr-access-remember"><input id="ubr-access-remember" type="checkbox">Recordarme en este dispositivo</label>' +
        '<button id="ubr-access-submit" type="button">Entrar</button>' +
        '<div id="ubr-access-error"></div>' +
      '</div>';
    document.body.appendChild(gate);

    var input = $('ubr-access-input');
    var remember = $('ubr-access-remember');
    var submit = $('ubr-access-submit');
    var error = $('ubr-access-error');
    var tryUnlock = function () {
      var value = String(input && input.value || '');
      var keep = !!(remember && remember.checked);
      if (value === ADMIN_PASSWORD) {
        setSiteUnlocked(true, { remember: keep, role: 'admin' });
        setAdminUnlocked(true);
        syncRememberedRoleWithCurrentMode();
        applyRoleUiMode();
        gate.remove();
        onGranted();
        return;
      }
      if (isValidViewerPassword(value)) {
        setSiteUnlocked(true, { remember: keep, role: 'viewer' });
        setAdminUnlocked(false);
        syncRememberedRoleWithCurrentMode();
        applyRoleUiMode();
        gate.remove();
        onGranted();
        return;
      }
      if (error) error.textContent = 'Clave incorrecta.';
      if (input) input.select();
    };
    if (submit) submit.onclick = tryUnlock;
    if (input) input.addEventListener('keydown', function (ev) {
      if (String(ev.key || '') === 'Enter') {
        ev.preventDefault();
        tryUnlock();
      }
    });
    if (input) setTimeout(function () { try { input.focus(); } catch (_) {} }, 40);
  }

  function isAdminUnlocked() {
    try { return sessionStorage.getItem(ADMIN_PASS_KEY) === '1'; } catch (_) { return false; }
  }
  function setAdminUnlocked(val) {
    try { if (val) sessionStorage.setItem(ADMIN_PASS_KEY, '1'); else sessionStorage.removeItem(ADMIN_PASS_KEY); } catch (_) {}
  }

  function syncRememberedRoleWithCurrentMode() {
    try {
      if (localStorage.getItem(ACCESS_REMEMBER_KEY) !== '1') return;
      localStorage.setItem(ACCESS_REMEMBER_ROLE_KEY, isAdminUnlocked() ? 'admin' : 'viewer');
    } catch (_) {}
  }

  function toggleRoleMode() {
    if (isAdminUnlocked()) {
      setAdminUnlocked(false);
      syncRememberedRoleWithCurrentMode();
      applyRoleUiMode();
      return;
    }

    var pw = window.prompt('Contraseña de administrador para cambiar a Admin:');
    if (pw === null) return;
    if (pw !== ADMIN_PASSWORD) {
      alert('Contraseña incorrecta.');
      return;
    }
    setAdminUnlocked(true);
    syncRememberedRoleWithCurrentMode();
    applyRoleUiMode();
  }

  function openAdminPanel() {
    if (!isAdminUnlocked()) {
      var pw = window.prompt('Contraseña de administrador:');
      if (pw === null) return;
      if (pw !== ADMIN_PASSWORD) { alert('Contraseña incorrecta.'); return; }
      setAdminUnlocked(true);
      syncRememberedRoleWithCurrentMode();
      applyRoleUiMode();
    }
    renderAdminModal();
  }

  function openViewerPasswordsManager() {
    if (!isAdminUnlocked()) {
      alert('Solo admin puede modificar claves de viewers.');
      return;
    }
    var current = getViewerPasswords();
    var raw = window.prompt(
      'Claves viewer (separadas por coma).\\nEjemplo: clubA123, staffB123, analista123',
      current.join(', ')
    );
    if (raw === null) return;
    var list = String(raw)
      .split(',')
      .map(function (x) { return String(x || '').trim(); })
      .filter(Boolean);
    var unique = [];
    list.forEach(function (pw) {
      if (!unique.includes(pw)) unique.push(pw);
    });
    if (!unique.length) {
      if (!window.confirm('Si dejas vacío se restablece a la clave por defecto viewer. ¿Continuar?')) return;
    }
    var saved = setViewerPasswords(unique);
    setStatus('Claves viewer actualizadas (' + saved.length + ').', false);
    alert('Claves viewer actualizadas: ' + saved.length);
  }

  function closeViewerHelpModal() {
    var modal = $('ubr-viewer-help');
    if (modal) modal.remove();
  }

  function openViewerHelpModal() {
    closeViewerHelpModal();
    var modal = document.createElement('div');
    modal.id = 'ubr-viewer-help';
    modal.innerHTML = '' +
      '<div id="ubr-viewer-help-backdrop">' +
        '<div id="ubr-viewer-help-card">' +
          '<div id="ubr-viewer-help-head">' +
            '<span>❓ Guía rápida Viewer</span>' +
            '<button id="ubr-viewer-help-close" type="button">✕</button>' +
          '</div>' +
          '<div id="ubr-viewer-help-body">' +
            '<div class="ubr-viewer-help-box"><h4>1) Cambiar cámara</h4><p>Usa los botones Cámara 1, Cámara 2, Cámara 3 o Multi. También puedes usar teclas numéricas 1..N para cambiar rápido.</p></div>' +
            '<div class="ubr-viewer-help-box"><h4>2) Buscar y abrir proyectos</h4><p>Usa el selector superior, el orden por fecha/nombre y el filtro de carpeta. También puedes abrir un proyecto haciendo clic en su nombre dentro del árbol de carpetas.</p></div>' +
            '<div class="ubr-viewer-help-box"><h4>3) Navegar por cortes</h4><p>En modo Viewer trabajas con la timeline: clic en un corte para saltar al instante, y usa play/pausa para revisar secuencias.</p></div>' +
            '<div class="ubr-viewer-help-box"><h4>4) Zoom y pan de video</h4><p>Haz Cmd + rueda para zoom. Con zoom activo, arrastra para pan. Doble clic resetea vista.</p></div>' +
            '<div class="ubr-viewer-help-box"><h4>5) Qué permisos tienes</h4><p>Viewer solo visualiza y reproduce: no puede borrar, editar cortes, crear/mover carpetas ni abrir herramientas de administración.</p></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    var closeBtn = $('ubr-viewer-help-close');
    if (closeBtn) closeBtn.onclick = closeViewerHelpModal;
    var backdrop = document.getElementById('ubr-viewer-help-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function (ev) {
        if (ev.target === backdrop) closeViewerHelpModal();
      });
    }
    document.addEventListener('keydown', function onEsc(ev) {
      if (String(ev.key || '') === 'Escape') {
        closeViewerHelpModal();
        document.removeEventListener('keydown', onEsc);
      }
    });
  }

  function closeAdminModal() {
    var m = $('ubr-admin-modal');
    if (m) m.remove();
  }

  function normalizeYtUrl(s) {
    s = String(s || '').trim();
    var m = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    var m2 = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (m2) return m2[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
    return '';
  }

  function renderAdminModal() {
    closeAdminModal();
    var modal = document.createElement('div');
    modal.id = 'ubr-admin-modal';
    modal.innerHTML = '' +
      '<div id="ubr-admin-backdrop"></div>' +
      '<div id="ubr-admin-dialog">' +
        '<div id="ubr-admin-head">' +
          '<span>⚙️ Panel Admin — UBRViewer</span>' +
          '<button id="ubr-admin-close" type="button">✕</button>' +
        '</div>' +
        '<div id="ubr-admin-body">' +

          /* ── Section: Create project ── */
          '<section class="ubr-admin-section">' +
            '<h3>Nuevo proyecto</h3>' +
            '<label>ID del proyecto (sin espacios)<input id="ubr-adm-id" type="text" placeholder="equipo-a-vs-b-2026-04-20"></label>' +
            '<label>Nombre visible<input id="ubr-adm-name" type="text" placeholder="Equipo A vs Equipo B — 20/04/2026"></label>' +
            '<label>Fecha<input id="ubr-adm-date" type="date"></label>' +
          '</section>' +

          /* ── Section: Cameras / YouTube ── */
          '<section class="ubr-admin-section">' +
            '<h3>Cámaras (YouTube)</h3>' +
            '<div id="ubr-adm-cams"></div>' +
            '<button id="ubr-adm-add-cam" type="button" class="ubr-adm-btn-sm">+ Añadir cámara</button>' +
          '</section>' +

          /* ── Section: XML ── */
          '<section class="ubr-admin-section">' +
            '<h3>Archivo XML de eventos</h3>' +
            '<input id="ubr-adm-xml-file" type="file" accept=".xml">' +
            '<div id="ubr-adm-xml-status" class="ubr-adm-status"></div>' +
          '</section>' +

          '<section class="ubr-admin-section">' +
            '<h3>Añadir proyecto JSON (local)</h3>' +
            '<input id="ubr-adm-project-json" type="file" accept=".json,application/json">' +
            '<button id="ubr-admin-open-json" type="button">Agregar al selector</button>' +
            '<button id="ubr-admin-migrate-locals" type="button" class="ubr-adm-btn-sm">Migrar locales al servidor</button>' +
            '<button id="ubr-admin-export-locals" type="button" class="ubr-adm-btn-sm">Exportar locales (backup)</button>' +
            '<div id="ubr-adm-project-status" class="ubr-adm-status"></div>' +
          '</section>' +

          /* ── Action buttons ── */
          '<div class="ubr-adm-actions">' +
            '<button id="ubr-adm-generate" type="button" class="ubr-adm-btn-primary">Generar proyecto JSON</button>' +
            '<button id="ubr-adm-lock" type="button" class="ubr-adm-btn-warn">🔒 Cerrar sesión admin</button>' +
          '</div>' +
          '<div id="ubr-adm-result" class="ubr-adm-status" style="margin-top:10px;white-space:pre-wrap;word-break:break-all;"></div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    $('ubr-admin-close').onclick = closeAdminModal;
    $('ubr-admin-backdrop').onclick = closeAdminModal;
    $('ubr-adm-lock').onclick = function () {
      setAdminUnlocked(false);
      try {
        if (localStorage.getItem(ACCESS_REMEMBER_KEY) === '1') {
          localStorage.setItem(ACCESS_REMEMBER_ROLE_KEY, 'viewer');
        }
      } catch (_) {}
      applyRoleUiMode();
      closeAdminModal();
    };

    function readLocalProjects() {
      var locals = [];
      try { locals = JSON.parse(localStorage.getItem('ubr_local_projects') || '[]'); } catch (_) { locals = []; }
      return Array.isArray(locals) ? locals : [];
    }

    function normalizeLocalProjectForPublish(entry, idx) {
      var source = entry && entry.inlineProject;
      if (!source || typeof source !== 'object') {
        return { ok: false, error: 'sin inlineProject', id: String(entry && entry.id || '') };
      }

      // Clonar para evitar mutar el cache local del navegador.
      var project;
      try {
        project = JSON.parse(JSON.stringify(source));
      } catch (_) {
        return { ok: false, error: 'no se pudo clonar proyecto local', id: String(entry && entry.id || '') };
      }

      var fallbackId = 'local-' + Date.now() + '-' + (idx + 1);
      var id = String(project.id || (entry && entry.id) || fallbackId).trim().replace(/\s+/g, '-');
      if (!id) return { ok: false, error: 'id vacío', id: '' };

      var name = String(project.name || (entry && entry.name) || id).trim();
      project.id = id;
      project.name = name || id;

      if (!Array.isArray(project.cameras)) project.cameras = [];
      if (!Array.isArray(project.lists)) project.lists = [];

      return {
        ok: true,
        id: id,
        name: project.name,
        project: project,
      };
    }

    $('ubr-admin-open-json').onclick = function () {
      var f = $('ubr-adm-project-json');
      var file = f && f.files && f.files[0];
      if (!file) { $('ubr-adm-project-status').textContent = 'Selecciona un JSON primero.'; return; }
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var parsed = JSON.parse(String(ev.target && ev.target.result || '{}'));
          if (!parsed || typeof parsed !== 'object') throw new Error('JSON inválido');
          var id = String(parsed.id || ('local-' + Date.now())).trim();
          var name = String(parsed.name || id).trim();
          var entry = {
            id: id,
            name: name,
            description: 'Proyecto local cargado en navegador',
            date: new Date().toISOString().slice(0, 10),
            tags: ['local'],
            inlineProject: parsed,
          };
          var locals = [];
          try { locals = JSON.parse(localStorage.getItem('ubr_local_projects') || '[]'); } catch (_) { locals = []; }
          if (!Array.isArray(locals)) locals = [];
          locals = locals.filter(function (it) { return String(it && it.id || '') !== id; });
          locals.unshift(entry);
          localStorage.setItem('ubr_local_projects', JSON.stringify(locals));
          state.localProjects = locals;
          state.manifest = state.manifest.filter(function (it) { return !it || !it.inlineProject || String(it.id || '') !== id; });
          state.manifest.unshift(entry);
          populateProjectSelector();
          $('ubr-adm-project-status').textContent = '✅ Cargado. Publicando en servidor...';
          // Asegurar que parsed tiene id antes de publicar
          if (!parsed.id) parsed.id = id;
          // Auto-publicar en servidor para que todos los viewers lo vean
          publishProject(parsed)
            .then(function (res) {
              $('ubr-adm-project-status').textContent = '✅ Publicado: ' + name + ' (' + res.clips + ' clips, ' + res.cameras + ' cámaras). Recargando...';
              showPublishStatus('✅ Publicado para todos: ' + name, false);
              setTimeout(function () { loadManifest(); }, 800);
            })
            .catch(function (err) {
              $('ubr-adm-project-status').textContent = '❌ Error al publicar: ' + String(err && err.message ? err.message : err);
            });
        } catch (err) {
          $('ubr-adm-project-status').textContent = '❌ Error al leer JSON: ' + String(err && err.message ? err.message : err);
        }
      };
      reader.readAsText(file);
    };

    $('ubr-admin-export-locals').onclick = function () {
      var locals = readLocalProjects();
      if (!locals.length) {
        $('ubr-adm-project-status').textContent = 'No hay proyectos locales para exportar.';
        return;
      }

      var payload = {
        exportedAt: new Date().toISOString(),
        count: locals.length,
        projects: locals,
      };

      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'ubr-local-projects-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      $('ubr-adm-project-status').textContent = '✅ Backup exportado (' + locals.length + ' proyecto(s)).';
    };

    $('ubr-admin-migrate-locals').onclick = function () {
      var locals = readLocalProjects();
      if (!locals.length) {
        $('ubr-adm-project-status').textContent = 'No hay proyectos locales para migrar.';
        return;
      }

      var normalized = [];
      var invalid = [];
      locals.forEach(function (entry, idx) {
        var n = normalizeLocalProjectForPublish(entry, idx);
        if (!n.ok) {
          invalid.push((n.id || 'sin-id') + ': ' + n.error);
          return;
        }
        normalized.push({
          id: n.id,
          name: n.name,
          project: n.project,
          meta: {
            id: n.id,
            name: n.name,
            date: String((entry && entry.date) || new Date().toISOString().slice(0, 10)),
            tags: Array.isArray(entry && entry.tags) ? entry.tags : []
          }
        });
      });

      if (!normalized.length) {
        $('ubr-adm-project-status').textContent = '❌ No hay proyectos locales válidos para migrar.';
        return;
      }

      var failures = [];
      var done = 0;
      var total = normalized.length;
      $('ubr-adm-project-status').textContent = 'Migrando ' + total + ' proyecto(s)...';

      function step(i) {
        if (i >= normalized.length) {
          var okCount = done - failures.length;
          var msg = '✅ Migración finalizada: ' + okCount + '/' + total + ' publicados.';
          if (invalid.length) msg += ' Omitidos inválidos: ' + invalid.length + '.';
          if (failures.length) msg += ' Fallos: ' + failures.length + '.';
          $('ubr-adm-project-status').textContent = msg;

          if (failures.length || invalid.length) {
            $('ubr-adm-result').textContent =
              (invalid.length ? ('Inválidos:\n- ' + invalid.join('\n- ') + '\n\n') : '') +
              (failures.length ? ('Fallos al publicar:\n- ' + failures.join('\n- ')) : '');
          }

          showPublishStatus(msg, failures.length > 0);
          setTimeout(function () { loadManifest(); }, 800);
          return;
        }

        var item = normalized[i];
        $('ubr-adm-project-status').textContent =
          'Migrando ' + (i + 1) + '/' + total + ': ' + item.name + '...';

        publishProject(item.project, item.meta)
          .then(function () {
            done += 1;
            step(i + 1);
          })
          .catch(function (err) {
            done += 1;
            failures.push(item.id + ': ' + String(err && err.message ? err.message : err));
            step(i + 1);
          });
      }

      step(0);
    };

    /* Camera rows */
    var camCount = 0;
    function addCamRow(ytId, label) {
      camCount += 1;
      var idx = camCount;
      var row = document.createElement('div');
      row.className = 'ubr-adm-cam-row';
      row.id = 'ubr-adm-cam-' + idx;
      row.innerHTML = '' +
        '<input class="ubr-adm-cam-label" type="text" placeholder="Etiqueta (ej: Cam Principal)" value="' + (label || 'Cámara ' + idx) + '">' +
        '<input class="ubr-adm-cam-yt" type="text" placeholder="URL o ID YouTube" value="' + (ytId || '') + '">' +
        '<input class="ubr-adm-cam-offset" type="number" placeholder="Offset (s)" value="0" style="width:70px">' +
        '<button type="button" class="ubr-adm-btn-sm ubr-adm-cam-del" data-idx="' + idx + '">✕</button>';
      $('ubr-adm-cams').appendChild(row);
      row.querySelector('.ubr-adm-cam-del').onclick = function () { row.remove(); };
    }
    addCamRow('', 'Cámara 1');

    $('ubr-adm-add-cam').onclick = function () { addCamRow('', ''); };

    /* XML parsing */
    var parsedClips = [];
    $('ubr-adm-xml-file').onchange = function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var text = e.target.result;
          var parser = new DOMParser();
          var doc = parser.parseFromString(text, 'application/xml');
          var instances = Array.from(doc.getElementsByTagName('instance'));
          parsedClips = [];
          instances.forEach(function (inst) {
            var startEl = inst.getElementsByTagName('start')[0];
            var endEl = inst.getElementsByTagName('end')[0];
            var codeEl = inst.getElementsByTagName('code')[0];
            var idEl = inst.getElementsByTagName('ID')[0];
            if (!startEl || !endEl) return;
            var start = parseFloat(startEl.textContent || 0);
            var end = parseFloat(endEl.textContent || 0);
            if (start === 0 && end === 0) return;
            var code = (codeEl ? codeEl.textContent : '').trim();
            var clipId = (idEl ? idEl.textContent : String(parsedClips.length)).trim();
            parsedClips.push({ id: clipId, label: code, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, cameraId: 'cam1', attr: code });
          });
          $('ubr-adm-xml-status').textContent = '✅ ' + parsedClips.length + ' clips leídos de ' + file.name;
        } catch (err) {
          $('ubr-adm-xml-status').textContent = '❌ Error: ' + String(err.message || err);
        }
      };
      reader.readAsText(file);
    };

    /* Generate JSON */
    $('ubr-adm-generate').onclick = function () {
      var id = ($('ubr-adm-id').value || '').trim().replace(/\s+/g, '-');
      var name = ($('ubr-adm-name').value || '').trim();
      var date = ($('ubr-adm-date').value || '');
      if (!id) { alert('Pon un ID de proyecto.'); return; }
      if (!name) { alert('Pon un nombre de proyecto.'); return; }

      /* Build cameras */
      var cameras = [];
      var camRows = Array.from($('ubr-adm-cams').querySelectorAll('.ubr-adm-cam-row'));
      camRows.forEach(function (row, i) {
        var ytRaw = (row.querySelector('.ubr-adm-cam-yt').value || '').trim();
        var ytId = normalizeYtUrl(ytRaw);
        var label = (row.querySelector('.ubr-adm-cam-label').value || 'Cámara ' + (i + 1)).trim();
        var offset = parseFloat(row.querySelector('.ubr-adm-cam-offset').value || 0) || 0;
        if (!ytId) { return; }
        cameras.push({ id: 'cam' + (i + 1), label: label, youtubeId: ytId, offset: offset });
      });
      if (!cameras.length) { alert('Añade al menos una cámara con URL de YouTube válida.'); return; }

      var project = {
        id: id,
        name: name,
        source: { date: date },
        cameras: cameras,
        lists: [{ id: 'all-events', name: 'Eventos (importado)', clips: parsedClips }],
      };

      var json = JSON.stringify(project, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = id + '.json';
      a.click();
      URL.revokeObjectURL(url);

      /* Also show manifest entry to copy */
      var manifestEntry = JSON.stringify({
        id: id,
        name: name,
        description: cameras.length + ' cámara(s) · ' + parsedClips.length + ' clips',
        file: './projects/' + id + '.json',
        date: date,
        tags: [],
      }, null, 2);

      $('ubr-adm-result').innerHTML = '' +
        '<strong>✅ Descargado:</strong> ' + id + '.json<br><br>' +
        'Copia esta entrada en <code>manifest.json</code> y sube el JSON a la carpeta <code>projects/</code>:<br>' +
        '<textarea style="width:100%;height:120px;font-size:10px;margin-top:4px">' + manifestEntry + '</textarea>';

      $('ubr-adm-project-status').textContent = '✅ JSON generado. Publicando en servidor...';
      publishProject(project, {
        id: id,
        name: name,
        date: date,
        tags: []
      })
        .then(function (res) {
          $('ubr-adm-project-status').textContent = '✅ Publicado: ' + name + ' (' + res.clips + ' clips, ' + res.cameras + ' cámaras).';
          $('ubr-adm-result').innerHTML = '' +
            '<strong>✅ Descargado y publicado:</strong> ' + id + '.json<br><br>' +
            'El proyecto ya está disponible para todos los viewers.';
          showPublishStatus('✅ Publicado para todos: ' + name, false);
          setTimeout(function () { loadManifest(); }, 800);
        })
        .catch(function (err) {
          $('ubr-adm-project-status').textContent = '❌ Error al publicar: ' + String(err && err.message ? err.message : err);
        });
    };
  }

  function ensureAdminButton() {
    if ($('ubr-admin-btn')) return;
    var header = document.querySelector('#videosPanel .panel-header');
    if (!header) return;
    var badge = document.createElement('span');
    badge.id = 'ubr-role-badge';
    badge.textContent = isAdminUnlocked() ? 'ADMIN' : 'VIEWER';
    header.insertBefore(badge, header.querySelector('.panel-toggle'));

    var btn = document.createElement('button');
    btn.id = 'ubr-admin-btn';
    btn.type = 'button';
    btn.title = 'Panel administrador';
    btn.textContent = '⚙️';
    btn.style.cssText = 'margin-left:auto;margin-right:4px;background:none;border:none;cursor:pointer;font-size:14px;opacity:0.6;padding:0 2px;';
    btn.onclick = function (ev) { ev.stopPropagation(); openAdminPanel(); };
    header.insertBefore(btn, header.querySelector('.panel-toggle'));

    var roleSwitch = document.createElement('button');
    roleSwitch.id = 'ubr-role-switch-btn';
    roleSwitch.type = 'button';
    roleSwitch.title = 'Cambiar entre Admin y Viewer';
    roleSwitch.textContent = '⇄';
    roleSwitch.style.cssText = 'margin-right:4px;background:none;border:none;cursor:pointer;font-size:14px;opacity:0.8;padding:0 2px;';
    roleSwitch.onclick = function (ev) { ev.stopPropagation(); toggleRoleMode(); };
    header.insertBefore(roleSwitch, header.querySelector('.panel-toggle'));

    var helpBtn = document.createElement('button');
    helpBtn.id = 'ubr-viewer-help-btn';
    helpBtn.type = 'button';
    helpBtn.title = 'Ayuda de uso (Viewer)';
    helpBtn.textContent = '❓';
    helpBtn.style.cssText = 'margin-right:4px;background:none;border:none;cursor:pointer;font-size:14px;opacity:0.75;padding:0 2px;';
    helpBtn.onclick = function (ev) { ev.stopPropagation(); openViewerHelpModal(); };
    header.insertBefore(helpBtn, header.querySelector('.panel-toggle'));

    applyRoleUiMode();
  }

  /* ─────────────────────────────────────────
     BOOT
  ───────────────────────────────────────── */

  function boot() {
    ensureStyles();
    loadProjectPreferences();
    ensureAccessGate(function () {
      applyRoleUiMode();
      ensurePanel();
      installWebFallbacks();
      ensureSidebarIntegration();
      ensureAdminButton();
      loadManifest();
      setStatus('Listo. Carga un proyecto desde la barra izquierda.', false);
    });
  }

  document.addEventListener('DOMContentLoaded', boot);

  window.UBRViewerWeb = {
    loadProjectFromUrl: loadProjectFromUrl,
    loadManifest: loadManifest,
    loadSelectedProject: loadSelectedProject,
    applyEventFilter: applyCombinedFilter,
    openAdminPanel: openAdminPanel,
  };
})();
