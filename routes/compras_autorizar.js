// routes/compras_autorizar.js
const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const pool    = require('../config/db');

/* ====== Middlewares ====== */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.rol_id === 1) return next();
  return res.status(403).send('Solo administrador');
}

/* ====== Multer: uploads/facturas ====== */
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'facturas');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename   : (_req, file, cb) => {
    const ts = Date.now();
    const safe = (file.originalname || 'archivo').replace(/[^\w.\-]+/g,'_');
    cb(null, `${ts}_${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (_req, file, cb) => {
    const ok = /pdf|png|jpe?g|webp/i.test(file.mimetype);
    cb(ok ? null : new Error('Formato no permitido (solo PDF/PNG/JPG/WebP)'), ok);
  }
});

/* ====== Helpers de stock ====== */
function agruparPorProducto(items) {
  const map = new Map();
  for (const it of (items || [])) {
    if (it.clase !== 'PRODUCTO') continue;
    const pid = Number(it.item_id);
    const cant = Number(it.cantidad || 0);
    if (!pid || !cant) continue;
    map.set(pid, (map.get(pid) || 0) + cant);
  }
  return [...map.entries()].map(([product_id, cantidad]) => ({ product_id, cantidad }));
}

async function aplicarStock(conn, { warehouse_id, supplier_id, items, signo }) {
  const consol = agruparPorProducto(items);
  for (const { product_id, cantidad } of consol) {
    const delta = signo * cantidad;

    await conn.query(`
      INSERT INTO product_stock (product_id, warehouse_id, cantidad)
      VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE cantidad = cantidad + VALUES(cantidad)
    `, [product_id, warehouse_id, delta]);

    const linea = items.find(x => Number(x.item_id) === product_id && x.clase === 'PRODUCTO') || {};
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
   LISTADO DE ÓRDENES A AUTORIZAR (no completadas)
======================================================= */
router.get('/autorizar', isAuth, isAdmin, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.id, c.fecha_compra, c.total, c.estado,
             p.nombre AS proveedor_nombre,
             b.nombre AS bodega_nombre
        FROM compras c
   LEFT JOIN proveedores p ON p.id = c.proveedor_id
   LEFT JOIN bodegas b     ON b.id = c.bodega_id
       WHERE c.estado IN ('PENDIENTE','APROBADO')
       ORDER BY c.id DESC
    `);

    res.render('V4compras/autorizar_list', {
      title: 'Autorizar compra / Registrar factura',
      compras: rows
    });
  } catch (e) { next(e); }
});

/* =======================================================
   FORMULARIO DE AUTORIZACIÓN/FACTURA
======================================================= */
router.get('/autorizar/:id(\\d+)', isAuth, isAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const [[compra]] = await pool.query(`
      SELECT c.*, p.nombre AS proveedor_nombre, b.nombre AS bodega_nombre
        FROM compras c
   LEFT JOIN proveedores p ON p.id = c.proveedor_id
   LEFT JOIN bodegas b     ON b.id = c.bodega_id
       WHERE c.id=?
    `, [id]);

    if (!compra) return res.redirect('/compras-v4/autorizar');
    if (compra.estado === 'COMPLETADO') return res.redirect(`/compras-v2/${id}`);

    const [formas]      = await pool.query(`SELECT id, nombre FROM formas_pago ORDER BY nombre`);
    const [condiciones] = await pool.query(`SELECT id, nombre FROM condiciones_pago ORDER BY nombre`);
    const [tiposDoc]    = await pool.query(`SELECT id, nombre FROM tipos_documento ORDER BY nombre`);

    res.render('V4compras/autorizar_form', {
      title: `Autorizar compra #${id}`,
      compra,
      formas,
      condiciones,
      tiposDoc
    });
  } catch (e) { next(e); }
});

/* =======================================================
   REGISTRAR FACTURA + COMPLETAR COMPRA
======================================================= */
router.post('/autorizar/:id(\\d+)', isAuth, isAdmin, upload.single('archivo'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const id  = Number(req.params.id);
    const uid = req.session.user.id;

    const [[compra]] = await conn.query(`SELECT * FROM compras WHERE id=? FOR UPDATE`, [id]);
    if (!compra) { await conn.rollback(); return res.status(404).send('Compra no encontrada'); }
    if (compra.estado === 'COMPLETADO') { await conn.rollback(); return res.redirect(`/compras-v2/${id}`); }

    const { numero_factura, forma_pago_id, condicion_pago_id, tipo_documento_id } = req.body;

    const archivoRel = req.file
      ? path.join('/uploads/facturas', req.file.filename).replace(/\\/g,'/')
      : null;

    await conn.query(`
      INSERT INTO compras_facturas
        (compra_id, numero_factura, forma_pago_id, condicion_pago_id, tipo_documento_id, archivo_path, creado_por_id, creado_en)
      VALUES (?,?,?,?,?,?,?, NOW())
    `, [
      id,
      (numero_factura || null),
      (forma_pago_id ? Number(forma_pago_id) : null),
      (condicion_pago_id ? Number(condicion_pago_id) : null),
      (tipo_documento_id ? Number(tipo_documento_id) : null),
      archivoRel,
      uid
    ]);

    const [items] = await conn.query(`
      SELECT COALESCE(producto_id, insumo_id) AS item_id,
             CASE WHEN producto_id IS NOT NULL THEN 'PRODUCTO' ELSE 'INSUMO' END AS clase,
             cantidad, precio_unitario
        FROM compras_detalles WHERE compra_id=?`, [id]);

    if (items.some(i => i.clase === 'PRODUCTO')) {
      await aplicarStock(conn, {
        warehouse_id: Number(compra.bodega_id),
        supplier_id : Number(compra.proveedor_id),
        items,
        signo: +1
      });
    }

    await conn.query(
      `UPDATE compras SET estado='COMPLETADO', usuario_mod_id=?, updated_at=NOW() WHERE id=?`,
      [uid, id]
    );

    await conn.commit();
    res.redirect(`/compras-v2/${id}`);
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

module.exports = router;
