// js/privacidad.js — aviso de privacidad (y aceptarlo si hay versión nueva)
document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();
  const cont = document.getElementById("texto-privacidad");
  try {
    const p = await api("/public/privacy");
    cont.innerHTML =
      textoConFormato(p.text) +
      `<p class="muted" style="font-size:0.82rem; margin-top:24px;">Versión ${p.version}${p.updated_at ? ` · actualizada el ${formatFecha(p.updated_at)}` : ""}</p>`;
  } catch (err) {
    cont.innerHTML = `<p class="form-message error">${esc(err.message)}</p>`;
    return;
  }

  // Con sesión iniciada y una versión pendiente de aceptar: botón para aceptarla.
  const cuenta = getAccount();
  if (!getToken() || !cuenta || !cuenta.privacy_pending) return;
  document.getElementById("aceptar-arriba").innerHTML = `
    <div class="notice warn">La academia ha publicado su aviso de privacidad (o lo ha actualizado). Léelo y acéptalo para seguir usando la app. Al final de la página tienes el botón.</div>`;
  document.getElementById("aceptar-abajo").innerHTML = `
    <div class="form-card" style="margin:24px 0 0; max-width:none;">
      <p style="margin-bottom:12px;">Al aceptar, confirmas que has leído este aviso, también en nombre de los menores de tu cuenta.</p>
      <button class="btn btn-primary" id="btn-aceptar">He leído y acepto el aviso de privacidad</button>
      <p id="aceptar-msg" class="form-message"></p>
    </div>`;
  document.getElementById("btn-aceptar").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await api("/account/accept-privacy", { method: "POST" });
      localStorage.setItem("academia_account", JSON.stringify({ ...getAccount(), privacy_pending: false }));
      window.location.href = "index.html";
    } catch (err) {
      const msg = document.getElementById("aceptar-msg");
      msg.textContent = err.message; msg.className = "form-message error";
      e.target.disabled = false;
    }
  });
});
