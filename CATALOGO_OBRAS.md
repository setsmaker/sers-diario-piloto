# Catálogo compartido de obras · SERS Diario

Esta aplicación usa `obras.json` en la raíz del repositorio GitHub para que todas las instalaciones reciban el mismo listado.

## Seguridad y privacidad

**Este archivo se publica por GitHub Pages.** No incluir nombres de clientes, proyectos privados, referencias internas, contratos, direcciones, técnicos u otros datos que SERS no haya autorizado a hacer públicos. No basta con ocultar un campo en pantalla: todo lo escrito en `obras.json` es visible.

Las fotografías, notas, visitas, audios y borradores se almacenan en el dispositivo del inspector; no se suben a GitHub.

## Administración desde móvil

1. Iniciar sesión en GitHub con la cuenta autorizada.
2. Abrir `setsmaker/sers-diario-piloto` y entrar en `obras.json`.
3. Editar el JSON con el lápiz (o solicitar desde ChatGPT el cambio en el repositorio conectado).
4. Guardar los cambios. GitHub Pages publicará el nuevo catálogo.
5. En SERS Diario, abrir **Ajustes / ZIP → Actualizar catálogo**.

Los inspectores no necesitan cuenta GitHub para consultar las obras. La aplicación hace una consulta a GitHub Pages y conserva la última copia disponible en el teléfono. No colocar contraseñas ni tokens de GitHub en el código de la aplicación.

## Estructura del archivo

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-26",
  "obras": [
    {
      "id": "portillo-e19",
      "nombre": "Portillo · Urbanización E-19",
      "codigo": "",
      "zonas": ["Anselmo Clavé", "Escoriaza y Fabro", "Parque Central"],
      "unidades": ["Pavimentación", "Saneamiento", "Alumbrado"],
      "activa": true
    }
  ]
}
```

Al añadir una obra, elegir un `id` único y estable, sin espacios (por ejemplo `obra-prueba-02`). No cambiar el ID después, porque los registros guardados en los móviles se vinculan a ese identificador.

- `nombre`: denominación visible.
- `codigo`: opcional; dejar vacío si no está autorizado para publicación.
- `zonas`: listado de zonas seleccionables, que admiten selección múltiple.
- `unidades`: listado de unidades seleccionables, que admiten selección múltiple.
- `activa`: `false` oculta la obra de las opciones habituales sin borrar los registros locales existentes.

## Alcance actual

El catálogo es centralizado y de solo lectura para inspectores. Cada técnico configura su perfil localmente, registra trabajos con o sin visita iniciada y exporta sus ZIP de forma independiente. No hay sincronización de fotos, notas ni perfiles entre teléfonos. Los informes se elaborarán posteriormente fuera de esta aplicación.

Antes de incorporar más obras, revisar qué campos pueden hacerse públicos.
