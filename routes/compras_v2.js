// routes/compras_v2.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

/* ============ Auth ============ */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.rol_id === 1) return next();
  return res.status(403).send('Solo administrador');
}

/* ============ Utils ============ */
const toLocalInput = (dt) => {
  if (!dt) return '';
  const d = new Date(dt);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// agrupa ítems PRODUCTO para sumar cantidades por product_id
function agruparPorProducto(items) {
  const map = new Map();
  for (const it of (items||[])) {
    if (it.clase !== 'PRODUCTO') continue;
    const pid  = Number(it.item_id);
    const cant = parseFloat(it.cantidad || 0);
    if (!pid || !cant) continue;
    map.set(pid, (map.get(pid)||0) + cant);
  }
  return [...map.entries()].map(([product_id, cantidad]) => ({ product_id, cantidad }));
}

// aplica stock en product_stock y product_inventario (por proveedor)
// signo +1 aprobar / -1 revertir
async function aplicarStock(conn, { warehouse_id, supplier_id, items, signo }) {
  const consol = agruparPorProducto(items);
  for (const { product_id, cantidad } of consol) {
    const delta = signo * cantidad;

    // 1) product_stock (por bodega)
    await conn.query(`
      INSERT INTO product_stock (product_id, warehouse_id, cantidad)
      VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad)
    `, [product_id, warehouse_id, delta]);

    // 2) product_inventario (por proveedor y bodega) – mantenemos último precio visto en compra
    const linea = items.find(x => Number(x.item_id) === product_id && x.clase==='PRODUCTO') || {};
    const precioCompra = (linea.precio_unitario != null && linea.precio_unitario !== '') ? Number(linea.precio_unitario) : null;

    await conn.query(`
      INSERT INTO product_inventario (product_id, warehouse_id, supplier_id, cantidad, precio_compra, updated_at)
      VALUES (?,?,?,?,?, NOW())
      ON DUPLICATE KEY UPDATE
        cantidad      = cantidad + VALUES(cantidad),
        precio_compra = COALESCE(VALUES(precio_compra), precio_compra),
        updated_at    = NOW()
    `, [product_id, warehouse_id, supplier_id, delta, precioCompra]);
  }
}

/* =======================================================
   LISTADO
======================================================= */
router.get('/', isAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*,
             DATE_FORMAT(c.fecha_compra, '%d/%m/%Y %H:%i') AS fecha_formateada,
             p.nombre AS proveedor_nombre,
             b.nombre AS bodega_nombre
        FROM compras c
   LEFT JOIN proveedores p ON p.id = c.proveedor_id
   LEFT JOIN bodegas     b ON b.id = c.bodega_id
    ORDER BY c.id DESC
    `);
    res.render('comprasV2/compra_list', {
      title: 'Compras',
      compras: rows,
      user: req.session.user
    });
  } catch (e) { next(e); }
});

/* =======================================================
   NUEVA (catálogo embebido)
======================================================= */
router.get('/nueva', isAuth, async (req, res, next) => {
  try {
    const [proveedores] = await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');
    const [bodegas]     = await pool.query('SELECT id,nombre FROM bodegas ORDER BY nombre');
    res.render('comprasV2/compra_form_modal', {
      title: 'Nueva compra',
      compra: null,
      proveedores,
      bodegas,
      detalles: [],
      user: req.session.user
    });
  } catch (e) { next(e); }
});

/* =======================================================
   API CATÁLOGO (lista)
   - precio: de product_supplier_prices (par único producto+proveedor)
   - stock: SUM(product_inventario.cantidad) por bodega si se elige, sino total
   - si hay proveedor: muestra todos los productos; si un producto no tiene precio para ese
     proveedor, precio será NULL (para que sepas que falta cargarlo).
   - NUNCA filtra por stock -> pueden salir STOCK 0
======================================================= */
// GET /compras-v2/api/items?clase=PRODUCTO|INSUMO&search=&proveedor_id=&bodega_id=
router.get('/api/items', isAuth, async (req, res, next) => {
  try {
    const clase = (req.query.clase || 'PRODUCTO').toUpperCase();
    const q     = (req.query.search || '').trim();
    const prov  = Number(req.query.proveedor_id) || null;
    const bod   = Number(req.query.bodega_id) || null;

    if (clase === 'PRODUCTO') {
      const params = [];

      // precio por proveedor desde LA NUEVA TABLA
      const precioSelect = prov
        ? `(
             SELECT psp.precio_compra
               FROM product_supplier_prices psp
              WHERE psp.product_id = p.id AND psp.supplier_id = ?
              LIMIT 1
           )`
        : `NULL`;
      if (prov) params.push(prov);

      // stock por bodega (si hay) o total
      const stockSelect = `
        COALESCE((
          SELECT SUM(pi.cantidad)
            FROM product_inventario pi
           WHERE pi.product_id = p.id
             ${bod ? 'AND pi.warehouse_id = ?' : ''}
        ),0)`;
      if (bod) params.push(bod);

      let sql = `
        SELECT p.id AS item_id, p.nombre, p.imagen, 'PRODUCTO' AS clase,
               ${precioSelect} AS precio,
               ${stockSelect}   AS stock
          FROM products p
         WHERE p.clase='PRODUCTO'
      `;

      if (q) { sql += ' AND p.nombre LIKE ?'; params.push(`%${q}%`); }
      sql += ' ORDER BY p.nombre ASC LIMIT 200';

      const [rows] = await pool.query(sql, params);
      return res.json({ ok:true, items: rows });
    }

    // INSUMOS (si usas la misma tabla products con clase='INSUMO')
    const params = [];
    let sql = `
      SELECT p.id AS item_id, p.nombre, p.imagen, 'INSUMO' AS clase,
             NULL AS precio, 0 AS stock
        FROM products p
       WHERE p.clase='INSUMO'
    `;
    if (q) { sql += ' AND p.nombre LIKE ?'; params.push(`%${q}%`); }
    sql += ' ORDER BY p.nombre ASC LIMIT 200';

    const [rows] = await pool.query(sql, params);
    return res.json({ ok:true, items: rows });
  } catch (e) { next(e); }
});

/* =======================================================
   CREAR COMPRA (PENDIENTE) – no mueve stock
======================================================= */
router.post('/', isAuth, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { proveedor_id, bodega_id, notas } = req.body;
    const itemsRaw = req.body.items || [];
    const items = Array.isArray(itemsRaw) ? itemsRaw : Object.values(itemsRaw);

    // fecha segura
    const fecha = (req.body.fecha_compra && !isNaN(new Date(req.body.fecha_compra)))
      ? new Date(req.body.fecha_compra) : new Date();

    // total
    let total = 0;
    for (const it of items) {
      it.cantidad = Number(it.cantidad || 0);
      it.precio_unitario = Number(it.precio_unitario || 0);
      total += it.cantidad * it.precio_unitario;
    }

    // cabecera
    const [r] = await conn.query(`
      INSERT INTO compras
        (proveedor_id, bodega_id, fecha_compra, total, notas, usuario_crea_id, estado)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDIENTE')
    `, [
      Number(proveedor_id),
      items.some(i => i.clase==='PRODUCTO') ? (Number(bodega_id) || null) : null,
      fecha,
      total,
      (notas || null),
      req.session.user.id
    ]);
    const compraId = r.insertId;

    // detalle
    for (const it of items) {
      const esProd = it.clase === 'PRODUCTO';
      await conn.query(`
        INSERT INTO compras_detalles
          (compra_id, producto_id, insumo_id, cantidad, precio_unitario)
        VALUES (?,?,?,?,?)
      `, [compraId, esProd ? it.item_id : null, esProd ? null : it.item_id, it.cantidad, it.precio_unitario]);
    }

    await conn.commit();
    res.json({ ok:true, id: compraId, redirect: `/compras-v2/${compraId}` });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally { conn.release(); }
});

/* =======================================================
   EDITAR
======================================================= */
router.get('/:id/editar', isAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [[compra]] = await pool.query('SELECT * FROM compras WHERE id=?', [id]);
    if (!compra) return res.redirect('/compras-v2');

    const [proveedores] = await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');
    const [bodegas]     = await pool.query('SELECT id,nombre FROM bodegas ORDER BY nombre');
    const [detalles]    = await pool.query(`
      SELECT compra_id,
             COALESCE(producto_id, insumo_id) AS item_id,
             CASE WHEN producto_id IS NOT NULL THEN 'PRODUCTO' ELSE 'INSUMO' END AS clase,
             cantidad, precio_unitario
        FROM compras_detalles
       WHERE compra_id=?`, [id]);

    compra.fecha_compra_local = toLocalInput(compra.fecha_compra);
    res.render('comprasV2/compra_form_modal', {
      title:`Editar compra #${compra.id}`,
      compra, proveedores, bodegas, detalles, user: req.session.user
    });
  } catch (e) { next(e); }
});

router.post('/:id', isAuth, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { id } = req.params;
    const { proveedor_id, bodega_id, notas } = req.body;
    const itemsRaw = req.body.items || [];
    const items = Array.isArray(itemsRaw) ? itemsRaw : Object.values(itemsRaw);

    const fecha = (req.body.fecha_compra && !isNaN(new Date(req.body.fecha_compra)))
      ? new Date(req.body.fecha_compra) : new Date();

    // recuperar compra previa para revertir si estaba aprobada
    const [[prev]] = await conn.query('SELECT * FROM compras WHERE id=?', [id]);

    if (prev.estado === 'APROBADO') {
      const [ant] = await conn.query(`
        SELECT COALESCE(producto_id, insumo_id) AS item_id,
               CASE WHEN producto_id IS NOT NULL THEN 'PRODUCTO' ELSE 'INSUMO' END AS clase,
               cantidad, precio_unitario
          FROM compras_detalles WHERE compra_id=?`, [id]);
      if (ant.some(i => i.clase==='PRODUCTO')) {
        await aplicarStock(conn, {
          warehouse_id: Number(prev.bodega_id),
          supplier_id : Number(prev.proveedor_id),
          items: ant,
          signo: -1
        });
      }
    }

    // total nuevo
    let total = 0;
    for (const it of items) {
      it.cantidad = Number(it.cantidad || 0);
      it.precio_unitario = Number(it.precio_unitario || 0);
      total += it.cantidad * it.precio_unitario;
    }

    // actualizar cabecera
    await conn.query(`
      UPDATE compras
         SET proveedor_id=?, bodega_id=?, fecha_compra=?, total=?, notas=?, usuario_mod_id=?, updated_at=NOW()
       WHERE id=?`,
      [Number(proveedor_id), (items.some(i => i.clase==='PRODUCTO') ? (Number(bodega_id)||null) : null),
       fecha, total, (notas||null), req.session.user.id, id]);

    // detalle (borrado + inserción simple)
    await conn.query('DELETE FROM compras_detalles WHERE compra_id=?', [id]);
    for (const it of items) {
      const esProd = it.clase === 'PRODUCTO';
      await conn.query(`
        INSERT INTO compras_detalles (compra_id, producto_id, insumo_id, cantidad, precio_unitario)
        VALUES (?,?,?,?,?)`,
        [id, esProd ? it.item_id : null, esProd ? null : it.item_id, it.cantidad, it.precio_unitario]);
    }

    // si quedó APROBADO reaplicamos stock
    const [[nowC]] = await conn.query('SELECT * FROM compras WHERE id=?', [id]);
    if (nowC.estado === 'APROBADO' && items.some(i => i.clase==='PRODUCTO')) {
      await aplicarStock(conn, {
        warehouse_id: Number(nowC.bodega_id),
        supplier_id : Number(nowC.proveedor_id),
        items,
        signo: +1
      });
    }

    await conn.commit();
    res.redirect('/compras-v2/' + id);
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally { conn.release(); }
});

/* =======================================================
   FICHA
======================================================= */
router.get('/:id', isAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const [[compra]] = await pool.query(`
      SELECT c.*,
             DATE_FORMAT(c.fecha_compra, '%d/%m/%Y %H:%i') AS fecha_formateada,
             p.nombre AS proveedor_nombre,
             b.nombre AS bodega_nombre
        FROM compras c
   LEFT JOIN proveedores p ON p.id = c.proveedor_id
   LEFT JOIN bodegas     b ON b.id = c.bodega_id
       WHERE c.id=?`, [id]);
    if (!compra) return res.redirect('/compras-v2');

    const [detalles] = await pool.query(`
      SELECT d.*,
             pr.nombre  AS producto_nombre,
             ins.nombre AS insumo_nombre,
             (d.cantidad * d.precio_unitario) AS subtotal
        FROM compras_detalles d
   LEFT JOIN products pr  ON pr.id  = d.producto_id
   LEFT JOIN products ins ON ins.id = d.insumo_id AND ins.clase='INSUMO'
       WHERE d.compra_id=?`, [id]);

    res.render('comprasV2/compra_ficha', {
      title:`Compra #${compra.id}`,
      compra, detalles,
      user: req.session.user
    });
  } catch (e) { next(e); }
});

/* =======================================================
   CAMBIAR ESTADO (admin)
======================================================= */
router.post('/:id/estado', isAuth, isAdmin, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { id } = req.params;
    const { estado } = req.body;
    if (!['PENDIENTE','APROBADO','DENEGADO'].includes(estado)) {
      await conn.rollback();
      return res.status(400).send('Estado inválido');
    }

    const [[prev]] = await conn.query('SELECT * FROM compras WHERE id=?', [id]);

    // items actuales
    const [items] = await conn.query(`
      SELECT COALESCE(producto_id, insumo_id) AS item_id,
             CASE WHEN producto_id IS NOT NULL THEN 'PRODUCTO' ELSE 'INSUMO' END AS clase,
             cantidad, precio_unitario
        FROM compras_detalles WHERE compra_id=?`, [id]);

    // transiciones
    if (prev.estado !== 'APROBADO' && estado === 'APROBADO' && items.some(i => i.clase==='PRODUCTO')) {
      await aplicarStock(conn, {
        warehouse_id: Number(prev.bodega_id),
        supplier_id : Number(prev.proveedor_id),
        items, signo:+1
      });
    }
    if (prev.estado === 'APROBADO' && estado !== 'APROBADO' && items.some(i => i.clase==='PRODUCTO')) {
      await aplicarStock(conn, {
        warehouse_id: Number(prev.bodega_id),
        supplier_id : Number(prev.proveedor_id),
        items, signo:-1
      });
    }

    await conn.query(
      `UPDATE compras SET estado=?, usuario_mod_id=?, updated_at=NOW() WHERE id=?`,
      [estado, req.session.user.id, id]
    );

    await conn.commit();
    res.redirect('/compras-v2/' + id);
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally { conn.release(); }
});

/* =======================================================
   PRECIOS por proveedor
======================================================= */

/** Listado simple (opcional) */
router.get('/precios', isAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT psp.product_id, pr.nombre AS producto,
             psp.supplier_id, prov.nombre AS proveedor,
             psp.precio_compra, psp.precio_venta, psp.updated_at
        FROM product_supplier_prices psp
        JOIN products     pr   ON pr.id  = psp.product_id
        JOIN proveedores  prov ON prov.id = psp.supplier_id
    ORDER BY prov.nombre, pr.nombre
    `);
    res.render('comprasV2/precios_list', {
      title: 'Precios por proveedor', precios: rows, user: req.session.user
    });
  } catch (e) { next(e); }
});

/** Formulario nuevo/actualizar */
router.get('/precios/nuevo', isAuth, async (req, res, next) => {
  try {
    const [productos]   = await pool.query('SELECT id,nombre FROM products ORDER BY nombre');
    const [proveedores] = await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');
    res.render('comprasV2/precios_form', {
      title: 'Asignar precio por proveedor',
      productos, proveedores, user: req.session.user
    });
  } catch (e) { next(e); }
});

/** UPSERT de precio por proveedor */
router.post('/precios', isAuth, async (req, res, next) => {
  try {
    const { product_id, supplier_id, precio_compra, precio_venta } = req.body;
    await pool.query(`
      INSERT INTO product_supplier_prices
        (product_id, supplier_id, precio_compra, precio_venta, updated_by)
      VALUES (?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        precio_compra = VALUES(precio_compra),
        precio_venta  = VALUES(precio_venta),
        updated_by    = VALUES(updated_by),
        updated_at    = NOW()
    `, [
      Number(product_id), Number(supplier_id),
      Number(precio_compra || 0), (precio_venta ? Number(precio_venta) : null),
      req.session.user?.id || null
    ]);

    // Regreso al listado de precios o al formulario en blanco
    res.redirect('/compras-v2/precios');
  } catch (e) { next(e); }
});

module.exports = router;
