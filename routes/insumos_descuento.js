// routes/insumos_descuento.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

// Auth simple (ajústalo si usas otra verificación)
const isAuth = (req, res, next) => next();

/* ===========================
   1) Listado de INSUMOS
   - Muestra imagen, nombre y stock total
=========================== */
router.get('/descontar', isAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT  p.id,
              p.nombre,
              COALESCE(p.imagen, '/img/products/noimg.png') AS imagen,
              COALESCE(SUM(ps.cantidad), 0) AS stock_total
        FROM products p
   LEFT JOIN product_stock ps
          ON ps.product_id = p.id
       WHERE p.clase = 'INSUMO'
    GROUP BY p.id, p.nombre, p.imagen
    ORDER BY p.nombre ASC
    `);

    // Renderiza la vista (si aún no la tienes, puedes cambiar temporalmente a res.json)
    return res.render('insumos/descontar_list', {
      title: 'Descontar insumos',
      items: rows
    });
  } catch (e) {
    return next(e);
  }
});

/* ===========================
   2) Form de descuento por INSUMO
   - Muestra stock por bodega
=========================== */
router.get('/descontar/:id(\\d+)', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const [[prod]] = await pool.query(`
      SELECT id, nombre, COALESCE(imagen, '/img/products/noimg.png') AS imagen
        FROM products
       WHERE id=? AND clase='INSUMO'
       LIMIT 1
    `, [id]);
    if (!prod) return res.status(404).send('Insumo no encontrado');

    const [porBodega] = await pool.query(`
      SELECT  b.id,
              b.nombre,
              COALESCE(ps.cantidad, 0) AS stock
        FROM bodegas b
   LEFT JOIN product_stock ps
          ON ps.warehouse_id = b.id
         AND ps.product_id   = ?
    ORDER BY b.nombre ASC
    `, [id]);

    return res.render('insumos/descontar_form', {
      title: `Descontar: ${prod.nombre}`,
      prod,
      porBodega
    });
  } catch (e) {
    return next(e);
  }
});

/* ===========================
   3) Aplicar descuento
   body: { warehouse_id, cantidad }
=========================== */
router.post('/descontar/:id(\\d+)', isAuth, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const product_id   = Number(req.params.id);
    const warehouse_id = Number(req.body.warehouse_id);
    const desc         = Math.max(0, Number(req.body.cantidad || 0));

    if (!product_id || !warehouse_id || desc <= 0) {
      return res.status(400).json({ ok:false, message:'Datos inválidos.' });
    }

    // Verificar que sea INSUMO
    const [[p]] = await conn.query(
      `SELECT id FROM products WHERE id=? AND clase='INSUMO' LIMIT 1`,
      [product_id]
    );
    if (!p) {
      return res.status(400).json({ ok:false, message:'Solo se pueden descontar insumos.' });
    }

    await conn.beginTransaction();

    // Asegurar fila en product_stock
    await conn.query(`
      INSERT INTO product_stock (product_id, warehouse_id, cantidad)
      VALUES (?,?,0)
      ON DUPLICATE KEY UPDATE cantidad = cantidad
    `, [product_id, warehouse_id]);

    // Leer stock actual
    const [[row]] = await conn.query(`
      SELECT cantidad AS stock
        FROM product_stock
       WHERE product_id=? AND warehouse_id=? LIMIT 1
    `, [product_id, warehouse_id]);

    const disponible = Number(row?.stock || 0);
    if (disponible < desc) {
      await conn.rollback();
      return res.status(400).json({
        ok:false,
        message:`Stock insuficiente. Disponible: ${disponible}, a descontar: ${desc}.`
      });
    }

    // Descontar
    await conn.query(`
      UPDATE product_stock
         SET cantidad = cantidad - ?
       WHERE product_id=? AND warehouse_id=?
       LIMIT 1
    `, [desc, product_id, warehouse_id]);

    await conn.commit();
    return res.json({ ok:true, message:'Descuento aplicado.' });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    return next(e);
  } finally {
    conn.release();
  }
});

module.exports = router;
  