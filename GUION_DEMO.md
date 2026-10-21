# Guion para presentar AcademiaApp a la academia

Una demostración de unos 20 minutos, en local, con los datos de ejemplo. No
hace falta servidor, dominio ni ninguna cuenta de pago: los emails se quedan
en una bandeja dentro de la app y el pago con tarjeta está en modo
demostración.

## Antes de la reunión (10 minutos, el día antes)

1. En `backend/.env`: `SEED_DEMO_DATA=1` y `STRIPE_DEMO=1`.
2. Empieza con una base de datos limpia: si existe `backend/db/academia.db`,
   cámbiale el nombre (por ejemplo `academia-antes-demo.db`) para conservarla.
3. `cd backend && npm start` y abre http://localhost:3000.
4. **Abre dos navegadores** (o uno normal y una ventana privada): en uno
   entrarás como la academia y en el otro como una familia. Así se ve en
   directo cómo lo que hace uno le llega al otro.
5. En la ventana de la academia, entra con `admin@academia.com` y en
   *Administración → Academia* pon el nombre real de la academia, su
   teléfono y dirección y, si queréis, un lema (salen en la portada, los
   emails y el aviso de privacidad). En *Disciplinas y grupos → Editar*
   puedes ajustar el color de cinturón y la descripción de cada disciplina.
6. Si vas a enseñarlo en un móvil: la app se adapta a pantallas pequeñas;
   en el portátil, las herramientas del navegador (F12 → icono de móvil)
   muestran cómo se vería.

Todas las cuentas de ejemplo tienen la contraseña `academia123`.

## 1. El problema que resuelve (1 minuto)

Hoy pagáis Maat. Esta app hace lo que usáis en el día a día (familias,
horario, reservas, cuotas, pasar lista) y es vuestra: sin cuota mensual por
el programa, solo el alojamiento si decidís usarla.

## 1b. La portada (1 minuto) — sin iniciar sesión

Abre http://localhost:3000 y baja despacio: las clases de hoy, las
disciplinas con su color, *Cómo empezar* (el cinturón pasa de blanco a negro
según bajas), el equipo, las cuotas y cuándo hay clase. Todo sale de los
datos de la app: si cambiáis un precio o una clase, la portada cambia sola.
Pulsa una disciplina para enseñar su página.

## 2. Una familia (5 minutos) — ventana de la familia

Entra con **beatriz@ejemplo.com**: una madre que entrena y tiene a Mateo y a
Sofía apuntados.

- **Mi familia**: una sola cuenta para toda la familia. Cada miembro con su
  foto, contacto de emergencia y notas médicas (Mateo tiene alergia a frutos
  secos). Los hijos no necesitan contraseña.
- **Horario**: por día y disciplina, con la edad de cada grupo y las plazas
  libres. Reserva a **Sofía** en *Judo Infantil*: como no tiene cuota, la app
  le deja una **clase de prueba gratuita** (y avisa al instructor).
- **Mis reservas**: las próximas (se pueden anular hasta que empiece la
  clase) y el historial.
- **Cuotas**: las cuotas de cada miembro, lo pagado y lo pendiente. «Con
  tarjeta» se puede enseñar, pero en esta demostración no cobra nada.

## 3. Lista de espera (2 minutos) — las dos ventanas

1. Academia: *Administración → Horario*, edita *BJJ Competición* del martes y
   pon **aforo 1**.
2. En la ventana de la familia, sal y entra con **carlos@ejemplo.com**:
   reserva ese martes. La clase queda llena.
3. Sal y entra con **beatriz@ejemplo.com**: al reservar esa misma clase,
   entra en **lista de espera**.
4. Vuelve a Carlos y cancela su reserva: Beatriz **sube sola** a tener plaza.
5. (Deja el aforo como estaba al terminar.)

## 4. El instructor (2 minutos) — ventana de la familia

Entra con **marta.instructor@academia.com** → **Pasar lista**: elige *Judo
Infantil*. Ve quién viene, con foto, la marca de «clase de prueba» de Sofía
y el aviso médico cuando lo hay. La asistencia se marca con un toque el día
de la clase (si la de Sofía es otro día, la app lo avisa: para enseñarlo en
directo, reserva antes una clase de hoy que aún no haya empezado). Si te
equivocas, se deshace con otro toque.

## 5. La academia (6 minutos) — ventana de la academia

*Administración*:

- **Resumen**: las clases de hoy con su ocupación, las cuotas pendientes y
  las cancelaciones próximas.
- **Horario → cancelar un día**: cancela la *Judo Infantil* donde reservó
  Sofía, con el motivo «Festivo local». Enseña que:
  - Beatriz ve la cancelación y el motivo en *Mis reservas*.
  - Ya nadie puede reservar ese día.
  - En **Emails** aparece el aviso que le ha llegado a Beatriz (pulsa *Ver*).
- **Equipo**: dar de alta a un instructor nuevo. La app genera una contraseña
  temporal y le obliga a cambiarla al entrar.
- **Alumnos**: buscar una familia y abrir la ficha de un alumno (contacto de
  emergencia, notas médicas, graduaciones, asistencia).
- **Cuotas y pagos**: registrar un pago en recepción (efectivo, Bizum…) y ver
  el estado de todas las cuotas.

## 6. Seguridad y tranquilidad (3 minutos)

- **Contraseña olvidada**: en la ventana de la familia, sal, pulsa
  «¿Has olvidado tu contraseña?» y pon `carlos@ejemplo.com`. En la ventana de
  la academia, *Emails → Ver*: ahí está el email con el enlace. Ábrelo **en
  la ventana de la familia** (si lo abres en la de la academia, se cierra la
  sesión de administración) y elige una contraseña nueva. Cuando la app
  esté publicada, este email llega de verdad al correo de la familia.
- **Aviso de privacidad**: *Academia → Aviso de privacidad*. Para
  registrarse hay que aceptarlo, y si lo cambiáis, la app pide aceptarlo de
  nuevo a todas las cuentas y os dice cuántas faltan.
- **Copias de seguridad**: una al día, automática. *Hacer copia ahora* y
  *Descargar* para guardarla fuera.
- Contraseñas cifradas, bloqueo tras muchos intentos fallidos, y cada familia
  solo ve lo suyo (hay 81 pruebas automáticas que lo comprueban).

## 7. Qué haría falta para usarla de verdad (1 minuto)

| | Coste orientativo |
|---|---|
| Servidor pequeño en Europa | unos 5 € al mes |
| Dominio (p. ej. `academia-nombre.es`) | unos 10 € al año |
| Emails (Brevo, plan gratuito: 300 al día) | 0 € |
| Pagos con tarjeta (Stripe), si se quieren | comisión por cobro, sin cuota fija |

Los precios son orientativos: hay que confirmarlos al contratar.

Pasos: contratar servidor y dominio, publicarla con HTTPS, completar el aviso
de privacidad con vuestra asesoría, crear vuestras clases y planes reales y
avisar a las familias para que se registren.

## Preguntas para la academia

Conviene salir de la reunión con respuesta a estas preguntas:

1. **Notas médicas**: ¿las debe ver cualquier instructor al pasar lista, o
   solo el de esa clase o solo la dirección?
2. **Cobro**: ¿seguís cobrando en recepción, o queréis activar el pago con
   tarjeta (Stripe) para las cuotas mensuales?
3. **Datos de Maat**: ¿las familias se registran de nuevo (lo más sencillo),
   o hay que pasar los datos desde una exportación de Maat?
4. **Reglas**: ¿exigir cuota para reservar? ¿una clase de prueba gratis?
   ¿cuántos días se puede pausar una cuota?
5. **Edades**: ¿la app debe impedir reservar en un grupo que no es de la
   edad del alumno? (Ahora la edad se muestra, pero no se bloquea.)
6. **Quién la administra**: qué personas de recepción o dirección tendrán
   cuenta de administración.
7. **Nombre del dominio** que os gustaría.

## Después de la demostración

Para volver a los datos de antes, para la app y recupera el nombre original de
tu base de datos (`academia.db`). Para empezar la academia real, sigue
«Empezar con los datos reales de la academia» en el `README.md`.
