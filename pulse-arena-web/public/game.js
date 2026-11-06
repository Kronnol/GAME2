'use strict';
/* PULSE ARENA — Canvas renderer + live multiplayer client. Vanilla JavaScript. */
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('arena');
  const ctx = canvas.getContext('2d', { alpha: false });
  const menu = $('menu'), hud = $('hud'), results = $('results');
  const nameInput = $('nameInput'), roomInput = $('roomInput');
  const playBtn = $('playBtn'), createBtn = $('createBtn');
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rnd = (min, max) => Math.random() * (max - min) + min;
  const TAU = Math.PI * 2;
  const ORB_COLOR = { normal: '#5ef6ed', rare: '#c088ff', legend: '#ffd36e' };
  const POWER_COLOR = { shield: '#70c8ff', speed: '#ff78a5', magnet: '#ffe07c' };
  const MAX_PARTICLES = 330;
  let w = 0, h = 0, dpr = 1, zoom = 1, camera = { x: 1050, y: 720 };
  let myId = null, socket = null, world = null, arena = { width: 2100, height: 1440 };
  let obstacles = [], renderPlayers = new Map(), particles = [], waves = [], floats = [];
  let shake = 0, phase = 'menu', lastFrame = performance.now(), playerColor = '#5df8ec';
  let lastInput = { x: 0, y: 0 }, touchVec = { x: 0, y: 0 }, touchActive = false;
  let inputTimer = null, soundOn = true, audioCtx = null, resultEndsAt = 0;
  let announceTimer, toastTimer, lastScore = 0, bannerTick = 0;
  const keys = new Set();
  const screenStars = Array.from({ length: 100 }, () => ({ x: Math.random(), y: Math.random(), size: rnd(.4, 2.1), speed: rnd(.15, 1.2), phase: rnd(0, TAU) }));
  let username = '';

  try { nameInput.value = localStorage.getItem('pulseName') || ''; }
  catch (_) { /* Private browser mode */ }
  const urlRoom = new URLSearchParams(location.search).get('room');
  roomInput.value = (urlRoom || 'PUBLIC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9);

  const resize = () => {
    w = innerWidth; h = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    zoom = clamp(Math.min(w / 1160, h / 790), .65, 1.02);
    if (w < 560) zoom = .66;
  };
  addEventListener('resize', resize);
  resize();

  function toast(message, duration = 2800) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }
  function announce(message, color = '#66fff0') {
    const el = $('centerAnnouncement');
    el.textContent = message;
    el.style.color = color;
    el.classList.add('show');
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => el.classList.remove('show'), 1100);
  }
  function playTone(frequency = 450, duration = .08, kind = 'sine', volume = .035) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime;
      osc.type = kind;
      osc.frequency.setValueAtTime(frequency, now);
      osc.frequency.exponentialRampToValueAtTime(frequency * .68, now + duration);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + .009);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(now); osc.stop(now + duration + .01);
    } catch (_) { /* Browsers may block sound until interaction */ }
  }
  function emit(message) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function begin(createRoom = false) {
    username = (nameInput.value || 'PILOTO').trim().replace(/[<>]/g, '').slice(0, 16) || 'PILOTO';
    nameInput.value = username;
    try { localStorage.setItem('pulseName', username); } catch (_) {}
    const room = (roomInput.value || 'PUBLIC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9) || 'PUBLIC';
    if (socket && socket.readyState <= 1) socket.close();
    playBtn.disabled = true;
    createBtn.disabled = true;
    $('connectStatus').textContent = 'CONECTANDO CON LA ARENA...';
    const wsScheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const connection = new WebSocket(`${wsScheme}//${location.host}/ws`);
    socket = connection;
    connection.onopen = () => {
      if (socket !== connection) return;
      emit({ type: 'join', room, create: createRoom, name: username });
    };
    connection.onmessage = event => {
      if (socket !== connection) return;
      try { handleMessage(JSON.parse(event.data)); }
      catch (err) { console.error('Mensaje inválido del servidor:', err); }
    };
    connection.onerror = () => {
      if (socket === connection) $('connectStatus').textContent = 'No se pudo conectar al servidor. ¿Está encendido?';
    };
    connection.onclose = () => {
      if (socket !== connection) return;
      resetToMenu('Conexión terminada. Puedes volver a entrar.');
    };
  }
  playBtn.addEventListener('click', () => begin(false));
  createBtn.addEventListener('click', () => begin(true));
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') begin(false); });
  roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') begin(false); });
  roomInput.addEventListener('input', () => roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));

  function resetToMenu(message = '') {
    if (inputTimer) clearInterval(inputTimer);
    inputTimer = null;
    myId = null;
    world = null;
    phase = 'menu';
    keys.clear();
    touchVec = { x: 0, y: 0 };
    lastScore = 0;
    particles = []; waves = []; floats = []; renderPlayers.clear();
    menu.hidden = false; hud.hidden = true; results.hidden = true;
    playBtn.disabled = false; createBtn.disabled = false;
    $('connectStatus').textContent = message || 'Sin descargas. Abre el juego y empieza a competir.';
  }
  $('exitBtn').addEventListener('click', () => {
    if (socket) { const conn = socket; socket = null; conn.close(); }
    resetToMenu('Saliste de la arena. ¡Tu próxima partida te espera!');
  });
  $('soundBtn').addEventListener('click', () => {
    soundOn = !soundOn;
    $('soundBtn').textContent = soundOn ? '♫' : '♪';
    toast(soundOn ? 'Efectos de sonido activados' : 'Efectos de sonido silenciados');
  });
  $('shareBtn').addEventListener('click', async () => {
    const link = new URL(location.href);
    link.searchParams.set('room', world?.room || 'PUBLIC');
    try { await navigator.clipboard.writeText(link.toString()); toast('¡Enlace de la sala copiado!'); }
    catch (_) {
      // Fallback for non-secure HTTP local-network browsers.
      window.prompt('Copia este enlace para invitar amigos:', link.toString());
    }
  });

  function handleMessage(m) {
    if (m.type === 'welcome') {
      myId = m.id;
      arena = m.arena;
      obstacles = m.obstacles;
      roomInput.value = m.room;
      playerColor = '#5df8ec';
      history.replaceState(null, '', `?room=${encodeURIComponent(m.room)}`);
      $('roomLabel').textContent = `SALA ${m.room}`;
      menu.hidden = true; hud.hidden = false; results.hidden = true;
      phase = 'playing';
      playBtn.disabled = false; createBtn.disabled = false;
      renderPlayers.clear();
      camera = { x: 1050, y: 720 };
      announce('¡A DOMINAR LA ARENA!');
      if (inputTimer) clearInterval(inputTimer);
      inputTimer = setInterval(sendInput, 45);
      return;
    }
    if (m.type === 'error') {
      toast(m.message || 'No se pudo entrar.');
      resetToMenu(m.message);
      if (socket) socket.close();
      return;
    }
    if (m.type === 'state') {
      world = m;
      phase = m.phase;
      for (const p of m.players) {
        if (!renderPlayers.has(p.id)) renderPlayers.set(p.id, { x: p.x, y: p.y, angle: p.angle, trail: [] });
      }
      const ids = new Set(m.players.map(p => p.id));
      for (const id of renderPlayers.keys()) if (!ids.has(id)) renderPlayers.delete(id);
      updateHud(m);
      return;
    }
    if (m.type === 'event') {
      handleEvent(m);
      return;
    }
    if (m.type === 'feed') {
      addFeed(m.text, m.color);
      return;
    }
    if (m.type === 'round_end') {
      showResults(m);
      return;
    }
    if (m.type === 'round_start') {
      results.hidden = true;
      phase = 'playing';
      particles = []; waves = []; floats = [];
      lastScore = 0;
      announce('¡NUEVA RONDA!');
      playTone(690, .32, 'triangle', .07);
    }
  }

  function updateHud(s) {
    const me = s.players.find(p => p.id === myId);
    if (!me) return;
    playerColor = me.color;
    const rankers = [...s.players].sort((a, b) => b.score - a.score);
    const rank = rankers.findIndex(p => p.id === myId) + 1;
    $('scoreNumber').textContent = me.score.toLocaleString('es-CR');
    $('myRank').textContent = `# ${rank}`;
    const comboEl = $('comboDisplay');
    comboEl.textContent = me.combo >= 2 ? `✦ COMBO x${me.combo} · ¡SIGUE RECOGIENDO!` : 'RECOGE ENERGÍA PARA HACER COMBO';
    comboEl.style.color = me.combo > 5 ? '#ffd67d' : '#66fff0';
    $('roundLabel').textContent = `ROUND ${String(s.round).padStart(2, '0')} · ${s.phase === 'playing' ? 'EN CURSO' : 'FINALIZADO'}`;
    const sec = s.timeLeft;
    $('timeLabel').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    $('timeLabel').classList.toggle('urgent', sec <= 15 && s.phase === 'playing');
    $('clockBar').style.width = `${clamp(sec / 105 * 100, 0, 100)}%`;
    $('clockBar').style.background = sec <= 15 ? '#ff5fba' : '#66fff0';
    $('humanCount').innerHTML = `<i class="status-dot"></i> ${s.humans} ${s.humans === 1 ? 'JUGADOR REAL' : 'JUGADORES REALES'}`;
    renderLeaderBoard(rankers, myId);
    for (const [key, remaining] of [['pulse', me.pulseReadyIn], ['dash', me.dashReadyIn]]) {
      $(key + 'Cooldown').textContent = remaining > 0 ? Math.ceil(remaining) : '';
      $(key + 'Ability').querySelector('button').classList.toggle('on-cooldown', remaining > 0);
    }
    if (me.score > lastScore && lastScore > 0 && me.combo > 6 && (me.combo === 7 || me.combo === 10)) announce(`COMBO x${me.combo}!`, '#ffd36e');
    lastScore = me.score;
    if (phase === 'results') $('nextCountdown').textContent = s.timeLeft;
  }
  function renderLeaderBoard(rankers, selfId) {
    const container = $('leaderRows');
    container.replaceChildren();
    rankers.slice(0, 7).forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'leader-row' + (p.id === selfId ? ' me' : '');
      const rank = document.createElement('span'); rank.className = 'rank-no'; rank.textContent = String(i + 1).padStart(2, '0');
      const dot = document.createElement('span'); dot.className = 'leader-dot'; dot.style.color = p.color;
      const name = document.createElement('span'); name.className = 'leader-name'; name.textContent = p.name;
      if (p.bot) { const label = document.createElement('small'); label.className = 'bot-label'; label.textContent = 'IA'; name.append(label); }
      const score = document.createElement('strong'); score.className = 'leader-score'; score.textContent = p.score.toLocaleString('es-CR');
      row.append(rank, dot, name, score); container.append(row);
    });
  }
  function showResults(m) {
    phase = 'results';
    results.hidden = false;
    const mine = m.standings.find(p => p.id === myId);
    const won = mine?.rank === 1;
    $('resultsTitle').textContent = won ? '¡VICTORIA!' : 'FIN DEL CAOS';
    $('resultsTitle').style.color = won ? '#66fff0' : '#eafaff';
    $('resultsSubtitle').textContent = won ? 'Nadie pudo quitarte la corona. ¡Imparable!' : 'Otra ronda, otra oportunidad de conquistar el primer lugar.';
    $('finalScore').textContent = (mine?.score || 0).toLocaleString('es-CR');
    $('finalRank').textContent = mine ? `# ${mine.rank}` : '—';
    $('nextCountdown').textContent = m.nextIn;
    const list = $('resultsList'); list.replaceChildren();
    m.standings.slice(0, 6).forEach(p => {
      const row = document.createElement('div'); row.className = 'result-row' + (p.id === myId ? ' mine' : '');
      const rk = document.createElement('span'); rk.className = 'result-rank'; rk.textContent = String(p.rank).padStart(2, '0');
      const dot = document.createElement('i'); dot.className = 'result-color'; dot.style.setProperty('--p-color', p.color);
      const name = document.createElement('span'); name.textContent = p.name + (p.bot ? ' [IA]' : '');
      const score = document.createElement('strong'); score.className = 'result-score'; score.textContent = p.score.toLocaleString('es-CR');
      row.append(rk, dot, name, score); list.append(row);
    });
    const records = $('allTimeRecords'); records.replaceChildren();
    if (!m.topScores?.length) {
      const empty = document.createElement('div');
      empty.className = 'records-empty'; empty.textContent = '¡Sé el primero en conseguir un récord!';
      records.append(empty);
    } else {
      m.topScores.slice(0, 3).forEach((entry, i) => {
        const row = document.createElement('div'); row.className = 'record-row';
        const no = document.createElement('span'); no.className = 'record-no'; no.textContent = `#${i + 1}`;
        const name = document.createElement('span'); name.className = 'record-name'; name.textContent = entry.name;
        const score = document.createElement('strong'); score.className = 'record-score'; score.textContent = entry.score.toLocaleString('es-CR');
        row.append(no, name, score); records.append(row);
      });
    }
    if (won) { playTone(880, .34, 'triangle', .05); setTimeout(() => playTone(1175, .3, 'triangle', .05), 190); }
    else playTone(270, .28, 'sine', .035);
    resultEndsAt = performance.now() + (m.nextIn || 11) * 1000;
  }
  function addFeed(text, color) {
    const feed = $('eventFeed');
    const row = document.createElement('div'); row.className = 'feed-item';
    row.textContent = text; row.style.borderRightColor = color || '#66fff0';
    feed.prepend(row);
    while (feed.children.length > 4) feed.lastChild.remove();
    setTimeout(() => row.remove(), 4300);
  }

  function spawnParticles(x, y, color, count = 10, power = 1) {
    for (let i = 0; i < count; i++) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      const angle = Math.random() * TAU, speed = rnd(80, 330) * power;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        t: 0, lifetime: rnd(.35, .85), r: rnd(1.4, 4.7), color });
    }
  }
  function handleEvent(ev) {
    const now = performance.now();
    if (ev.kind === 'pickup') {
      const color = ORB_COLOR[ev.orb] || ORB_COLOR.normal;
      spawnParticles(ev.x, ev.y, color, ev.orb === 'legend' ? 35 : 9, ev.orb === 'legend' ? 1.4 : .65);
      floats.push({ x: ev.x, y: ev.y, text: `+${ev.value}`, color, t: 0, lifetime: 1.05 });
      playTone(350 + Math.min(ev.combo, 12) * 65 + (ev.orb === 'legend' ? 280 : 0), .085, 'sine', .02);
      if (ev.orb === 'legend') { announce('¡ENERGÍA LEGENDARIA!', '#ffd36e'); shake = 4; }
    }
    if (ev.kind === 'pulse') {
      waves.push({ x: ev.x, y: ev.y, color: ev.color, started: now, maxRadius: 180, duration: 560 });
      spawnParticles(ev.x, ev.y, ev.color, 32, 1.4);
      if (ev.id === myId) {
        playTone(155, .32, 'sawtooth', .085); shake = 13;
        if (ev.hits > 0) announce(`¡${ev.hits} IMPACTO${ev.hits > 1 ? 'S' : ''}!`, '#ff77b4');
      } else if (ev.hits && world?.players.some(p => p.id === myId && Math.hypot(p.x - ev.x, p.y - ev.y) < 210)) shake = 11;
    }
    if (ev.kind === 'dash') {
      spawnParticles(ev.x, ev.y, ev.color, 24, .85);
      if (ev.id === myId) { playTone(270, .2, 'triangle', .065); shake = 6; }
    }
    if (ev.kind === 'powerup') {
      spawnParticles(ev.x, ev.y, POWER_COLOR[ev.power] || '#ffffff', 35, 1);
      announce(`¡${{ shield: 'ESCUDO', speed: 'TURBO', magnet: 'IMÁN' }[ev.power]} ACTIVADO!`, POWER_COLOR[ev.power]);
      playTone(735, .3, 'sine', .04);
    }
  }
  function inputVector() {
    if (touchActive) return touchVec;
    let x = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
    let y = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
    const d = Math.hypot(x, y);
    if (d > 1) { x /= d; y /= d; }
    return { x, y };
  }
  function sendInput() {
    const vec = inputVector();
    lastInput = vec;
    emit({ type: 'input', x: vec.x, y: vec.y });
  }
  function pulse() {
    if (phase !== 'playing') return;
    emit({ type: 'pulse' });
  }
  function dash() {
    if (phase !== 'playing') return;
    sendInput(); emit({ type: 'dash' });
  }
  $('pulseBtn').addEventListener('pointerdown', e => { e.preventDefault(); pulse(); });
  $('dashBtn').addEventListener('pointerdown', e => { e.preventDefault(); dash(); });
  canvas.addEventListener('pointerdown', e => { if (phase === 'playing' && e.pointerType === 'mouse' && e.button === 0) pulse(); });
  addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && phase !== 'menu') e.preventDefault();
    if (phase !== 'playing') return;
    if ((key === ' ' || key === 'e') && !e.repeat) pulse();
    else if (key === 'shift' && !e.repeat) dash();
    keys.add(key);
  });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { keys.clear(); touchVec = { x: 0, y: 0 }; touchActive = false; sendInput(); });
  const joystick = $('joystick'), knob = $('joystickKnob');
  let pointerId = null;
  function moveJoystick(e) {
    const r = joystick.getBoundingClientRect();
    const centerX = r.left + r.width / 2, centerY = r.top + r.height / 2;
    let dx = (e.clientX - centerX) / (r.width * .31), dy = (e.clientY - centerY) / (r.height * .31);
    const d = Math.hypot(dx, dy);
    if (d > 1) { dx /= d; dy /= d; }
    touchVec = { x: dx, y: dy };
    knob.style.transform = `translate(${dx * 32}px,${dy * 32}px)`;
  }
  joystick.addEventListener('pointerdown', e => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    joystick.setPointerCapture(e.pointerId);
    touchActive = true;
    moveJoystick(e);
  });
  joystick.addEventListener('pointermove', e => { if (e.pointerId === pointerId) moveJoystick(e); });
  function endJoystick(e) {
    if (e.pointerId !== pointerId) return;
    pointerId = null; touchActive = false;
    touchVec = { x: 0, y: 0 };
    knob.style.transform = 'translate(0,0)';
  }
  joystick.addEventListener('pointerup', endJoystick);
  joystick.addEventListener('pointercancel', endJoystick);

  function roundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
  }
  function drawAmbient(time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080d1d'; ctx.fillRect(0, 0, w, h);
    let glow = ctx.createRadialGradient(w * .58, h * .5, 0, w * .58, h * .5, Math.max(w, h) * .75);
    glow.addColorStop(0, '#13263b'); glow.addColorStop(.5, '#0a142b'); glow.addColorStop(1, '#070a15');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    const gridSize = 69;
    ctx.strokeStyle = 'rgba(83,178,211,.07)';ctx.lineWidth = 1;
    const drift = time * .003 % gridSize;
    ctx.beginPath();
    for (let x = drift; x < w; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = drift; y < h; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    for (const star of screenStars) {
      const px = star.x * w + Math.sin(time * .0003 * star.speed + star.phase) * 23;
      const py = star.y * h + Math.cos(time * .0002 + star.phase) * 17;
      ctx.fillStyle = `rgba(113,221,239,${.13 + .13 * Math.sin(time * .001 * star.speed + star.phase)})`;
      ctx.beginPath(); ctx.arc(px, py, star.size, 0, TAU); ctx.fill();
    }
    const cx = w * .72, cy = h * .6;
    for (let i = 0; i < 6; i++) {
      const r = 190 + i * 100 + Math.sin(time * .0005) * 15;
      ctx.beginPath();ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = `rgba(70,213,213,${.055 * (1 - i / 7)})`;ctx.stroke();
    }
  }
  function drawFloor(time) {
    ctx.fillStyle = '#0a1425'; ctx.fillRect(0, 0, arena.width, arena.height);
    const glow = ctx.createRadialGradient(arena.width / 2, arena.height / 2, 50, arena.width / 2, arena.height / 2, 1250);
    glow.addColorStop(0, 'rgba(21,62,79,.34)'); glow.addColorStop(1, 'rgba(9,15,29,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, arena.width, arena.height);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(88,174,205,.09)';
    for (let x = 0; x <= arena.width; x += 90) { ctx.moveTo(x, 0); ctx.lineTo(x, arena.height); }
    for (let y = 0; y <= arena.height; y += 90) { ctx.moveTo(0, y); ctx.lineTo(arena.width, y); }
    ctx.stroke();
    ctx.beginPath();ctx.strokeStyle = 'rgba(103,241,236,.35)';ctx.lineWidth = 9;
    ctx.strokeRect(13, 13, arena.width - 26, arena.height - 26);
    ctx.beginPath();ctx.strokeStyle = 'rgba(103,241,236,.08)';ctx.lineWidth = 30;
    ctx.strokeRect(14, 14, arena.width - 28, arena.height - 28);
    ctx.lineWidth = 1;ctx.strokeStyle = 'rgba(108,180,215,.1)';
    for (const [x, y] of [[110,90],[arena.width-110,90],[110,arena.height-90],[arena.width-110,arena.height-90]]) {
      ctx.save();ctx.translate(x,y);ctx.rotate(time*.00008);ctx.beginPath();ctx.arc(0,0,53,0,TAU);ctx.stroke();
      ctx.beginPath();ctx.moveTo(-72,0);ctx.lineTo(72,0);ctx.moveTo(0,-72);ctx.lineTo(0,72);ctx.stroke();ctx.restore();
    }
    ctx.fillStyle = 'rgba(134,202,218,.08)';ctx.font = '900 86px Impact, sans-serif';ctx.textAlign='center';
    ctx.fillText('P U L S E  / /  A R E N A', arena.width/2, arena.height/2+28);
    ctx.textAlign='left';
  }
  function drawObstacle(ob, time) {
    ctx.save();ctx.translate(ob.x,ob.y);
    ctx.shadowColor = '#53e5ed';ctx.shadowBlur = 27;
    ctx.fillStyle = '#0a2433';ctx.strokeStyle = 'rgba(83,212,226,.5)';ctx.lineWidth=4;
    ctx.beginPath();ctx.arc(0,0,ob.r,0,TAU);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
    ctx.strokeStyle = 'rgba(102,255,243,.22)';ctx.lineWidth = 4;ctx.setLineDash([19,14]);
    ctx.save();ctx.rotate(time*.00032);ctx.beginPath();ctx.arc(0,0,ob.r+10,0,TAU);ctx.stroke();ctx.restore();ctx.setLineDash([]);
    ctx.fillStyle = '#102d40';ctx.beginPath();ctx.arc(0,0,ob.r*.69,0,TAU);ctx.fill();
    ctx.fillStyle = '#256478';ctx.beginPath();ctx.arc(0,0,ob.r*.35,0,TAU);ctx.fill();
    ctx.fillStyle = '#9efff5';ctx.shadowColor='#5ef6ed';ctx.shadowBlur=20;ctx.beginPath();ctx.arc(0,0,ob.r*.15,0,TAU);ctx.fill();ctx.shadowBlur=0;
    ctx.restore();
  }
  function drawOrb(orb, time) {
    const c = ORB_COLOR[orb.type] || '#5ef6ed';
    const r = orb.type === 'legend' ? 13 : orb.type === 'rare' ? 10.5 : 7.3;
    const pulse = 1 + Math.sin(time * .004 + orb.id * 1.83) * .16;
    ctx.save();ctx.translate(orb.x, orb.y + Math.sin(time * .003 + orb.id)*3);
    ctx.fillStyle = c;ctx.shadowColor = c;ctx.shadowBlur = orb.type === 'legend' ? 30 : 13;
    ctx.beginPath();ctx.arc(0,0,r*pulse,0,TAU);ctx.fill();
    ctx.fillStyle = '#fff';ctx.beginPath();ctx.arc(-r*.25,-r*.24,r*.24,0,TAU);ctx.fill();
    if (orb.type !== 'normal') {
      ctx.shadowBlur=0;ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.globalAlpha=.5;
      ctx.save();ctx.rotate(time*.001 + orb.id);ctx.strokeRect(-r*1.7,-r*1.7,r*3.4,r*3.4);ctx.restore();
      if (orb.type === 'legend') {
        ctx.globalAlpha = .22;ctx.beginPath();ctx.arc(0,0,23 + Math.sin(time*.003)*2,0,TAU);ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawPowerup(power, time) {
    const c = POWER_COLOR[power.type];
    ctx.save();ctx.translate(power.x,power.y);ctx.rotate(time*.001);
    ctx.shadowColor=c;ctx.shadowBlur=18;ctx.fillStyle='#0a2033';ctx.strokeStyle=c;ctx.lineWidth=3;
    ctx.beginPath();for(let i=0;i<6;i++){const a=TAU*i/6;const xx=Math.cos(a)*24,yy=Math.sin(a)*24;if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);}ctx.closePath();ctx.fill();ctx.stroke();
    ctx.rotate(-time*.001);ctx.shadowBlur=0;ctx.fillStyle=c;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 23px Arial';
    ctx.fillText(power.type==='shield'?'◈':power.type==='speed'?'➤':'✣',0,1);
    ctx.restore();
  }
  function drawPlayer(p, smooth, time) {
    const my = p.id === myId;
    const x = smooth.x, y = smooth.y;
    ctx.save();
    const trail = smooth.trail;
    if (p.dashing || Math.random() < .2) {
      trail.push({ x, y, born: time, color: p.color });
      if (trail.length > 12) trail.shift();
    }
    for (const t of trail) {
      const alpha = clamp(1 - (time - t.born) / 360, 0, 1);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha * .17;
      ctx.beginPath();ctx.arc(t.x,t.y,22 * alpha,0,TAU);ctx.fill();
    }
    smooth.trail = trail.filter(t => time - t.born < 370);
    ctx.globalAlpha=1;
    ctx.translate(x,y);
    const r=23;
    ctx.shadowColor=p.color;ctx.shadowBlur=my?27:18;
    ctx.fillStyle='#071522';ctx.strokeStyle=p.color;ctx.lineWidth=my?5:3.5;
    ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.fill();ctx.stroke();
    ctx.shadowBlur=0;
    ctx.rotate(smooth.angle);
    ctx.fillStyle=p.color;
    ctx.beginPath();ctx.moveTo(r+12,0);ctx.lineTo(12,-10);ctx.lineTo(12,10);ctx.closePath();ctx.fill();
    ctx.fillStyle=p.color;ctx.globalAlpha=.8;
    ctx.beginPath();ctx.arc(0,0,11,0,TAU);ctx.fill();
    ctx.fillStyle='#fbffff';ctx.globalAlpha=1;
    ctx.beginPath();ctx.arc(2,-3,4.3,0,TAU);ctx.fill();ctx.rotate(-smooth.angle);
    if (p.shield) { ctx.strokeStyle='#67ceff';ctx.lineWidth=3;ctx.globalAlpha=.7+.25*Math.sin(time*.009);ctx.beginPath();ctx.arc(0,0,34,0,TAU);ctx.stroke();ctx.globalAlpha=1; }
    if (p.magnet) {ctx.setLineDash([5,6]);ctx.strokeStyle='#ffd36e';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,45,0,TAU);ctx.stroke();ctx.setLineDash([]);}
    if (p.speed) {ctx.strokeStyle='#ff78aa';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,29,-Math.PI/2,-Math.PI/2+TAU*.75);ctx.stroke();}
    if (p.stunned) {ctx.strokeStyle='#ff5375';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-12,-12);ctx.lineTo(12,12);ctx.moveTo(12,-12);ctx.lineTo(-12,12);ctx.stroke();}
    ctx.textAlign='center';ctx.textBaseline='bottom';ctx.shadowBlur=5;ctx.shadowColor='#000';
    ctx.font=`${my?'900':'800'} 15px 'Barlow Condensed',Arial,sans-serif`;
    ctx.fillStyle=my?'#e9fffb':'#d3e1f4';ctx.fillText(my?'★ '+p.name:p.name,0,-38);
    ctx.shadowBlur=0;
    ctx.font='700 12px Arial,sans-serif';ctx.fillStyle=p.color;
    ctx.fillText(p.score.toLocaleString('es-CR'),0,49);
    if (my) {ctx.strokeStyle='rgba(107,255,242,.25)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,51,0,TAU);ctx.stroke();}
    ctx.restore();
  }
  function drawEffects(dt,time) {
    for (const wave of waves) {
      const f=(time-wave.started)/wave.duration;if(f<0||f>1)continue;
      ctx.strokeStyle=wave.color;ctx.globalAlpha=(1-f)*.8;ctx.lineWidth=8*(1-f)+1;
      ctx.shadowColor=wave.color;ctx.shadowBlur=21;
      ctx.beginPath();ctx.arc(wave.x,wave.y,wave.maxRadius*f,0,TAU);ctx.stroke();ctx.shadowBlur=0;
      ctx.lineWidth=2;ctx.beginPath();ctx.arc(wave.x,wave.y,wave.maxRadius*f*.67,0,TAU);ctx.stroke();
    }
    ctx.globalAlpha=1;
    waves=waves.filter(wave=>time-wave.started<wave.duration);
    for (const p of particles) {
      p.t+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.965;p.vy*=.965;
      const a=clamp(1-p.t/p.lifetime,0,1);ctx.globalAlpha=a;
      ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r*a,0,TAU);ctx.fill();
    }
    particles=particles.filter(p=>p.t<p.lifetime);
    ctx.globalAlpha=1;
    for (const f of floats) {
      f.t+=dt;f.y-=40*dt;
      const a=clamp(1-f.t/f.lifetime,0,1);
      ctx.globalAlpha=a;ctx.textAlign='center';ctx.font='900 24px "Barlow Condensed",Arial,sans-serif';
      ctx.fillStyle=f.color;ctx.shadowColor=f.color;ctx.shadowBlur=10;ctx.fillText(f.text,f.x,f.y-22);ctx.shadowBlur=0;
    }
    floats=floats.filter(f=>f.t<f.lifetime);ctx.globalAlpha=1;
  }
  function renderFrame(time) {
    const dt=Math.min((time-lastFrame)/1000,.05);lastFrame=time;
    if (phase==='menu'||!world) drawAmbient(time);
    else {
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.fillStyle='#07101d';ctx.fillRect(0,0,w,h);
      const p=world.players.find(q=>q.id===myId);
      const me=p?renderPlayers.get(p.id):null;
      const ease=1-Math.exp(-dt*15);
      for (const entity of world.players) {
        const sp=renderPlayers.get(entity.id);
        if (!sp) continue;
        sp.x+=(entity.x-sp.x)*ease;sp.y+=(entity.y-sp.y)*ease;
        let delta=entity.angle-sp.angle;
        while (delta>Math.PI)delta-=TAU;
        while (delta< -Math.PI)delta+=TAU;
        sp.angle+=delta*ease;
      }
      if (me) {
        camera.x+=(me.x-camera.x)*(1-Math.exp(-dt*8));
        camera.y+=(me.y-camera.y)*(1-Math.exp(-dt*8));
      }
      const halfW=w/(2*zoom),halfH=h/(2*zoom);
      const camX=halfW>arena.width/2?arena.width/2:clamp(camera.x,halfW,arena.width-halfW);
      const camY=halfH>arena.height/2?arena.height/2:clamp(camera.y,halfH,arena.height-halfH);
      shake=Math.max(0,shake-43*dt);
      const sx=shake?rnd(-shake,shake):0,sy=shake?rnd(-shake,shake):0;
      ctx.translate(w/2+sx,h/2+sy);ctx.scale(zoom,zoom);ctx.translate(-camX,-camY);
      drawFloor(time);
      for(const obstacle of obstacles)drawObstacle(obstacle,time);
      for(const orb of world.orbs)drawOrb(orb,time);
      for(const power of world.powerups)drawPowerup(power,time);
      for(const entity of world.players) {
        const smooth=renderPlayers.get(entity.id);
        if(smooth)drawPlayer(entity,smooth,time);
      }
      drawEffects(dt,time);
      if (phase==='results' && !results.hidden) {
        $('nextCountdown').textContent=String(Math.max(0,Math.ceil((resultEndsAt-time)/1000)));
      }
    }
    requestAnimationFrame(renderFrame);
  }
  requestAnimationFrame(renderFrame);
})();
