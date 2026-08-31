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
let editingTodoId = null;
let undoTimer = null;

const todoForm = document.getElementById("todo-form");
const todoInput = document.getElementById("todo-input");
const todoGroupsEl = document.getElementById("todo-groups");
const todoEmptyEl = document.getElementById("todo-empty");

const todoEditOverlay = document.getElementById("todo-edit-overlay");
const todoEditForm = document.getElementById("todo-edit-form");
const todoEditClose = document.getElementById("todo-edit-close");
const todoEditDelete = document.getElementById("todo-edit-delete");
const editTitle = document.getElementById("edit-title");
const editNotes = document.getElementById("edit-notes");
const editDueDate = document.getElementById("edit-due-date");
const editDueTime = document.getElementById("edit-due-time");
const editPriority = document.getElementById("edit-priority");
const editRecurrence = document.getElementById("edit-recurrence");
const subtaskListEl = document.getElementById("subtask-list");
const subtaskInput = document.getElementById("subtask-input");
const subtaskAddBtn = document.getElementById("subtask-add-btn");

const undoToast = document.getElementById("undo-toast");
const undoToastText = document.getElementById("undo-toast-text");
const undoToastBtn = document.getElementById("undo-toast-btn");

const CHECK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const TRASH_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
const RECUR_SVG = '<svg class="todo-recur-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
const GROUP_LABELS = { overdue: "Overdue", today: "Today", tomorrow: "Tomorrow", week: "This week", later: "Later", none: "No date" };
const GROUP_ORDER = ["overdue", "today", "tomorrow", "week", "later", "none"];

function deckDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function deckTodayStr() {
  return deckDateStr(new Date());
}
function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return deckDateStr(d);
}
function nextDueDate(dateStr, recurrence) {
  const d = new Date(dateStr + "T00:00:00");
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);
  return deckDateStr(d);
}
function formatDueLabel(dateStr, timeStr) {
  const d = new Date(dateStr + "T00:00:00");
  const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (!timeStr) return label;
  const [h, m] = timeStr.split(":");
  const dt = new Date();
  dt.setHours(+h, +m, 0, 0);
  return `${label}, ${dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

async function getCurrentUserId() {
  const {
    data: { session },
  } = await db.auth.getSession();
  return session ? session.user.id : null;
}

function groupTodos(items) {
  const today = deckTodayStr();
  const tomorrow = addDaysStr(today, 1);
  const weekEnd = addDaysStr(today, 7);
  const groups = { overdue: [], today: [], tomorrow: [], week: [], later: [], none: [] };

  items.forEach((t) => {
    if (!t.due_date) { groups.none.push(t); return; }
    if (t.due_date < today) { groups.overdue.push(t); return; }
    if (t.due_date === today) { groups.today.push(t); return; }
    if (t.due_date === tomorrow) { groups.tomorrow.push(t); return; }
    if (t.due_date <= weekEnd) { groups.week.push(t); return; }
    groups.later.push(t);
  });

  const sorter = (a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pDiff !== 0) return pDiff;
    if (a.due_time && b.due_time) return a.due_time.localeCompare(b.due_time);
    if (a.due_time) return -1;
    if (b.due_time) return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  };
  Object.values(groups).forEach((g) => g.sort(sorter));
  return groups;
}

function renderTodoItem(t) {
  const subtasks = todos.filter((s) => s.parent_id === t.id);
  const subDone = subtasks.filter((s) => s.done).length;
  const today = deckTodayStr();
  const overdue = t.due_date && t.due_date < today && !t.done;

  const metaParts = [];
  if (t.due_date) metaParts.push(`<span class="${overdue ? "todo-meta-overdue" : ""}">${formatDueLabel(t.due_date, t.due_time)}</span>`);
  if (subtasks.length) metaParts.push(`<span>${subDone}/${subtasks.length} subtasks</span>`);
  if (t.recurrence !== "none") metaParts.push(RECUR_SVG);

  return `
    <li class="todo-item${t.done ? " todo-item--done" : ""}" data-id="${t.id}">
      <span class="priority-dot priority-dot--${t.priority}" title="${t.priority} priority"></span>
      <button class="todo-check" aria-label="${t.done ? "Mark as not done" : "Mark as done"}">${t.done ? CHECK_SVG : ""}</button>
      <div class="todo-main">
        <span class="todo-title">${escapeHtml(t.title)}</span>
        ${metaParts.length ? `<span class="todo-meta">${metaParts.join(" · ")}</span>` : ""}
      </div>
      <button class="todo-delete" aria-label="Delete to-do">${TRASH_SVG}</button>
    </li>`;
}

function renderTodos() {
  const topLevel = todos.filter((t) => !t.parent_id);
  if (!topLevel.length) {
    todoGroupsEl.innerHTML = "";
    todoEmptyEl.hidden = false;
    return;
  }
  todoEmptyEl.hidden = true;

  const groups = groupTodos(topLevel);
  todoGroupsEl.innerHTML = GROUP_ORDER.filter((key) => groups[key].length)
    .map(
      (key) => `
    <div class="todo-group todo-group--${key}">
      <p class="todo-group-title">${GROUP_LABELS[key]}</p>
      <ul class="todo-list">${groups[key].map(renderTodoItem).join("")}</ul>
    </div>`
    )
    .join("");
}

async function loadTodos() {
  if (!todosLoaded) {
    todoEmptyEl.textContent = "Loading…";
    todoEmptyEl.hidden = false;
    todoGroupsEl.innerHTML = "";
  }
  const { data, error } = await db.from("todos").select("*").is("deleted_at", null).order("created_at", { ascending: true });
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
    .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, () => loadTodos())
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

async function toggleTodoDone(todo) {
  const newDone = !todo.done;
  todo.done = newDone;
  todo.completed_at = newDone ? new Date().toISOString() : null;
  renderTodos();

  const { error } = await db.from("todos").update({ done: newDone, completed_at: todo.completed_at }).eq("id", todo.id);
  if (error) {
    console.error("Could not update to-do", error);
    todo.done = !newDone;
    renderTodos();
    return;
  }

  if (newDone && todo.recurrence !== "none" && todo.due_date && !todo.parent_id) {
    const nextDate = nextDueDate(todo.due_date, todo.recurrence);
    const { data: row, error: insertErr } = await db
      .from("todos")
      .insert({
        user_id: todo.user_id,
        title: todo.title,
        notes: todo.notes,
        priority: todo.priority,
        due_date: nextDate,
        due_time: todo.due_time,
        recurrence: todo.recurrence,
      })
      .select()
      .single();
    if (!insertErr && row) {
      todos.push(row);
      renderTodos();
    }
  }
}

function showUndoToast(removedRows, ids) {
  clearTimeout(undoTimer);
  undoToastText.textContent = removedRows.length > 1 ? "To-do and its subtasks deleted." : "To-do deleted.";
  undoToast.hidden = false;
  undoToastBtn.onclick = async () => {
    clearTimeout(undoTimer);
    undoToast.hidden = true;
    const { error } = await db.from("todos").update({ deleted_at: null }).in("id", ids);
    if (!error) {
      todos.push(...removedRows);
      renderTodos();
    }
  };
  undoTimer = setTimeout(() => {
    undoToast.hidden = true;
  }, 6000);
}

async function softDeleteTodo(todo) {
  const idsToRemove = [todo.id, ...todos.filter((t) => t.parent_id === todo.id).map((t) => t.id)];
  const removed = todos.filter((t) => idsToRemove.includes(t.id));
  todos = todos.filter((t) => !idsToRemove.includes(t.id));
  renderTodos();
  if (editingTodoId === todo.id) closeEditPanel();

  const nowIso = new Date().toISOString();
  const { error } = await db.from("todos").update({ deleted_at: nowIso }).in("id", idsToRemove);
  if (error) {
    console.error("Could not delete to-do", error);
    todos.push(...removed);
    renderTodos();
    return;
  }
  showUndoToast(removed, idsToRemove);
}

todoGroupsEl.addEventListener("click", (e) => {
  const item = e.target.closest(".todo-item");
  if (!item) return;
  const id = item.dataset.id;
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  if (e.target.closest(".todo-check")) {
    toggleTodoDone(todo);
  } else if (e.target.closest(".todo-delete")) {
    softDeleteTodo(todo);
  } else {
    openEditPanel(todo);
  }
});

// ---------- Edit panel ----------

function renderSubtasks(parentId) {
  const subtasks = todos.filter((s) => s.parent_id === parentId);
  subtaskListEl.innerHTML = subtasks
    .map(
      (s) => `
    <li class="subtask-item${s.done ? " subtask-item--done" : ""}" data-id="${s.id}">
      <button class="todo-check todo-check--small" aria-label="${s.done ? "Mark as not done" : "Mark as done"}">${s.done ? CHECK_SVG : ""}</button>
      <span class="subtask-title">${escapeHtml(s.title)}</span>
      <button class="todo-delete" aria-label="Delete subtask">${TRASH_SVG}</button>
    </li>`
    )
    .join("");
}

function openEditPanel(todo) {
  editingTodoId = todo.id;
  editTitle.value = todo.title;
  editNotes.value = todo.notes || "";
  editDueDate.value = todo.due_date || "";
  editDueTime.value = todo.due_time || "";
  editPriority.value = todo.priority;
  editRecurrence.value = todo.recurrence;
  renderSubtasks(todo.id);
  todoEditOverlay.hidden = false;
}

function closeEditPanel() {
  todoEditOverlay.hidden = true;
  editingTodoId = null;
}

todoEditClose.addEventListener("click", closeEditPanel);
todoEditOverlay.addEventListener("click", (e) => {
  if (e.target === todoEditOverlay) closeEditPanel();
});

todoEditForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingTodoId) return;
  const todo = todos.find((t) => t.id === editingTodoId);
  if (!todo) return;

  const updates = {
    title: editTitle.value.trim() || todo.title,
    notes: editNotes.value.trim() || null,
    due_date: editDueDate.value || null,
    due_time: editDueTime.value || null,
    priority: editPriority.value,
    recurrence: editRecurrence.value,
  };
  Object.assign(todo, updates);
  renderTodos();
  closeEditPanel();

  const { error } = await db.from("todos").update(updates).eq("id", todo.id);
  if (error) console.error("Could not save to-do", error);
});

todoEditDelete.addEventListener("click", () => {
  if (!editingTodoId) return;
  const todo = todos.find((t) => t.id === editingTodoId);
  if (todo) softDeleteTodo(todo);
});

subtaskListEl.addEventListener("click", async (e) => {
  const item = e.target.closest(".subtask-item");
  if (!item) return;
  const id = item.dataset.id;
  const sub = todos.find((t) => t.id === id);
  if (!sub) return;

  if (e.target.closest(".todo-check")) {
    const newDone = !sub.done;
    sub.done = newDone;
    renderSubtasks(sub.parent_id);
    renderTodos();
    const { error } = await db.from("todos").update({ done: newDone }).eq("id", id);
    if (error) {
      sub.done = !newDone;
      renderSubtasks(sub.parent_id);
      renderTodos();
    }
  } else if (e.target.closest(".todo-delete")) {
    const parentId = sub.parent_id;
    const nowIso = new Date().toISOString();
    todos = todos.filter((t) => t.id !== id);
    renderSubtasks(parentId);
    renderTodos();
    const { error } = await db.from("todos").update({ deleted_at: nowIso }).eq("id", id);
    if (error) {
      todos.push(sub);
      renderSubtasks(parentId);
      renderTodos();
    }
  }
});

async function addSubtask() {
  const title = subtaskInput.value.trim();
  if (!title || !editingTodoId) return;
  subtaskInput.value = "";
  const userId = await getCurrentUserId();
  if (!userId) return;
  const { data: row, error } = await db.from("todos").insert({ user_id: userId, title, parent_id: editingTodoId }).select().single();
  if (!error && row) {
    todos.push(row);
    renderSubtasks(editingTodoId);
    renderTodos();
  }
}

subtaskAddBtn.addEventListener("click", addSubtask);
subtaskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addSubtask();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
