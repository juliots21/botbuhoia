# Guía de Configuración Whatsapp Business Cloud API

Esta guía te ayudará a configurar la API de WhatsApp, el webhook y realizar envíos de prueba.

## 1. Crear app en Meta for Developers
1. Ve a [Meta for Developers](https://developers.facebook.com/)
2. Ve a Mis Aplicaciones -> Crear Aplicación -> "Otro" -> "Empresa"
3. Dale un nombre (ej. `ia-buho`) y asóciala a tu cuenta comercial.
4. En el panel del lado izquierdo, añade el producto "WhatsApp".

## 2. Obtener Credenciales
En el menú izquierdo, ve a **WhatsApp -> Configuración de la API**. En esa pantalla verás:
- **Token de acceso temporal** (Cópialo en tu archivo `.env` como `WHATSAPP_TOKEN`). *Nota: caduca en 24h. Para uno permanente necesitas crear un usuario del sistema.*
- **Identificador del número de teléfono** (Cópialo en tu archivo `.env` como `WHATSAPP_PHONE_NUMBER_ID`).
- Tienes un número de prueba y la opción de agregar hasta 5 números destinatarios para testear de forma gratuita. **Asegúrate de agregar tu propio número de WhatsApp ahí**.

## 3. Obtener tu URL pública (Alwasdata)
Al configurar tu proyecto en **Alwaysdata**, tu aplicación ahora es pública bajo el dominio:
`https://testing21.alwaysdata.net/`
Esta es la URL que Meta utilizará para enviarte los mensajes de WhatsApp. Ya no necesitas Ngrok.

## 4. Configurar el Webhook en Meta
1. Ve a **WhatsApp -> Configuración** en el panel de Meta.
2. En la sección Webhooks, haz clic en el botón de **Configurar** o **Editar**.
3. **URL de devolución de llamada (Callback URL):** Escribe tu dominio de Alwaysdata y añádele `/webhook` al final. Debe quedar exactamente así: 
   `https://testing21.alwaysdata.net/webhook`
4. **Token de verificación:** Escribe exactamente lo que pusiste en tu entorno de Alwaysdata en la variable `WEBHOOK_VERIFY_TOKEN` (ej. `token_seguro_inventado_por_ti_123`).
5. Haz clic en **Verificar y Guardar** (OJO: Tu aplicación en Alwaysdata debe estar encendida y sin errores de código para que esto se apruebe exitosamente).
6. **MUY IMPORTANTE:** Tras ser aprobado, haz clic en "Administrar" campos del webhook y **suscríbete** obligatoriamente al evento que dice `messages`.

## 5. Probar con CURL (Troubleshooting / Solución de problemas)
Si la consola de Meta tiene problemas para enviar mensajes de prueba y falla misteriosamente, puedes usar tu terminal para ver el error real:

```bash
curl -i -X POST \
  https://graph.facebook.com/v22.0/TU_PHONE_NUMBER_ID/messages \
  -H "Authorization: Bearer TU_TOKEN_DE_ACCESO" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "TU_NUMERO_DESTINO_CON_CODIGO_DE_PAIS",
    "type": "template",
    "template": {
      "name": "hello_world",
      "language": {
        "code": "en_US"
      }
    }
  }'
```
**Errores Comunes usando CURL:**
- `190` - Invalid OAuth access token: Tu token de prueba temporal caducó. Genera uno nuevo.
- `131009` - Parameter value is not valid: El número destino *no está listado* en Meta (añádelo a tu lista blanca de 5 números primero) o le *falta el código de país* (ej. `51` para Perú).
- Si usas Windows PowerShell, el JSON interior (`-d '{...}'`) suele dar problemas con las comillas simples. Recomendación: Usa **Git Bash**, usa **WSL (Ubuntu en Windows)** o en su lugar, crea un archivo (`datos.json`) y pásalo a curl así: `-d @datos.json`.
