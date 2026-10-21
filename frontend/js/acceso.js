// js/acceso.js
document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();
  if (getToken()) { window.location.href = "index.html"; return; }

  document.getElementById("r-practices").addEventListener("change", (e) => {
    document.getElementById("r-birthdate-field").classList.toggle("hidden", !e.target.checked);
  });
  document.getElementById("btn-olvido").addEventListener("click", () => {
    const form = document.getElementById("forgot-form");
    form.classList.toggle("hidden");
    document.getElementById("f-email").value = document.getElementById("l-email").value.trim();
    if (!form.classList.contains("hidden")) document.getElementById("f-email").focus();
  });

  // Las cuentas de prueba solo se enseñan en la academia de ejemplo.
  api("/public/info").then((i) => {
    if (i.demo_accounts) document.getElementById("cuentas-demo").classList.remove("hidden");
  }).catch(() => {});
  // Desde la portada ("Probar una clase gratis") se llega a #registro.
  if (location.hash === "#registro") document.getElementById("r-name").focus();

  document.getElementById("login-form").addEventListener("submit", submitLogin);
  document.getElementById("register-form").addEventListener("submit", submitRegister);
  document.getElementById("forgot-form").addEventListener("submit", submitOlvido);
});

// Después de entrar: primero, cambiar una contraseña temporal; después,
// aceptar el aviso de privacidad si la academia ha publicado uno nuevo.
function destinoTrasEntrar(account) {
  if (account.must_change_password) return "mi-cuenta.html?cambiar=1";
  if (account.privacy_pending) return "privacidad.html?aceptar=1";
  return "index.html";
}

async function submitLogin(e) {
  e.preventDefault();
  const msg = document.getElementById("login-msg");
  msg.textContent = ""; msg.className = "form-message";

  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("l-email").value.trim(),
        password: document.getElementById("l-password").value,
      }),
    });
    saveSession(data.token, data.account);
    window.location.href = destinoTrasEntrar(data.account);
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
  }
}

async function submitOlvido(e) {
  e.preventDefault();
  const msg = document.getElementById("forgot-msg");
  const btn = e.target.querySelector("button[type=submit]");
  msg.textContent = ""; msg.className = "form-message";
  btn.disabled = true;
  try {
    const data = await api("/auth/forgot", {
      method: "POST",
      body: JSON.stringify({ email: document.getElementById("f-email").value.trim() }),
    });
    msg.textContent = data.message; msg.classList.add("success");
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
  } finally {
    btn.disabled = false;
  }
}

async function submitRegister(e) {
  e.preventDefault();
  const msg = document.getElementById("register-msg");
  msg.textContent = ""; msg.className = "form-message";

  const body = {
    name: document.getElementById("r-name").value.trim(),
    email: document.getElementById("r-email").value.trim(),
    phone: document.getElementById("r-phone").value.trim(),
    password: document.getElementById("r-password").value,
    practices_self: document.getElementById("r-practices").checked,
    birth_date: document.getElementById("r-birthdate").value || null,
    accept_privacy: document.getElementById("r-privacy").checked,
  };

  try {
    const data = await api("/auth/register", { method: "POST", body: JSON.stringify(body) });
    saveSession(data.token, data.account);
    window.location.href = "mi-familia.html";
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
  }
}
