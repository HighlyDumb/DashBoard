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
  if (view === "habits") loadHabits();
  if (view === "watchlist") loadWatchlist();
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
let pendingDeleteId = null;
let activeTodoTab = "all";

const todoTabsEl = document.getElementById("todo-tabs");
const todoSearchInput = document.getElementById("todo-search");
const todoPriorityFilter = document.getElementById("todo-priority-filter");
const todoSortSelect = document.getElementById("todo-sort");
const todoListEl = document.getElementById("todo-list");
const todoEmptyEl = document.getElementById("todo-empty");
const todoAddBtn = document.getElementById("todo-add-btn");

const todoModalOverlay = document.getElementById("todo-modal-overlay");
const todoModalTitle = document.getElementById("todo-modal-title");
const todoModalForm = document.getElementById("todo-modal-form");
const todoModalCancel = document.getElementById("todo-modal-cancel");
const fName = document.getElementById("f-name");
const fDue = document.getElementById("f-due");
const fPriority = document.getElementById("f-priority");
const fRecur = document.getElementById("f-recur");
const fNotes = document.getElementById("f-notes");
const todoNameError = document.getElementById("todo-name-error");

const todoDeleteOverlay = document.getElementById("todo-delete-overlay");
const todoDeleteMsg = document.getElementById("todo-delete-msg");
const todoDeleteCancel = document.getElementById("todo-delete-cancel");
const todoDeleteConfirm = document.getElementById("todo-delete-confirm");

const CHECK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_LABELS = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };

const TODO_TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "today", label: "Due today" },
  { key: "overdue", label: "Overdue" },
  { key: "done", label: "Completed" },
];

function deckDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function deckTodayStr() {
  return deckDateStr(new Date());
}
function nextDueDate(dateStr, recurrence) {
  const d = new Date(dateStr + "T00:00:00");
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);
  return deckDateStr(d);
}
function formatDueLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function daysUntil(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}
function isOverdueTodo(t) {
  return !!t.due_date && !t.done && t.due_date < deckTodayStr();
}

// Priority automatically escalates (never downgrades) as the due date nears.
function escalatedPriority(t) {
  if (!t.due_date || t.done) return t.priority;
  const days = daysUntil(t.due_date);
  let byDate = null;
  if (days <= 0) byDate = "urgent";
  else if (days <= 3) byDate = "high";
  else if (days <= 7) byDate = "medium";
  if (byDate && PRIORITY_ORDER[byDate] < PRIORITY_ORDER[t.priority]) return byDate;
  return t.priority;
}

async function getCurrentUserId() {
  const {
    data: { session },
  } = await db.auth.getSession();
  return session ? session.user.id : null;
}

function renderTodoTabs() {
  todoTabsEl.innerHTML = "";
  TODO_TABS.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab" + (activeTodoTab === t.key ? " active" : "");
    el.textContent = t.label;
    el.addEventListener("click", () => {
      activeTodoTab = t.key;
      renderTodos();
    });
    todoTabsEl.appendChild(el);
  });
}

function renderTodoCard(t) {
  const card = document.createElement("div");
  const ePriority = escalatedPriority(t);
  const bumped = ePriority !== t.priority;
  card.className = `todo-card p-${ePriority}` + (t.done ? " done" : "");
  card.dataset.id = t.id;

  const overdue = isOverdueTodo(t);
  const metaParts = [];
  if (t.due_date) {
    metaParts.push(`<span class="${overdue ? "overdue" : ""}">${overdue ? "Overdue: " : "Due "}${formatDueLabel(t.due_date)}</span>`);
  }
  if (t.recurrence && t.recurrence !== "none") {
    metaParts.push(`<span class="todo-recur-tag">Repeats ${t.recurrence}</span>`);
  }
  if (bumped) {
    metaParts.push(`<span style="color:var(--priority-${ePriority})">Priority raised (due soon)</span>`);
  }
  if (t.notes) metaParts.push(escapeHtml(t.notes));

  const subtasks = todos.filter((s) => s.parent_id === t.id);
  const doneSub = subtasks.filter((s) => s.done).length;
  if (subtasks.length) metaParts.push(`${doneSub}/${subtasks.length} subtasks`);

  card.innerHTML = `
    <div class="todo-card-top">
      <div class="todo-title-row">
        <button type="button" class="todo-check-circle${t.done ? " checked" : ""}" data-action="toggle-done" aria-label="${t.done ? "Mark as not done" : "Mark as done"}">${t.done ? CHECK_SVG : ""}</button>
        <div>
          <p class="todo-card-title${t.done ? " strike" : ""}">${escapeHtml(t.title)}</p>
          <div class="todo-card-meta">${metaParts.join(" &middot; ")}</div>
        </div>
      </div>
      <span class="priority-badge priority-badge--${ePriority}">${PRIORITY_LABELS[ePriority]}</span>
    </div>
    <div class="todo-subtasks" data-role="subtasks"></div>
    <div class="todo-add-subtask-row">
      <input type="text" placeholder="Add subtask…" data-role="new-subtask" />
      <button type="button" class="btn-ghost btn-tiny" data-action="add-subtask">Add</button>
    </div>
    <div class="todo-card-actions">
      <button type="button" class="btn-ghost btn-tiny" data-action="edit">Edit</button>
      <button type="button" class="btn-ghost btn-tiny btn-ghost--danger" data-action="delete">Delete</button>
    </div>
  `;

  const subEl = card.querySelector('[data-role="subtasks"]');
  subtasks.forEach((s) => {
    const row = document.createElement("div");
    row.className = "todo-subtask-row";
    row.innerHTML = `
      <input type="checkbox" ${s.done ? "checked" : ""} />
      <span class="todo-subtask-text${s.done ? " strike" : ""}">${escapeHtml(s.title)}</span>
      <button type="button" class="todo-subtask-remove" title="Remove">&times;</button>
    `;
    row.querySelector("input").addEventListener("change", (e) => toggleSubtaskDone(s, e.target.checked));
    row.querySelector(".todo-subtask-remove").addEventListener("click", () => deleteSubtask(s));
    subEl.appendChild(row);
  });

  card.querySelector('[data-action="toggle-done"]').addEventListener("click", () => toggleTodoDone(t));
  card.querySelector('[data-action="add-subtask"]').addEventListener("click", () => {
    const input = card.querySelector('[data-role="new-subtask"]');
    addSubtask(t.id, input.value.trim());
    input.value = "";
  });
  card.querySelector('[data-role="new-subtask"]').addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      card.querySelector('[data-action="add-subtask"]').click();
    }
  });
  card.querySelector('[data-action="edit"]').addEventListener("click", () => openTodoModal(t));
  card.querySelector('[data-action="delete"]').addEventListener("click", () => openDeleteModal(t));

  return card;
}

function renderTodos() {
  renderTodoTabs();

  const topLevel = todos.filter((t) => !t.parent_id);
  const search = todoSearchInput.value.trim().toLowerCase();
  const priorityFilterVal = todoPriorityFilter.value;
  const sortBy = todoSortSelect.value;
  const today = deckTodayStr();

  let filtered = topLevel.filter((t) => {
    if (activeTodoTab === "active" && t.done) return false;
    if (activeTodoTab === "today" && (t.done || t.due_date !== today)) return false;
    if (activeTodoTab === "overdue" && !isOverdueTodo(t)) return false;
    if (activeTodoTab === "done" && !t.done) return false;
    if (priorityFilterVal !== "all" && escalatedPriority(t) !== priorityFilterVal) return false;
    if (search && !t.title.toLowerCase().includes(search)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === "priority") return PRIORITY_ORDER[escalatedPriority(a)] - PRIORITY_ORDER[escalatedPriority(b)];
    if (sortBy === "created") return new Date(a.created_at) - new Date(b.created_at);
    const ad = a.due_date || "9999-99-99";
    const bd = b.due_date || "9999-99-99";
    return ad.localeCompare(bd);
  });

  todoListEl.innerHTML = "";
  filtered.forEach((t) => todoListEl.appendChild(renderTodoCard(t)));

  if (!filtered.length) {
    todoEmptyEl.textContent = topLevel.length ? "No tasks match your filters." : "Nothing on your list yet.";
    todoEmptyEl.hidden = false;
  } else {
    todoEmptyEl.hidden = true;
  }
}

async function loadTodos() {
  if (!todosLoaded) {
    todoEmptyEl.textContent = "Loading…";
    todoEmptyEl.hidden = false;
    todoListEl.innerHTML = "";
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

// ---------- Toggling done, recurrence, subtasks ----------

async function toggleTodoDone(t) {
  const subtasks = todos.filter((s) => s.parent_id === t.id);
  const newDone = !t.done;
  const prevCompletedAt = t.completed_at;

  t.done = newDone;
  t.completed_at = newDone ? new Date().toISOString() : null;
  subtasks.forEach((s) => {
    s.done = newDone;
  });
  renderTodos();

  const { error } = await db.from("todos").update({ done: newDone, completed_at: t.completed_at }).eq("id", t.id);
  if (subtasks.length) {
    await db.from("todos").update({ done: newDone }).in("id", subtasks.map((s) => s.id));
  }
  if (error) {
    console.error("Could not update to-do", error);
    t.done = !newDone;
    t.completed_at = prevCompletedAt;
    subtasks.forEach((s) => {
      s.done = !newDone;
    });
    renderTodos();
    return;
  }

  if (newDone && t.recurrence !== "none" && t.due_date && !t.parent_id) {
    const nextDate = nextDueDate(t.due_date, t.recurrence);
    const { data: row, error: insertErr } = await db
      .from("todos")
      .insert({
        user_id: t.user_id,
        title: t.title,
        notes: t.notes,
        priority: t.priority,
        due_date: nextDate,
        recurrence: t.recurrence,
      })
      .select()
      .single();
    if (!insertErr && row) {
      todos.push(row);
      if (subtasks.length) {
        const { data: subRows, error: subErr } = await db
          .from("todos")
          .insert(subtasks.map((s) => ({ user_id: t.user_id, title: s.title, parent_id: row.id, done: false })))
          .select();
        if (!subErr && subRows) todos.push(...subRows);
      }
      renderTodos();
    }
  }
}

async function toggleSubtaskDone(sub, newDone) {
  sub.done = newDone;
  renderTodos();
  const { error } = await db.from("todos").update({ done: newDone }).eq("id", sub.id);
  if (error) {
    console.error("Could not update subtask", error);
    sub.done = !newDone;
    renderTodos();
  }
}

async function deleteSubtask(sub) {
  const nowIso = new Date().toISOString();
  todos = todos.filter((t) => t.id !== sub.id);
  renderTodos();
  const { error } = await db.from("todos").update({ deleted_at: nowIso }).eq("id", sub.id);
  if (error) {
    console.error("Could not delete subtask", error);
    todos.push(sub);
    renderTodos();
  }
}

async function addSubtask(parentId, title) {
  if (!title) return;
  const userId = await getCurrentUserId();
  if (!userId) return;
  const { data: row, error } = await db.from("todos").insert({ user_id: userId, title, parent_id: parentId }).select().single();
  if (error) {
    console.error("Could not add subtask", error);
    return;
  }
  todos.push(row);
  renderTodos();
}

// ---------- Add/edit modal ----------

function openTodoModal(todo) {
  editingTodoId = todo ? todo.id : null;
  todoModalTitle.textContent = todo ? "Edit task" : "Add task";
  fName.value = todo ? todo.title : "";
  fDue.value = todo ? todo.due_date || "" : "";
  fPriority.value = todo ? todo.priority : "medium";
  fRecur.value = todo ? todo.recurrence : "none";
  fNotes.value = todo ? todo.notes || "" : "";
  todoNameError.classList.remove("show");
  todoModalOverlay.hidden = false;
}

function closeTodoModal() {
  todoModalOverlay.hidden = true;
  editingTodoId = null;
}

todoAddBtn.addEventListener("click", () => openTodoModal(null));
todoModalCancel.addEventListener("click", closeTodoModal);
todoModalOverlay.addEventListener("click", (e) => {
  if (e.target === todoModalOverlay) closeTodoModal();
});

todoModalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = fName.value.trim();
  if (!title) {
    todoNameError.classList.add("show");
    return;
  }
  todoNameError.classList.remove("show");

  const updates = {
    title,
    due_date: fDue.value || null,
    priority: fPriority.value,
    recurrence: fRecur.value,
    notes: fNotes.value.trim() || null,
  };

  if (editingTodoId) {
    const todo = todos.find((t) => t.id === editingTodoId);
    if (!todo) return;
    Object.assign(todo, updates);
    renderTodos();
    closeTodoModal();
    const { error } = await db.from("todos").update(updates).eq("id", todo.id);
    if (error) console.error("Could not save to-do", error);
  } else {
    const userId = await getCurrentUserId();
    if (!userId) return;
    const { data: row, error } = await db
      .from("todos")
      .insert({ user_id: userId, ...updates })
      .select()
      .single();
    if (error) {
      console.error("Could not add to-do", error);
      return;
    }
    todos.push(row);
    renderTodos();
    closeTodoModal();
  }
});

// ---------- Delete confirmation modal ----------

function openDeleteModal(todo) {
  pendingDeleteId = todo.id;
  const hasSubtasks = todos.some((t) => t.parent_id === todo.id);
  todoDeleteMsg.textContent = hasSubtasks
    ? `"${todo.title}" and its subtasks will be removed. This can't be undone.`
    : `"${todo.title}" will be removed. This can't be undone.`;
  todoDeleteOverlay.hidden = false;
}

function closeDeleteModal() {
  todoDeleteOverlay.hidden = true;
  pendingDeleteId = null;
}

todoDeleteCancel.addEventListener("click", closeDeleteModal);
todoDeleteOverlay.addEventListener("click", (e) => {
  if (e.target === todoDeleteOverlay) closeDeleteModal();
});

todoDeleteConfirm.addEventListener("click", async () => {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  const idsToRemove = [id, ...todos.filter((t) => t.parent_id === id).map((t) => t.id)];
  const removed = todos.filter((t) => idsToRemove.includes(t.id));
  todos = todos.filter((t) => !idsToRemove.includes(t.id));
  closeDeleteModal();
  renderTodos();

  const nowIso = new Date().toISOString();
  const { error } = await db.from("todos").update({ deleted_at: nowIso }).in("id", idsToRemove);
  if (error) {
    console.error("Could not delete to-do", error);
    todos.push(...removed);
    renderTodos();
  }
});

// ---------- Filter/sort controls ----------

todoSearchInput.addEventListener("input", renderTodos);
todoPriorityFilter.addEventListener("change", renderTodos);
todoSortSelect.addEventListener("change", renderTodos);

// ---------- Habits page ----------

let habits = [];
let habitCompletions = {}; // habit_id -> Set of "YYYY-MM-DD" strings
let habitsLoaded = false;
let habitsChannel = null;
let editingHabitId = null;
let pendingDeleteHabitId = null;
let activeHabitsPage = "tracker";
let selectedHabitDays = [0, 1, 2, 3, 4, 5, 6];

const habitsPageTabsEl = document.getElementById("habits-page-tabs");
const habitsTrackerPageEl = document.getElementById("habits-tracker-page");
const habitsAnalysisPageEl = document.getElementById("habits-analysis-page");
const habitsListEl = document.getElementById("habits-list");
const habitsEmptyEl = document.getElementById("habits-empty");
const habitsStatCardsEl = document.getElementById("habits-stat-cards");
const habitsAnalysisListEl = document.getElementById("habits-analysis-list");
const habitsAnalysisEmptyEl = document.getElementById("habits-analysis-empty");
const habitAddBtn = document.getElementById("habit-add-btn");

const habitModalOverlay = document.getElementById("habit-modal-overlay");
const habitModalTitle = document.getElementById("habit-modal-title");
const habitModalForm = document.getElementById("habit-modal-form");
const habitModalCancel = document.getElementById("habit-modal-cancel");
const hfName = document.getElementById("hf-name");
const hfFrequency = document.getElementById("hf-frequency");
const habitDaysField = document.getElementById("habit-days-field");
const habitDayTogglesEl = document.getElementById("habit-day-toggles");
const habitNameError = document.getElementById("habit-name-error");

const habitDeleteOverlay = document.getElementById("habit-delete-overlay");
const habitDeleteMsg = document.getElementById("habit-delete-msg");
const habitDeleteCancel = document.getElementById("habit-delete-cancel");
const habitDeleteConfirm = document.getElementById("habit-delete-confirm");

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HEATMAP_WEEKS = 4; // last 28 days

const HABITS_PAGE_TABS = [
  { key: "tracker", label: "Tracker" },
  { key: "analysis", label: "Analysis" },
];

function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return deckDateStr(d);
}
function dayOfWeek(dateStr) {
  return new Date(dateStr + "T00:00:00").getDay();
}

function isHabitScheduled(habit, dateStr) {
  if (habit.frequency === "daily") return true;
  return (habit.days || []).includes(dayOfWeek(dateStr));
}
function isHabitCompleted(habit, dateStr) {
  const set = habitCompletions[habit.id];
  return !!set && set.has(dateStr);
}

// Current streak: walk backward from today; today not-yet-done on a
// scheduled day doesn't break the streak (the day isn't over yet).
// Non-scheduled days are skipped over rather than breaking the run.
function currentHabitStreak(habit) {
  let d = deckTodayStr();
  if (isHabitScheduled(habit, d) && !isHabitCompleted(habit, d)) {
    d = addDaysStr(d, -1);
  }
  let streak = 0;
  let guard = 0;
  while (guard < 3650) {
    guard++;
    if (isHabitScheduled(habit, d)) {
      if (isHabitCompleted(habit, d)) {
        streak++;
        d = addDaysStr(d, -1);
      } else {
        break;
      }
    } else {
      d = addDaysStr(d, -1);
    }
  }
  return streak;
}

// Best streak ever, scanning forward from the earliest known date
// (creation or first completion) up to today.
function bestHabitStreak(habit) {
  const dates = habitCompletions[habit.id] ? Array.from(habitCompletions[habit.id]) : [];
  let earliest = habit.created_at ? deckDateStr(new Date(habit.created_at)) : deckTodayStr();
  dates.forEach((d) => {
    if (d < earliest) earliest = d;
  });
  let d = earliest;
  let run = 0;
  let best = 0;
  let guard = 0;
  const today = deckTodayStr();
  while (d <= today && guard < 3650) {
    guard++;
    if (isHabitScheduled(habit, d)) {
      if (isHabitCompleted(habit, d)) {
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
    d = addDaysStr(d, 1);
  }
  return best;
}

function habitCompletionRate(habit, days) {
  let scheduled = 0;
  let done = 0;
  let d = deckTodayStr();
  for (let i = 0; i < days; i++) {
    if (isHabitScheduled(habit, d)) {
      scheduled++;
      if (isHabitCompleted(habit, d)) done++;
    }
    d = addDaysStr(d, -1);
  }
  return scheduled ? Math.round((done / scheduled) * 100) : 0;
}

function habitFrequencyLabel(habit) {
  if (habit.frequency === "daily") return "Every day";
  const sorted = [...(habit.days || [])].sort();
  return sorted.map((i) => DAY_NAMES[i]).join(", ") || "No days set";
}

async function loadHabits() {
  if (!habitsLoaded) {
    habitsEmptyEl.textContent = "Loading…";
    habitsEmptyEl.hidden = false;
    habitsListEl.innerHTML = "";
  }
  const [habitsRes, compRes] = await Promise.all([
    db.from("habits").select("*").order("created_at", { ascending: true }),
    db.from("habit_completions").select("habit_id, date"),
  ]);
  if (habitsRes.error || compRes.error) {
    console.error("Could not load habits", habitsRes.error || compRes.error);
    habitsEmptyEl.textContent = "Couldn't load your habits.";
    habitsEmptyEl.hidden = false;
    return;
  }
  habits = habitsRes.data || [];
  habitCompletions = {};
  (compRes.data || []).forEach((row) => {
    if (!habitCompletions[row.habit_id]) habitCompletions[row.habit_id] = new Set();
    habitCompletions[row.habit_id].add(row.date);
  });
  habitsLoaded = true;
  renderHabitsPage();
  subscribeHabits();
}

function subscribeHabits() {
  if (habitsChannel) return;
  habitsChannel = db
    .channel("deck-habits-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "habits" }, () => loadHabits())
    .on("postgres_changes", { event: "*", schema: "public", table: "habit_completions" }, () => loadHabits())
    .subscribe();
}

function renderHabitsPageTabs() {
  habitsPageTabsEl.innerHTML = "";
  HABITS_PAGE_TABS.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab" + (activeHabitsPage === t.key ? " active" : "");
    el.textContent = t.label;
    el.addEventListener("click", () => {
      activeHabitsPage = t.key;
      renderHabitsPage();
    });
    habitsPageTabsEl.appendChild(el);
  });
}

function renderHabitsPage() {
  renderHabitsPageTabs();
  habitsTrackerPageEl.hidden = activeHabitsPage !== "tracker";
  habitsAnalysisPageEl.hidden = activeHabitsPage !== "analysis";
  if (activeHabitsPage === "tracker") renderHabitsTracker();
  else renderHabitsAnalysis();
}

function renderHabitsTracker() {
  habitsListEl.innerHTML = "";
  habitsEmptyEl.textContent = "No habits yet. Tap + to add one.";
  habitsEmptyEl.hidden = habits.length > 0;

  const today = deckTodayStr();
  habits.forEach((h) => {
    habitsListEl.appendChild(renderHabitCard(h, today));
  });
}

function renderHabitCard(h, today) {
  const card = document.createElement("div");
  card.className = "habit-card";
  card.dataset.id = h.id;

  const doneToday = isHabitCompleted(h, today);
  const scheduledToday = isHabitScheduled(h, today);
  const streak = currentHabitStreak(h);

  card.innerHTML = `
    <div class="habit-card-top">
      <div>
        <p class="habit-name">${escapeHtml(h.name)}</p>
        <div class="habit-meta">${habitFrequencyLabel(h)}</div>
      </div>
      <span class="streak-badge">${streak} day${streak === 1 ? "" : "s"} streak</span>
    </div>
    <div class="habit-today-row">
      <button type="button" class="habit-today-check${doneToday ? " done" : ""}${scheduledToday ? "" : " not-scheduled"}" data-action="toggle-today" aria-label="${doneToday ? "Mark as not done" : "Mark today done"}">${doneToday ? CHECK_SVG : ""}</button>
      <span class="habit-today-label">${scheduledToday ? (doneToday ? "Done today" : "Mark today done") : "Not scheduled today"}</span>
    </div>
    <div class="heatmap" data-role="heatmap"></div>
    <div class="habit-card-actions">
      <button type="button" class="btn-ghost btn-tiny" data-action="edit">Edit</button>
      <button type="button" class="btn-ghost btn-tiny btn-ghost--danger" data-action="delete">Delete</button>
    </div>
  `;

  const heatmapEl = card.querySelector('[data-role="heatmap"]');
  const totalDays = HEATMAP_WEEKS * 7;
  // Oldest first, left-to-right/top-to-bottom, ending on today.
  for (let i = totalDays - 1; i >= 0; i--) {
    const dateStr = addDaysStr(today, -i);
    const scheduled = isHabitScheduled(h, dateStr);
    const completed = isHabitCompleted(h, dateStr);
    const isFuture = dateStr > today;
    const cell = document.createElement("button");
    cell.type = "button";
    let cls = "heatmap-cell";
    if (!scheduled || isFuture) cls += " na";
    else if (completed) cls += " done";
    else if (dateStr < today) cls += " missed";
    else cls += " pending";
    if (dateStr === today) cls += " today-outline";
    cell.className = cls;
    cell.title = `${dateStr}${scheduled && !isFuture ? (completed ? " — done" : " — missed") : ""}`;
    if (scheduled && !isFuture) {
      cell.addEventListener("click", () => toggleHabitCompletion(h, dateStr, completed));
    } else {
      cell.disabled = true;
    }
    heatmapEl.appendChild(cell);
  }

  const toggleTodayBtn = card.querySelector('[data-action="toggle-today"]');
  if (scheduledToday) {
    toggleTodayBtn.addEventListener("click", () => toggleHabitCompletion(h, today, doneToday));
  } else {
    toggleTodayBtn.disabled = true;
  }

  card.querySelector('[data-action="edit"]').addEventListener("click", () => openHabitModal(h));
  card.querySelector('[data-action="delete"]').addEventListener("click", () => openHabitDeleteModal(h));

  return card;
}

async function toggleHabitCompletion(habit, dateStr, wasCompleted) {
  if (!habitCompletions[habit.id]) habitCompletions[habit.id] = new Set();
  const set = habitCompletions[habit.id];
  if (wasCompleted) set.delete(dateStr);
  else set.add(dateStr);
  renderHabitsPage();

  if (wasCompleted) {
    const { error } = await db.from("habit_completions").delete().eq("habit_id", habit.id).eq("date", dateStr);
    if (error) {
      console.error("Could not unmark habit day", error);
      set.add(dateStr);
      renderHabitsPage();
    }
  } else {
    const userId = await getCurrentUserId();
    if (!userId) return;
    const { error } = await db.from("habit_completions").insert({ user_id: userId, habit_id: habit.id, date: dateStr });
    if (error) {
      console.error("Could not mark habit day", error);
      set.delete(dateStr);
      renderHabitsPage();
    }
  }
}

function renderHabitsAnalysis() {
  habitsStatCardsEl.innerHTML = "";
  habitsAnalysisListEl.innerHTML = "";

  if (!habits.length) {
    habitsAnalysisEmptyEl.hidden = false;
    return;
  }
  habitsAnalysisEmptyEl.hidden = true;

  const rates = habits.map((h) => habitCompletionRate(h, 30));
  const avgRate = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
  let bestHabit = habits[0];
  let bestStreakVal = currentHabitStreak(habits[0]);
  habits.forEach((h) => {
    const s = currentHabitStreak(h);
    if (s > bestStreakVal) {
      bestStreakVal = s;
      bestHabit = h;
    }
  });

  const stats = [
    { num: habits.length, label: "Habits tracked" },
    { num: `${avgRate}%`, label: "Avg. completion (30d)" },
    { num: bestStreakVal, label: `Best current streak${bestHabit ? " — " + escapeHtml(bestHabit.name) : ""}` },
  ];
  stats.forEach((s) => {
    const el = document.createElement("div");
    el.className = "stat-card";
    el.innerHTML = `<div class="stat-num">${s.num}</div><div class="stat-label">${s.label}</div>`;
    habitsStatCardsEl.appendChild(el);
  });

  habits.forEach((h) => {
    const rate30 = habitCompletionRate(h, 30);
    const rate7 = habitCompletionRate(h, 7);
    const cur = currentHabitStreak(h);
    const best = bestHabitStreak(h);
    const row = document.createElement("div");
    row.className = "analysis-row";
    row.innerHTML = `
      <div class="analysis-top">
        <span class="analysis-name">${escapeHtml(h.name)}</span>
        <span class="analysis-nums">
          <span>7d: ${rate7}%</span>
          <span>30d: ${rate30}%</span>
          <span>Current streak: ${cur}</span>
          <span>Best streak: ${best}</span>
        </span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${rate30}%;"></div></div>
    `;
    habitsAnalysisListEl.appendChild(row);
  });
}

// ---------- Add/edit modal ----------

function renderHabitDayToggles() {
  habitDayTogglesEl.innerHTML = "";
  DAY_LABELS.forEach((label, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-toggle" + (selectedHabitDays.includes(i) ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      if (selectedHabitDays.includes(i)) selectedHabitDays = selectedHabitDays.filter((x) => x !== i);
      else selectedHabitDays.push(i);
      renderHabitDayToggles();
    });
    habitDayTogglesEl.appendChild(btn);
  });
}

function toggleHabitDaysField() {
  habitDaysField.hidden = hfFrequency.value !== "custom";
}

function openHabitModal(habit) {
  editingHabitId = habit ? habit.id : null;
  habitModalTitle.textContent = habit ? "Edit habit" : "Add habit";
  hfName.value = habit ? habit.name : "";
  hfFrequency.value = habit ? habit.frequency : "daily";
  selectedHabitDays = habit ? [...(habit.days || [])] : [0, 1, 2, 3, 4, 5, 6];
  habitNameError.classList.remove("show");
  renderHabitDayToggles();
  toggleHabitDaysField();
  habitModalOverlay.hidden = false;
}

function closeHabitModal() {
  habitModalOverlay.hidden = true;
  editingHabitId = null;
}

habitAddBtn.addEventListener("click", () => openHabitModal(null));
habitModalCancel.addEventListener("click", closeHabitModal);
habitModalOverlay.addEventListener("click", (e) => {
  if (e.target === habitModalOverlay) closeHabitModal();
});
hfFrequency.addEventListener("change", toggleHabitDaysField);

habitModalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = hfName.value.trim();
  if (!name) {
    habitNameError.classList.add("show");
    return;
  }
  habitNameError.classList.remove("show");

  const frequency = hfFrequency.value;
  const days = frequency === "custom" ? [...selectedHabitDays] : [0, 1, 2, 3, 4, 5, 6];

  if (editingHabitId) {
    const habit = habits.find((h) => h.id === editingHabitId);
    if (!habit) return;
    Object.assign(habit, { name, frequency, days });
    renderHabitsPage();
    closeHabitModal();
    const { error } = await db.from("habits").update({ name, frequency, days }).eq("id", habit.id);
    if (error) console.error("Could not save habit", error);
  } else {
    const userId = await getCurrentUserId();
    if (!userId) return;
    const { data: row, error } = await db
      .from("habits")
      .insert({ user_id: userId, name, frequency, days })
      .select()
      .single();
    if (error) {
      console.error("Could not add habit", error);
      return;
    }
    habits.push(row);
    renderHabitsPage();
    closeHabitModal();
  }
});

// ---------- Delete confirmation modal ----------

function openHabitDeleteModal(habit) {
  pendingDeleteHabitId = habit.id;
  habitDeleteMsg.textContent = `"${habit.name}" and all its logged history will be removed. This can't be undone.`;
  habitDeleteOverlay.hidden = false;
}

function closeHabitDeleteModal() {
  habitDeleteOverlay.hidden = true;
  pendingDeleteHabitId = null;
}

habitDeleteCancel.addEventListener("click", closeHabitDeleteModal);
habitDeleteOverlay.addEventListener("click", (e) => {
  if (e.target === habitDeleteOverlay) closeHabitDeleteModal();
});
habitDeleteConfirm.addEventListener("click", async () => {
  if (!pendingDeleteHabitId) return;
  const id = pendingDeleteHabitId;
  const removed = habits.find((h) => h.id === id);
  habits = habits.filter((h) => h.id !== id);
  delete habitCompletions[id];
  closeHabitDeleteModal();
  renderHabitsPage();

  const { error } = await db.from("habits").delete().eq("id", id);
  if (error) {
    console.error("Could not delete habit", error);
    if (removed) habits.push(removed);
    renderHabitsPage();
  }
});

// ---------- Watchlist page ----------

let watchlistItems = [];
let watchlistLoaded = false;
let watchlistChannel = null;
let editingWatchlistId = null;
let pendingDeleteWatchlistId = null;
let activeWatchlistTab = "all";

const watchlistTabsEl = document.getElementById("watchlist-tabs");
const watchlistSearchInput = document.getElementById("watchlist-search");
const watchlistTypeFilter = document.getElementById("watchlist-type-filter");
const watchlistListEl = document.getElementById("watchlist-list");
const watchlistEmptyEl = document.getElementById("watchlist-empty");
const watchlistAddBtn = document.getElementById("watchlist-add-btn");

const watchlistModalOverlay = document.getElementById("watchlist-modal-overlay");
const watchlistModalTitle = document.getElementById("watchlist-modal-title");
const watchlistModalForm = document.getElementById("watchlist-modal-form");
const watchlistModalCancel = document.getElementById("watchlist-modal-cancel");
const wfName = document.getElementById("wf-name");
const wfType = document.getElementById("wf-type");
const wfStatus = document.getElementById("wf-status");
const watchlistProgressFields = document.getElementById("watchlist-progress-fields");
const wfSeason = document.getElementById("wf-season");
const wfEpisode = document.getElementById("wf-episode");
const wfNotes = document.getElementById("wf-notes");
const watchlistNameError = document.getElementById("watchlist-name-error");

const watchlistDeleteOverlay = document.getElementById("watchlist-delete-overlay");
const watchlistDeleteMsg = document.getElementById("watchlist-delete-msg");
const watchlistDeleteCancel = document.getElementById("watchlist-delete-cancel");
const watchlistDeleteConfirm = document.getElementById("watchlist-delete-confirm");

const WATCHLIST_TABS = [
  { key: "all", label: "All" },
  { key: "watching", label: "Watching" },
  { key: "plan", label: "Plan to watch" },
  { key: "done", label: "Completed" },
];

const WATCHLIST_STATUS_LABELS = { plan: "Plan to watch", watching: "Watching", done: "Completed" };

async function loadWatchlist() {
  if (!watchlistLoaded) {
    watchlistEmptyEl.textContent = "Loading…";
    watchlistEmptyEl.hidden = false;
    watchlistListEl.innerHTML = "";
  }
  const { data, error } = await db.from("watchlist").select("*").order("created_at", { ascending: true });
  if (error) {
    console.error("Could not load watchlist", error);
    watchlistEmptyEl.textContent = "Couldn't load your watchlist.";
    watchlistEmptyEl.hidden = false;
    return;
  }
  watchlistItems = data || [];
  watchlistLoaded = true;
  renderWatchlist();
  subscribeWatchlist();
}

function subscribeWatchlist() {
  if (watchlistChannel) return;
  watchlistChannel = db
    .channel("deck-watchlist-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "watchlist" }, () => loadWatchlist())
    .subscribe();
}

function renderWatchlistTabs() {
  watchlistTabsEl.innerHTML = "";
  WATCHLIST_TABS.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab" + (activeWatchlistTab === t.key ? " active" : "");
    el.textContent = t.label;
    el.addEventListener("click", () => {
      activeWatchlistTab = t.key;
      renderWatchlist();
    });
    watchlistTabsEl.appendChild(el);
  });
}

function renderWatchlist() {
  renderWatchlistTabs();
  const search = watchlistSearchInput.value.trim().toLowerCase();
  const typeFilterVal = watchlistTypeFilter.value;

  const filtered = watchlistItems.filter((it) => {
    if (activeWatchlistTab !== "all" && it.status !== activeWatchlistTab) return false;
    if (typeFilterVal !== "all" && it.type !== typeFilterVal) return false;
    if (search && !it.name.toLowerCase().includes(search)) return false;
    return true;
  });

  watchlistListEl.innerHTML = "";
  filtered.forEach((it) => watchlistListEl.appendChild(renderWatchlistCard(it)));

  if (!filtered.length) {
    watchlistEmptyEl.textContent = watchlistItems.length
      ? "No titles match your filters."
      : "Nothing here yet. Tap + to add a movie or series.";
    watchlistEmptyEl.hidden = false;
  } else {
    watchlistEmptyEl.hidden = true;
  }
}

function renderWatchlistCard(it) {
  const card = document.createElement("div");
  card.className = "watchlist-card";
  card.dataset.id = it.id;

  const progressText = it.type === "series" && (it.season || it.episode) ? `S${it.season || "?"} &middot; E${it.episode || "?"}` : "";
  const metaParts = [it.type === "movie" ? "Movie" : "Series"];
  if (progressText) metaParts.push(progressText);
  if (it.notes) metaParts.push(escapeHtml(it.notes));

  card.innerHTML = `
    <div class="watchlist-card-top">
      <div>
        <p class="watchlist-title">${escapeHtml(it.name)}</p>
        <p class="watchlist-meta">${metaParts.join(" &middot; ")}</p>
      </div>
      <span class="status-badge status-badge--${it.status}">${WATCHLIST_STATUS_LABELS[it.status]}</span>
    </div>
    ${
      it.type === "series"
        ? `<div class="watchlist-progress">
      <span class="watchlist-meta">S</span>
      <input type="text" data-field="season" value="${escapeHtml(it.season || "")}" />
      <span class="watchlist-meta">E</span>
      <input type="text" data-field="episode" value="${escapeHtml(it.episode || "")}" />
      <button type="button" class="btn-ghost btn-tiny" data-action="save-progress">Update</button>
    </div>`
        : ""
    }
    <div class="watchlist-card-actions">
      <select data-action="status">
        <option value="plan" ${it.status === "plan" ? "selected" : ""}>Plan to watch</option>
        <option value="watching" ${it.status === "watching" ? "selected" : ""}>Watching</option>
        <option value="done" ${it.status === "done" ? "selected" : ""}>Completed</option>
      </select>
      <button type="button" class="btn-ghost btn-tiny" data-action="edit">Edit</button>
      <button type="button" class="btn-ghost btn-tiny btn-ghost--danger" data-action="delete">Delete</button>
    </div>
  `;

  card.querySelector('[data-action="status"]').addEventListener("change", (e) => updateWatchlistStatus(it, e.target.value));
  const saveProgBtn = card.querySelector('[data-action="save-progress"]');
  if (saveProgBtn) {
    saveProgBtn.addEventListener("click", () => {
      const season = card.querySelector('[data-field="season"]').value.trim();
      const episode = card.querySelector('[data-field="episode"]').value.trim();
      updateWatchlistProgress(it, season, episode);
    });
  }
  card.querySelector('[data-action="edit"]').addEventListener("click", () => openWatchlistModal(it));
  card.querySelector('[data-action="delete"]').addEventListener("click", () => openWatchlistDeleteModal(it));

  return card;
}

async function updateWatchlistStatus(it, status) {
  const prev = it.status;
  it.status = status;
  renderWatchlist();
  const { error } = await db.from("watchlist").update({ status }).eq("id", it.id);
  if (error) {
    console.error("Could not update status", error);
    it.status = prev;
    renderWatchlist();
  }
}

async function updateWatchlistProgress(it, season, episode) {
  const prevSeason = it.season;
  const prevEpisode = it.episode;
  it.season = season;
  it.episode = episode;
  renderWatchlist();
  const { error } = await db.from("watchlist").update({ season, episode }).eq("id", it.id);
  if (error) {
    console.error("Could not update progress", error);
    it.season = prevSeason;
    it.episode = prevEpisode;
    renderWatchlist();
  }
}

// ---------- Add/edit modal ----------

function toggleWatchlistProgressFields() {
  watchlistProgressFields.hidden = wfType.value !== "series";
}

function openWatchlistModal(item) {
  editingWatchlistId = item ? item.id : null;
  watchlistModalTitle.textContent = item ? "Edit title" : "Add title";
  wfName.value = item ? item.name : "";
  wfType.value = item ? item.type : "movie";
  wfStatus.value = item ? item.status : "plan";
  wfSeason.value = item ? item.season || "" : "";
  wfEpisode.value = item ? item.episode || "" : "";
  wfNotes.value = item ? item.notes || "" : "";
  watchlistNameError.classList.remove("show");
  toggleWatchlistProgressFields();
  watchlistModalOverlay.hidden = false;
}

function closeWatchlistModal() {
  watchlistModalOverlay.hidden = true;
  editingWatchlistId = null;
}

watchlistAddBtn.addEventListener("click", () => openWatchlistModal(null));
watchlistModalCancel.addEventListener("click", closeWatchlistModal);
watchlistModalOverlay.addEventListener("click", (e) => {
  if (e.target === watchlistModalOverlay) closeWatchlistModal();
});
wfType.addEventListener("change", toggleWatchlistProgressFields);

watchlistModalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = wfName.value.trim();
  if (!name) {
    watchlistNameError.classList.add("show");
    return;
  }
  watchlistNameError.classList.remove("show");

  const updates = {
    name,
    type: wfType.value,
    status: wfStatus.value,
    season: wfSeason.value.trim() || null,
    episode: wfEpisode.value.trim() || null,
    notes: wfNotes.value.trim() || null,
  };

  if (editingWatchlistId) {
    const item = watchlistItems.find((it) => it.id === editingWatchlistId);
    if (!item) return;
    Object.assign(item, updates);
    renderWatchlist();
    closeWatchlistModal();
    const { error } = await db.from("watchlist").update(updates).eq("id", item.id);
    if (error) console.error("Could not save title", error);
  } else {
    const userId = await getCurrentUserId();
    if (!userId) return;
    const { data: row, error } = await db
      .from("watchlist")
      .insert({ user_id: userId, ...updates })
      .select()
      .single();
    if (error) {
      console.error("Could not add title", error);
      return;
    }
    watchlistItems.push(row);
    renderWatchlist();
    closeWatchlistModal();
  }
});

// ---------- Delete confirmation modal ----------

function openWatchlistDeleteModal(item) {
  pendingDeleteWatchlistId = item.id;
  watchlistDeleteMsg.textContent = `"${item.name}" will be removed from your watchlist. This can't be undone.`;
  watchlistDeleteOverlay.hidden = false;
}

function closeWatchlistDeleteModal() {
  watchlistDeleteOverlay.hidden = true;
  pendingDeleteWatchlistId = null;
}

watchlistDeleteCancel.addEventListener("click", closeWatchlistDeleteModal);
watchlistDeleteOverlay.addEventListener("click", (e) => {
  if (e.target === watchlistDeleteOverlay) closeWatchlistDeleteModal();
});
watchlistDeleteConfirm.addEventListener("click", async () => {
  if (!pendingDeleteWatchlistId) return;
  const id = pendingDeleteWatchlistId;
  const removed = watchlistItems.find((it) => it.id === id);
  watchlistItems = watchlistItems.filter((it) => it.id !== id);
  closeWatchlistDeleteModal();
  renderWatchlist();

  const { error } = await db.from("watchlist").delete().eq("id", id);
  if (error) {
    console.error("Could not delete title", error);
    if (removed) watchlistItems.push(removed);
    renderWatchlist();
  }
});

// ---------- Filter controls ----------

watchlistSearchInput.addEventListener("input", renderWatchlist);
watchlistTypeFilter.addEventListener("change", renderWatchlist);

// Service worker + offline caching is deferred to the final PWA-polish
// phase - it was registered too early and has been serving stale files
// during active development. This actively removes any copy that's
// already installed on this device/browser, and deletes its caches, so
// no manual devtools steps are needed. Safe to run every load: if nothing
// is registered, both calls just resolve to nothing.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
}
if ("caches" in window) {
  caches.keys().then((keys) => {
    keys.forEach((key) => caches.delete(key));
  });
}
