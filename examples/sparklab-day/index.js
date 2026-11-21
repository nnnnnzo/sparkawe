/**
 * Journée — minuteur et liste de tâches.
 *
 * Le temps restant se calcule toujours depuis une échéance (`endsAt`) : un
 * intervalle au niveau du module publie la surface une fois par seconde, le
 * composant ne fait qu’afficher. Changer d’onglet ne fait donc pas dériver le
 * minuteur.
 *
 * L’état vit dans `api.state`, espace isolé par identifiant d’extension :
 * `tasks` est partagé par toutes les tuiles Tâches, `timers` est indexé par
 * identifiant de tuile.
 */
(function () {
  const extensions = (window.SparkExtensions =
    window.SparkExtensions || {});
  const ID = "sparklab.day";
  const TIMER = ID + ".timer";
  const TASKS = ID + ".tasks";
  const FINISHED = { id: ID + ".timer.finished" };
  const NOTIFICATIONS = { id: "spark.notifications@1" };

  const WORK_BREAK_MS = 5 * 60 * 1000;
  const MAX_TASKS = 500;
  const DONE_KEEP_DAYS = 30;
  const MAX_TITLE = 200;
  const DAY = 24 * 60 * 60 * 1000;

  extensions[ID] = function (runtime) {
    const React = runtime.React;
    const h = React.createElement;
    const { useEffect, useReducer, useRef } = React;

    // ---------------------------------------------------------------- état

    let api = null;
    let store = blank();
    let saveTimer = undefined;
    let ticker = undefined;
    let audio = null;

    const storeListeners = new Set();
    const timerListeners = new Map();
    const shown = new Map();

    function blank() {
      return { version: 1, tasks: [], timers: {}, settings: { sound: true } };
    }

    function normalize(raw) {
      const next = blank();
      if (!raw || typeof raw !== "object") return next;
      if (Array.isArray(raw.tasks)) {
        next.tasks = raw.tasks
          .filter(
            (task) =>
              task &&
              typeof task.id === "string" &&
              typeof task.title === "string",
          )
          .slice(0, MAX_TASKS)
          .map((task) => ({
            id: task.id,
            title: String(task.title).slice(0, MAX_TITLE),
            due: typeof task.due === "string" ? task.due : null,
            priority:
              task.priority === "high" || task.priority === "low"
                ? task.priority
                : "normal",
            done: task.done === true,
            createdAt: Number(task.createdAt) || Date.now(),
            doneAt: Number(task.doneAt) || null,
          }));
      }
      if (raw.timers && typeof raw.timers === "object") {
        for (const [tileId, timer] of Object.entries(raw.timers)) {
          if (timer && typeof timer === "object")
            next.timers[tileId] = normalizeTimer(timer);
        }
      }
      if (raw.settings && typeof raw.settings === "object")
        next.settings.sound = raw.settings.sound !== false;
      return next;
    }

    function save() {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      try {
        api.state.save(store);
      } catch (error) {
        console.error(error);
      }
    }

    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 300);
    }

    function notifyStore() {
      for (const listener of [...storeListeners]) listener();
    }

    function notifyTimers(tileId) {
      const groups = tileId ? [timerListeners.get(tileId)] : timerListeners.values();
      for (const group of groups) if (group) for (const listener of [...group]) listener();
    }

    // ------------------------------------------------------------- horloge

    function pad(value) {
      return String(value).padStart(2, "0");
    }

    function clock(ms) {
      const total = Math.max(0, Math.ceil(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      return hours
        ? `${hours}:${pad(minutes)}:${pad(seconds)}`
        : `${pad(minutes)}:${pad(seconds)}`;
    }

    /** Chronomètre : millisecondes visibles, sans heures. */
    function clockPrecise(ms) {
      const total = Math.max(0, Math.floor(ms));
      const hours = Math.floor(total / 3600000);
      const minutes = Math.floor((total % 3600000) / 60000);
      const seconds = Math.floor((total % 60000) / 1000);
      const millis = String(total % 1000).padStart(3, "0");
      return hours
        ? `${hours}:${pad(minutes)}:${pad(seconds)}.${millis}`
        : `${pad(minutes)}:${pad(seconds)}.${millis}`;
    }

    /** Durée éditable : minutes:secondes, minutes au-delà de 59. */
    function durationText(ms) {
      const total = Math.max(0, Math.round(ms / 1000));
      return `${Math.floor(total / 60)}:${pad(total % 60)}`;
    }

    /** Accepte « 25 » (minutes) ou « 25:30 » (minutes:secondes). */
    function parseDuration(text) {
      const value = String(text).trim().replace(",", ":");
      const limit = 180 * 60 * 1000;
      let match = /^(\d{1,3}):(\d{1,2})$/.exec(value);
      if (match) {
        const minutes = Number(match[1]);
        const seconds = Number(match[2]);
        if (seconds > 59) return null;
        const ms = (minutes * 60 + seconds) * 1000;
        return ms >= 1000 && ms <= limit ? ms : null;
      }
      match = /^(\d{1,3})$/.exec(value);
      if (match) {
        const ms = Number(match[1]) * 60000;
        return ms >= 1000 && ms <= limit ? ms : null;
      }
      return null;
    }

    function clampMinutes(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return undefined;
      return Math.min(180, Math.max(1, Math.round(number)));
    }

    // --------------------------------------------------------------- dates

    function iso(date) {
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function todayISO() {
      return iso(new Date());
    }

    function fromISO(value) {
      const [year, month, day] = value.split("-").map(Number);
      return new Date(year, month - 1, day);
    }

    function addDays(value, days) {
      const date = fromISO(value);
      date.setDate(date.getDate() + days);
      return iso(date);
    }

    const WEEKDAYS = [
      "dimanche",
      "lundi",
      "mardi",
      "mercredi",
      "jeudi",
      "vendredi",
      "samedi",
    ];

    /** Déplace une échéance écrite dans le texte vers `due`. */
    function parseDue(text) {
      const out = text.replace(/\s+/g, " ").trim();
      const today = todayISO();
      const cleanup = (value) =>
        value
          .replace(/\s+/g, " ")
          .trim()
          .replace(/[,;]?\s+(le|la|pour|à)$/i, "")
          .trim();
      const take = (due, match) => ({
        title: cleanup(out.replace(match, " ")),
        due,
      });

      let match = /\bapr[eè]s[- ]demain\b/i.exec(out);
      if (match) return take(addDays(today, 2), match[0]);

      match = /\bdemain\b/i.exec(out);
      if (match) return take(addDays(today, 1), match[0]);

      match = /\baujourd'?hui\b/i.exec(out);
      if (match) return take(today, match[0]);

      match = /\bdans\s+(\d{1,3})\s+jours?\b/i.exec(out);
      if (match)
        return take(addDays(today, Number(match[1])), match[0]);

      match = new RegExp(`\\b(${WEEKDAYS.join("|")})\\b`, "i").exec(out);
      if (match) {
        const target = WEEKDAYS.indexOf(match[1].toLowerCase());
        const current = new Date().getDay();
        const delta = ((target - current + 7) % 7) || 7;
        return take(addDays(today, delta), match[0]);
      }

      match = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(out);
      if (match) {
        const day = Number(match[1]);
        const month = Number(match[2]);
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
          const year = match[3]
            ? Number(match[3]) < 100
              ? 2000 + Number(match[3])
              : Number(match[3])
            : new Date().getFullYear();
          const date = new Date(year, month - 1, day);
          // Une date impossible (31/02) ne devient pas une autre date.
          if (date.getDate() !== day || date.getMonth() !== month - 1)
            return { title: out, due: null };
          let due = iso(date);
          if (!match[3] && due < today)
            due = iso(new Date(year + 1, month - 1, day));
          return take(due, match[0]);
        }
      }

      return { title: out, due: null };
    }

    /** Échéance fournie par un agent : ISO ou expression française. */
    function resolveDue(value) {
      if (!value) return null;
      const trimmed = String(value).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const date = fromISO(trimmed);
        return Number.isFinite(date.getTime()) ? trimmed : null;
      }
      return parseDue(` ${trimmed} `).due;
    }

    function formatDue(due) {
      if (!due) return "";
      const today = todayISO();
      if (due === today) return "Aujourd’hui";
      if (due === addDays(today, 1)) return "Demain";
      if (due === addDays(today, -1)) return "Hier";
      const date = fromISO(due);
      const sameYear = date.getFullYear() === new Date().getFullYear();
      return date.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        ...(sameYear ? {} : { year: "numeric" }),
      });
    }

    // -------------------------------------------------------------- minuteur

    function normalizeTimer(raw) {
      const mode =
        raw.mode === "pomodoro" || raw.mode === "stopwatch"
          ? raw.mode
          : "countdown";
      const durationMs = Math.max(0, Number(raw.durationMs) || 0);
      return {
        mode,
        label: typeof raw.label === "string" ? raw.label.slice(0, 80) : "",
        durationMs,
        remainingMs: Math.max(0, Number(raw.remainingMs) || 0),
        endsAt: Number(raw.endsAt) || null,
        running: raw.running === true,
        phase:
          raw.phase === "break" || raw.phase === "done"
            ? raw.phase
            : mode === "pomodoro"
              ? "work"
              : mode === "stopwatch"
                ? "stop"
                : "countdown",
        cycle: Number(raw.cycle) || 0,
        workMs: Number(raw.workMs) || durationMs,
        elapsedMs: Math.max(0, Number(raw.elapsedMs) || 0),
        startedAt: Number(raw.startedAt) || null,
      };
    }

    function ensureTimer(tile) {
      const existing = store.timers[tile.id];
      if (existing) return existing;
      const data = tile.data || {};
      const mode =
        data.mode === "pomodoro" || data.mode === "stopwatch"
          ? data.mode
          : "countdown";
      const minutes = clampMinutes(data.minutes) || 25;
      const durationMs = minutes * 60 * 1000;
      const timer = normalizeTimer({
        mode,
        label: data.label,
        durationMs,
        remainingMs: mode === "stopwatch" ? 0 : durationMs,
        phase: mode === "pomodoro" ? "work" : mode === "stopwatch" ? "stop" : "countdown",
        workMs: durationMs,
      });
      store.timers[tile.id] = timer;
      save();
      return timer;
    }

    function live(timer) {
      return timer.mode === "stopwatch"
        ? timer.startedAt !== null
        : timer.endsAt !== null;
    }

    function remainingOf(timer, now) {
      if (timer.mode === "stopwatch")
        return timer.startedAt ? timer.elapsedMs + (now - timer.startedAt) : timer.elapsedMs;
      return timer.endsAt ? Math.max(0, timer.endsAt - now) : timer.remainingMs;
    }

    function surfaceOf(timer, now) {
      const remaining = remainingOf(timer, now);
      return {
        mode: timer.mode,
        phase: timer.phase,
        remaining: clock(remaining),
        label: timer.label,
        running: String(live(timer)),
      };
    }

    function publish(tileId, timer) {
      try {
        api.tiles.publish(tileId, surfaceOf(timer, Date.now()));
      } catch (error) {
        console.error(error);
      }
    }

    function announce(title, body) {
      if (store.settings.sound) beep();
      notifySystem(title, body);
    }

    /**
     * Notification système par le service du noyau. Un paquet importé n’a pas
     * d’API Tauri : sans service, on retombe sur l’API web si elle existe.
     */
    function notifySystem(title, body) {
      try {
        const service = api.services.get(NOTIFICATIONS);
        if (service && typeof service.send === "function") {
          Promise.resolve(service.send({ title, body })).catch(() => {});
          return;
        }
      } catch (error) {
        console.error(error);
      }
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted")
          new Notification(title, { body, silent: true });
      } catch (error) {
        console.error(error);
      }
    }

    /** Un contexte audio créé hors geste reste suspendu : on l’amorce au départ. */
    function primeAudio() {
      try {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        audio = audio || new Context();
        if (audio.state === "suspended") audio.resume().catch(() => {});
      } catch (error) {
        console.error(error);
      }
    }

    function beep() {
      try {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        audio = audio || new Context();
        if (audio.state === "suspended") audio.resume().catch(() => {});
        const now = audio.currentTime;
        for (const offset of [0, 0.22]) {
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = 660;
          gain.gain.setValueAtTime(0.0001, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
          oscillator.connect(gain).connect(audio.destination);
          oscillator.start(now + offset);
          oscillator.stop(now + offset + 0.2);
        }
      } catch (error) {
        console.error(error);
      }
    }

    function emitFinished(timer, phase) {
      try {
        api.events.emit(FINISHED, {
          label: timer.label,
          mode: timer.mode,
          phase,
        });
      } catch (error) {
        console.error(error);
      }
    }

    function complete(tileId, timer, now) {
      if (timer.mode === "pomodoro") {
        const work = timer.phase !== "break";
        timer.phase = work ? "break" : "work";
        timer.durationMs = work ? WORK_BREAK_MS : timer.workMs;
        timer.remainingMs = timer.durationMs;
        timer.endsAt = now + timer.durationMs;
        if (!work) timer.cycle += 1;
        announce(
          work ? "Pause" : "Reprise",
          `${timer.label || "Pomodoro"} · ${Math.round(timer.durationMs / 60000)} min`,
        );
        emitFinished(timer, timer.phase);
        publish(tileId, timer);
        return;
      }
      timer.running = false;
      timer.endsAt = null;
      timer.remainingMs = 0;
      timer.phase = "done";
      announce("Terminé", timer.label || "Minuteur");
      emitFinished(timer, "done");
      publish(tileId, timer);
    }

    function tick() {
      if (!store) return;
      const now = Date.now();
      let painted = false;
      let touched = false;
      for (const [tileId, timer] of Object.entries(store.timers)) {
        if (!live(timer)) continue;
        const remaining = remainingOf(timer, now);
        if (timer.mode !== "stopwatch" && remaining <= 0) {
          complete(tileId, timer, now);
          touched = true;
          painted = true;
          continue;
        }
        const second = Math.ceil(remaining / 1000);
        if (shown.get(tileId) !== second) {
          shown.set(tileId, second);
          publish(tileId, timer);
          painted = true;
        }
      }
      if (touched) save();
      if (painted) notifyTimers();
    }

    function startTicker() {
      if (ticker) return;
      ticker = setInterval(tick, 250);
    }

    function stopTicker() {
      clearInterval(ticker);
      ticker = undefined;
      shown.clear();
    }

    function requestPermission() {
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default")
          Notification.requestPermission().catch(() => {});
      } catch (error) {
        console.error(error);
      }
    }

    // --------------------------------------------------------------- actions

    function touch(tileId) {
      save();
      notifyTimers(tileId);
      notifyStore();
    }

    function timerAction(tileId) {
      const tile = api.tabs.getAllTiles().find((candidate) => candidate.id === tileId);
      if (!tile) throw new Error("Tuile inconnue.");
      return { tile, timer: ensureTimer(tile) };
    }

    function startTimer(tileId, input) {
      const { tile, timer } = timerAction(tileId);
      const minutes =
        clampMinutes(input.minutes) ||
        Math.max(1, Math.round((timer.durationMs || timer.workMs || 1500000) / 60000));
      const mode =
        input.mode === "pomodoro" || input.mode === "stopwatch"
          ? input.mode
          : timer.mode;
      const now = Date.now();
      const ms = minutes * 60 * 1000;
      timer.mode = mode;
      if (typeof input.label === "string") timer.label = input.label.slice(0, 80);
      if (mode === "stopwatch") {
        timer.startedAt = now;
        timer.elapsedMs = 0;
        timer.phase = "stop";
        timer.endsAt = null;
      } else {
        timer.workMs = ms;
        timer.durationMs = ms;
        timer.remainingMs = ms;
        timer.endsAt = now + ms;
        timer.running = true;
        timer.phase = mode === "pomodoro" ? "work" : "countdown";
        timer.cycle = 0;
      }
      requestPermission();
      primeAudio();
      touch(tile.id);
      publish(tile.id, timer);
      return { endsAt: timer.endsAt, remaining: clock(remainingOf(timer, now)) };
    }

    function pauseTimer(tileId) {
      const { tile, timer } = timerAction(tileId);
      const now = Date.now();
      if (timer.mode === "stopwatch") {
        timer.elapsedMs = remainingOf(timer, now);
        timer.startedAt = null;
      } else if (timer.endsAt) {
        timer.remainingMs = Math.max(0, timer.endsAt - now);
        timer.endsAt = null;
        timer.running = false;
      }
      touch(tile.id);
      publish(tile.id, timer);
      return { remaining: clock(remainingOf(timer, now)) };
    }

    function resumeTimer(tileId) {
      const { tile, timer } = timerAction(tileId);
      const now = Date.now();
      if (timer.mode === "stopwatch") {
        timer.startedAt = now;
      } else {
        if (timer.phase === "done" || timer.remainingMs <= 0) {
          timer.remainingMs = timer.durationMs || timer.workMs;
          timer.phase = timer.mode === "pomodoro" ? "work" : "countdown";
        }
        timer.endsAt = now + timer.remainingMs;
        timer.running = true;
      }
      touch(tile.id);
      publish(tile.id, timer);
      return { endsAt: timer.endsAt, remaining: clock(remainingOf(timer, now)) };
    }

    function resetTimer(tileId) {
      const { tile, timer } = timerAction(tileId);
      timer.endsAt = null;
      timer.startedAt = null;
      timer.running = false;
      timer.elapsedMs = 0;
      timer.cycle = 0;
      timer.remainingMs =
        timer.mode === "stopwatch" ? 0 : timer.durationMs || timer.workMs;
      timer.phase =
        timer.mode === "pomodoro"
          ? "work"
          : timer.mode === "stopwatch"
            ? "stop"
            : "countdown";
      touch(tile.id);
      publish(tile.id, timer);
      return { remaining: clock(timer.remainingMs) };
    }

    /** Durée saisie au clavier : règle le minuteur et le remet au repos. */
    function setDuration(tileId, ms) {
      const { tile, timer } = timerAction(tileId);
      timer.durationMs = ms;
      if (timer.mode === "pomodoro") timer.workMs = ms;
      timer.remainingMs = ms;
      timer.endsAt = null;
      timer.startedAt = null;
      timer.running = false;
      timer.phase = timer.mode === "pomodoro" ? "work" : "countdown";
      touch(tile.id);
      publish(tile.id, timer);
      return { minutes: Math.round(ms / 60000), remaining: clock(ms) };
    }

    function statusTimer(tileId) {      const { timer } = timerAction(tileId);
      const now = Date.now();
      return {
        mode: timer.mode,
        phase: timer.phase,
        remaining: clock(remainingOf(timer, now)),
        running: live(timer),
        label: timer.label,
      };
    }

    function openTasks() {
      return api.tabs.openTile(TASKS);
    }

    function sortedTasks(list) {
      return [...list].sort((first, second) => {
        if (first.due && second.due && first.due !== second.due)
          return first.due < second.due ? -1 : 1;
        if (first.due && !second.due) return -1;
        if (!first.due && second.due) return 1;
        return first.createdAt - second.createdAt;
      });
    }

    function findTask(id) {
      const task = store.tasks.find((candidate) => candidate.id === id);
      if (!task) throw new Error(`Tâche inconnue : ${id}`);
      return task;
    }

    function addTask(input) {
      if (store.tasks.length >= MAX_TASKS)
        throw new Error(`La liste est pleine (${MAX_TASKS} tâches).`);
      const raw = String(input.title || "").replace(/\s+/g, " ").trim();
      if (!raw) throw new Error("title est requis.");
      const parsed = parseDue(raw);
      const due = resolveDue(input.due) || parsed.due;
      const title = (parsed.title || raw).slice(0, MAX_TITLE);
      const task = {
        id: crypto.randomUUID(),
        title,
        due,
        priority:
          input.priority === "high" || input.priority === "low"
            ? input.priority
            : "normal",
        done: false,
        createdAt: Date.now(),
        doneAt: null,
      };
      store.tasks.push(task);
      save();
      notifyStore();
      return { id: task.id, due: task.due };
    }

    function listTasks(input) {
      const view = input.view || "open";
      const limit = Math.min(50, Math.max(1, Math.round(Number(input.limit) || 20)));
      const today = todayISO();
      const open = store.tasks.filter((task) => !task.done);
      const pool =
        view === "all"
          ? store.tasks
          : view === "today"
            ? open.filter((task) => task.due === today)
            : view === "overdue"
              ? open.filter((task) => task.due && task.due < today)
              : open;
      return sortedTasks(pool)
        .slice(0, limit)
        .map((task) => ({ id: task.id, title: task.title, due: task.due }));
    }

    function completeTask(input) {
      const task = findTask(input.id);
      if (!task.done) {
        task.done = true;
        task.doneAt = Date.now();
        save();
        notifyStore();
      }
      return { id: task.id, open: store.tasks.filter((item) => !item.done).length };
    }

    function reopenTask(input) {
      const task = findTask(input.id);
      if (task.done) {
        task.done = false;
        task.doneAt = null;
        save();
        notifyStore();
      }
      return { id: task.id };
    }

    function removeTask(id) {
      store.tasks = store.tasks.filter((task) => task.id !== id);
      save();
      notifyStore();
    }

    // ------------------------------------------------------------------ vues

    function Glyph(children) {
      return function Icon({ size = 16, strokeWidth = 1.7, ...rest }) {
        return h(
          "svg",
          {
            width: size,
            height: size,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": true,
            ...rest,
          },
          children,
        );
      };
    }

    const ClockIcon = Glyph([
      h("circle", { key: "c", cx: 12, cy: 12, r: 9 }),
      h("path", { key: "h", d: "M12 7v5l3 2" }),
    ]);
    const TasksIcon = Glyph([
      h("path", { key: "a", d: "m3 17 2 2 4-4" }),
      h("path", { key: "b", d: "m3 7 2 2 4-4" }),
      h("path", { key: "c", d: "M13 6h8" }),
      h("path", { key: "d", d: "M13 12h8" }),
      h("path", { key: "e", d: "M13 18h8" }),
    ]);
    const CheckIcon = Glyph([h("path", { key: "c", d: "M20 6 9 17l-5-5" })]);
    const PlayIcon = Glyph([h("path", { key: "p", d: "M7 4l13 8-13 8z" })]);
    const PauseIcon = Glyph([
      h("path", { key: "a", d: "M9 4v16" }),
      h("path", { key: "b", d: "M15 4v16" }),
    ]);
    const ResetIcon = Glyph([
      h("path", { key: "a", d: "M3 12a9 9 0 1 0 3-6.7L3 8" }),
      h("path", { key: "b", d: "M3 3v5h5" }),
    ]);
    const CloseIcon = Glyph([
      h("path", { key: "a", d: "M18 6 6 18" }),
      h("path", { key: "b", d: "m6 6 12 12" }),
    ]);

    function useStore() {
      const [, bump] = useReducer((value) => value + 1, 0);
      useEffect(() => {
        storeListeners.add(bump);
        return () => storeListeners.delete(bump);
      }, []);
      return store;
    }

    function useTimerTick(tileId) {
      const [, bump] = useReducer((value) => value + 1, 0);
      useEffect(() => {
        const group = timerListeners.get(tileId) || new Set();
        timerListeners.set(tileId, group);
        group.add(bump);
        return () => {
          group.delete(bump);
          if (!group.size && timerListeners.get(tileId) === group)
            timerListeners.delete(tileId);
        };
      }, [tileId]);
    }

    function TimerTile({ tile }) {
      useTimerTick(tile.id);
      useEffect(() => {
        if (store.timers[tile.id]) return;
        ensureTimer(tile);
        notifyTimers(tile.id);
      }, [tile.id]);
      const timer = store.timers[tile.id];
      return timer ? h(TimerBody, { tile, timer }) : null;
    }

    function TimerBody({ tile, timer }) {
      const now = Date.now();
      const remaining = remainingOf(timer, now);
      const running = live(timer);
      const label = useLabel(tile.id, timer);
      const [, spin] = useReducer((value) => value + 1, 0);
      const [editing, setEditing] = React.useState(false);
      const [draft, setDraft] = React.useState("");
      const settled = useRef(false);

      // Le chronomètre rafraîchit son affichage à ~32 images par seconde pour
      // rendre les millisecondes lisibles ; la surface reste publiée à la
      // seconde, un agent n’a pas besoin de cette précision.
      useEffect(() => {
        if (timer.mode !== "stopwatch" || !running) return undefined;
        let frame;
        let last = 0;
        const loop = (time) => {
          if (time - last >= 31) {
            last = time;
            spin();
          }
          frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
      }, [timer.mode, running, spin]);

      const beginEdit = () => {
        if (timer.mode === "stopwatch") return;
        settled.current = false;
        setDraft(durationText(timer.durationMs || timer.workMs));
        setEditing(true);
      };
      const commit = () => {
        if (settled.current) return;
        settled.current = true;
        const ms = parseDuration(draft);
        if (ms) setDuration(tile.id, ms);
        setEditing(false);
      };

      const ratio =
        timer.mode === "stopwatch"
          ? 0
          : timer.durationMs > 0
            ? Math.max(0, Math.min(1, remaining / timer.durationMs))
            : 0;

      return h(
        "div",
        { className: "sparklab-day sparklab-day-timer" },
        h(
          "div",
          { className: "sparklab-day-bar" },
          h(
            "div",
            { className: "sparklab-day-modes", role: "group", "aria-label": "Mode" },
            ...MODES.map((mode) =>
              h(
                "button",
                {
                  key: mode.id,
                  type: "button",
                  className: "sparklab-day-mode",
                  "aria-pressed": timer.mode === mode.id,
                  title: mode.title,
                  onClick: () => switchMode(tile.id, mode.id),
                },
                mode.label,
              ),
            ),
          ),
          h("input", {
            className: "sparklab-day-label",
            value: label.value,
            placeholder: "Libellé",
            "aria-label": "Libellé du minuteur",
            maxLength: 80,
            onChange: (event) => label.change(event.target.value),
            onBlur: label.commit,
            onKeyDown: (event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            },
          }),
        ),
        h(
          "div",
          { className: "sparklab-day-face" },
          timer.mode === "pomodoro"
            ? h(
                "span",
                { className: "sparklab-day-phase" },
                timer.phase === "break" ? "Pause" : "Travail",
              )
            : null,
          editing
            ? h("input", {
                className: "sparklab-day-time sparklab-day-time-input",
                value: draft,
                autoFocus: true,
                inputMode: "numeric",
                "aria-label": "Durée en minutes, ou minutes:secondes",
                onChange: (event) => setDraft(event.target.value),
                onBlur: commit,
                onKeyDown: (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commit();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    settled.current = true;
                    setEditing(false);
                  }
                },
              })
            : timer.mode === "stopwatch"
              ? h(
                  "span",
                  { className: "sparklab-day-time precise" },
                  clockPrecise(remaining),
                )
              : h(
                  "button",
                  {
                    type: "button",
                    className: "sparklab-day-time",
                    title: "Saisir la durée",
                    onClick: beginEdit,
                  },
                  clock(remaining),
                ),
          timer.mode === "stopwatch" ? null : h(
            "span",
            { className: "sparklab-day-scale", "aria-hidden": true },
            h("i", { style: { width: `${Math.round(ratio * 100)}%` } }),
          ),
          h(
            "span",
            { className: "sparklab-day-hint" },
            timer.mode === "stopwatch"
              ? "Chronomètre"
              : timer.phase === "done"
                ? "Terminé"
                : running
                  ? `sur ${durationText(timer.durationMs)}`
                  : "en pause",
          ),
        ),
        h(
          "div",
          { className: "sparklab-day-foot" },
          timer.mode === "stopwatch" || running || timer.phase === "done"
            ? null
            : h(
                "div",
                { className: "sparklab-day-presets" },
                ...[5, 15, 25, 45].map((minutes) =>
                  h(
                    "button",
                    {
                      key: minutes,
                      type: "button",
                      className: "sparklab-day-preset",
                      onClick: () => startFromView(tile.id, minutes),
                    },
                    `${minutes} min`,
                  ),
                ),
              ),
          h(
            "button",
            {
              type: "button",
              className: "sparklab-day-button sparklab-day-primary",
              onClick: () => toggle(tile.id, timer, running),
            },
            running
              ? h(PauseIcon, { size: 14 })
              : h(PlayIcon, { size: 14 }),
            running ? "Pause" : timer.phase === "done" ? "Relancer" : "Démarrer",
          ),
          h(
            "button",
            {
              type: "button",
              className: "sparklab-day-button sparklab-day-ghost",
              title: "Réinitialiser",
              onClick: () => resetTimer(tile.id),
            },
            h(ResetIcon, { size: 14 }),
            "Réinitialiser",
          ),
        ),
      );
    }

    const MODES = [
      { id: "countdown", label: "Minuteur", title: "Compte à rebours" },
      { id: "pomodoro", label: "Pomodoro", title: "Travail puis pause" },
      { id: "stopwatch", label: "Chrono", title: "Chronomètre" },
    ];

    function switchMode(tileId, mode) {
      const { timer } = timerAction(tileId);
      if (timer.mode === mode) return;
      timer.mode = mode;
      timer.endsAt = null;
      timer.startedAt = null;
      timer.elapsedMs = 0;
      timer.running = false;
      timer.cycle = 0;
      timer.phase =
        mode === "pomodoro" ? "work" : mode === "stopwatch" ? "stop" : "countdown";
      if (mode !== "stopwatch" && !timer.durationMs) timer.durationMs = 25 * 60 * 1000;
      timer.remainingMs = mode === "stopwatch" ? 0 : timer.durationMs;
      touch(tileId);
    }

    function toggle(tileId, timer, running) {
      if (running) {
        pauseTimer(tileId);
        return;
      }
      if (timer.mode === "stopwatch") {
        const now = Date.now();
        timer.startedAt = now;
        touch(tileId);
        return;
      }
      if (timer.phase === "done" || timer.remainingMs <= 0) {
        const minutes = Math.max(
          1,
          Math.round((timer.durationMs || timer.workMs || 25 * 60 * 1000) / 60000),
        );
        startTimer(tileId, { minutes });
        return;
      }
      resumeTimer(tileId);
    }

    function startFromView(tileId, minutes) {
      startTimer(tileId, { minutes });
    }

    /** Libellé éditable, écrit dans l’état avec un délai de garde. */
    function useLabel(tileId, timer) {
      const [value, setValue] = React.useState(timer.label);
      const current = useRef(timer.label);
      useEffect(() => {
        if (timer.label !== current.current) {
          current.current = timer.label;
          setValue(timer.label);
        }
      }, [timer.label]);
      return {
        value,
        change: (next) => {
          setValue(next);
          current.current = next;
          timer.label = next;
          scheduleSave();
        },
        commit: () => {
          save();
          publish(tileId, timer);
        },
      };
    }

    function TasksTile() {
      const state = useStore();
      const [text, setText] = React.useState("");
      const input = useRef(null);
      const today = todayISO();
      const open = state.tasks.filter((task) => !task.done);
      const done = state.tasks.filter((task) => task.done);
      const late = open.filter((task) => task.due && task.due < today);
      const dueToday = open.filter((task) => task.due === today);
      const later = open.filter((task) => !task.due || task.due > today);

      const submit = (event) => {
        event.preventDefault();
        const title = text.trim();
        if (!title) return;
        addTask({ title });
        setText("");
        input.current?.focus();
      };

      const group = (name, list) =>
        list.length
          ? h(
              "section",
              { className: "sparklab-day-group", key: name },
              h(
                "h3",
                null,
                name,
                h("span", { className: "sparklab-day-count" }, String(list.length)),
              ),
              ...sortedTasks(list).map((task) => row(task)),
            )
          : null;

      const row = (task) =>
        h(
          "div",
          {
            key: task.id,
            className: "sparklab-day-row",
            "data-done": String(task.done),
            "data-priority": task.priority,
          },
          h(
            "button",
            {
              type: "button",
              role: "checkbox",
              "aria-checked": String(task.done),
              "aria-label": task.done ? "Rouvrir la tâche" : "Terminer la tâche",
              className: "sparklab-day-check",
              onClick: () =>
                task.done ? reopenTask({ id: task.id }) : completeTask({ id: task.id }),
            },
            task.done ? h(CheckIcon, { size: 11, strokeWidth: 2.4 }) : null,
          ),
          h("span", { className: "sparklab-day-title", title: task.title }, task.title),
          task.priority === "high" && !task.done
            ? h("span", { className: "sparklab-day-dot", title: "Priorité haute" })
            : null,
          task.due
            ? h(
                "span",
                {
                  className: "sparklab-day-due",
                  "data-late": String(!task.done && task.due < today),
                },
                formatDue(task.due),
              )
            : null,
          h(
            "button",
            {
              type: "button",
              className: "sparklab-day-remove",
              title: "Supprimer",
              "aria-label": "Supprimer la tâche",
              onClick: () => removeTask(task.id),
            },
            h(CloseIcon, { size: 12 }),
          ),
        );

      const groups = [
        group("En retard", late),
        group("Aujourd’hui", dueToday),
        group("À venir", later),
        group("Faites", done.slice(-12).reverse()),
      ].filter(Boolean);

      return h(
        "div",
        { className: "sparklab-day sparklab-day-tasks" },
        h(
          "form",
          { className: "sparklab-day-capture", onSubmit: submit },
          h("input", {
            ref: input,
            value: text,
            placeholder: "Ajouter une tâche… (demain, vendredi, 12/03)",
            "aria-label": "Nouvelle tâche",
            maxLength: MAX_TITLE,
            onChange: (event) => setText(event.target.value),
          }),
          h(
            "button",
            { type: "submit", className: "sparklab-day-add", disabled: !text.trim() },
            "Ajouter",
          ),
        ),
        groups.length
          ? h("div", { className: "sparklab-day-list" }, ...groups)
          : h(
              "p",
              { className: "sparklab-day-empty" },
              "Aucune tâche. Écrivez une ligne, puis Entrée.",
            ),
      );
    }

    function describeTimer(tile, surface) {
      if (surface && surface.remaining)
        return `${surface.label || "Minuteur"} · ${surface.remaining}`;
      const timer = store?.timers?.[tile.id];
      if (!timer) return "minuteur";
      const remaining = remainingOf(timer, Date.now());
      return `${timer.label || "Minuteur"} · ${clock(remaining)}`;
    }

    function describeTasks() {
      const open = store ? store.tasks.filter((task) => !task.done).length : 0;
      const late = store
        ? store.tasks.filter((task) => !task.done && task.due && task.due < todayISO()).length
        : 0;
      return late ? `${open} ouvertes · ${late} en retard` : `${open} ouvertes`;
    }

    // --------------------------------------------------------------- cycle

    return {
      activate(next) {
        api = next;
        const raw = api.state.read();
        store = normalize(raw);
        if (!raw) save();

        // Purge des tâches faites depuis longtemps, une fois à l’activation.
        const cutoff = Date.now() - DONE_KEEP_DAYS * DAY;
        const before = store.tasks.length;
        store.tasks = store.tasks.filter(
          (task) => !task.done || !task.doneAt || task.doneAt > cutoff,
        );
        if (store.tasks.length !== before) save();

        // Un minuteur dont l’échéance est passée pendant l’arrêt est clos
        // sans notification rétroactive.
        for (const timer of Object.values(store.timers)) {
          if (timer.endsAt && timer.endsAt <= Date.now()) {
            timer.endsAt = null;
            timer.running = false;
            timer.remainingMs = 0;
            timer.phase = "done";
          }
        }

        startTicker();

        api.tiles.register({
          type: TIMER,
          title: "Minuteur",
          icon: ClockIcon,
          view: TimerTile,
          dataKeys: ["mode", "minutes", "label"],
          guide:
            "Le restant se calcule depuis l’échéance : `status` est la seule vérité, ne jamais attendre dans une action. `start` accepte `minutes` (1–180, 25 par défaut) et remplace le minuteur en cours ; `pause`, `resume` et `reset` agissent sur celui de la tuile. En pomodoro, `minutes` règle le travail et la pause dure 5 min. La fin d’une phase émet sparklab.day.timer.finished.",
          describe: describeTimer,
          prepare(data) {
            const mode =
              data.mode === "pomodoro" || data.mode === "stopwatch"
                ? data.mode
                : "countdown";
            const minutes = clampMinutes(data.minutes) || 25;
            return { mode, minutes: String(minutes), label: data.label || "" };
          },
          actions: {
            start: {
              title: "Démarrer",
              description: "Démarre un compte à rebours, un pomodoro ou un chrono.",
              input: {
                minutes: {
                  type: "number",
                  required: false,
                  description: "Durée en minutes, 1 à 180. 25 par défaut.",
                },
                label: { type: "string", required: false },
                mode: {
                  type: "string",
                  required: false,
                  enum: ["countdown", "pomodoro", "stopwatch"],
                },
              },
              mutates: true,
              run: (tile, input) => startTimer(tile.id, input),
            },
            pause: {
              title: "Mettre en pause",
              mutates: true,
              run: (tile) => pauseTimer(tile.id),
            },
            resume: {
              title: "Reprendre",
              mutates: true,
              run: (tile) => resumeTimer(tile.id),
            },
            reset: {
              title: "Réinitialiser",
              mutates: true,
              run: (tile) => resetTimer(tile.id),
            },
            status: {
              title: "État",
              description: "Renvoie le restant et la phase en cours.",
              mutates: false,
              run: (tile) => statusTimer(tile.id),
            },
          },
          close(tile) {
            delete store.timers[tile.id];
            shown.delete(tile.id);
            save();
          },
        });

        api.tiles.register({
          type: TASKS,
          title: "Tâches",
          icon: TasksIcon,
          view: TasksTile,
          dataKeys: [],
          guide:
            "Liste partagée par toutes les tuiles Tâches. `add` renvoie un `id` ; si `due` est absent, l’échéance est lue en français dans `title` (demain, vendredi, dans 3 jours, 12/03). `list` ne renvoie que des titres, plafonné à 50. `complete` et `reopen` sont idempotents. Une tâche faite depuis plus de 30 jours est purgée à l’activation.",
          describe: describeTasks,
          actions: {
            add: {
              title: "Ajouter une tâche",
              input: {
                title: { type: "string", description: "Titre, échéance incluse si besoin." },
                due: { type: "string", required: false },
                priority: {
                  type: "string",
                  required: false,
                  enum: ["low", "normal", "high"],
                },
              },
              mutates: true,
              run: (_tile, input) => addTask(input),
            },
            list: {
              title: "Lister",
              input: {
                view: {
                  type: "string",
                  required: false,
                  enum: ["open", "today", "overdue", "all"],
                },
                limit: { type: "number", required: false },
              },
              mutates: false,
              run: (_tile, input) => listTasks(input),
            },
            complete: {
              title: "Terminer une tâche",
              input: { id: { type: "string" } },
              mutates: true,
              run: (_tile, input) => completeTask(input),
            },
            reopen: {
              title: "Rouvrir une tâche",
              input: { id: { type: "string" } },
              mutates: true,
              run: (_tile, input) => reopenTask(input),
            },
          },
        });

        api.commands.register({
          id: ID + ".timer.open",
          title: "Ouvrir le minuteur",
          tileType: TIMER,
          run: () => api.tabs.openTile(TIMER),
        });
        api.commands.register({
          id: ID + ".tasks.open",
          title: "Ouvrir les tâches",
          tileType: TASKS,
          run: openTasks,
        });
      },
      deactivate() {
        stopTicker();
        save();
        storeListeners.clear();
        timerListeners.clear();
        if (audio) {
          audio.close().catch(() => {});
          audio = null;
        }
        api = null;
        store = null;
      },
    };
  };
})();
