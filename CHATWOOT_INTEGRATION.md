# Guía de Integración API: Chatwoot <-> Cerebro IA Búho Digital

Este documento está dirigido al desarrollador, agente IA o administrador encargado de configurar la instancia de **Chatwoot**. 

El objetivo es conectar tu Chatwoot con nuestro "Cerebro de Inteligencia Artificial" (alojado en un servidor externo) para que la IA responda automáticamente a los mensajes de tus clientes.

**NOTA IMPORTANTE:** Esta arquitectura es **100% Stateless** (sin estado) del lado del Cerebro IA. Esto significa que **no necesitas pedirle a ningún administrador del servidor externo que configure variables o contraseñas por ti**. Tú controlas la conexión directamente desde tu Chatwoot a través de la URL del webhook.

---

## Requisitos Previos
1. Acceso de Administrador a tu instancia de Chatwoot.
2. Tu Chatwoot debe ser accesible desde internet público (si lo tienes en `localhost`, necesitarás una herramienta como **Ngrok** o **Cloudflare Tunnels**).

---

## Paso 1: Obtener una URL Pública para tu Chatwoot (Solo si usas Localhost)

El Cerebro IA está en la nube y necesita poder hacer peticiones a la API de tu Chatwoot para enviar las respuestas. Si tu Chatwoot ya está en un dominio público (ej. `https://chatwoot.miempresa.com`), salta al **Paso 2**. 

Si estás corriendo Chatwoot en tu computadora (ej. `http://localhost:3000`), haz lo siguiente:

1. Instala [Ngrok](https://ngrok.com/).
2. En tu terminal, expón el puerto de Chatwoot:
   ```bash
   ngrok http 3000
   ```
3. Copia la URL pública generada (ej. `https://1234-abcd.ngrok-free.app`). **Asegúrate de copiarla sin la barra `/` final.**

---

## Paso 2: Generar el Token de Acceso (API Token)

El Cerebro IA utilizará este token para autenticarse en tu Chatwoot y publicar mensajes en nombre de tu cuenta.

1. Ingresa a tu panel de Chatwoot.
2. Ve a **Ajustes de Perfil** (haz clic en tu avatar en la esquina inferior izquierda > Configuración del perfil).
3. Desplázate hacia abajo hasta encontrar **Token de acceso (Access Token)**.
4. **Copia ese token**. (Ejemplo: `k8xL...`)

---

## Paso 3: Configurar el Webhook Mágico en Chatwoot

Aquí es donde ocurre la conexión. Vas a registrar un webhook en Chatwoot para que cada vez que un cliente escriba, el mensaje se envíe al Cerebro IA. 

Como el sistema es *stateless*, le enviaremos tu **URL Pública** y tu **API Token** a la IA directamente incrustados en la URL del webhook.

1. En tu Chatwoot, ve a **Ajustes > Integraciones > Webhooks** (o en la configuración de la Bandeja de entrada, dependiendo de tu versión).
2. Haz clic en **Añadir un Webhook** (Add Webhook).
3. Construye tu URL dinámica usando esta plantilla:
   
   ```text
   https://bhdtlai.alwaysdata.net/webhook/chatwoot?url=[TU_URL_PUBLICA]&token=[TU_API_TOKEN]
   ```

   **Ejemplo de cómo debe quedar:**
   > `https://bhdtlai.alwaysdata.net/webhook/chatwoot?url=https://1234-abcd.ngrok-free.app&token=k8xL9pZ2`

4. Pega esa URL completa en el campo **URL** de la configuración del webhook.
5. En la sección de **Eventos (Events)**, es crítico que marques **ÚNICAMENTE**:
   - `message_created`
6. Haz clic en **Crear/Guardar**.

---

## ¿Cómo funciona el flujo?

1. Un cliente te escribe "Hola, quiero información" por el chat.
2. Chatwoot detecta el evento `message_created` y envía el texto a: `https://bhdtlai.alwaysdata.net/webhook/chatwoot?url=...&token=...`
3. El Cerebro IA recibe el mensaje. Nota que es de un cliente y lo procesa con la Inteligencia Artificial.
4. El Cerebro IA toma la `url` y el `token` que le pasaste en la petición, construye un cliente HTTP al vuelo, y hace un `POST` a tu API de Chatwoot para insertar la respuesta en la conversación.
5. *(Mecanismo de seguridad)*: Si la IA te responde, Chatwoot volverá a disparar el evento `message_created`. Pero tranquilo, el webhook está programado para ignorar mensajes de tipo `outgoing` (mensajes del bot/agente), previniendo así un bucle infinito.

---

## Referencia Técnica Completa de la API

### 1. Endpoint del Webhook (Recepción de Mensajes)

**URL Base:** `https://bhdtlai.alwaysdata.net/webhook/chatwoot`  
**Método HTTP:** `POST`  
**Content-Type:** `application/json`

#### Query Parameters Requeridos

| Parámetro | Tipo | Descripción | Ejemplo |
|-----------|------|-------------|---------|
| `url` | string | URL pública de tu instancia Chatwoot (sin barra final) | `https://1234-abcd.ngrok-free.app` |
| `token` | string | Tu API Access Token de Chatwoot | `k8xL9pZ2mQ...` |

#### Ejemplo de URL Completa
```
POST https://bhdtlai.alwaysdata.net/webhook/chatwoot?url=https://1234-abcd.ngrok-free.app&token=k8xL9pZ2mQ
Content-Type: application/json
```

---

### 2. Payload JSON que Chatwoot Envía (Request Body)

Cuando un cliente envía un mensaje, Chatwoot dispara el webhook con este formato JSON:

```json
{
  "event": "message_created",
  "id": 123456,
  "content": "Hola, quiero información sobre sus servicios",
  "message_type": "incoming",
  "content_type": "text",
  "status": "sent",
  "content_attributes": {},
  "created_at": "2024-01-15T10:30:00.000Z",
  "private": false,
  "sender": {
    "id": 789,
    "name": "Juan Pérez",
    "email": "juan@ejemplo.com",
    "type": "contact"
  },
  "conversation": {
    "id": 456,
    "display_id": 789,
    "status": "open"
  },
  "account": {
    "id": 1
  }
}
```

#### Descripción de Campos Importantes

| Campo | Tipo | Descripción | Obligatorio |
|-------|------|-------------|-------------|
| `event` | string | Tipo de evento. Siempre `"message_created"` para esta integración | Sí |
| `id` | integer | ID único del mensaje en Chatwoot | Sí |
| `content` | string | Texto del mensaje del cliente | Sí (puede ser vacío para archivos) |
| `message_type` | string/integer | Tipo de mensaje. `"incoming"` o `0` = cliente, `"outgoing"` o `1` = agente/IA | Sí |
| `sender.id` | integer | ID del remitente | Sí |
| `sender.name` | string | Nombre del cliente | No |
| `conversation.id` | integer | ID de la conversación | Sí |
| `account.id` | integer | ID de la cuenta Chatwoot | Sí |

---

### 3. Respuestas del Servidor IA

El servidor devuelve diferentes códigos de estado HTTP según el resultado:

#### ✅ Éxito - 200 OK

```http
HTTP/1.1 200 OK
Content-Type: text/plain

EVENT_RECEIVED
```
Significa que el mensaje fue recibido y está siendo procesado por la IA.

#### ⚠️ Mensaje Ignorado - 200 OK (con texto diferente)

```http
HTTP/1.1 200 OK
Content-Type: text/plain

EVENT_IGNORED
```
El evento no es `message_created` (ej. `conversation_created`, etc.)

```http
HTTP/1.1 200 OK
Content-Type: text/plain

MESSAGE_TYPE_IGNORED
```
El mensaje es de tipo `outgoing` (enviado por agente/IA), no por el cliente.

```http
HTTP/1.1 200 OK
Content-Type: text/plain

EMPTY_MESSAGE_IGNORED
```
El mensaje no tiene contenido de texto (ej. imagen sin caption, archivo, etc.)

#### ❌ Error - 400 Bad Request

```http
HTTP/1.1 400 Bad Request
Content-Type: text/plain

MISSING_CREDENTIALS_IN_QUERY
```
Faltan los parámetros `url` o `token` en la URL del webhook.

```http
HTTP/1.1 400 Bad Request
Content-Type: text/plain

INVALID_PAYLOAD
```
El payload JSON de Chatwoot está incompleto o le faltan campos requeridos (`account.id`, `conversation.id`, `id`).

#### ❌ Error - 500 Internal Server Error

```http
HTTP/1.1 500 Internal Server Error
Content-Type: text/plain

INTERNAL_SERVER_ERROR
```
Error inesperado en el servidor IA. Revisa los logs de tu servidor Chatwoot.

---

### 4. Cómo la IA Responde a Chatwoot (Reverse API Call)

Una vez procesado el mensaje, la IA envía la respuesta **directamente a tu API de Chatwoot** usando las credenciales que le proporcionaste:

#### Request que la IA hace a Chatwoot

```http
POST https://[TU_URL]/api/v1/accounts/{account_id}/conversations/{conversation_id}/messages
Content-Type: application/json
api_access_token: [TU_TOKEN]

{
  "content": "¡Hola Juan! Gracias por contactarnos. Te ayudo con información sobre nuestros servicios...",
  "message_type": "outgoing",
  "private": false
}
```

#### Descripción

| Campo | Valor | Descripción |
|-------|-------|-------------|
| `content` | string | Respuesta generada por la IA |
| `message_type` | `"outgoing"` | Indica que es un mensaje del agente/IA |
| `private` | `false` | El mensaje es visible para el cliente (no nota interna) |

#### Respuesta Esperada de Chatwoot

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": 123457,
  "content": "¡Hola Juan! Gracias por contactarnos...",
  "message_type": "outgoing",
  "status": "sent",
  "created_at": "2024-01-15T10:30:05.000Z"
}
```

---

### 5. Flujo de Datos Completo (Diagrama de Secuencia)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐     ┌─────────────┐
│   Cliente    │────▶│   Chatwoot   │────▶│  Cerebro IA Búho     │────▶│   Chatwoot  │
│  (WhatsApp/  │     │   (Webhook)  │     │  (Alwaysdata)        │     │   (API)     │
│   Webchat)   │     │              │     │                      │     │             │
└──────────────┘     └──────────────┘     └──────────────────────┘     └─────────────┘
                          │                        │                            │
                          │ 1. POST /webhook       │                            │
                          │    ?url=...&token=...  │                            │
                          │───────────────────────▶│                            │
                          │    JSON: {             │                            │
                          │      event: "message", │                            │
                          │      content: "Hola",  │                            │
                          │      sender: {...}     │                            │
                          │    }                   │                            │
                          │                        │                            │
                          │ 2. 200 OK              │                            │
                          │    "EVENT_RECEIVED"    │                            │
                          │◀───────────────────────│                            │
                          │                        │                            │
                          │                        │ 3. POST /api/v1/...       │
                          │                        │    /conversations/...      │
                          │                        │    /messages               │
                          │                        │    Headers: api_access_token │
                          │                        │    Body: {                 │
                          │                        │      content: "Respuesta", │
                          │                        │      message_type: "out"   │
                          │                        │    }                       │
                          │                        │───────────────────────────▶│
                          │                        │                            │
                          │                        │ 4. 200 OK                  │
                          │                        │◀───────────────────────────│
                          │                        │                            │
                          │                        │                            │ 5. Muestra al cliente
                          │                        │                            │
```

---

### 6. Manejo de Errores y Reintentos

#### Comportamiento de Chatwoot
- Si el webhook devuelve **cualquier código HTTP >= 400**, Chatwoot marcará el webhook como fallido y **reintentará automáticamente** la entrega del mensaje (generalmente 3 veces con backoff exponencial).
- Si devuelve **200**, Chatwoot considera la entrega exitosa y no reintenta.

#### Errores Comunes y Soluciones

| Error | Causa | Solución |
|-------|-------|----------|
| `MISSING_CREDENTIALS_IN_QUERY` | URL del webhook sin `?url=` o `&token=` | Verificar que la URL del webhook incluya ambos parámetros |
| `INVALID_PAYLOAD` | Chatwoot envió un payload sin `account.id`, `conversation.id` o `id` | Revisar que el webhook esté suscrito solo a `message_created` |
| `EMPTY_MESSAGE_IGNORED` | Cliente envió archivo/imagen sin texto | Comportamiento esperado; para evitar loops |
| `MESSAGE_TYPE_IGNORED` | La IA respondió y Chatwoot reenvió su propio mensaje | Comportamiento esperado; filtro anti-bucle funcionando |
| `ECONNREFUSED` en respuesta de IA | URL de Ngrok cambió o servidor Chatwoot caído | Actualizar URL en webhook de Chatwoot |
| `401 Unauthorized` en respuesta de IA | Token de Chatwoot inválido o expirado | Generar nuevo token en Ajustes de Perfil |

---

### 7. Código de Ejemplo para Integración Personalizada (Opcional)

Si necesitas hacer una integración manual (ej. desde un script o servidor propio en lugar del webhook nativo de Chatwoot), aquí tienes ejemplos:

#### Node.js / JavaScript

```javascript
const axios = require('axios');

async function enviarMensajeAIaChatwoot(config) {
  const { baseUrl, apiToken, accountId, conversationId, mensaje } = config;
  
  try {
    const response = await axios.post(
      `${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
      {
        content: mensaje,
        message_type: 'outgoing',
        private: false
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'api_access_token': apiToken
        }
      }
    );
    
    console.log('Mensaje enviado:', response.data.id);
    return response.data;
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    throw error;
  }
}

// Uso
enviarMensajeAIaChatwoot({
  baseUrl: 'https://1234-abcd.ngrok-free.app',
  apiToken: 'k8xL9pZ2mQ',
  accountId: 1,
  conversationId: 456,
  mensaje: 'Hola, soy la IA de Búho Digital'
});
```

#### cURL (para testing)

```bash
# Simular mensaje de cliente hacia la IA
curl -X POST "https://bhdtlai.alwaysdata.net/webhook/chatwoot?url=https://1234-abcd.ngrok-free.app&token=k8xL9pZ2mQ" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "id": 123456,
    "content": "Hola, necesito ayuda",
    "message_type": "incoming",
    "sender": {"id": 789, "name": "Cliente Test"},
    "conversation": {"id": 456},
    "account": {"id": 1}
  }'

# Enviar respuesta manual a Chatwoot
curl -X POST "https://1234-abcd.ngrok-free.app/api/v1/accounts/1/conversations/456/messages" \
  -H "Content-Type: application/json" \
  -H "api_access_token: k8xL9pZ2mQ" \
  -d '{
    "content": "Hola, te ayudo con eso",
    "message_type": "outgoing",
    "private": false
  }'
```

#### Python

```python
import requests

def enviar_mensaje_a_chatwoot(base_url, api_token, account_id, conversation_id, mensaje):
    url = f"{base_url}/api/v1/accounts/{account_id}/conversations/{conversation_id}/messages"
    headers = {
        "Content-Type": "application/json",
        "api_access_token": api_token
    }
    payload = {
        "content": mensaje,
        "message_type": "outgoing",
        "private": False
    }
    
    response = requests.post(url, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()

# Uso
resultado = enviar_mensaje_a_chatwoot(
    base_url="https://1234-abcd.ngrok-free.app",
    api_token="k8xL9pZ2mQ",
    account_id=1,
    conversation_id=456,
    mensaje="Hola desde Python"
)
print(f"Mensaje enviado ID: {resultado['id']}")
```

---

## Resolución de Problemas (Troubleshooting)

*   **Uso de Ngrok gratuito:** Cada vez que reinicies Ngrok, la URL (`https://....ngrok-free.app`) cambiará. Simplemente ve a tus Ajustes de Webhook en Chatwoot y edita el parámetro `url=` con la nueva dirección. No necesitas avisar a nadie más.
*   **La IA no responde:** 
    *   Verifica tu terminal de Ngrok. Si no ves peticiones entrantes después de unos segundos de que el cliente escribiera, significa que tu parámetro `url=` en el webhook podría estar mal escrito o incluir una barra final (debe ser estricto sin `/` al final).
    *   Revisa que el parámetro `token=` sea correcto y no tenga espacios en blanco.
*   **Bucle de mensajes:** Revisa que el webhook en Chatwoot solo esté suscrito a `message_created` y no a otro tipo de actualizaciones. El Cerebro IA ya está diseñado para filtrar sus propios mensajes.
