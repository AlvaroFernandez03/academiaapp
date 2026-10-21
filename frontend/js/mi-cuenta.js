// js/mi-cuenta.js
document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();
  if (!getToken()) { window.location.href = "acceso.html?next=mi-cuenta.html"; return; }

  const acc = getAccount();
  if (acc && acc.must_change_password) {
    document.getElementById("aviso-cuenta").innerHTML =
      `<div class="notice warn">Estás usando una <strong>contraseña temporal</strong> que te ha dado la academia. Escríbela en «Contraseña actual» y elige una nueva que solo sepas tú.</div>`;
    document.getElementById("p-current").focus();
  }

  try {
    const cuenta = await api("/account");
    document.getElementById("a-name").value = cuenta.name;
    document.getElementById("a-email").value = cuenta.email;
    document.getElementById("a-phone").value = cuenta.phone || "";
  } catch (err) {
    document.getElementById("datos-msg").textContent = err.message;
    document.getElementById("datos-msg").classList.add("error");
  }

  document.getElementById("guardar-datos").addEventListener("click", guardarDatos);
  document.getElementById("cambiar-password").addEventListener("click", cambiarPassword);
});

async function guardarDatos() {
  const msg = document.getElementById("datos-msg");
  msg.textContent = ""; msg.className = "form-message";

  try {
    const res = await api("/account", {
      method: "PUT",
      body: JSON.stringify({
        name: document.getElementById("a-name").value.trim(),
        phone: document.getElementById("a-phone").value.trim(),
      }),
    });
    // Actualizamos también el nombre guardado en el navegador, para que la
    // cabecera lo refleje sin tener que volver a iniciar sesión.
    const account = getAccount();
    if (account) {
      account.name = res.name;
      localStorage.setItem("academia_account", JSON.stringify(account));
    }
    msg.textContent = "Datos guardados."; msg.classList.add("success");
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
  }
}

async function cambiarPassword() {
  const msg = document.getElementById("password-msg");
  msg.textContent = ""; msg.className = "form-message";

  const actual = document.getElementById("p-current").value;
  const nueva = document.getElementById("p-new").value;
  const repetida = document.getElementById("p-confirm").value;

  if (nueva !== repetida) {
    msg.textContent = "La nueva contraseña y su repetición no coinciden.";
    msg.classList.add("error");
    return;
  }

  try {
    const data = await api("/account/password", {
      method: "PUT",
      body: JSON.stringify({ current_password: actual, new_password: nueva }),
    });
    // Cambiar la contraseña cierra las sesiones abiertas en otros
    // dispositivos; este navegador recibe una sesión nueva y la guarda.
    const acc = getAccount() || {};
    const eraTemporal = !!acc.must_change_password;
    acc.must_change_password = false;
    saveSession(data.token, acc);
    document.getElementById("aviso-cuenta").innerHTML = "";
    msg.textContent = "Contraseña cambiada correctamente. Si tenías la sesión abierta en otros dispositivos, allí tendrás que volver a entrar.";
    msg.classList.add("success");
    if (eraTemporal && acc.privacy_pending) {
      setTimeout(() => { window.location.href = "privacidad.html?aceptar=1"; }, 1200);
    } else if (eraTemporal) {
      renderHeader();
    }
    document.getElementById("p-current").value = "";
    document.getElementById("p-new").value = "";
    document.getElementById("p-confirm").value = "";
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
  }
}
