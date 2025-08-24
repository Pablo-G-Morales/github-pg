/**
 * /inventario/stock
 *  - Stock total por producto
 *  - Último precio de compra (de product_inventario)
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* Middleware local */
function isAuthenticated (req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

/* LISTADO GLOBAL */
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const [productos] = await pool.query(`
      SELECT  p.id,
              p.nombre,
              IFNULL(SUM(pi.cantidad),0)                         AS stock_total,
              (
                SELECT pi.precio_compra
                  FROM product_inventario pi
                 WHERE pi.product_id = p.id
            ORDER BY pi.updated_at DESC
                 LIMIT 1
              )                                                 AS ultimo_compra
        FROM products p
   LEFT JOIN product_inventario pi ON pi.product_id = p.id
    GROUP BY p.id, p.nombre
    ORDER BY p.nombre
    `);

    res.render('inventario/stock_list', {
      title: 'Stock global',
      productos
    });

  } catch (err) { next(err); }
});

module.exports = router;
