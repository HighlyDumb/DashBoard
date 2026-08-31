const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Separate client for Study Suite's own Supabase project. Deck only ever
// reads app_data here (never writes) - see the Study panel below. Given its
// own storageKey so its session never collides with Deck's own login above.
const studyDb = createClient(STUDY_SUPABASE_URL, STUDY_SUPABASE_ANON_KEY, {
  auth: { storageKey: "deck-study-auth", persistSession: true, autoRefreshToken: true },
});

const authScreen = document.getElementById("auth-screen");
const app = document.getElementById("app");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const signinBtn = document.getElementById("signin-btn");
const signupBtn = document.getElementById("signup-btn");
const signoutBtn = document.getElementById("signout-btn");

function showError(message) {
  authError.textContent = message;
  authError.hidden = false;
}

function clearError() {
  authError.hidden = true;
  authError.textContent = "";
}

async function handleSignIn(email, password) {
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function handleSignUp(email, password) {
  const { error } = await db.auth.signUp({ email, password });
  if (error) throw error;
  showError("Account created. Check your email if confirmation is required, then sign in.");
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  signinBtn.disabled = true;
  try {
    await handleSignIn(emailInput.value.trim(), passwordInput.value);
  } catch (err) {
    showError(err.message || "Sign in failed.");
  } finally {
    signinBtn.disabled = false;
  }
});

signupBtn.addEventListener("click", async () => {
  clearError();
  if (!emailInput.value || !passwordInput.value) {
    showError("Enter an email and password first.");
    return;
  }
  try {
    await handleSignUp(emailInput.value.trim(), passwordInput.value);
  } catch (err) {
    showError(err.message || "Sign up failed.");
  }
});

signoutBtn.addEventListener("click", async () => {
  await db.auth.signOut();
});

const VALID_VIEWS = ["home", "todo", "notes", "habits", "watchlist", "study"];

function showApp() {
  authScreen.hidden = true;
  app.hidden = false;
  startClock();
  let lastView = null;
  try {
    lastView = localStorage.getItem("deck-last-view");
  } catch (e) {}
  navigateTo(VALID_VIEWS.includes(lastView) ? lastView : "home");
}

function showAuth() {
  app.hidden = true;
  authScreen.hidden = false;
  stopClock();
}

db.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showApp();
  } else {
    showAuth();
  }
});

// ---------- Status strip: greeting, clock, day progress ----------

let clockInterval = null;

function greetingForHour(hour) {
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

function tick() {
  const now = new Date();

  document.getElementById("greeting").textContent = greetingForHour(now.getHours());
  document.getElementById("date-text").textContent = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  document.getElementById("clock").textContent = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  const secondsIntoDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const pctOfDay = (secondsIntoDay / 86400) * 100;
  document.getElementById("day-progress").style.width = `${pctOfDay}%`;
}

function startClock() {
  tick();
  clockInterval = setInterval(tick, 1000 * 15);
}

function stopClock() {
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = null;
}

// ---------- Router: sidebar + home cards swap which page is visible ----------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function navigateTo(view) {
  if (!VALID_VIEWS.includes(view)) return;

  document.querySelectorAll(".page").forEach((el) => {
    el.hidden = el.dataset.view !== view;
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view);
  });

  try {
    localStorage.setItem("deck-last-view", view);
  } catch (e) {}

  if (view === "todo") loadTodos();
  if (view === "study") loadStudyStats();
}

document.querySelectorAll(".nav-item[data-view]:not([disabled])").forEach((btn) => {
  btn.addEventListener("click", () => navigateTo(btn.dataset.view));
});

document.querySelectorAll(".home-card[data-view]:not([disabled])").forEach((btn) => {
  btn.addEventListener("click", () => navigateTo(btn.dataset.view));
});

// ---------- Study panel: read-only stats from Study Suite's Supabase ----------

const studyBody = document.getElementById("study-panel-body");
const studyRefreshBtn = document.getElementById("study-refresh-btn");

function studyTodayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDurationLong(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0 && m === 0) return `${s}s`;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Ported from Study Suite: minutes/seconds logged today across the
// standalone timer, per-subject general time, per-chapter time, and any
// completed Pomodoro focus blocks.
function hoursLoggedToday(clockData, pomoData) {
  const today = studyTodayStr();
  let total = 0;
  if (clockData) {
    if (clockData.unsortedTimeLog && clockData.unsortedTimeLog[today]) total += clockData.unsortedTimeLog[today];
    Object.values(clockData.subjects || {}).forEach((subj) => {
      if (subj.generalTimeLog && subj.generalTimeLog[today]) total += subj.generalTimeLog[today];
      (subj.chapters || []).forEach((ch) => {
        if (ch.timeLog && ch.timeLog[today]) total += ch.timeLog[today];
      });
    });
  }
  if (pomoData && pomoData.focusLog && pomoData.focusLog[today]) total += pomoData.focusLog[today];
  return total;
}

// Ported from Study Suite's home dashboard: consecutive days (counting
// back from today) where every daily goal that existed that day was
// checked off.
function goalsPerfectStreak(goalsData) {
  if (!goalsData || !goalsData.goals) return 0;
  const goals = Object.values(goalsData.goals);
  if (!goals.length) return 0;

  function dayCompletion(dateStr) {
    const applicable = goals.filter((g) => g.createdAt <= dateStr);
    const total = applicable.length;
    const done = applicable.filter((g) => g.log && g.log[dateStr]).length;
    return { done, total };
  }
  function isPerfect(dateStr) {
    const { done, total } = dayCompletion(dateStr);
    if (total === 0) return null;
    return done === total;
  }

  let d = new Date();
  d.setHours(0, 0, 0, 0);
  const toDateStr = (dt) => {
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };
  if (isPerfect(toDateStr(d)) !== true) d.setDate(d.getDate() - 1);
  let count = 0;
  while (true) {
    const key = toDateStr(d);
    if (isPerfect(key) === true) {
      count++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return count;
}

function studyConnectFormHtml(errorMessage) {
  return `
    <p class="panel-empty">Connect your Study Suite account to see live stats here.</p>
    <form id="study-connect-form" class="study-connect-form">
      <input type="email" id="study-email" placeholder="Study Suite email" autocomplete="username" required />
      <input type="password" id="study-password" placeholder="Study Suite password" autocomplete="current-password" required />
      ${errorMessage ? `<div class="study-error" role="alert">${errorMessage}</div>` : ""}
      <button type="submit" class="btn-primary btn-small" id="study-connect-btn">Connect</button>
    </form>
  `;
}

function renderStudyConnectForm(errorMessage) {
  studyRefreshBtn.hidden = true;
  studyBody.innerHTML = studyConnectFormHtml(errorMessage);
  document.getElementById("study-connect-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("study-email").value.trim();
    const password = document.getElementById("study-password").value;
    const btn = document.getElementById("study-connect-btn");
    btn.disabled = true;
    try {
      const { error } = await studyDb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await loadStudyStats();
    } catch (err) {
      renderStudyConnectForm(err.message || "Could not connect.");
    }
  });
}

function renderStudyStats(stats) {
  studyRefreshBtn.hidden = false;
  const goalsLabel = stats.totalGoals === 0 ? "No goals set" : "Daily goals left";
  const goalsValue = stats.totalGoals === 0 ? "—" : `${stats.goalsLeft} left`;

  studyBody.innerHTML = `
    <div class="study-stats">
      <div class="study-stat">
        <span class="study-stat-num">${formatDurationLong(stats.secondsToday)}</span>
        <span class="study-stat-label">Studied today</span>
      </div>
      <div class="study-stat">
        <span class="study-stat-num">${stats.streak}</span>
        <span class="study-stat-label">Perfect-day streak</span>
      </div>
      <div class="study-stat">
        <span class="study-stat-num">${goalsValue}</span>
        <span class="study-stat-label">${goalsLabel}</span>
      </div>
      <div class="study-stat">
        <span class="study-stat-num">${stats.pomodorosToday}</span>
        <span class="study-stat-label">Pomodoros today</span>
      </div>
    </div>
    <div class="study-panel-footer">
      <button class="btn-ghost btn-tiny" id="study-disconnect-btn">Disconnect</button>
    </div>
  `;
  document.getElementById("study-disconnect-btn").addEventListener("click", async () => {
    await studyDb.auth.signOut();
    renderStudyConnectForm();
  });
}

async function fetchStudyAppData(uid, appName) {
  const { data: row, error } = await studyDb
    .from("app_data")
    .select("data")
    .eq("user_id", uid)
    .eq("app_name", appName)
    .maybeSingle();
  if (error) throw error;
  return row ? row.data : null;
}

async function loadStudyStats() {
  const {
    data: { session },
  } = await studyDb.auth.getSession();
  if (!session) {
    renderStudyConnectForm();
    return;
  }

  studyBody.innerHTML = `<p class="panel-empty">Loading…</p>`;
  try {
    const uid = session.user.id;
    const [clockData, goalsData, pomoData] = await Promise.all([
      fetchStudyAppData(uid, "clock"),
      fetchStudyAppData(uid, "goals"),
      fetchStudyAppData(uid, "pomo"),
    ]);

    const today = studyTodayStr();
    const goals = goalsData && goalsData.goals ? Object.values(goalsData.goals) : [];
    const doneToday = goals.filter((g) => g.log && g.log[today]).length;

    renderStudyStats({
      secondsToday: hoursLoggedToday(clockData, pomoData),
      streak: goalsPerfectStreak(goalsData),
      totalGoals: goals.length,
      goalsLeft: goals.length - doneToday,
      pomodorosToday: (pomoData && pomoData.sessionCountLog && pomoData.sessionCountLog[today]) || 0,
    });
  } catch (err) {
    console.error("Study stats load failed", err);
    studyBody.innerHTML = `<p class="panel-empty">Couldn't load study stats. <button class="btn-ghost btn-tiny" id="study-retry-btn">Retry</button></p>`;
    const retryBtn = document.getElementById("study-retry-btn");
    if (retryBtn) retryBtn.addEventListener("click", loadStudyStats);
  }
}

studyRefreshBtn.addEventListener("click", loadStudyStats);

// ---------- To-do page ----------

let todos = [];
let todosLoaded = false;
let todosChannel = null;

const todoForm = document.getElementById("todo-form");
const todoInput = document.getElementById("todo-input");
const todoListEl = document.getElementById("todo-list");
const todoEmptyEl = document.getElementById("todo-empty");

function renderTodos() {
  if (!todos.length) {
    todoListEl.innerHTML = "";
    todoEmptyEl.hidden = false;
    return;
  }
  todoEmptyEl.hidden = true;

  const sorted = [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  todoListEl.innerHTML = sorted
    .map(
      (t) => `
    <li class="todo-item${t.done ? " todo-item--done" : ""}" data-id="${t.id}">
      <button class="todo-check" aria-label="${t.done ? "Mark as not done" : "Mark as done"}">
        ${t.done ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : ""}
      </button>
      <span class="todo-title">${escapeHtml(t.title)}</span>
      <button class="todo-delete" aria-label="Delete to-do">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </li>`
    )
    .join("");
}

async function getCurrentUserId() {
  const {
    data: { session },
  } = await db.auth.getSession();
  return session ? session.user.id : null;
}

async function loadTodos() {
  if (!todosLoaded) {
    todoListEl.innerHTML = "";
    todoEmptyEl.hidden = true;
    todoEmptyEl.textContent = "Loading…";
    todoEmptyEl.hidden = false;
  }
  const { data, error } = await db.from("todos").select("*").order("created_at", { ascending: true });
  if (error) {
    console.error("Could not load to-dos", error);
    todoEmptyEl.textContent = "Couldn't load your to-dos.";
    todoEmptyEl.hidden = false;
    return;
  }
  todos = data || [];
  todosLoaded = true;
  todoEmptyEl.textContent = "Nothing on your list yet.";
  renderTodos();
  subscribeTodos();
}

function subscribeTodos() {
  if (todosChannel) return;
  todosChannel = db
    .channel("deck-todos-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, () => {
      loadTodos();
    })
    .subscribe();
}

todoForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = todoInput.value.trim();
  if (!title) return;
  todoInput.value = "";

  const userId = await getCurrentUserId();
  if (!userId) return;

  const { data: row, error } = await db.from("todos").insert({ user_id: userId, title }).select().single();
  if (error) {
    console.error("Could not add to-do", error);
    return;
  }
  todos.push(row);
  renderTodos();
});

todoListEl.addEventListener("click", async (e) => {
  const item = e.target.closest(".todo-item");
  if (!item) return;
  const id = item.dataset.id;
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  if (e.target.closest(".todo-check")) {
    const newDone = !todo.done;
    todo.done = newDone;
    renderTodos();
    const { error } = await db.from("todos").update({ done: newDone }).eq("id", id);
    if (error) {
      console.error("Could not update to-do", error);
      todo.done = !newDone;
      renderTodos();
    }
  } else if (e.target.closest(".todo-delete")) {
    const previous = todos;
    todos = todos.filter((t) => t.id !== id);
    renderTodos();
    const { error } = await db.from("todos").delete().eq("id", id);
    if (error) {
      console.error("Could not delete to-do", error);
      todos = previous;
      renderTodos();
    }
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
