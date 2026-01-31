# Lector de tickets (Mercadona + Lidl)

Una herramienta 100% en el navegador para **leer tickets de Mercadona y Lidl (PDF o imagen)**, extraer los productos, **repartirlos por categorías**, **validar el total** frente al que aparece en el nombre del archivo y **exportar un resumen como imagen**.

👉 **Demo**: [Lector](https://enriqueglezgm.github.io/Supermercado/)

---

## Características

- ✅ **Importa PDF o imagen** del ticket (texto embebido o escaneado).
- 🧾 **Extracción robusta**: maneja líneas por unidades y por peso/volumen.
- 🏷️ **Categorías por fila**: Alberto / Kike / Común (con color de fondo sutil).
- 📊 **Resumen por categorías** (contador y suma).
- 🧮 **Validación del total**: compara el total calculado con el **que va en el nombre del fichero** (p. ej. `... 75,76 €.pdf`) y muestra alerta **verde/roja** grande.
- 🖼️ **Exportación**: crea **una imagen** con las tablas de las categorías no vacías.
- 🌙 **Modo oscuro** automático (usa `prefers-color-scheme` / `data-bs-theme`).

> ⚠️ Si el total **no coincide**, al exportar se pedirá confirmación.

---

## Cómo usar

1. Abre la página: [Lector](https://enriqueglezgm.github.io/Supermercado/)
2. Pulsa **Elegir archivo** y selecciona el PDF o imagen del ticket.
   - El procesamiento **empieza automáticamente**
3. Clasifica cada producto en **Alberto / Kike / Común**.
4. Cuando todas las filas tengan categoría, pulsa **Exportar resumen por categorías** para descargar la imagen.

---

## Consejos para el nombre del archivo

Pon el **total del ticket** en el nombre (formato español), por ejemplo: "20250829 Mercadona 75,76 €.pdf"

---

## Desarrollo local

1. Instala dependencias:
   ```bash
   npm install
   ```
2. Ejecuta el servidor de desarrollo:
   ```bash
   npm run dev
   ```

## Deploy en GitHub Pages

1. Genera el build:
   ```bash
   npm run build
   ```
2. Publica la carpeta `dist` en GitHub Pages:
   ```bash
   npx gh-pages -d dist
   ```
3. En GitHub, ve a **Settings → Pages** y selecciona:
   - Source: `gh-pages`
   - Folder: `/ (root)`
