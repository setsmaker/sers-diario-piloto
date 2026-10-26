SERS · DIARIO DE OBRA — PRIMER PILOTO MÓVIL
=========================================
Versión 1.0 · 26 de octubre de 2026

QUÉ HACE
- Se abre en Android (Chrome) como una web y se puede instalar en la pantalla de inicio como una aplicación (PWA).
- Permite fotografiar con la cámara, importar varias fotos y adjuntar a cada una zona, unidad de obra y descripción.
- Permite crear notas independientes, dictar el texto y corregirlo en pantalla, y grabar una nota de voz que se guarda como audio original.
- Obtiene el GPS del móvil cuando lo autorizas (solicita permisos); guarda fecha, hora y autor.
- Guarda fotos y notas en el almacenamiento LOCAL del navegador (IndexedDB). Permite trabajar sin conexión tras abrir/instalar la app al menos una vez con Internet.
- Permite revisar, ampliar, escuchar, editar y eliminar registros.
- Exporta un ZIP con fotos originales, audios, un JSON estructurado y un CSV para Excel.

QUÉ NO HACE TODAVÍA
- No sube nada al servidor de SERS; la sincronización requerirá una conexión segura que configure informática.
- No genera el diario Word/PDF, ni analiza las fotos con IA, ni obtiene la meteorología, ni incorpora planificaciones.
- No hay sincronización entre varios técnicos. Cada uno guardaría sus datos en su móvil y tendría que exportar su ZIP.
- No se transcribe automáticamente el AUDIO GRABADO. El dictado de texto es independiente (botón «Dictar texto» o micrófono del teclado).
- No incluye servicios de pago ni conexión a API de OpenAI.

CÓMO PUBLICARLA EN GITHUB PAGES (recomendado para pruebas)
1. Descomprime el ZIP del piloto en tu ordenador.
2. Entra en github.com con tu cuenta y crea un repositorio nuevo, por ejemplo «sers-diario-piloto».
3. Sube el CONTENIDO de la carpeta SERS_Diario_Piloto al nivel principal del repositorio (index.html, app.js, etc., y la carpeta icons). No subas el ZIP como único archivo.
4. Ve a Settings > Pages y elige «Deploy from a branch», rama «main», carpeta «/(root)». Guarda.
5. Abre la dirección HTTPS que publique GitHub Pages en Chrome de Android.
6. Menú de Chrome (⋮) > «Instalar aplicación» o «Añadir a pantalla de inicio» (la opción varía según Android/Chrome).
7. Abre desde el icono, entra en Ajustes / ZIP y configura obra y técnico.
8. Haz una foto, dicta una descripción, guarda, revisa Registros y pulsa Exportar.

IMPORTANTE SOBRE PRIVACIDAD Y DATOS
- El código de la web se aloja en GitHub Pages; los registros que añadas se quedan LOCALMENTE en el móvil, no se suben a GitHub.
- No publiques fotografías reales o información interna como parte del repositorio de GitHub. Un repositorio público deja visible el CÓDIGO de la aplicación.
- No consideres el móvil un archivo permanente. Exporta ZIP al final de cada visita y guarda la copia en un lugar corporativo seguro. Borrar datos de Chrome, cambiar de móvil o falta de espacio puede hacer perder lo no exportado.
- El navegador puede necesitar conexión a Internet para reconocer la voz, aunque la aplicación funcione sin cobertura.
- El GPS capturado corresponde a la ubicación DEL MÓVIL cuando se consulta; al importar fotos antiguas no se deduce el GPS de su lugar de toma.
- La hora del registro es la de añadirlo al programa, no necesariamente el momento original de tomar una fotografía importada.
- Para uso real por varios técnicos, se requiere autenticación y servidor corporativo con HTTPS, controles de acceso y copias de seguridad.

ESTRUCTURA DEL ZIP DE DATOS
- fotografias/: originales sin recomprimir.
- audios/: grabaciones de las notas de voz.
- registros.json: objeto con registros y campos para automatizaciones.
- registros_excel.csv: listado abrible con Excel (CSV separado por punto y coma).
- LEEME.txt: descripción de los datos.

REQUISITOS
- Android reciente, preferiblemente Chrome; iPhone Safari puede instalar una PWA, pero dictado, grabación y cámara varían.
- Página servida por HTTPS (GitHub Pages es HTTPS) para cámara/micrófono/GPS y para instalación/offline.
- No basta abrir index.html con doble clic y file:// para probar todas las funciones.
