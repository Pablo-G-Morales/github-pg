// routes/pedidos_tienda.js
const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const pool    = require('../config/db');

/* ===== Auth ===== */
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}

/* ====== Multer: uploads/disenos ====== */
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'disenos');
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

/* ===== Helpers ===== */

// stock disponible por bodega (usa product_stock acumulado)
async function getStockDisponible(productId, bodegaId) {
  const [[r]] = await pool.query(`
    SELECT COALESCE((
      SELECT ps.cantidad FROM product_stock ps
       WHERE ps.product_id=? AND ps.warehouse_id=?
    ), 0) AS stock
  `, [productId, bodegaId]);
  return Number(r?.stock || 0);
}

/* =======================================================
   UI principal (tipo tienda) — SOLO PRODUCTO
======================================================= */
router.get('/nuevo', isAuth, async (req, res, next) => {
  try {
    const [proveedores]   = await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');
    const [bodegas]       = await pool.query('SELECT id,nombre FROM bodegas ORDER BY nombre');
    const [departamentos] = await pool.query('SELECT id,nombre FROM departamentos ORDER BY nombre');

    res.render('pedidos/shop', {
      title: 'Nuevo pedido (Tienda)',
      proveedores, bodegas, departamentos,
      user: req.session.user
    });
  } catch (e) { next(e); }
});

/* =======================================================
   API: municipios por departamento
   GET /pedidos/api/municipios?departamento_id=#
======================================================= */
router.get('/api/municipios', isAuth, async (req, res, next) => {
  try {
    const depId = Number(req.query.departamento_id);
    if (!depId) return res.json({ ok:true, items: [] });

    const [rows] = await pool.query(
      'SELECT id, nombre FROM municipios WHERE departamento_id=? ORDER BY nombre',
      [depId]
    );
    res.json({ ok:true, items: rows });
  } catch (e) { next(e); }
});

/* =======================================================
   API: catálogo SOLO PRODUCTO con stock por bodega
   GET /pedidos/api/catalog?search=&bodega_id=
   Precio mostrado: p.precio_venta (si existe), si no 0.
   Si stock <= 0 → sinStock = true (UI debe bloquear "Agregar").
======================================================= */
router.get('/api/catalog', isAuth, async (req, res, next) => {
  try {
    const q   = (req.query.search || '').trim();
    const bid = Number(req.query.bodega_id) || null;

    const params = [];
    let sql = `
      SELECT p.id, p.nombre, p.imagen,
             COALESCE(p.precio_venta, 0) AS precio
        FROM products p
       WHERE p.clase='PRODUCTO'
    `;
    if (q) { sql += ' AND p.nombre LIKE ?'; params.push(`%${q}%`); }
    sql += ' ORDER BY p.nombre ASC LIMIT 300';

    const [rows] = await pool.query(sql, params);

    // anexa stock por bodega
    const items = [];
    for (const r of rows) {
      const stock = bid ? await getStockDisponible(r.id, bid) : 0;
      items.push({
        id: r.id,
        nombre: r.nombre,
        imagen: r.imagen || '/img/products/noimg.png',
        precio: Number(r.precio || 0),
        stock,
        sinStock: bid ? stock <= 0 : false
      });
    }

    res.json({ ok:true, items });
  } catch (e) { next(e); }
});

/* =======================================================
   CREAR PEDIDO (PENDIENTE) – NO mueve stock
   SOLO acepta ítems que existan en products con clase='PRODUCTO'.
   POST /pedidos
======================================================= */
router.post('/', isAuth, upload.single('diseno'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const uid  = req.session.user.id;
    const proveedor_id    = req.body.proveedor_id ? Number(req.body.proveedor_id) : null;
    const bodega_id       = Number(req.body.bodega_id);
    const departamento_id = Number(req.body.departamento_id);
    const municipio_id    = Number(req.body.municipio_id);
    const fecha_pedido    = req.body.fecha_pedido ? new Date(req.body.fecha_pedido) : new Date();
    const direccion       = (req.body.direccion || null);
    const notas           = (req.body.notas || null);

    // items puede venir como JSON o arreglo
    let items = [];
    if (req.body.items && typeof req.body.items === 'string') {
      try { items = JSON.parse(req.body.items); } catch { items = []; }
    } else if (Array.isArray(req.body.items)) {
      items = req.body.items;
    }

    // normalizar y validar: SOLO PRODUCTO + stock suficiente
    let total = 0;
    const itemsNorm = [];
    const insuficientes = [];
    const noProducto   = [];

    for (const raw of (items || [])) {
      const producto_id = Number(raw.producto_id || raw.id);
      const cantidad    = Number(raw.cantidad || 0);
      const precioUnit  = Number(raw.precio_unitario != null ? raw.precio_unitario : raw.precio);

      if (!producto_id || cantidad <= 0) continue;

      // verificar que sea PRODUCTO
      const [[prd]] = await conn.query(
        'SELECT id FROM products WHERE id=? AND clase="PRODUCTO" LIMIT 1',
        [producto_id]
      );
      if (!prd) { noProducto.push(producto_id); continue; }

      // validar stock en la bodega
      const stock = await getStockDisponible(producto_id, bodega_id);
      if (cantidad > stock) {
        insuficientes.push({ producto_id, solicitado:cantidad, stock });
        continue;
      }

      total += cantidad * precioUnit;
      itemsNorm.push({ producto_id, cantidad, precio_unitario: precioUnit });
    }

    if (noProducto.length) {
      await conn.rollback();
      return res.status(400).json({
        ok:false,
        message: 'Se intentó agregar ítems que no son PRODUCTO.',
        productos: noProducto
      });
    }
    if (insuficientes.length) {
      await conn.rollback();
      return res.status(400).json({
        ok:false,
        message: 'Stock insuficiente en algunos productos.',
        detalles: insuficientes
      });
    }
    if (!itemsNorm.length) {
      await conn.rollback();
      return res.status(400).json({ ok:false, message:'No hay items válidos.' });
    }

    // archivo de diseño
    const diseno_path = req.file
      ? path.join('/uploads/disenos', req.file.filename).replace(/\\/g,'/')
      : null;

    // Insert cabecera
    const [r] = await conn.query(`
      INSERT INTO pedidos
        (proveedor_id, bodega_id, departamento_id, municipio_id, fecha_pedido,
         direccion, diseno_path, notas, estado, total, usuario_crea_id)
      VALUES (?,?,?,?,?,?,?,?, 'PENDIENTE', ?, ?)
    `, [
      proveedor_id, bodega_id, departamento_id, municipio_id, fecha_pedido,
      direccion, diseno_path, notas, total, uid
    ]);
    const pedidoId = r.insertId;

    // Insert detalles (precio congelado)
    for (const it of itemsNorm) {
      await conn.query(`
        INSERT INTO pedidos_detalles (pedido_id, producto_id, cantidad, precio_unitario)
        VALUES (?,?,?,?)
      `, [pedidoId, it.producto_id, it.cantidad, it.precio_unitario]);
    }

    await conn.commit();
    return res.json({ ok:true, id: pedidoId, redirect:`/pedidos/${pedidoId}` });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

module.exports = router;
