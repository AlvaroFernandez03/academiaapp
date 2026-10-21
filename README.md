# AcademiaApp

Aplicación de gestión para una academia de artes marciales, pensada para
**uso real** y para sustituir un software de pago como Maat: cuentas
familiares, horario y reservas con aforo, perfiles, cuotas con pago en
recepción o con tarjeta, avisos por email, copias de seguridad y un panel de
administración para gestionar horario, equipo y alumnos sin tocar código.

**Funciona completa en local**, sin servidor, dominio ni cuentas de pago: los
emails van a una bandeja de pruebas dentro del panel y los pagos con tarjeta
tienen un modo demostración. Así se puede enseñar a la academia (y en un
portfolio) antes de decidir publicarla. Para presentarla, sigue
**`GUION_DEMO.md`**.

> **Estado de los cobros con tarjeta**: de momento en **modo demostración**
> (se ve la opción, no cobra). La integración con Stripe está escrita contra
> su API real y probada con un Stripe simulado (`npm test`), pero **todavía no
> se ha ejecutado contra Stripe**. Si se decide activarla, sigue
> `PRUEBAS_STRIPE.md` con claves de prueba antes de cobrar a nadie.

## Demo en vivo

**[alvarofo-academia.onrender.com](https://alvarofo-academia.onrender.com)** · forma parte de mi portfolio: **[alvarofernandez03.github.io](https://alvarofernandez03.github.io/)**

Dentro tienes una cinta con las cuentas de prueba para entrar con un clic
(contraseña de todas: `academia123`):

| Cuenta | Email |
|---|---|
| Administración de la academia | `admin@academia.com` |
| Familia: madre y dos hijos | `beatriz@ejemplo.com` |
| Instructora (pasar lista) | `marta.instructor@academia.com` |
| Alumno adulto | `carlos@ejemplo.com` |

Está en el plan gratuito de Render: si nadie la ha usado en un rato, tarda
hasta un minuto en despertar. Los datos son de ejemplo y se reinician solos
cada vez que despierta, así que puedes tocar lo que quieras.

En la demo la academia se llama «Academia Tatami» (variable `ACADEMY_NAME`) y el pago con tarjeta está en modo demostración: se ve la opción, pero no cobra.

<details>
<summary>Cómo funciona el modo demo</summary>

La demo pública arranca con la variable `DEMO=1`. Con ella, `backend/demo.js`
añade la cinta con las cuentas de prueba a cada página y bloquea lo que
dejaría fuera a las siguientes visitas (cambiar la contraseña de una cuenta de
prueba, desactivarla...). Sin `DEMO=1`, en tu ordenador, la app funciona
exactamente igual que siempre. La configuración de Render está en el
`render.yaml` del [repositorio del portfolio](https://github.com/AlvaroFernandez03/AlvaroFernandez03.github.io).

</details>

## Cómo ejecutarlo

Requiere Node.js 22.5 o superior.

1. `cd backend && npm install`
2. Copia `.env.example` como `.env` y cambia `JWT_SECRET` (el propio archivo
   explica cómo generar uno)
3. `npm start` y abre **http://localhost:3000**
4. `npm test` ejecuta todas las pruebas automáticas (ver «Pruebas»)

Para una demostración, pon además `STRIPE_DEMO=1` en el `.env`.

Al arrancar, el servidor resume cómo están configurados los pagos y los
emails, hace la primera copia de seguridad y avisa de lo que suele dar
problemas (modo demostración activado, Stripe sin secreto de webhooks,
`JWT_SECRET` corto o de ejemplo, cuentas de ejemplo en una app publicada…).
Sin `JWT_SECRET` no arranca.

**Al actualizar desde una versión anterior**, ejecuta siempre `npm install`
(no `npm ci`): así se instalan las dependencias que hayan cambiado (por
ejemplo, `multer` pasó de la versión 1 a la 2) y se actualiza
`package-lock.json`.

Si ya tenías una base de datos de una versión anterior, **no hace falta
borrarla**: las tablas y columnas nuevas se añaden solas al arrancar. Eso sí,
los alumnos que no tengan cuota solo podrán hacer una clase de prueba (se
puede desactivar en *Cuotas y pagos → Ajustes*).

## Empezar con los datos reales de la academia

Las cuentas y clases de más abajo son **de ejemplo**. Para la academia de verdad:

1. En `backend/.env`: `SEED_DEMO_DATA=0`, `ADMIN_EMAIL=` el email de quien
   dirige la academia, un `JWT_SECRET` propio y `STRIPE_DEMO=0`.
2. Arranca con una base de datos **nueva** (sin `backend/db/academia.db`; si
   quieres conservar la de pruebas, cámbiale el nombre en vez de borrarla).
   La app arranca vacía, solo con los ajustes por defecto.
3. Regístrate en la app con el email de `ADMIN_EMAIL`: esa cuenta es la
   administración principal.
4. En **Administración → Academia**: pon el nombre, el email, el teléfono y
   la dirección, el lema y la presentación de la portada, y **completa el
   aviso de privacidad** (viene un borrador marcado como provisional;
   revisadlo con vuestra gestoría o asesoría).
5. En **Administración**: crea las disciplinas (con su color de cinturón y
   su descripción, que salen en la portada y en su página) y sus grupos,
   añade al equipo (instructores y recepción), y monta el horario.
6. En **Cuotas y pagos → Planes**: crea los planes con los precios reales.
7. Las familias se registran solas desde la app (aceptando el aviso de
   privacidad).

## Cuentas de prueba (contraseña `academia123`)

| Email | Rol |
|---|---|
| admin@academia.com | Administración (panel completo y cuotas) |
| javier.instructor@academia.com | Instructor (BJJ) |
| marta.instructor@academia.com | Instructora (BJJ Infantil, Judo) |
| diego.instructor@academia.com | Instructor (MMA, Kickboxing) |
| carlos@ejemplo.com | Adulto que entrena solo · cuota BJJ en recepción |
| beatriz@ejemplo.com | Familia: Beatriz (cuota Judo), Mateo (cuota Kickboxing) y Sofía (sin cuota) |

4 disciplinas, 8 grupos, 16 clases semanales y 6 planes de ejemplo.

## Decisiones clave

### Cuenta ≠ miembro
Una **cuenta** es quien inicia sesión (el adulto responsable). Un **miembro**
es quien entrena. Una cuenta puede tener varios miembros: el propio adulto (si
entrena) y sus hijos, que no tienen contraseña. Una familia reserva, paga y ve
el progreso de todos con un solo acceso.

### Reservas con aforo y lista de espera
Cada clase tiene aforo. Si está completa, se entra en lista de espera; al
cancelar una plaza, sube automáticamente quien lleve más tiempo esperando.
Se valida el día de la semana, que la fecha no haya pasado, que no se reserve
en nombre de otra familia y que no haya reservas duplicadas.

Reglas de fechas (las aplica el servidor, no solo la pantalla):

- Se reserva y se **anula hasta que empieza la clase**, y como mucho con
  **6 semanas** de antelación (lo mismo que enseña el horario).
- Quien anula **puede volver a reservar** la misma clase; si está llena,
  entra al final de la lista de espera (no recupera su puesto). También tras
  deshacer la cancelación de una sesión (festivo que al final no lo es).
- Una reserva marcada como **asistida no se puede anular**: es historial (y
  así nadie "devuelve" su clase de prueba para repetirla gratis).
- La **asistencia** se marca el día de la clase o después, nunca antes, y se
  puede **deshacer** si se marcó a quien no era. Quien ya tiene la asistencia
  marcada sigue ocupando su plaza en el aforo.
- *Mis reservas* separa las **próximas** (con el botón Anular) del
  **historial** (asistidas, anuladas y pasadas).

### Cuotas: dos formas de pago que conviven
- **En recepción** (efectivo, Bizum, transferencia, datáfono): la familia
  contrata desde la app ("pendiente de pago") y la administración pulsa
  *Registrar pago* (1 a 12 meses).
- **Con tarjeta**: se guarda **una vez** en la página segura de Stripe (los
  datos de la tarjeta nunca pasan por nuestro servidor) y cada cuota se cobra
  sola cada mes.

Stripe es **opcional**: sin `STRIPE_SECRET_KEY`, la app funciona solo con pago
en recepción, así la academia puede empezar antes de tener cuenta en Stripe.

**Modo demostración** (`STRIPE_DEMO=1` en el `.env`; en `.env.example` viene
desactivado): sin
clave de Stripe, las familias ven la opción "Con tarjeta" y el botón "Añadir
tarjeta", pero al usarlos solo aparece un aviso de "próximamente". No se
guarda ninguna tarjeta ni se crea ninguna cuota o pago. Sirve para presentar
la app. Si la academia decide cobrar con tarjeta: crear la cuenta de Stripe,
poner `STRIPE_SECRET_KEY` (la clave manda sobre la demo), quitar
`STRIPE_DEMO` y seguir `PRUEBAS_STRIPE.md`. Si se queda activado con alumnos
reales, verían un botón de tarjeta que no hace nada: el servidor lo recuerda
al arrancar. La protección no depende de la pantalla: aunque alguien fuerce la
petición, el servidor rechaza cualquier pago con tarjeta sin Stripe.

### Planes
Por disciplina (*BJJ mensual*) o combinados (*Ilimitado*), con límite
semanal opcional (*BJJ 2 días/semana*). Cambiar el precio de un plan solo
afecta a altas nuevas: cada cuota conserva el precio con el que se contrató.

### Cobro familiar configurable
*Cuotas y pagos → Ajustes*: **un cargo por cuota**, o **un único cargo
mensual por familia** (cada hijo es una línea del mismo recibo).

### Pausas y bajas
- **Pausa** (lesión, vacaciones) hasta una fecha, máximo configurable (90 días
  por defecto); se reanuda sola. En recepción, los días pausados se suman a la
  fecha pagada.
- **Baja** a final del periodo pagado: ni se devuelve ni se vuelve a cobrar.

### Cuotas y reservas
Con "exigir cuota" activado (por defecto), reservar requiere una cuota activa
que incluya esa disciplina. Sin cuota, se permite **una clase de prueba
gratuita** (configurable), marcada para el instructor al pasar lista.

### Protecciones en los cobros
- **Nunca se cobra dos veces la misma cuota**: un cerrojo en la base de datos
  deja que solo una petición la active, y cada envío a Stripe lleva una clave
  de idempotencia. Hay una prueba que lo verifica y que falla si se quita el
  cerrojo.
- **Los avisos (webhooks) de Stripe se verifican con su firma** y se procesan
  una sola vez aunque lleguen repetidos.
- No se puede registrar en recepción el pago de una cuota que se cobra con
  tarjeta.
- **El portal de Stripe no permite cancelar ni cambiar de plan**: la app lo
  abre siempre con una configuración propia creada por API, así un padre no
  puede dar de baja sin querer a toda la familia (las bajas van por la app).
  Si la configuración guardada no existe (por ejemplo, al pasar de claves de
  prueba a reales, que son cuentas distintas) crea otra; ante cualquier otro
  error de Stripe no crea nada, para no acumular configuraciones.

### Portada y páginas de disciplina
La portada (`index.html`) se pinta sola con los datos de la app: el nombre,
el lema y la presentación de *Administración → Academia*; las clases de hoy
en una línea de tiempo; una banda por disciplina con su color, descripción,
grupos y equipo; *Cómo empezar* en cinco pasos (el cinturón cambia de
blanco a negro según se baja); el equipo; las cuotas como tablón de
precios; y cuándo hay clase cada día, con el contacto. Si se añade una
disciplina o cambia un precio, la portada cambia sola.

Cada disciplina tiene su página (`disciplina.html?d=bjj`, enlazada desde el
menú *Disciplinas*): grupos y edades, clases de la semana, quién la imparte
y las cuotas que la incluyen.

Lo que aparece al bajar lo controla `js/aparecer.js` (atributo
`data-aparece`). Con *reducir movimiento* activado en el sistema no se anima
nada. Los datos salen de `GET /api/public/home`, que solo devuelve lo que ya
es público en el horario más los precios y el contacto: nada de alumnos ni
datos del equipo.

### Panel de administración
En *Administración* (solo cuentas de administración):

- **Resumen**: clases de hoy con su ocupación (y acceso directo a pasar
  lista), cuotas con pago pendiente y sesiones canceladas próximas.
- **Horario**: crear, editar y quitar clases; **cancelar un día concreto**
  (festivo, instructor enfermo…). Una misma persona no puede dar dos clases a
  la vez. Si se amplía el aforo, quien estaba en lista de espera pasa a tener
  plaza.
- **Disciplinas y grupos**: crear, editar (nombre, color de cinturón y
  descripción), archivar.
- **Equipo**: dar de alta instructores y administración con una **contraseña
  temporal** (se pide cambiarla al entrar), cambiar roles, desactivar cuentas.
  Si el email ya es de una familia (un padre que también da clases), se le
  da el rol sin duplicar la cuenta.
- **Alumnos**: familias con sus miembros, cuotas y última asistencia;
  búsqueda y filtros; ficha con contacto de emergencia, notas médicas,
  graduaciones y últimas reservas; dar una contraseña temporal a quien no
  pueda usar «¿Has olvidado tu contraseña?».
- **Academia**: nombre y email de contacto, editor del **aviso de
  privacidad** (con vista previa) y **copias de seguridad** (hacer una y
  descargarla).
- **Emails**: registro de los emails enviados y, en modo local, la bandeja
  de pruebas para leerlos.

Reglas que protegen el día a día:

- **Nunca se borra historial.** Lo que ya se ha usado (una clase con
  reservas, un grupo con clases, una disciplina con cuotas) se **archiva**; solo
  se puede borrar lo creado por error que nunca se usó.
- **Quien ya ha reservado no se queda colgado.** Al quitar una clase o
  cancelar un día, sus reservas se cancelan y la familia ve el motivo en *Mis
  reservas*. Con reservas próximas, una clase no se puede mover de día ni de
  grupo (quedarían en una clase que ya no existe): se crea otra y se quita
  esta. Cada familia afectada **recibe un email** con el motivo; si es con
  poca antelación, conviene avisar también por el canal habitual (WhatsApp).
- **La academia no se queda sin administración.** Nadie puede quitarse su
  propio rol ni desactivarse; siempre queda al menos una cuenta de
  administración activa, y la de `ADMIN_EMAIL` no se puede degradar.
- **Una cuenta desactivada deja de funcionar al momento**, incluida una sesión
  que ya tuviera abierta. No se puede desactivar a quien da clases (hay que
  reasignarlas) ni a una familia con cuotas vivas (se dan de baja primero).

### Emails
La app envía emails en tres casos: **recuperar la contraseña**, **una clase
cancelada** con reservas (a cada familia afectada) y **problemas con una
cuota** (vencida en recepción o cobro con tarjeta rechazado). Nunca envía
contraseñas.

- **Modo local** (por defecto): no sale nada a Internet. Cada email se guarda
  en *Administración → Emails*, donde se puede leer entero, incluido el
  enlace de recuperar la contraseña. Es el modo para probar y enseñar la app.
- **Brevo** (cuando se publique): con `EMAIL_PROVIDER=brevo`, la clave de API
  y el remitente en el `.env` (ver `.env.example`), los emails se envían de
  verdad. El registro guarda a quién y cuándo, pero no el contenido.

Si un email falla, la acción que lo provoca (cancelar una clase, etc.) sigue
adelante: el error queda en el registro.

### Aviso de privacidad
Para registrarse hay que aceptar el aviso de privacidad (también en nombre de
los menores de la cuenta). La academia lo edita en el panel:

- **Corregir erratas** guarda el texto sin molestar a nadie.
- **Publicar nueva versión** (cambios de contenido) hace que cada cuenta,
  incluido el equipo, tenga que leerla y aceptarla al entrar. El panel indica
  cuántas faltan. Queda guardado qué versión aceptó cada cuenta y cuándo.

El texto que trae la app es un **borrador provisional** con huecos
[entre corchetes]: el panel avisa mientras no se complete. No es
asesoramiento legal.

### Copias de seguridad
Una copia diaria de la base de datos (hecha con `VACUUM INTO`, coherente
aunque haya gente reservando en ese momento) y de las fotos; se guardan las
14 últimas (`BACKUP_KEEP`). Desde *Administración → Academia* se puede hacer
una en el momento y descargarla. Esas copias están en el mismo ordenador que
la app: protegen de errores, no de perder el servidor. Hay que descargar una
de vez en cuando y guardarla fuera.

Para **restaurar** una copia: parar la app, sustituir `backend/db/academia.db`
por el archivo descargado (con el mismo nombre; si existen,
borrar `academia.db-wal` y `academia.db-shm`) y volver a arrancarla.

### Seguridad
- **Contraseñas**: mínimo 8 caracteres, guardadas cifradas con bcrypt.
  Cambiarla o restablecerla **cierra las sesiones abiertas en otros
  dispositivos**.
- **Recuperar la contraseña** con un enlace de un solo uso que caduca en una
  hora (en la base de datos solo se guarda su huella, no el enlace). La
  respuesta es la misma exista o no la cuenta, para no revelar qué emails
  están registrados.
- **Límite de intentos**: tras 8 contraseñas incorrectas seguidas para un
  email (o 30 desde una misma conexión) se bloquea 15 minutos; también se
  limitan el registro y las peticiones de recuperar contraseña.
- **Cabeceras de seguridad**: el navegador solo ejecuta el código de la propia
  app (Content-Security-Policy), la app no se puede meter dentro de otra web,
  y los datos personales no se guardan en cachés.
- **Todo lo que escriben las familias se escapa** antes de mostrarlo
  (nombres, notas médicas…), y las fotos se comprueban por su contenido real,
  no solo por la extensión.
- Una cuenta desactivada deja de funcionar al momento.

### Perfiles
Foto de perfil **por miembro** (la ve el instructor al pasar lista),
"Sobre mí", edición completa desde *Mi familia*, y *Mi cuenta* con cambio de
contraseña (pidiendo la actual). Las fotos se guardan con nombres no
adivinables y solo el titular puede cambiarlas.

## Estructura

```
academia/
├── README.md, PRUEBAS_STRIPE.md
├── backend/
│   ├── server.js                -> rutas, webhook de Stripe, revisión horaria de cuotas y copias
│   ├── db/
│   │   ├── schema.js              -> cuentas, miembros, disciplinas, grupos, horario, reservas, graduaciones
│   │   ├── schema-billing.js      -> ajustes, planes, cuotas, pagos, eventos de Stripe
│   │   ├── seed.js, seed-billing.js -> datos de ejemplo (SEED_DEMO_DATA=0 para no crearlos)
│   │   ├── seed-app.js            -> ajustes generales y borrador del aviso de privacidad
│   │   └── database.js            -> ACADEMIA_DB_PATH permite otra base de datos (pruebas)
│   ├── routes/
│   │   ├── auth.js                -> registro, entrar, recuperar contraseña
│   │   ├── account.js, family.js, schedule.js, bookings.js
│   │   ├── public.js              -> datos de la academia, portada y aviso de privacidad
│   │   ├── billing.js             -> cuotas desde la familia
│   │   ├── admin.js               -> panel de administración
│   │   ├── admin-billing.js       -> cuotas, pagos, planes y ajustes (admin)
│   │   └── stripe-webhook.js      -> avisos de Stripe (verifica la firma)
│   ├── services/
│   │   ├── bookingService.js      -> aforo y lista de espera
│   │   ├── entitlements.js        -> ¿puede reservar? (cuota, prueba, límite semanal)
│   │   ├── admin.js               -> horario, sesiones canceladas, disciplinas, grupos, equipo, alumnos
│   │   ├── billing.js             -> toda la lógica de cuotas y Stripe
│   │   ├── stripeEvents.js        -> procesamiento de webhooks
│   │   ├── email.js               -> emails (modo local o Brevo) y sus textos
│   │   ├── backup.js              -> copias de seguridad
│   │   ├── stripeClient.js, settings.js
│   ├── middleware/                -> auth.js, upload.js (fotos), rateLimit.js, seguridad.js
│   ├── utils/                     -> dates.js, security.js
│   └── tests/
│       ├── billing.test.js        -> 25 pruebas de cuotas con Stripe simulado
│       ├── admin.test.js          -> 31 pruebas del panel y de las reglas de reservas
│       └── api.test.js            -> 25 pruebas contra el servidor real (permisos, seguridad, portada...)
└── frontend/
    ├── index.html                 -> portada (js/inicio.js; animaciones al bajar en js/aparecer.js)
    ├── disciplina.html            -> página de cada disciplina (js/disciplina.js)
    ├── acceso, horario, mis-reservas, mi-familia, mi-cuenta
    ├── privacidad.html            -> aviso de privacidad (y aceptarlo)
    ├── restablecer.html           -> elegir contraseña nueva con el enlace del email
    ├── mis-cuotas.html            -> cuotas de la familia, tarjeta, historial de pagos
    ├── admin.html                 -> panel de administración (js/admin.js, admin-horario.js, admin-academia.js)
    ├── admin-cuotas.html          -> cuotas y pagos (admin)
    └── pasar-lista.html           -> instructores
```

## Pruebas

`npm test` ejecuta las tres baterías (81 pruebas, unos segundos). Todas usan
una base de datos y carpetas de fotos y copias **temporales** y fijan sus
propias variables: nunca tocan tu base de datos, tus fotos, tu Stripe ni
envían emails.

- `npm run test:cuotas`: lógica de cuotas con un Stripe simulado.
- `npm run test:admin`: lógica del panel (horario, cancelaciones, roles…) y
  las reglas de reservas (volver a reservar, anular, pasar lista).
- `npm run test:api`: arranca el servidor de verdad y le hace peticiones
  HTTP: que una familia o un instructor **no** puedan usar el panel, cuentas
  desactivadas, fotos, límite de intentos, cabeceras de seguridad, recuperar
  la contraseña de principio a fin, aviso de privacidad, emails y copias.

Las protecciones importantes se han comprobado también «al revés»: quitándolas
a propósito, alguna prueba falla (si no, la prueba no protegería nada).

## Datos sensibles y menores

La app guarda fotos, contacto de emergencia y notas médicas (alergias,
lesiones) de alumnos, muchos menores. Es necesario para dar el servicio con
seguridad, pero antes de usarla con alumnos reales la academia necesita:

1. **Completar el aviso de privacidad** (*Administración → Academia*) con sus
   datos y revisarlo con alguien con competencia en protección de datos. El
   que trae la app es un borrador, no asesoramiento legal.
2. Decidir quién accede a las notas médicas (ahora, cualquier instructor al
   pasar lista, y la administración en la ficha del alumno).
3. No subir nunca `backend/uploads/`, `backend/backups/`, la base de datos ni
   el `.env` a un repositorio (están en `.gitignore`).

## Próximos pasos

1. **Presentarla a la academia** en local (`GUION_DEMO.md`).
2. Si sigue adelante, **publicarla**: servidor con HTTPS y dominio (ver
   «Publicarla en Internet»), Brevo para los emails y diseño final.
3. **Graduaciones**: registrar ascensos de grado desde la app (ahora solo se
   ven en la ficha del alumno).
4. **Check-in con QR**.
5. **Cobro con tarjeta real**, cuando la academia lo decida: `PRUEBAS_STRIPE.md`.

## Publicarla en Internet (cuando se decida)

Nada de esto hace falta para la demostración en local.

1. Un servidor pequeño (un VPS con Node 22) y un dominio.
2. Un proxy con HTTPS delante (Caddy lo configura solo) y `TRUST_PROXY=1`.
3. En el `.env`: `FRONTEND_URL=https://el-dominio`, un `JWT_SECRET` nuevo y
   largo, `SEED_DEMO_DATA=0`, `STRIPE_DEMO=0`, y Brevo para los emails.
4. `UPLOADS_DIR` y `BACKUP_DIR` en un disco que no se borre al actualizar, y
   las copias del proveedor del servidor activadas (o descargar las del panel).
5. Mantener la app arrancada con un gestor de procesos (systemd o pm2).

Al arrancar, el servidor avisa si detecta algo propio de una prueba en una
app publicada (emails en modo local, cuentas de ejemplo, falta
`TRUST_PROXY`).

## Notas de seguridad

- Cambia `JWT_SECRET` en `.env` antes de usarlo con datos reales.
- Usa claves de Stripe **de prueba** (`sk_test_…`) hasta haberlo probado todo,
  y las **live** solo con la app desplegada con HTTPS.
