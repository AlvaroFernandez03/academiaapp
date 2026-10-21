// js/restablecer.js — elegir contraseña nueva con el enlace del email
document.addEventListener("DOMContentLoaded", async () => {
  // El enlace de un solo uso se quita de la barra de direcciones en cuanto se
  // lee, para que no quede en el historial ni se comparta por error.
  const token = new URLSearchParams(location.search).get("token");
  history.replaceState(null, "", "restablecer.html");
  // Si había otra sesión abierta en este navegador, se cierra: la contraseña
  // que se va a cambiar puede ser de otra cuenta.
  localStorage.removeItem("academia_token");
  localStorage.removeItem("academia_account");
  await renderHeader();

  const form = document.getElementById("reset-form");
  const msg = document.getElementById("reset-msg");
  if (!token) {
    form.innerHTML = `<p class="form-message error">Falta el enlace. Ábrelo desde el email, o pide uno nuevo en <a class="btn-link" href="acceso.html">Iniciar sesión</a> → «¿Has olvidado tu contraseña?».</p>`;
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = ""; msg.className = "form-message";
    const nueva = document.getElementById("n-pass").value;
    if (nueva !== document.getElementById("n-pass2").value) {
      msg.textContent = "Las dos contraseñas no coinciden."; msg.classList.add("error");
      return;
    }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const data = await api("/auth/reset", { method: "POST", body: JSON.stringify({ token, new_password: nueva }) });
      saveSession(data.token, data.account);
      form.innerHTML = `<div class="notice ok">Contraseña cambiada. Ya has entrado con ella.</div><a class="btn btn-primary" href="index.html">Continuar</a>`;
    } catch (err) {
      msg.textContent = err.message; msg.classList.add("error");
      btn.disabled = false;
    }
  });
});
