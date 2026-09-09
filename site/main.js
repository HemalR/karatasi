/* Karatasi landing page: Omarchy themes, the fake desktop and the scroll-driven story. */
(() => {
  "use strict";

  // ---------- Omarchy themes (palettes copied from each theme's colors.toml) ----------

  const THEMES = [
    ["tokyo-night", "Tokyo Night", "dark", { bg: "#1a1b26", bgDark: "#13141c", bgLight: "#24283b", fg: "#a9b1d6", fgBright: "#c0caf5", fgDim: "#b4bee6", fgFaint: "#565f89", accent: "#7aa2f7", selection: "#292e42", muted: "#414868", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#ad8ee6", cyan: "#449dab" }],
    ["catppuccin", "Catppuccin", "dark", { bg: "#1e1e2e", bgDark: "#161622", bgLight: "#313244", fg: "#cdd6f4", fgBright: "#cdd6f4", fgDim: "#bac2de", fgFaint: "#6c7086", accent: "#89b4fa", selection: "#45475a", muted: "#585b70", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa", magenta: "#f5c2e7", cyan: "#94e2d5" }],
    ["gruvbox", "Gruvbox", "dark", { bg: "#282828", bgDark: "#1e1e1e", bgLight: "#3c3836", fg: "#d4be98", fgBright: "#d4be98", fgDim: "#bdae93", fgFaint: "#7c6f64", accent: "#7daea3", selection: "#504945", muted: "#665c54", red: "#ea6962", green: "#a9b665", yellow: "#d8a657", blue: "#7daea3", magenta: "#d3869b", cyan: "#89b482" }],
    ["everforest", "Everforest", "dark", { bg: "#2d353b", bgDark: "#21272c", bgLight: "#343f44", fg: "#d3c6aa", fgBright: "#d3c6aa", fgDim: "#9da9a0", fgFaint: "#4f585e", accent: "#7fbbb3", selection: "#3d484d", muted: "#475258", red: "#e67e80", green: "#a7c080", yellow: "#dbbc7f", blue: "#7fbbb3", magenta: "#d699b6", cyan: "#83c092" }],
    ["nord", "Nord", "dark", { bg: "#2e3440", bgDark: "#222730", bgLight: "#3b4252", fg: "#d8dee9", fgBright: "#d8dee9", fgDim: "#adb5c4", fgFaint: "#667080", accent: "#81a1c1", selection: "#434c5e", muted: "#4c566a", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0" }],
    ["kanagawa", "Kanagawa", "dark", { bg: "#1f1f28", bgDark: "#17171e", bgLight: "#223249", fg: "#dcd7ba", fgBright: "#dcd7ba", fgDim: "#c8c093", fgFaint: "#727169", accent: "#dcd7ba", selection: "#363646", muted: "#54546d", red: "#c34043", green: "#76946a", yellow: "#c0a36e", blue: "#7e9cd8", magenta: "#957fb8", cyan: "#6a9589" }],
    ["osaka-jade", "Osaka Jade", "dark", { bg: "#111c18", bgDark: "#0c1512", bgLight: "#23372b", fg: "#c1c497", fgBright: "#f7e8b2", fgDim: "#d6d5bc", fgFaint: "#81b8a8", accent: "#509475", selection: "#32473b", muted: "#53685b", red: "#ff5345", green: "#549e6a", yellow: "#459451", blue: "#509475", magenta: "#d2689c", cyan: "#2dd5b7" }],
    ["matte-black", "Matte Black", "dark", { bg: "#121212", bgDark: "#0d0d0d", bgLight: "#1e1e1e", fg: "#bebebe", fgBright: "#eaeaea", fgDim: "#8a8a8d", fgFaint: "#555555", accent: "#e68e0d", selection: "#2a2a2a", muted: "#333333", red: "#d35f5f", green: "#ffc107", yellow: "#f59e0b", blue: "#e68e0d", magenta: "#d35f5f", cyan: "#bebebe" }],
    ["rose-pine", "Rosé Pine Dawn", "light", { bg: "#faf4ed", bgDark: "#ede7e1", bgLight: "#f2e9e1", fg: "#575279", fgBright: "#575279", fgDim: "#6e6a86", fgFaint: "#9893a5", accent: "#56949f", selection: "#dfdad9", muted: "#cecacd", red: "#b4637a", green: "#286983", yellow: "#ea9d34", blue: "#56949f", magenta: "#907aa9", cyan: "#d7827e" }],
  ];
  const VARS = { bg: "--bg", bgDark: "--bg-dark", bgLight: "--bg-light", fg: "--fg", fgBright: "--fg-bright", fgDim: "--fg-dim", fgFaint: "--fg-faint", accent: "--accent", selection: "--selection", muted: "--muted", red: "--red", green: "--green", yellow: "--yellow", blue: "--blue", magenta: "--magenta", cyan: "--cyan" };

  let themeIndex = 0;
  const swatchGroups = [document.getElementById("themes-nav"), document.getElementById("themes-step")].filter(Boolean);

  function applyTheme(i, { user = false } = {}) {
    themeIndex = (i + THEMES.length) % THEMES.length;
    const [id, , mode, c] = THEMES[themeIndex];
    const root = document.documentElement;
    for (const k in VARS) root.style.setProperty(VARS[k], c[k]);
    root.dataset.mode = mode;
    root.dataset.theme = id;
    document.querySelectorAll(".tname").forEach((el) => (el.textContent = THEMES[themeIndex][1]));
    document.querySelectorAll(".swatch").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === id)));
    if (user) {
      stopThemeCycle();
      try { localStorage.setItem("karatasi-theme", id); } catch (_) {}
    }
  }

  for (const group of swatchGroups) {
    THEMES.forEach(([id, name, , c], i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.title = name;
      b.setAttribute("aria-label", `${name} theme`);
      b.dataset.theme = id;
      b.style.setProperty("--sw-bg", c.bg);
      b.style.setProperty("--sw-accent", c.accent);
      b.style.setProperty("--sw-fg", c.fg);
      b.addEventListener("click", () => applyTheme(i, { user: true }));
      group.appendChild(b);
    });
  }

  let saved = null;
  try { saved = localStorage.getItem("karatasi-theme"); } catch (_) {}
  applyTheme(Math.max(0, THEMES.findIndex((t) => t[0] === saved)));

  let themeTimer = 0;
  function startThemeCycle() {
    stopThemeCycle();
    themeTimer = setInterval(() => applyTheme(themeIndex + 1), 1500);
  }
  function stopThemeCycle() {
    clearInterval(themeTimer);
    themeTimer = 0;
  }

  // ---------- the desktop ----------

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stage = document.getElementById("stage");
  const wins = document.getElementById("wins");
  const win = (id) => document.getElementById(id);
  const note = win("note");
  const note2 = win("note2");
  const noteDoc = document.getElementById("note-doc");
  const noteStatus = document.getElementById("note-status");
  const toast = document.getElementById("keytoast");

  // Percent geometry with Hyprland-ish gaps.
  const G = 0.4;
  const GV = G * 1.7;
  const rect = (x, y, w, h) => ({ left: x + G, top: y + GV, width: w - 2 * G, height: h - 2 * GV });
  const FLOAT = { left: 25, top: 14, width: 50, height: 70 };
  const FLOAT2 = { left: 27, top: 17, width: 50, height: 70 };

  const model = { ws: 1, note: "hidden", tiledWs: 0, note2: false, typed: false };
  let interacted = false;

  function place(el, r) {
    el.style.left = r.left + "%";
    el.style.top = r.top + "%";
    el.style.width = r.width + "%";
    el.style.height = r.height + "%";
  }

  function render() {
    const tiledHere = model.note === "tiled" && model.tiledWs === model.ws;

    // Workspace 1 and 2 layouts, splitting the right column when the note is tiled there.
    if (model.note === "tiled" && model.tiledWs === 1) {
      place(win("w-term"), rect(0, 0, 50, 100));
      place(win("w-browser"), rect(50, 0, 50, 50));
    } else {
      place(win("w-term"), rect(0, 0, 50, 100));
      place(win("w-browser"), rect(50, 0, 50, 100));
    }
    if (model.note === "tiled" && model.tiledWs === 2) {
      place(win("w-nvim"), rect(0, 0, 58, 100));
      place(win("w-term2"), rect(58, 0, 42, 50));
    } else {
      place(win("w-nvim"), rect(0, 0, 58, 100));
      place(win("w-term2"), rect(58, 0, 42, 100));
    }

    document.querySelectorAll(".workspace").forEach((w) => {
      const n = +w.dataset.ws;
      w.classList.toggle("left", n < model.ws);
      w.classList.toggle("right", n > model.ws);
    });
    document.querySelectorAll(".bar .ws").forEach((w) => w.classList.toggle("on", +w.dataset.ws === model.ws));

    // The main note: hidden, floating and pinned, or tiled into one workspace.
    note.classList.toggle("hidden", model.note === "hidden");
    if (model.note === "tiled") {
      place(note, model.tiledWs === 1 ? rect(50, 50, 50, 50) : rect(58, 50, 42, 50));
      const dx = model.tiledWs < model.ws ? -1.04 : model.tiledWs > model.ws ? 1.04 : 0;
      note.style.transform = dx ? `translateX(${dx * wins.clientWidth}px)` : "";
      note.style.opacity = dx ? "0" : "";
    } else {
      place(note, FLOAT);
      note.style.transform = "";
      note.style.opacity = "";
    }
    note.style.zIndex = model.note === "tiled" ? "" : "5";

    note2.classList.toggle("hidden", !model.note2);
    place(note2, FLOAT2);

    const noteFocused = model.note === "float" || (tiledHere && !model.note2);
    note.classList.toggle("focus", noteFocused);
    note2.classList.toggle("focus", model.note2);
    win("w-term").classList.toggle("focus", model.ws === 1 && !noteFocused && !model.note2);
    win("w-term2").classList.toggle("focus", model.ws === 2 && !noteFocused && !model.note2);
    win("w-browser").classList.remove("focus");
    win("w-nvim").classList.remove("focus");

    if (model.note !== "hidden" && !model.typed && !typing) typeNote();
  }

  let toastTimer = 0;
  function showKey(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 900);
  }

  function pressKey(act, ws) {
    const active = document.querySelector(".step.active") || document.querySelector(".step.hero");
    let key = active && active.querySelector(`.key[data-act="${act}"]${ws ? `[data-ws="${ws}"]` : ""}`);
    if (!key) key = document.querySelector(`.key[data-act="${act}"]${ws ? `[data-ws="${ws}"]` : ""}`);
    if (!key) return;
    key.classList.add("pressed");
    setTimeout(() => key.classList.remove("pressed"), 160);
  }

  // ---------- actions, the same ones the real keys perform ----------

  function toggle(auto) {
    if (!auto) interacted = true;
    showKey("Super N");
    pressKey("toggle");
    if (model.note === "tiled") model.note2 = !model.note2;
    else model.note = model.note === "hidden" ? "float" : "hidden";
    render();
  }
  function tile() {
    interacted = true;
    showKey("Super T");
    pressKey("tile");
    if (model.note === "tiled") {
      model.note = "float";
      model.note2 = false;
    } else {
      if (model.note === "hidden") model.note = "float";
      model.note = "tiled";
      model.tiledWs = model.ws;
      model.note2 = false;
    }
    render();
  }
  function workspace(n, auto) {
    if (!auto) interacted = true;
    if (n === model.ws) return;
    showKey(`Super ${n}`);
    pressKey("ws", n);
    model.ws = n;
    render();
  }

  document.querySelectorAll(".key[data-act]").forEach((k) => {
    k.addEventListener("click", () => {
      stopAuto();
      k.classList.remove("pulse");
      const act = k.dataset.act;
      if (act === "toggle") toggle();
      else if (act === "tile") tile();
      else if (act === "ws") workspace(+k.dataset.ws);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (!"nt12".includes(k)) return;
    stopAuto();
    document.querySelectorAll(".key.pulse").forEach((b) => b.classList.remove("pulse"));
    if (k === "n") toggle();
    else if (k === "t") tile();
    else workspace(+k);
    e.preventDefault();
  });

  // ---------- typing into the note ----------

  const LINES = [
    { t: "h1", s: "Landing page" },
    { t: "todo", s: "Register karatasi.app", done: true },
    { t: "todo", s: "Fake Omarchy desktop, with workspaces" },
    { t: "todo", s: "Ship 0.1.0 to the AUR", done: true },
    { t: "p", s: "Raycast Notes, but it follows you everywhere." },
  ];
  let typing = false;

  function lineEl(line) {
    if (line.t === "h1") {
      const h = document.createElement("h1");
      h.innerHTML = '<span class="txt"></span>';
      return h;
    }
    if (line.t === "todo") {
      const ul = noteDoc.querySelector("ul") || noteDoc.appendChild(document.createElement("ul"));
      const li = document.createElement("li");
      li.innerHTML = '<span class="box"></span><span class="txt"></span>';
      ul.appendChild(li);
      return li;
    }
    const p = document.createElement("p");
    p.innerHTML = '<span class="txt"></span>';
    return p;
  }

  function finalDoc() {
    noteDoc.innerHTML = "";
    for (const line of LINES) {
      const el = lineEl(line);
      if (!el.parentNode) noteDoc.appendChild(el);
      el.querySelector(".txt").textContent = line.s;
      if (line.done) el.classList.add("done");
    }
    noteStatus.textContent = "Saved · just now";
    model.typed = true;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function typeNote() {
    if (reduced) return finalDoc();
    typing = true;
    noteDoc.innerHTML = "";
    const caret = document.createElement("span");
    caret.className = "caret";
    noteStatus.textContent = "Editing";
    await sleep(350);
    for (const line of LINES) {
      const el = lineEl(line);
      if (!el.parentNode) noteDoc.appendChild(el);
      const txt = el.querySelector(".txt");
      txt.after(caret);
      for (const ch of line.s) {
        txt.textContent += ch;
        await sleep(22 + Math.random() * 40 + (ch === " " ? 30 : 0));
      }
      if (line.done) {
        await sleep(260);
        el.classList.add("done");
      }
      await sleep(line.t === "h1" ? 380 : 220);
    }
    caret.remove();
    noteStatus.textContent = "Saved · just now";
    model.typed = true;
    typing = false;
  }

  // ---------- scenes, driven by which step is in view ----------

  const stepsEl = Array.from(document.querySelectorAll(".step"));
  let scene = 0;
  let sceneTimers = [];
  const later = (fn, ms) => sceneTimers.push(setTimeout(fn, ms));
  const clearSceneTimers = () => {
    sceneTimers.forEach(clearTimeout);
    sceneTimers = [];
  };

  let autoTimer = 0;
  function startAuto() {
    stopAuto();
    if (reduced || interacted) return;
    let on = false;
    const tick = () => {
      if (scene !== 0 || interacted) return stopAuto();
      on = !on;
      model.note = on ? "float" : "hidden";
      showKey("Super N");
      pressKey("toggle");
      render();
      autoTimer = setTimeout(tick, on ? 4200 : 2600);
    };
    autoTimer = setTimeout(tick, 1600);
  }
  function stopAuto() {
    clearTimeout(autoTimer);
    autoTimer = 0;
  }

  function setScene(i) {
    const forward = i > scene;
    scene = i;
    stage.dataset.scene = String(i);
    stepsEl.forEach((s) => s.classList.toggle("active", +s.dataset.scene === i));
    clearSceneTimers();
    stopAuto();
    if (i !== 6) stopThemeCycle();
    const key = forward ? showKey : () => {};
    const press = forward ? pressKey : () => {};

    switch (i) {
      case 0:
        Object.assign(model, { ws: 1, note: "hidden", note2: false });
        render();
        startAuto();
        break;
      case 1:
        Object.assign(model, { ws: 1, note: "float", note2: false });
        key("Super N");
        press("toggle");
        render();
        break;
      case 2:
        model.note = model.note === "tiled" ? "float" : "float";
        model.note2 = false;
        render();
        later(() => {
          model.ws = 2;
          key("Super 2");
          press("ws", 2);
          render();
        }, forward ? 500 : 0);
        break;
      case 3:
        Object.assign(model, { ws: 2, note: "hidden", note2: false });
        key("Super N");
        press("toggle");
        render();
        break;
      case 4: {
        const wasHidden = model.note === "hidden";
        Object.assign(model, { ws: 2, note2: false });
        if (wasHidden) {
          model.note = "float";
          key("Super N");
          render();
        }
        later(() => {
          Object.assign(model, { note: "tiled", tiledWs: 2 });
          key("Super T");
          press("tile");
          render();
        }, wasHidden && forward ? 900 : 0);
        break;
      }
      case 5:
        Object.assign(model, { ws: 2, note: "tiled", tiledWs: 2 });
        render();
        later(() => {
          model.note2 = true;
          key("Super N");
          press("toggle");
          render();
        }, forward ? 450 : 0);
        break;
      case 6:
        Object.assign(model, { ws: 2, note: "tiled", tiledWs: 2, note2: true });
        render();
        if (!reduced) later(startThemeCycle, 600);
        break;
    }
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const n = +e.target.dataset.scene;
        if (e.isIntersecting) setScene(n);
        else if (n === scene) {
          // Scrolled past the story entirely: stop whatever the last scene left running.
          stopThemeCycle();
          stopAuto();
        }
      }
    },
    { rootMargin: "-42% 0px -42% 0px", threshold: 0 }
  );
  stepsEl.forEach((s) => io.observe(s));

  addEventListener("resize", render);
  render();
  startAuto();

  // ---------- small things ----------

  const clock = document.getElementById("clock");
  const tickClock = () => {
    const d = new Date();
    clock.textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  tickClock();
  setInterval(tickClock, 15000);

  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        b.textContent = "copied";
      } catch (_) {
        b.textContent = "select it";
      }
      setTimeout(() => (b.textContent = "copy"), 1400);
    });
  });

  // The welcome note as it sits on disk, lightly highlighted.
  const raw = document.getElementById("raw-md");
  if (raw && window.WELCOME_MD) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    raw.innerHTML = window.WELCOME_MD.split("\n")
      .map((line) => {
        let l = esc(line);
        if (/^#{1,3} /.test(l)) return `<span class="md-h">${l}</span>`;
        if (/^(```|---)/.test(l)) return `<span class="md-m">${l}</span>`;
        l = l.replace(/(\*\*[^*]+\*\*)/g, '<span class="md-b">$1</span>');
        l = l.replace(/(`[^`]+`)/g, '<span class="md-c">$1</span>');
        l = l.replace(/^(- (?:\[[ x]\] )?)/, '<span class="md-m">$1</span>');
        return l;
      })
      .join("\n");
  }
})();
