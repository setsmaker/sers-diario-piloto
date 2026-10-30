# OneDrive · SERS Diario de Obra

**Estado:** interfaz, autenticación y sincronizador desarrollados. **Pendiente:** registrar la aplicación en Microsoft Entra, configurar el Client ID y comprobar una subida real en la cuenta autorizada. Ningún archivo se ha subido todavía a OneDrive desde estas pruebas.

## Activación inicial (administrador)

1. Abrir [Centro de administración de Microsoft Entra](https://entra.microsoft.com/) → **Identity** → **Applications** → **App registrations** → **New registration**.
2. Nombre: `SERS Diario de Obra`.
3. Tipos de cuenta: para una prueba con OneDrive personal y corporativo, seleccionar **Accounts in any organizational directory and personal Microsoft accounts**. Si la organización solo permite cuentas corporativas, seleccionar el tipo que autorice el administrador de Microsoft 365. La configuración del sincronizador usa la autoridad `common`; si se restringe a un tenant, habrá que adaptar ese valor.
4. Registrar la aplicación. Copiar **Application (client) ID**. Es un identificador público, **no es un Client Secret**.
5. En **Authentication** → **Add a platform** → **Single-page application (SPA)**, añadir exactamente:
   `https://setsmaker.github.io/sers-diario-piloto/`
   (sin parámetros de consulta). No seleccionar la plataforma «Web» en lugar de SPA.
6. En **API permissions** → **Microsoft Graph** → **Delegated permissions**, conceder:
   - `User.Read`
   - `Files.ReadWrite`
   El administrador de Microsoft 365 puede necesitar autorizar el consentimiento en el tenant.
7. En SERS Diario (móvil), entrar en **Ajustes / ZIP → Sincronizar con OneDrive → Configuración de Microsoft (una vez)**, pegar el **Client ID**, guardar, pulsar **Conectar OneDrive** e iniciar sesión con la cuenta que deba ser el destino.
8. Probar primero con una **nota ficticia**, pulsando «Sincronizar registros pendientes». Comprobar en OneDrive la carpeta **DIARIOS DE OBRA**.

No guardar Client Secrets en el repositorio ni introducirlos en la PWA. La autenticación se gestiona con MSAL y OAuth para SPA. El navegador conserva la sesión de Microsoft mediante su almacenamiento local. El usuario puede desconectar OneDrive desde los ajustes.

## Organización de carpetas

```text
DIARIOS DE OBRA
└── portillo-e19 - Portillo · Urbanización E-19
    └── 2026-10-30
        ├── VISITA_<identificador>
        │   ├── REGISTRO_<identificador>.zip
        │   └── REGISTRO_<identificador>.zip
        └── REGISTROS_SIN_VISITA
            └── REGISTRO_<identificador>.zip
```

Cada ZIP conserva `registro.json`, descripción original general e individual de cada imagen, fotografías y audios originales. Se mantiene el identificador de registro para evitar duplicados. Si un registro se edita o se cierra una visita, su ZIP se actualiza. Si el archivo está en OneDrive y no tenemos constancia local de una versión distinta, se omite en lugar de duplicarlo.

La sincronización consulta OneDrive y crea las carpetas automáticamente; no hace falta abrir OneDrive para subir los archivos. También se conservan todos los registros en el móvil. Un fallo de conexión no modifica los originales.

## Sincronización automática

Con **Sincronizar automáticamente** activado, la PWA intenta sincronizar al abrirse, al recuperar conexión y después de guardar un registro, siempre que exista sesión Microsoft y la app esté activa. **No es un servicio en segundo plano garantizado** cuando Android cierra la aplicación; para verificar el envío, utilizar el botón manual. Si Microsoft requiere renovar la autorización, se mostrará un aviso.

Se utilizan operaciones Microsoft Graph con permisos delegados mínimos `Files.ReadWrite`. Para archivos grandes se utilizan sesiones de carga fragmentada.

## Seguridad y límites

- **No crear carpetas públicas.** Los documentos pueden contener fotografías, nombres y datos técnicos internos.
- Para pruebas reales, utilizar OneDrive corporativo autorizado, no uno personal sin aprobación de SERS.
- Los tokens MSAL pueden quedar en el almacenamiento del navegador (según políticas de Microsoft y Chrome). El origen `setsmaker.github.io` es compartido entre los diferentes proyectos GitHub Pages del mismo propietario: **antes de desplegarlo en toda SERS hay que revisar el aislamiento del dominio y la política de acceso**.
- El prototipo sincroniza al **OneDrive de la cuenta conectada en ese móvil**. Si los inspectores usan cuentas OneDrive distintas, los datos no acabarán automáticamente en una carpeta común. Para despliegue multiusuario deberá configurarse un destino corporativo compartido (por ejemplo SharePoint/OneDrive de equipo con acceso autorizado), o un mecanismo de recepción central. No pedir a todos que compartan una misma contraseña.
- La primera sincronización nunca borra archivos en OneDrive; borrar algo del móvil tampoco lo elimina de la nube.
- Los registros antiguos que ya no figuran en el catálogo público se sincronizan igualmente bajo la obra guardada en el registro local.
- No se generan aún diarios redactados con IA. La rutina de procesamiento se instalará posteriormente en el ordenador de SERS.

Referencias: Microsoft Graph [crear carpetas](https://learn.microsoft.com/en-us/graph/api/driveitem-post-children), [subir archivos](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content), [subidas fragmentadas](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession) y [registrar aplicación](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).
