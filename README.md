# Puzzle Cam + Supabase

Photobooth con seguimiento de manos (MediaPipe) que arma un
rompecabezas en vivo. Al resolverlo y cerrar el puño, la foto se
guarda en la tira local **y se sube automáticamente a Supabase**,
donde queda visible en un panel de administración con login.

## Estructura del proyecto

```
puzzlecam/
├── index.html              # app de la cámara (para el kiosco/photobooth)
├── admin.html               # panel de administración (login + galería)
├── css/
│   ├── styles.css            # estilos de la app de cámara
│   └── admin.css             # estilos del panel admin
├── js/
│   ├── app.js                 # lógica de la cámara + subida a Supabase
│   ├── admin.js                # lógica del panel admin
│   ├── supabaseClient.js       # cliente compartido de Supabase
│   └── supabase-config.js      # ← AQUÍ VAN TUS CLAVES
└── supabase/
    └── schema.sql             # SQL para crear tabla + bucket + políticas
```

## 1. Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo.
2. Ve a **SQL Editor** → *New query*, pega el contenido completo de
   `supabase/schema.sql` y ejecútalo. Esto crea:
   - la tabla `public.captures` (con RLS activado),
   - el bucket de Storage `puzzle-photos` (público para lectura),
   - las políticas necesarias para que la cámara pueda subir fotos
     sin sesión, y solo el admin autenticado pueda leerlas/borrarlas.

## 2. Crear la cuenta de administrador

1. Ve a **Authentication → Users → Add user**.
2. Crea un usuario con correo y contraseña (esa será la cuenta con la
   que entres en `admin.html`).
3. No hace falta ninguna tabla de roles extra: cualquier usuario
   autenticado en este proyecto puede ver y borrar capturas, porque
   así está definida la política `authenticated` en `schema.sql`.
   Si vas a tener varios admins, crea un usuario por persona desde
   la misma pantalla.

## 3. Conectar el frontend

Abre `js/supabase-config.js` y reemplaza los valores de ejemplo con
los de tu proyecto (**Project Settings → API**):

```js
export const SUPABASE_URL = "https://tu-proyecto.supabase.co";
export const SUPABASE_ANON_KEY = "tu-clave-anon-publica";
```

> La clave `anon` es pública por diseño (se usa en el navegador). La
> seguridad real la dan las políticas RLS del paso 1, no esta clave.

## 4. Ejecutar

Sirve la carpeta con cualquier servidor estático (no puede abrirse
con `file://` porque usa módulos ES y la cámara requiere HTTPS o
`localhost`). Por ejemplo:

```bash
npx serve .
# o
python3 -m http.server 8080
```

- Cámara / kiosco: `http://localhost:PUERTO/index.html`
- Panel admin: `http://localhost:PUERTO/admin.html`

Para producción, sube la carpeta tal cual a cualquier hosting
estático (Vercel, Netlify, GitHub Pages, etc.) — no necesita backend
propio, todo pasa por Supabase.

## Cómo funciona la sincronización

1. En `index.html`, cuando alguien resuelve el rompecabezas y cierra
   el puño, `finishShatter()` llama a `uploadCaptureToCloud()`.
2. Esa función sube el PNG al bucket `puzzle-photos` y crea una fila
   en `captures` con la URL pública de la imagen.
3. `admin.html` se suscribe a cambios en tiempo real de la tabla
   `captures` (Supabase Realtime), así que las fotos nuevas aparecen
   en el panel sin recargar la página.
4. Si no hay conexión o Supabase no está configurado, la app sigue
   funcionando con normalidad: la foto queda en la tira local, solo
   que no se sincroniza con el panel (verás un aviso en la consola
   del navegador y una insignia breve "sin conexión con la nube").

## Notas de seguridad

- El bucket es público **solo para lectura** (para poder mostrar las
  fotos por URL), no para listar su contenido arbitrariamente.
- Cualquiera con la app de cámara puede *insertar* capturas (es un
  kiosco público), pero solo un usuario autenticado puede *leer la
  lista* completa o *borrar* — por eso el panel admin exige login.
- Si quieres cerrar del todo la subida pública (por ejemplo, correr
  la cámara solo en un evento controlado), puedes quitar la política
  `"anon puede insertar capturas"` y exigir también login ahí.
