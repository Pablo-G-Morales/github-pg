/**
 * Rutas de inventario por producto
 * ──────────────────────────────────────────────────────────────
 *  GET  /inventario/productos/:id/inventario
 *      → ficha con existencias por bodega + histórico de precios
 *
 *  GET  /inventario/productos/:id/inventario/nuevo
 *      → formulario para registrar / actualizar inventario
 *
 *  POST /inventario/productos/:id/inventario/nuevo
 *      → guarda stock (product_stock) y precio proveedor
 *        (product_supplier_prices) y vuelve a la ficha
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* ───────── middleware simple de sesión ───────── */
function isAuth (req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/');
}

/* ════════════════════════════════════════════════
   FICHA DE INVENTARIO
   ════════════════════════════════════════════════ */
router.get('/:id/inventario', isAuth, async (req, res, next) => {
  const { id } = req.params;
  try {
    /* ► Producto + catálogos */
    const [[producto]] = await pool.query(`
      SELECT p.*, m.nombre AS marca,
             mat.nombre AS material,
             c.nombre AS color,
             f.nombre AS forma,
             u.nombre AS unidad
        FROM products p
   LEFT JOIN marcas      m   ON m.id  = p.brand_id
   LEFT JOIN materiales  mat ON mat.id = p.material_id
   LEFT JOIN colores     c   ON c.id  = p.color_id
   LEFT JOIN formas      f   ON f.id  = p.shape_id
   LEFT JOIN unidades    u   ON u.id  = p.unit_id
       WHERE p.id = ?`, [id]);

    if (!producto) return res.status(404).send('Producto no encontrado');

    /* ► Existencias por bodega */
    const [stocks] = await pool.query(`
      SELECT b.nombre AS bodega,
             IFNULL(SUM(ps.cantidad),0) AS cantidad
        FROM bodegas b
   LEFT JOIN product_stock ps
              ON ps.warehouse_id = b.id
             AND ps.product_id   = ?
    GROUP BY b.id, b.nombre
    ORDER BY b.nombre`, [id]);

    /* ► Histórico de precios por proveedor */
    const [precios] = await pool.query(`
      SELECT psp.*,
             prov.nombre AS proveedor
        FROM product_supplier_prices psp
  INNER JOIN proveedores prov ON prov.id = psp.supplier_id
       WHERE psp.product_id = ?
    ORDER BY psp.fecha_vigencia DESC`, [id]);

    res.render('inventario/producto_stock', {
      title: `Inventario – ${producto.nombre}`,
      producto, stocks, precios
    });
  } catch (e) { next(e); }
});

/* ════════════════════════════════════════════════
   FORMULARIO NUEVO / EDITAR INVENTARIO  (GET)
   ════════════════════════════════════════════════ */
router.get('/:id/inventario/nuevo', isAuth, async (req, res, next) => {
  const { id } = req.params;
  try {
    const [bodegas]     = await pool.query('SELECT id,nombre FROM bodegas ORDER BY nombre');
    const [proveedores] = await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');

    res.render('inventario/producto_inventario_form', {
      title       : 'Nuevo inventario',
      producto_id : id,
      bodegas,
      proveedores
    });
  } catch (e) { next(e); }
});

/* ════════════════════════════════════════════════
   GUARDAR INVENTARIO (POST)
   ════════════════════════════════════════════════ */
router.post('/:id/inventario/nuevo', isAuth, async (req, res, next) => {
  const { id } = req.params;
  const {
    warehouse_id,
    supplier_id,
    cantidad,
    precio_compra,
    precio_venta
  } = req.body;
  const uid = req.session.user.id;

  try {
    /* ► 1. Stock por bodega (tabla product_stock) */
    await pool.query(`
      INSERT INTO product_stock
        (product_id, warehouse_id, cantidad,
         creado_por, actualizado_por)
      VALUES (?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        cantidad        = VALUES(cantidad),
        actualizado_por = VALUES(actualizado_por),
        updated_at      = NOW()`,
      [id, warehouse_id, cantidad, uid, uid]);

    /* ► 2. Histórico de precio por proveedor
       (tabla product_supplier_prices)            */
    await pool.query(`
      INSERT INTO product_supplier_prices
        (product_id, supplier_id, fecha_vigencia,
         precio_compra, precio_venta, creado_por, actualizado_por)
      VALUES (?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        precio_compra   = VALUES(precio_compra),
        precio_venta    = VALUES(precio_venta),
        actualizado_por = VALUES(actualizado_por),
        updated_at      = NOW()`,
      [
        id,
        supplier_id,
        new Date(),               // fecha_vigencia = hoy
        precio_compra,
        precio_venta || null,
        uid, uid
      ]);

    res.redirect(`/inventario/productos/${id}/inventario`);
  } catch (e) { next(e); }
});

module.exports = router;
