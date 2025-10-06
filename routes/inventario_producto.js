// routes/inventario_producto.js
/**
 * Inventario por producto (ficha + histórico de precios por proveedor).
 * IMPORTANTE:
 * - Este módulo YA NO mueve stock. El stock se ajusta exclusivamente desde Compras v2.
 * - En la tabla product_supplier_prices la FK del proveedor es supplier_id.
 * - En product_stock la FK de bodega es warehouse_id.
 */
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* -------------------- Auth -------------------- */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}

/* -------------------- Utils -------------------- */
const toMoney = (n) => (n == null ? null : Number(n).toFixed(2));

/* =========================================================
   FICHA
   GET /inventario/productos/:id/inventario
   - Datos del producto
   - Existencias por bodega (product_stock.warehouse_id)
   - Histórico de precios por proveedor (product_supplier_prices.supplier_id)
   - Último precio por proveedor
========================================================= */
router.get('/:id/inventario', isAuth, async (req, res, next) => {
  const { id } = req.params;
  try {
    // Producto + catálogos
    const [[producto]] = await pool.query(`
      SELECT p.*,
             m.nombre   AS marca,
             mat.nombre AS material,
             c.nombre   AS color,
             f.nombre   AS forma,
             u.nombre   AS unidad
        FROM products p
   LEFT JOIN marcas     m   ON m.id  = p.brand_id
   LEFT JOIN materiales mat ON mat.id = p.material_id
   LEFT JOIN colores    c   ON c.id  = p.color_id
   LEFT JOIN formas     f   ON f.id  = p.shape_id
   LEFT JOIN unidades   u   ON u.id  = p.unit_id
       WHERE p.id = ?
    `, [id]);

    if (!producto) return res.status(404).send('Producto no encontrado');

    // Existencias por bodega
    const [stocks] = await pool.query(`
      SELECT b.id, b.nombre AS bodega,
             IFNULL(SUM(ps.cantidad), 0) AS stock
        FROM bodegas b
   LEFT JOIN product_stock ps
          ON ps.warehouse_id = b.id
         AND ps.product_id   = ?
    GROUP BY b.id, b.nombre
    ORDER BY b.nombre
    `, [id]);

    // Histórico completo (ordenado por proveedor y fecha)
    const [historial] = await pool.query(`
      SELECT psp.id,
             pr.id          AS proveedor_id,
             pr.nombre      AS proveedor,
             psp.precio_compra,
             psp.precio_venta,
             psp.fecha_vigencia
        FROM product_supplier_prices psp
        JOIN proveedores pr ON pr.id = psp.supplier_id
       WHERE psp.product_id = ?
       ORDER BY pr.nombre, psp.fecha_vigencia DESC
    `, [id]);

    // Último precio por proveedor (intenta ventana; si no, fallback con MAX)
    let ultimos;
    try {
      const [rows] = await pool.query(`
        SELECT x.product_id,
               x.supplier_id AS proveedor_id,
               pr.nombre     AS proveedor,
               x.precio_compra,
               x.precio_venta,
               x.fecha_vigencia
          FROM (
            SELECT psp.*,
                   ROW_NUMBER() OVER (
                     PARTITION BY psp.product_id, psp.supplier_id
                     ORDER BY psp.fecha_vigencia DESC
                   ) AS rn
              FROM product_supplier_prices psp
             WHERE psp.product_id = ?
          ) x
          JOIN proveedores pr ON pr.id = x.supplier_id
         WHERE x.rn = 1
         ORDER BY pr.nombre
      `, [id]);
      ultimos = rows;
    } catch {
      const [rows] = await pool.query(`
        SELECT psp.product_id,
               psp.supplier_id AS proveedor_id,
               pr.nombre       AS proveedor,
               psp.precio_compra,
               psp.precio_venta,
               psp.fecha_vigencia
          FROM product_supplier_prices psp
          JOIN proveedores pr ON pr.id = psp.supplier_id
          JOIN (
            SELECT product_id, supplier_id, MAX(fecha_vigencia) AS max_fv
              FROM product_supplier_prices
             WHERE product_id = ?
             GROUP BY product_id, supplier_id
          ) ult
            ON ult.product_id  = psp.product_id
           AND ult.supplier_id = psp.supplier_id
           AND ult.max_fv      = psp.fecha_vigencia
         ORDER BY pr.nombre
      `, [id]);
      ultimos = rows;
    }

    res.render('inventario/producto_inventario', {
      title: producto?.nombre || 'Producto',
      producto,
      stocks,
      historial: historial.map(h => ({
        ...h,
        precio_compra: toMoney(h.precio_compra),
        precio_venta : toMoney(h.precio_venta)
      })),
      ultimos: ultimos.map(u => ({
        ...u,
        precio_compra: toMoney(u.precio_compra),
        precio_venta : toMoney(u.precio_venta)
      }))
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   NUEVO/EDITAR PRECIO (formulario)
   GET /inventario/productos/:id/inventario/nuevo
   - Ya NO se pide "cantidad".
   - Solo se registran precios por proveedor.
========================================================= */
router.get('/:id/inventario/nuevo', isAuth, async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const [[producto]] = await pool.query('SELECT id, nombre FROM products WHERE id=?', [productId]);
    if (!producto) return res.redirect('/inventario/productos');

    const [proveedores] = await pool.query('SELECT id, nombre FROM proveedores ORDER BY nombre');

    res.render('inventario/producto_inventario_form', {
      title: 'Nuevo inventario',
      producto,
      proveedores,
      registro: null
    });
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   GUARDAR PRECIO PROVEEDOR
   POST /inventario/productos/:id/inventario/nuevo
   - Inserta registro en product_supplier_prices (supplier_id).
   - NO toca product_stock.
========================================================= */
router.post('/:id/inventario/nuevo', isAuth, async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const { proveedor_id, precio_compra, precio_venta } = req.body;

    if (!productId || !proveedor_id) {
      return res.redirect(`/inventario/productos/${productId}/inventario/nuevo`);
    }

    await pool.query(`
      INSERT INTO product_supplier_prices
        (product_id, supplier_id, precio_compra, precio_venta, fecha_vigencia, creado_por)
      VALUES (?,?,?,?, NOW(), ?)
    `, [
      productId,
      Number(proveedor_id), // ← el name del form puede seguir siendo proveedor_id
      precio_compra ? Number(precio_compra) : 0,
      precio_venta  ? Number(precio_venta)  : null,
      req.session.user.id
    ]);

    res.redirect(`/inventario/productos/${productId}/inventario`);
  } catch (err) {
    next(err);
  }
});

/* =========================================================
   (Opcional) Editar/Eliminar un precio del historial
========================================================= */
router.get('/:id/inventario/precios/:precioId/editar', isAuth, async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const precioId  = Number(req.params.precioId);

    const [[producto]] = await pool.query('SELECT id, nombre FROM products WHERE id=?', [productId]);
    if (!producto) return res.redirect('/inventario/productos');

    const [proveedores] = await pool.query('SELECT id, nombre FROM proveedores ORDER BY nombre');
    const [[registro]]  = await pool.query(`
      SELECT *
        FROM product_supplier_prices
       WHERE id=? AND product_id=?
       LIMIT 1
    `, [precioId, productId]);
    if (!registro) return res.redirect(`/inventario/productos/${productId}/inventario`);

    res.render('inventario/producto_inventario_form', {
      title: `Editar precio — ${producto.nombre}`,
      producto,
      proveedores,
      registro
    });
  } catch (err) { next(err); }
});

router.post('/:id/inventario/precios/:precioId/editar', isAuth, async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const precioId  = Number(req.params.precioId);
    const { proveedor_id, precio_compra, precio_venta, fecha_vigencia } = req.body;

    await pool.query(`
      UPDATE product_supplier_prices
         SET supplier_id   = ?,
             precio_compra = ?,
             precio_venta  = ?,
             fecha_vigencia = ?
       WHERE id = ? AND product_id = ?
    `, [
      Number(proveedor_id),
      precio_compra ? Number(precio_compra) : 0,
      precio_venta  ? Number(precio_venta)  : null,
      fecha_vigencia ? new Date(fecha_vigencia) : new Date(),
      precioId,
      productId
    ]);

    res.redirect(`/inventario/productos/${productId}/inventario`);
  } catch (err) { next(err); }
});

router.post('/:id/inventario/precios/:precioId/eliminar', isAuth, async (req, res, next) => {
  try {
    const productId = Number(req.params.id);
    const precioId  = Number(req.params.precioId);
    await pool.query('DELETE FROM product_supplier_prices WHERE id=? AND product_id=?', [precioId, productId]);
    res.redirect(`/inventario/productos/${productId}/inventario`);
  } catch (err) { next(err); }
});

module.exports = router;
