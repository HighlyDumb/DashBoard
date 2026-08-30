const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

function showApp() {
  authScreen.hidden = true;
  app.hidden = false;
  startClock();
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
