# Probar los cobros con Stripe de verdad (modo pruebas)

Todo esto se hace con las **claves de prueba** de Stripe (`sk_test_…`): no se
mueve dinero real. Pensado para hacerlo con Claude Code en tu ordenador.

## 0. Pruebas automáticas (sin Stripe)

```bash
cd backend
npm install
npm test
```

Deben salir tres líneas: **25/25** (cuotas), **25/25** (panel de
administración) y **22/22** (API real). Usan un Stripe simulado y una base de
datos temporal: no tocan la base de datos real ni se conectan a nada.

## 1. Preparar la cuenta de Stripe

1. Crea la cuenta en https://dashboard.stripe.com (a nombre de la academia).
   Mientras no la actives, todo funciona en **modo pruebas**.
2. En *Desarrolladores → Claves de API*, copia la **clave secreta de prueba**
   (`sk_test_…`).
3. El **portal de clientes** no hay que configurarlo a mano: la primera vez
   que alguien pulsa "Cambiar tarjeta y ver facturas", la app crea por API su
   propia configuración (solo cambiar tarjeta y ver facturas; **sin cancelar
   ni cambiar de plan**) y la usa siempre. Las bajas se hacen desde la app,
   que sabe si una cuota comparte cargo con otras de la familia; si se
   cancelaran desde el portal, se daría de baja a toda la familia a la vez.
   Si alguien activara la cancelación en esa configuración, la app lo detecta
   y crea otra segura. Aun así, por si acaso, desactiva también "Cancelar
   suscripciones" en *Configuración → Facturación → Portal de clientes*.

## 2. Configurar el `.env`

```
STRIPE_SECRET_KEY=sk_test_…
FRONTEND_URL=http://localhost:3000
STRIPE_WEBHOOK_SECRET=whsec_…   # lo da el paso 3
```

## 3. Recibir los avisos (webhooks) en local

Instala la CLI de Stripe (https://docs.stripe.com/stripe-cli) y, con el
servidor arrancado (`npm start`), en otra terminal:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhook
```

Te mostrará un `whsec_…`: ponlo en `STRIPE_WEBHOOK_SECRET` y reinicia el
servidor.

## 4. Tarjetas de prueba

Cualquier fecha futura y cualquier CVC.

| Tarjeta | Qué simula |
|---|---|
| `4242 4242 4242 4242` | Todo va bien |
| `4000 0025 0000 3155` | El banco pide confirmación (3D Secure) |
| `4000 0000 0000 0341` | Se guarda bien pero **falla al cobrar** |

## 5. Recorrido a comprobar

Con `beatriz@ejemplo.com` / `academia123`:

1. **Cuotas → Contratar cuota** para Sofía, *Judo mensual*, *Con tarjeta*.
   Debe pedir añadir tarjeta → página de Stripe → `4242…` → vuelve a la app
   con "Tarjeta guardada" y la cuota **Activa**.
2. En el dashboard de Stripe (modo prueba): hay un cliente, una suscripción
   de 39 € y una factura pagada. En la app, el pago aparece en el historial.
3. **Pausar** la cuota de Sofía → en Stripe, la suscripción queda con el
   cobro pausado. **Reanudar ya** → vuelve a estar activa.
4. **Dar de baja** → en Stripe queda "se cancelará al final del periodo". En
   la app sigue activa hasta esa fecha.
5. **Fallo de cobro**: en *Cambiar tarjeta y ver facturas* (comprueba de
   paso que ahí **no** aparece la opción de cancelar) pon la
   `4000 0000 0000 0341`, contrata otra cuota → debe quedar **Pago pendiente**
   con botón "Completar pago".
6. **3D Secure**: repite con la `4000 0025 0000 3155` → "Completar pago"
   abre la confirmación del banco; al confirmarla, la cuota pasa a Activa
   (llega por webhook: puede tardar unos segundos).
7. **Modo familiar**: como `admin@academia.com`, en *Cuotas y pagos →
   Ajustes* elige "Un único cargo mensual por familia". Contrata dos cuotas
   con tarjeta en una misma familia → en Stripe debe haber **una**
   suscripción con **dos** líneas.
8. **Avisos repetidos**: `stripe events resend evt_…` de un `invoice.paid`
   → el pago no debe aparecer duplicado.
9. **Pago en recepción**: contrata con "En recepción" → como admin,
   *Registrar pago* → la cuota pasa a Activa.

## 6. Antes de cobrar de verdad

- Al cambiar a claves reales, la configuración del portal guardada (que es de
  la cuenta de pruebas) no existirá en la cuenta real: la app lo detecta y
  crea sola una nueva configuración segura la primera vez que alguien abra
  "Cambiar tarjeta y ver facturas". No hay que hacer nada.
- Pon `STRIPE_DEMO=0` (con clave de Stripe se ignora, pero así no hay dudas).
- Cambiar a las claves **live** (`sk_live_…`) solo cuando la app esté
  desplegada con HTTPS.
- Crear el webhook definitivo en el dashboard (*Desarrolladores → Webhooks*)
  apuntando a `https://tu-dominio/api/billing/webhook`, con los eventos:
  `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
  `customer.subscription.updated`, `customer.subscription.deleted`.
- Mejora a valorar: **domiciliación SEPA** (cargo en cuenta bancaria), muy
  habitual en España para cuotas mensuales y con comisiones más bajas que la
  tarjeta.
