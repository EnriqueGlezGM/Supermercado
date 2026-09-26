import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTicketTotal, filterProductsSection, parseProducts } from '../src/ticketParser.js';

test('parses Lidl unit-price times quantity rows without keeping the multiplier in the title', () => {
  const items = parseProducts(['COMPO SUSTRATO 5 L 2,99x 2'], { store: 'Lidl' });

  assert.equal(items.length, 1);
  assert.equal(items[0].description, 'COMPO SUSTRATO 5 L');
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].unit, 2.99);
  assert.equal(items[0].amount, 5.98);
});

test('parses Lidl unit-price times quantity rows when OCR also includes the final amount', () => {
  const items = parseProducts(['COMPO SUSTRATO 5 L 2,99x 2 5,98 A'], { store: 'Lidl' });

  assert.equal(items.length, 1);
  assert.equal(items[0].description, 'COMPO SUSTRATO 5 L');
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].unit, 2.99);
  assert.equal(items[0].amount, 5.98);
});

test('attaches a standalone negative amount after a Lidl weight line to that product', () => {
  const items = parseProducts([
    'QUESO VIEJO TOSTADO 19,41 A',
    '1,494 kg x 12,99 EUR/kg',
    '-2,99',
    'DIGESTIVE 1,49 B',
  ], { store: 'Lidl' });

  assert.equal(items.length, 2);
  assert.equal(items[0].description, 'QUESO VIEJO TOSTADO');
  assert.equal(items[0].quantity, 1.494);
  assert.equal(items[0].baseAmount, 19.41);
  assert.equal(items[0].discountAmount, 2.99);
  assert.deepEqual(items[0].discountLabels, ['Descuento']);
  assert.equal(items[0].amount, 16.42);
});

test('attaches a plain PROMO line after a Lidl weight product', () => {
  const items = parseProducts([
    'QUESO VIEJO TOSTADO 19,41 A',
    '1,494 kg x 12,99 EUR/kg',
    'PROMO -2,99',
    'DIGESTIVE 1,49 B',
  ], { store: 'Lidl' });

  assert.equal(items.length, 2);
  assert.equal(items[0].description, 'QUESO VIEJO TOSTADO');
  assert.equal(items[0].baseAmount, 19.41);
  assert.equal(items[0].discountAmount, 2.99);
  assert.deepEqual(items[0].discountLabels, ['Promo']);
  assert.equal(items[0].amount, 16.42);
});

test('does not attach a standalone negative amount without a preceding weight line', () => {
  const items = parseProducts([
    'BEBIDA 1,25 A',
    '-0,25',
  ], { store: 'Lidl' });

  assert.equal(items.length, 1);
  assert.equal(items[0].amount, 1.25);
  assert.equal(items[0].discountAmount, undefined);
});

test('keeps duplicate product rows as separate parser results', () => {
  const items = parseProducts([
    'BEBIDA 1,25 A',
    'BEBIDA 1,25 A',
  ], { store: 'Lidl' });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((it) => it.description), ['BEBIDA', 'BEBIDA']);
  assert.deepEqual(items.map((it) => it.amount), [1.25, 1.25]);
});

test('does not treat product names ending in IVA as tax summary noise', () => {
  const items = parseProducts([
    '1 ATUN OLIVA 7,70',
    '1 NAVAJA VIVA 2,95',
    'IVA 21% 0,52',
  ], { store: 'Mercadona' });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((it) => it.description), ['ATUN OLIVA', 'NAVAJA VIVA']);
  assert.deepEqual(items.map((it) => it.amount), [7.7, 2.95]);
});

test('product section detection recognizes Lidl unit-price times quantity rows', () => {
  const lines = [
    'LIDL',
    'FACTURA SIMPLIFICADA',
    'COMPO SUSTRATO 5 L 2,99x 2',
    'BEBIDA 1,25 A',
    'TOTAL 7,23',
    'TARJETA',
  ];

  assert.deepEqual(filterProductsSection(lines), [
    'COMPO SUSTRATO 5 L 2,99x 2',
    'BEBIDA 1,25 A',
  ]);
});

test('extracts Lidl ticket total without confusing it with cash delivered or change', () => {
  const total = extractTicketTotal([
    'TOTAL 52,05',
    'ENTREGA 55,00',
    'Cambio -2,95',
    'IVA% IVA + PN = PVP',
    'Suma 3,81 48,24 52,05',
    '! Desc. total en compra !',
    '| 6,99EUR |',
    '| Total oferta Lidl Plus: !',
    '| 4,54 EUR |',
  ]);

  assert.equal(total, 52.05);
});

test('extracts split-line totals and ignores Lidl offer totals', () => {
  assert.equal(extractTicketTotal([
    'TOTAL',
    '52,05',
    'ENTREGADO',
    '55,00',
  ]), 52.05);

  assert.equal(Number.isNaN(extractTicketTotal([
    '! Desc. total en compra !',
    '| 6,99EUR |',
    '| Total oferta Lidl Plus: !',
    '| 4,54 EUR |',
  ])), true);
});
