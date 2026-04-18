# Lector de tickets de supermercado

Aplicación web para leer tickets de **Mercadona** y **Lidl**, extraer los productos y repartir una compra compartida por personas, grupos o conceptos. Funciona en el navegador con PDF o imágenes, sin backend.

Demo: [Lector](https://enriqueglezgm.github.io/Supermercado/)

## Propósito

La idea es partir del ticket digital que ya dan supermercados como Mercadona o Lidl y convertirlo en un desglose rápido de quién paga qué.

En una compra compartida, cada línea del ticket se asigna a una categoría. Lo normal es que esas categorías sean personas, pero también pueden ser grupos, cuentas o conceptos de gasto. Por ejemplo, `Alberto` y `Kike` pueden ser personas, mientras que `Común` puede representar una parte compartida entre ambos.

El resumen exportado está pensado para usarlo después en una app de reparto de gastos como Tricount, Splitwise o similar. Así no hace falta introducir producto por producto a mano: se revisa el ticket, se reparte en esta web y luego se pasan los totales por persona o grupo.

## Qué hace

- Lee tickets en **PDF** o **imagen**.
- Extrae texto desde PDF con texto embebido y usa **OCR** cuando el ticket viene escaneado o como foto.
- Detecta productos por unidad, packs, cantidades tipo `2,99 x 2` y productos por peso o volumen.
- Aplica descuentos habituales de Lidl, incluyendo `Desc.`, promociones Lidl Plus y descuentos porcentuales cuando el OCR los reconoce.
- Detecta el total del ticket desde el nombre del archivo o desde el propio ticket.
- Valida si el total de productos detectados coincide con el total esperado.
- Permite corregir el total esperado manualmente con una calculadora integrada.
- Permite añadir líneas manuales cuando falta importe o hay productos fuera del ticket.
- Permite editar nombre e importe de cada producto, también con calculadora rápida.
- Permite ocultar líneas que no quieras repartir.
- Permite crear, editar y eliminar categorías.
- Permite repartir un producto por porcentaje entre varias categorías.
- Muestra resumen por categoría con contador y suma.
- Exporta una imagen con el resumen por categorías.
- Si quedan productos sin categoría al exportar, permite asignarlos todos a una categoría o exportar solo los ya asignados.
- Soporta modo oscuro automático.

## Flujo de uso

1. Obtén el ticket digital del supermercado.
2. Abre la web y selecciona el PDF o imagen del ticket.
3. Revisa que el total de arriba coincida.
4. Toca productos para asignarlos a la categoría activa.
5. Edita productos, importes, repartos o categorías si hace falta.
6. Exporta el resumen y usa esos importes en tu repartidor de gastos.


## Categorías y reparto

Aunque la app las llama categorías, están pensadas para funcionar como personas, grupos o bolsas de gasto. Las iniciales son `Alberto`, `Kike` y `Común`, pero se pueden cambiar desde la barra inferior.

Cada producto puede:

- asignarse entero a una categoría;
- dividirse por porcentaje;
- ocultarse;
- editarse;
- añadirse manualmente si falta.

## Exportación

La exportación genera una imagen con las categorías que tienen productos asignados.

Si hay productos sin categoría, antes de exportar la app muestra un aviso con opciones para:

- asignar todos los pendientes a una categoría;
- exportar solo los productos ya asignados;
- cancelar.

## Consejos

- Para Mercadona, ayuda que el archivo incluya el total en el nombre, por ejemplo: `20260204 Mercadona 57,51 €.pdf`.
- En tickets de Lidl como imagen, el OCR puede introducir espacios o símbolos raros. Si el total no cuadra, revisa descuentos y líneas cercanas.
- Si una línea no debe repartirse, puedes ocultarla desde la edición del producto.

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
