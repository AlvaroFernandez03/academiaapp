// js/mi-familia.js
let miembrosCache = [];

document.addEventListener("DOMContentLoaded", async () => {
  await renderHeader();
  if (!getToken()) { window.location.href = "acceso.html"; return; }

  document.getElementById("btn-add-member").addEventListener("click", () => mostrarFormulario(null));
  cargarMiembros();
});

async function cargarMiembros() {
  const cont = document.getElementById("members-list");
  cont.innerHTML = "<p class='muted'>Cargando…</p>";

  try {
    miembrosCache = await api("/family/members");

    if (miembrosCache.length === 0) {
      cont.innerHTML = `<div class="empty-state"><p>Todavía no hay nadie en tu familia. Añade a un hijo/a para poder reservarle clases.</p></div>`;
      return;
    }

    cont.innerHTML = miembrosCache.map(tarjetaMiembro).join("");
    document.querySelectorAll("[data-editar-miembro]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = miembrosCache.find((x) => x.id === Number(btn.dataset.editarMiembro));
        mostrarFormulario(m);
      });
    });
  } catch (err) {
    cont.innerHTML = `<p class="form-message error">${esc(err.message)}</p>`;
  }
}

function tarjetaMiembro(m) {
  const edad = m.birth_date ? calcularEdad(m.birth_date) : null;
  return `
    <div class="member-card">
      <div class="member-top">
        ${avatarHtml(m)}
        <div>
          <strong>${esc(m.first_name)} ${esc(m.last_name)}</strong>
          <span class="badge">${m.is_dependent ? "Hijo/a" : "Titular"}</span>
          <div class="muted" style="font-size:0.84rem; margin-top:3px;">
            ${edad !== null ? edad + " años" : "Sin fecha de nacimiento"}
            ${m.medical_notes ? " · " + esc(m.medical_notes) : ""}
          </div>
          ${m.bio ? `<div class="member-bio">"${esc(m.bio)}"</div>` : ""}
        </div>
      </div>
      <button class="btn btn-outline btn-sm" data-editar-miembro="${m.id}">Editar</button>
    </div>`;
}

function calcularEdad(birthDate) {
  const hoy = new Date();
  const nacimiento = new Date(birthDate);
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const m = hoy.getMonth() - nacimiento.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nacimiento.getDate())) edad--;
  return edad;
}

// ---------------------------------------------------------------------------
// Formulario compartido para "añadir" (member = null) y "editar" (member con datos)
// ---------------------------------------------------------------------------
function mostrarFormulario(member) {
  const cont = document.getElementById("form-member");
  cont.classList.remove("hidden");
  const esNuevo = !member;

  cont.innerHTML = `
    <div class="form-card" style="margin:0;">
      <h3 style="margin-bottom:14px;">${esNuevo ? "Añadir hijo/a" : "Editar " + esc(member.first_name)}</h3>

      ${
        !esNuevo
          ? `<div class="avatar-upload-row">
               ${avatarHtml(member, true)}
               <div>
                 <input type="file" id="m-avatar-input" accept="image/jpeg,image/png,image/webp">
                 <p class="muted" style="font-size:0.78rem; margin-top:4px;">JPG, PNG o WEBP, máx. 3 MB.</p>
                 ${member.avatar_file ? `<button type="button" class="link-remove-photo" id="quitar-foto">Quitar foto</button>` : ""}
               </div>
             </div>`
          : `<p class="muted" style="font-size:0.82rem; margin-bottom:14px;">Podrás añadir una foto después de guardar.</p>`
      }

      <div class="field"><label for="m-first">Nombre</label><input id="m-first" value="${member ? esc(member.first_name) : ""}" required></div>
      <div class="field"><label for="m-last">Apellidos</label><input id="m-last" value="${member ? esc(member.last_name) : ""}" required></div>
      <div class="field"><label for="m-birth">Fecha de nacimiento</label><input type="date" id="m-birth" value="${member && member.birth_date ? member.birth_date : ""}"></div>
      <div class="field"><label for="m-contact">Contacto de emergencia (si es distinto de ti)</label><input id="m-contact" value="${member ? esc(member.emergency_contact_phone || "") : ""}" placeholder="Nombre y teléfono"></div>
      <div class="field"><label for="m-medical">Alergias o notas médicas (opcional)</label><textarea id="m-medical" rows="2">${member ? esc(member.medical_notes || "") : ""}</textarea></div>
      <div class="field"><label for="m-bio">Sobre mí (opcional)</label><textarea id="m-bio" rows="2" placeholder="Objetivos, algo que quieras contar…">${member ? esc(member.bio || "") : ""}</textarea></div>

      <button class="btn btn-primary" id="guardar-member">Guardar</button>
      <button class="btn btn-outline" id="cancelar-member" style="margin-left:8px;">Cancelar</button>
      <p id="member-msg" class="form-message"></p>
    </div>`;

  document.getElementById("cancelar-member").addEventListener("click", () => { cont.classList.add("hidden"); cont.innerHTML = ""; });
  document.getElementById("guardar-member").addEventListener("click", () => guardarMiembro(member ? member.id : null));

  if (!esNuevo) {
    document.getElementById("m-avatar-input").addEventListener("change", (e) => cambiarFoto(member.id, e.target.files[0]));
    const btnQuitar = document.getElementById("quitar-foto");
    if (btnQuitar) btnQuitar.addEventListener("click", () => quitarFoto(member.id));
  }
}

async function guardarMiembro(memberId) {
  const msg = document.getElementById("member-msg");
  msg.textContent = ""; msg.className = "form-message";

  const body = {
    first_name: document.getElementById("m-first").value.trim(),
    last_name: document.getElementById("m-last").value.trim(),
    birth_date: document.getElementById("m-birth").value || null,
    emergency_contact_phone: document.getElementById("m-contact").value.trim() || null,
    medical_notes: document.getElementById("m-medical").value.trim() || null,
    bio: document.getElementById("m-bio").value.trim() || null,
  };

  try {
    if (memberId) {
      await api(`/family/members/${memberId}`, { method: "PUT", body: JSON.stringify(body) });
    } else {
      await api("/family/members", { method: "POST", body: JSON.stringify(body) });
    }
    document.getElementById("form-member").classList.add("hidden");
    document.getElementById("form-member").innerHTML = "";
    cargarMiembros();
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
  }
}

// ---------------------------------------------------------------------------
// Foto de perfil
// ---------------------------------------------------------------------------
// Tras subir o quitar la foto, cerramos el formulario y refrescamos la
// lista, en vez de intentar reabrirlo con los datos actualizados: como
// cargarMiembros() es asíncrono, hacerlo así evitaba una condición de
// carrera (mostrar el formulario antes de que la caché tuviera la foto
// nueva). Si quiere seguir editando, vuelve a pulsar "Editar".
async function cambiarFoto(memberId, file) {
  if (!file) return;
  const msg = document.getElementById("member-msg");
  msg.textContent = "Subiendo foto…"; msg.className = "form-message";

  try {
    await subirAvatar(memberId, file);
    document.getElementById("form-member").classList.add("hidden");
    document.getElementById("form-member").innerHTML = "";
    cargarMiembros();
  } catch (err) {
    msg.textContent = err.message; msg.classList.add("error");
  }
}

async function quitarFoto(memberId) {
  try {
    await api(`/family/members/${memberId}/avatar`, { method: "DELETE" });
    document.getElementById("form-member").classList.add("hidden");
    document.getElementById("form-member").innerHTML = "";
    cargarMiembros();
  } catch (err) {
    alert(err.message);
  }
}
