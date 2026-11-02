# SERS Reportajes

Aplicación web instalable (PWA) para reportajes fotográficos e inventarios. Independiente de SERS Diario de Obra.

**Abrir:** https://setsmaker.github.io/sers-diario-piloto/reportajes/

## Uso

1. Abrir **Reportajes** y escribir un nombre. Elegir *Reportaje fotográfico* o *Inventario*.
2. Pulsar **Crear reportaje** y, en **Capturar**, utilizar el botón de cámara grande. También se puede elegir una fotografía existente de la galería.
3. Comprobar los indicadores de precisión GPS (verde ≤10 m, amarillo 10–25 m, rojo >25 m, gris sin posición) y de orientación. Los datos disponibles quedan asociados a la foto sin necesidad de hacer ninguna selección manual en un plano.
4. Dictar o escribir la descripción. El campo se guarda automáticamente como borrador. Pulsar **Guardar y siguiente foto** para continuar con el mismo reportaje.
5. En **Galería** se pueden ampliar, revisar, corregir descripciones y eliminar fotografías.
6. En **Mapa**, si hay conexión, aparecen las fotografías con GPS sobre OpenStreetMap, con círculos de precisión y flechas de orientación aproximada. Debajo hay accesos directos a Google Maps para cada fotografía.
7. En **Reportajes**, utilizar **Continuar** para recuperar una sesión anterior y **Finalizar/Reabrir** para cerrar o continuar posteriormente. Cada reportaje tiene opción **Exportar ZIP** para copia local aun sin OneDrive.

## Conservación de datos

Se utiliza IndexedDB para guardar en **este móvil** los reportajes, imágenes originales, descripciones, metadatos y borradores. No hay servidor de SERS ni cuentas de técnicos para registrar imágenes. El EXIF disponible en la imagen original **no se elimina ni se altera**. No se garantiza que todos los teléfonos adjunten EXIF o que la posición geográfica se encuentre dentro de la foto original: la aplicación guarda, además, un archivo JSON con las lecturas de GPS/brújula que haya podido obtener.

El rumbo solo se almacena si el navegador facilita un rumbo absoluto. Es **aproximado** y no está calibrado como un levantamiento topográfico. Si se abrió la cámara del sistema y no se obtuvo lectura posterior, la aplicación puede conservar una medición anterior, identificándola como tal. En reportajes importados de la galería no se atribuyen coordenadas GPS actuales a fotografías antiguas.

No hay georreferenciación manual. Los mapas usan OpenStreetMap; necesitan Internet para descargar los mosaicos. Se puede exportar el GeoJSON para elaborar posteriormente planos técnicos desde ordenador (QGIS, CAD, PDF georreferenciado, etc.).

El ZIP de cada reportaje contiene fotografías originales, `DATOS/fotografias.json`, `DATOS/localizaciones.geojson` y `reportaje.json`. No se genera todavía el reportaje Word/PDF con IA: eso queda para la rutina del ordenador de SERS.

**Precaución:** si se borran los datos del sitio web en Chrome, se pueden perder las fotos todavía no exportadas o sincronizadas. Exportar copias periódicamente.

## Configurar OneDrive

**La integración está programada y probada con respuestas simuladas, pero requiere registro/autorización Microsoft y una prueba real. No existe un Client ID configurado de antemano.**

En Microsoft Entra:
1. Abrir **Registros de aplicaciones** → **Nuevo registro**.
2. Nombre: **SERS Reportajes**. Para cuenta SERS corporativa, elegir **Solo las cuentas de este directorio**. Si se registra otra aplicación para SERS Diario, puede reutilizarse su Client ID **solo si se añade también la URI de redirección siguiente**.
3. En **Autenticación**, agregar plataforma **Aplicación de página única (SPA)** y esta URI exacta:
   `https://setsmaker.github.io/sers-diario-piloto/reportajes/`
4. En permisos delegados Microsoft Graph, habilitar `User.Read` y `Files.ReadWrite`; el administrador Microsoft 365 puede tener que autorizar el consentimiento.
5. Copiar **Application (client) ID** y, si la app es **Single tenant**, también **Directory (tenant) ID**. **No crear ni introducir Client Secret**.
6. Desde SERS Reportajes → Reportajes → OneDrive → **Configurar cuenta Microsoft**, pegar los identificadores, guardar y conectar.
7. Probar con una foto ficticia y pulsar **Sincronizar pendientes**. La aplicación creará automáticamente las carpetas.

Se utiliza Microsoft Graph con autenticación delegada para leer y escribir los archivos del OneDrive al que se conecte cada inspector. Los tokens MSAL se almacenan en `sessionStorage` para limitar su persistencia, pero hay que revisar la arquitectura de dominio y permisos antes del uso corporativo real.

### Carpetas creadas automáticamente

```text
OneDrive / SERS REPORTAJES
└── Nombre_del_reportaje__ID
    ├── FOTOGRAFIAS
    │   ├── FOTO_001_ID.jpg
    │   └── FOTO_002_ID.jpg
    ├── DATOS
    │   ├── FOTO_001_ID.json
    │   ├── FOTO_002_ID.json
    │   └── localizaciones.geojson
    └── reportaje.json
```

El identificador de cada foto es estable. La sincronización comprueba en OneDrive si la imagen está presente y evita volver a subirla si su tamaño coincide. Las descripciones modificadas y el índice del reportaje se actualizan sin retransmitir la fotografía original. Si se interrumpe, se reintenta; los originales no se borran del móvil.

**Límites:** la sincronización automática solo funciona cuando la aplicación está activa o se vuelve a abrir; Chrome/Android pueden impedir trabajo en segundo plano. El borrado local de una foto **no** la elimina de OneDrive. Si dos inspectores usan cuentas distintas, cada uno escribe en **su propio OneDrive**: para un repositorio corporativo compartido habrá que seleccionar después un destino de equipo autorizado. No usar cuentas personales para datos internos sin autorización de SERS.

**Seguridad:** todas las páginas del mismo propietario en `setsmaker.github.io` comparten origen web. Para desplegarlo a toda la plantilla con documentación reservada conviene usar un dominio propio exclusivo para las aplicaciones SERS y revisar los permisos de Microsoft y la confidencialidad antes de dar acceso.

## Estructura técnica

- `index.html`: interfaz y navegación.
- `styles.css`: diseño corporativo y móvil.
- `db.js`: IndexedDB, sin backend ni cuentas de usuario.
- `app.js`: captura, GPS, brújula, dictado, borradores, galería, mapas, ZIP.
- `cloud.js`: OneDrive MSAL / Graph.
- `manifest.webmanifest` y `sw.js`: instalación independiente y captura offline.
- `../zip.js` y `../icons/`: recursos reutilizados de SERS Diario.

La brújula y GPS dependen del dispositivo y los permisos de Chrome. En ausencia de lectura no se inventan datos.
