/* Stillwater — a calm Pomodoro productivity app */
(() => {
  "use strict";

  // ---------- Storage helpers ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("sw:" + key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, val) { localStorage.setItem("sw:" + key, JSON.stringify(val)); },
  };

  const DEFAULTS = {
    focus: 25, short: 5, long: 15, interval: 4,
    autoBreaks: false, autoFocus: false, chime: true, notify: false,
  };

  const MODE_TEXT = {
    focus: { label: "Time to focus", title: "Focus" },
    short: { label: "Breathe & rest", title: "Short break" },
    long:  { label: "Step away a while", title: "Long break" },
  };

  const QUOTES = [
    ["Almost everything will work again if you unplug it for a few minutes, including you.", "Anne Lamott"],
    ["Nature does not hurry, yet everything is accomplished.", "Lao Tzu"],
    ["The way to get started is to quit talking and begin doing.", "Walt Disney"],
    ["Slow down and everything you are chasing will come around and catch you.", "John De Paola"],
    ["Concentrate all your thoughts upon the work at hand.", "Alexander Graham Bell"],
    ["Rest is not idleness.", "John Lubbock"],
    ["You can do anything, but not everything.", "David Allen"],
    ["Small steps every day.", "Unknown"],
  ];

  // ---------- State ----------
  let settings = { ...DEFAULTS, ...store.get("settings", {}) };
  let tasks = store.get("tasks", []);
  let activeTaskId = store.get("activeTask", null);
  let history = store.get("history", {});
  let cycleCount = store.get("cycle", 0);

  const state = { mode: "focus", total: 0, remaining: 0, endAt: 0, running: false, timerId: null };

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const el = {
    time: $("#time"), phase: $("#phaseLabel"), ring: $("#ringProgress"),
    start: $("#startBtn"), startLabel: $("#startLabel"), reset: $("#resetBtn"), skip: $("#skipBtn"),
    modes: $$(".mode"), pill: $(".mode-pill"), dots: $("#dots"), currentTask: $("#currentTask"),
    taskForm: $("#taskForm"), taskInput: $("#taskInput"), estValue: $("#estValue"),
    taskList: $("#taskList"), empty: $("#emptyState"), clearDone: $("#clearDoneBtn"),
    sounds: $$(".sound"), volume: $("#volume"), quote: $("#quote"),
    settingsDialog: $("#settingsDialog"), settingsForm: $("#settingsForm"),
    statsDialog: $("#statsDialog"), toast: $("#toast"),
  };

  const R = 136, CIRC = 2 * Math.PI * R;
  el.ring.style.strokeDasharray = CIRC;

  // ---------- Utils ----------
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  };
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const escapeHTML = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2800);
  }

  // ---------- Timer ----------
  function setMode(mode, { autostart = false } = {}) {
    stop();
    state.mode = mode;
    state.total = settings[mode] * 60 * 1000;
    state.remaining = state.total;
    document.body.dataset.mode = mode;
    el.modes.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    el.phase.textContent = MODE_TEXT[mode].label;
    movePill();
    render();
    renderDots();
    el.startLabel.textContent = "Start";
    if (autostart) start();
  }

  function start() {
    if (state.running) return;
    ensureAudio();
    state.running = true;
    state.endAt = Date.now() + state.remaining;
    state.timerId = setInterval(tick, 250);
    document.body.classList.add("running");
    el.startLabel.textContent = "Pause";
    tick();
  }

  function stop() {
    if (!state.running) return;
    state.running = false;
    clearInterval(state.timerId);
    state.remaining = Math.max(0, state.endAt - Date.now());
    document.body.classList.remove("running");
    el.startLabel.textContent = "Resume";
  }

  function reset() {
    const wasRunning = state.running;
    stop();
    state.remaining = state.total;
    el.startLabel.textContent = "Start";
    render();
    if (wasRunning) toast("Timer reset");
  }

  function tick() {
    state.remaining = Math.max(0, state.endAt - Date.now());
    render();
    if (state.remaining <= 0) complete(true);
  }

  function complete(natural) {
    stop();
    const finished = state.mode;
    let next;

    if (finished === "focus") {
      if (natural) {
        recordSession(settings.focus);
        bumpActiveTask();
      }
      cycleCount += 1;
      store.set("cycle", cycleCount);
      next = cycleCount % settings.interval === 0 ? "long" : "short";
    } else {
      if (finished === "long") { cycleCount = 0; store.set("cycle", 0); }
      next = "focus";
    }

    if (natural) {
      if (settings.chime) chime();
      const msg = finished === "focus" ? "Session complete — time for a gentle break." : "Break's over — ready when you are.";
      toast(msg);
      notify(msg);
    }

    const auto = next === "focus" ? settings.autoFocus : settings.autoBreaks;
    setMode(next, { autostart: natural && auto });
    el.startLabel.textContent = state.running ? "Pause" : "Start";
  }

  function render() {
    const t = fmt(state.remaining);
    el.time.textContent = t;
    const progress = state.total ? state.remaining / state.total : 1;
    el.ring.style.strokeDashoffset = CIRC * (1 - progress);
    document.title = state.running || state.remaining !== state.total
      ? `${t} · ${MODE_TEXT[state.mode].title}`
      : "Stillwater · Focus";
  }

  function renderDots() {
    const n = settings.interval;
    const filled = state.mode === "long" ? n : cycleCount % n;
    el.dots.innerHTML = Array.from({ length: n }, (_, i) =>
      `<span class="dot${i < filled ? " filled" : ""}"></span>`).join("");
  }

  function movePill() {
    const active = el.modes.find((b) => b.classList.contains("active"));
    if (!active) return;
    el.pill.style.width = active.offsetWidth + "px";
    el.pill.style.transform = `translateX(${active.offsetLeft - 5}px)`;
  }

  // ---------- Stats ----------
  function recordSession(minutes) {
    const k = dayKey();
    const day = history[k] || { minutes: 0, sessions: 0 };
    day.minutes += minutes;
    day.sessions += 1;
    history[k] = day;
    store.set("history", history);
  }

  function streak() {
    let count = 0;
    const d = new Date();
    if (!history[dayKey(d)]) d.setDate(d.getDate() - 1); // today not yet started is OK
    while (history[dayKey(d)]?.sessions) { count++; d.setDate(d.getDate() - 1); }
    return count;
  }

  function renderStats() {
    const today = history[dayKey()] || { minutes: 0, sessions: 0 };
    $("#statToday").textContent = today.minutes;
    $("#statSessions").textContent = today.sessions;
    $("#statStreak").textContent = streak();

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push({ d, m: history[dayKey(d)]?.minutes || 0, today: i === 0 });
    }
    const max = Math.max(60, ...days.map((x) => x.m));
    $("#weekChart").innerHTML = days.map(({ d, m, today }) => `
      <div class="bar${today ? " today" : ""}" title="${m} min">
        <em>${m || ""}</em>
        <div class="bar-fill" style="height:${(m / max) * 100}%"></div>
        <small>${d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)}</small>
      </div>`).join("");
  }

  // ---------- Tasks ----------
  let est = 1;
  function saveTasks() { store.set("tasks", tasks); store.set("activeTask", activeTaskId); }

  function renderTasks() {
    el.taskList.innerHTML = tasks.map((t) => `
      <li class="task${t.done ? " done" : ""}${t.id === activeTaskId ? " active" : ""}" data-id="${t.id}">
        <button class="check" data-action="toggle" aria-label="Mark complete">
          <svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>
        </button>
        <span class="task-title">${escapeHTML(t.title)}</span>
        <span class="task-count">${t.spent}/${t.est}</span>
        <button class="task-del" data-action="delete" aria-label="Delete task">
          <svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </li>`).join("");
    el.empty.style.display = tasks.length ? "none" : "block";

    const active = tasks.find((t) => t.id === activeTaskId);
    el.currentTask.innerHTML = active
      ? `Working on <strong>${escapeHTML(active.title)}</strong>`
      : "Pick a task below to stay intentional";
  }

  function bumpActiveTask() {
    const t = tasks.find((x) => x.id === activeTaskId);
    if (!t) return;
    t.spent += 1;
    saveTasks();
    renderTasks();
  }

  el.taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = el.taskInput.value.trim();
    if (!title) return;
    const task = { id: uid(), title, est, spent: 0, done: false };
    tasks.push(task);
    if (!activeTaskId) activeTaskId = task.id;
    el.taskInput.value = "";
    est = 1; el.estValue.textContent = est;
    saveTasks(); renderTasks();
  });

  $$(".est-btn").forEach((b) => b.addEventListener("click", () => {
    est = Math.min(12, Math.max(1, est + Number(b.dataset.delta)));
    el.estValue.textContent = est;
  }));

  el.taskList.addEventListener("click", (e) => {
    const li = e.target.closest(".task");
    if (!li) return;
    const id = li.dataset.id;
    const task = tasks.find((t) => t.id === id);
    const action = e.target.closest("[data-action]")?.dataset.action;

    if (action === "delete") {
      tasks = tasks.filter((t) => t.id !== id);
      if (activeTaskId === id) activeTaskId = null;
    } else if (action === "toggle") {
      task.done = !task.done;
      if (task.done && activeTaskId === id) {
        activeTaskId = tasks.find((t) => !t.done)?.id ?? null;
        toast("Lovely. One thing done.");
      }
    } else {
      activeTaskId = task.done ? activeTaskId : id;
    }
    saveTasks(); renderTasks();
  });

  el.clearDone.addEventListener("click", () => {
    tasks = tasks.filter((t) => !t.done);
    saveTasks(); renderTasks();
  });

  // ---------- Audio ----------
  let ctx, master, ambient = null;

  function ensureAudio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = Number(el.volume.value);
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  function noiseBuffer(type) {
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === "brown") {
          last = (last + 0.02 * w) / 1.02;
          data[i] = last * 3.5;
        } else if (type === "pink") {
          b0 = 0.99765 * b0 + w * 0.099046;
          b1 = 0.963 * b1 + w * 0.2965164;
          b2 = 0.57 * b2 + w * 1.0526913;
          data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
        } else {
          data[i] = w * 0.5;
        }
      }
    }
    return buf;
  }

  function playAmbient(kind) {
    stopAmbient();
    if (kind === "off") return;
    ensureAudio();

    const src = ctx.createBufferSource();
    src.loop = true;
    const out = ctx.createGain();
    out.gain.value = 0;
    const nodes = [src];

    if (kind === "rain") {
      src.buffer = noiseBuffer("pink");
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 400;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7000;
      src.connect(hp).connect(lp).connect(out);
      out.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.5);
    } else if (kind === "ocean") {
      src.buffer = noiseBuffer("brown");
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      const swell = ctx.createGain(); swell.gain.value = 0.55;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
      const depth = ctx.createGain(); depth.gain.value = 0.45;
      lfo.connect(depth).connect(swell.gain);
      lfo.start();
      nodes.push(lfo);
      src.connect(lp).connect(swell).connect(out);
      out.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
    } else if (kind === "brown") {
      src.buffer = noiseBuffer("brown");
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
      src.connect(lp).connect(out);
      out.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.5);
    }

    out.connect(master);
    src.start();
    ambient = { nodes, out };
  }

  function stopAmbient() {
    if (!ambient) return;
    const { nodes, out } = ambient;
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.linearRampToValueAtTime(0, t + 0.8);
    setTimeout(() => { nodes.forEach((n) => { try { n.stop(); } catch {} }); out.disconnect(); }, 900);
    ambient = null;
  }

  function chime() {
    ensureAudio();
    const t = ctx.currentTime;
    [[523.25, 0], [659.25, 0.18], [783.99, 0.36]].forEach(([f, d]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.25, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 2.4);
      o.connect(g).connect(ctx.destination);
      o.start(t + d); o.stop(t + d + 2.5);
    });
  }

  el.sounds.forEach((b) => b.addEventListener("click", () => {
    el.sounds.forEach((x) => x.classList.toggle("active", x === b));
    playAmbient(b.dataset.sound);
  }));

  el.volume.addEventListener("input", () => {
    if (master) master.gain.value = Number(el.volume.value);
    store.set("volume", el.volume.value);
  });

  // ---------- Notifications ----------
  function notify(msg) {
    if (!settings.notify || !("Notification" in window) || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    new Notification("Stillwater", { body: msg, silent: true });
  }

  // ---------- Settings ----------
  function fillSettingsForm() {
    const f = el.settingsForm.elements;
    ["focus", "short", "long", "interval"].forEach((k) => (f[k].value = settings[k]));
    ["autoBreaks", "autoFocus", "chime", "notify"].forEach((k) => (f[k].checked = settings[k]));
  }

  $("#settingsBtn").addEventListener("click", () => { fillSettingsForm(); el.settingsDialog.returnValue = ""; el.settingsDialog.showModal(); });

  $("#resetSettings").addEventListener("click", () => {
    settings = { ...DEFAULTS };
    fillSettingsForm();
  });

  el.settingsForm.elements.notify.addEventListener("change", async (e) => {
    if (e.target.checked && "Notification" in window && Notification.permission === "default") {
      const p = await Notification.requestPermission();
      if (p !== "granted") { e.target.checked = false; toast("Notifications were not allowed"); }
    }
  });

  el.settingsDialog.addEventListener("close", () => {
    if (el.settingsDialog.returnValue !== "save") { settings = { ...DEFAULTS, ...store.get("settings", {}) }; return; }
    const f = el.settingsForm.elements;
    const clamp = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    settings = {
      focus: clamp(f.focus.value, 1, 120, DEFAULTS.focus),
      short: clamp(f.short.value, 1, 60, DEFAULTS.short),
      long: clamp(f.long.value, 1, 90, DEFAULTS.long),
      interval: clamp(f.interval.value, 2, 10, DEFAULTS.interval),
      autoBreaks: f.autoBreaks.checked,
      autoFocus: f.autoFocus.checked,
      chime: f.chime.checked,
      notify: f.notify.checked,
    };
    store.set("settings", settings);
    if (!state.running) setMode(state.mode);
    renderDots();
    toast("Settings saved");
  });

  $("#statsBtn").addEventListener("click", () => { renderStats(); el.statsDialog.showModal(); });

  // ---------- Controls ----------
  el.start.addEventListener("click", () => (state.running ? stop() : start()));
  el.reset.addEventListener("click", reset);
  el.skip.addEventListener("click", () => complete(false));
  el.modes.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.mode !== state.mode) { setMode(b.dataset.mode); el.startLabel.textContent = "Start"; }
  }));

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea") || document.querySelector("dialog[open]")) return;
    if (e.code === "Space") { e.preventDefault(); state.running ? stop() : start(); }
    else if (e.key.toLowerCase() === "r") reset();
    else if (e.key.toLowerCase() === "s") complete(false);
  });

  window.addEventListener("resize", movePill);

  // ---------- Quotes ----------
  let qi = Math.floor(Math.random() * QUOTES.length);
  function showQuote() {
    el.quote.style.opacity = 0;
    setTimeout(() => {
      const [text, who] = QUOTES[qi];
      el.quote.innerHTML = `“${text}”<cite>— ${who}</cite>`;
      el.quote.style.opacity = 1;
      qi = (qi + 1) % QUOTES.length;
    }, 600);
  }
  setInterval(showQuote, 45000);

  // ---------- Init ----------
  el.volume.value = store.get("volume", 0.4);
  setMode("focus");
  renderTasks();
  showQuote();
  document.fonts?.ready.then(movePill);
})();
