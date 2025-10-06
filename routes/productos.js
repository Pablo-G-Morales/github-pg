// routes/productos.js
const express  = require('express');
const router   = express.Router();
const pool     = require('../config/db');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

/* Redimensionado opcional de imágenes */
let sharp;
try { sharp = require('sharp'); }
catch { console.warn('sharp no instalado; las imágenes no se optimizarán'); }

/* ---------- Auth ---------- */
function auth (req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

/* ---------- Multer (límite 1 MB) ---------- */
const storage = multer.diskStorage({
  destination: (_, __, cb) =>
    cb(null, path.join(__dirname, '../public/img/products')),
  filename: (_, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 1 * 1024 * 1024 } });

/* ---------- Helpers ---------- */
const numOrZero = v => (v === undefined || v === null || v === '' ? 0 : Number(v));

/* =================================================
   LISTA DE PRODUCTOS
   ================================================= */
router.get('/', auth, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*,
             b.nombre   AS marca,
             mat.nombre AS material,
             col.nombre AS color,
             sh.nombre  AS forma,
             un.nombre  AS unidad
        FROM products p
        LEFT JOIN marcas      b   ON b.id  = p.brand_id
        LEFT JOIN materiales  mat ON mat.id = p.material_id
        LEFT JOIN colores     col ON col.id = p.color_id
        LEFT JOIN formas      sh  ON sh.id  = p.shape_id
        LEFT JOIN unidades    un  ON un.id  = p.unit_id
      ORDER BY p.nombre
    `);
    res.render('inventario/productos_list', {
      title: 'Productos',
      productos: rows
    });
  } catch (e) { next(e); }
});

/* =================================================
   NUEVO PRODUCTO – FORMULARIO
   ================================================= */
router.get('/nuevo', auth, async (_req, res, next) => {
  try {
    const [marcas]      = await pool.query('SELECT id,nombre FROM marcas      ORDER BY nombre');
    const [materiales]  = await pool.query('SELECT id,nombre FROM materiales ORDER BY nombre');
    const [colores]     = await pool.query('SELECT id,nombre FROM colores    ORDER BY nombre');
    const [formas]      = await pool.query('SELECT id,nombre FROM formas     ORDER BY nombre');
    const [unidades]    = await pool.query('SELECT id,nombre FROM unidades   ORDER BY nombre');
    const [proveedores] = await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');

    res.render('inventario/productos_form', {
      title: 'Nuevo producto',
      prod: {
        id: 0,
        nombre: '', descripcion: '',
        brand_id: '', material_id: '', color_id: '', shape_id: '', unit_id: '',
        capacidad: '', precio_compra: '', precio_venta: '', imagen: '',
        clase: 'PRODUCTO' // default
      },
      marcas, materiales, colores, formas, unidades,
      proveedores,
      proveedoresSeleccionados: []
    });
  } catch (e) { next(e); }
});

/* =================================================
   CREAR PRODUCTO (POST)  — Parche numéricos: numOrZero
   ================================================= */
router.post('/nuevo', auth, upload.single('img'), async (req, res, next) => {
  const {
    nombre, descripcion, brand_id,
    material_id, color_id, shape_id, unit_id, capacidad,
    precio_compra, precio_venta, clase
  } = req.body;

  // Normalizar arreglo de proveedores (puede venir como proveedores[] o proveedores)
  const proveedoresSel = Array.isArray(req.body['proveedores[]'])
    ? req.body['proveedores[]']
    : (Array.isArray(req.body.proveedores)
        ? req.body.proveedores
        : (req.body.proveedores ? [req.body.proveedores] : []));

  // Parche: normalizar numéricos a 0 si vienen vacíos
  const pc  = numOrZero(precio_compra);
  const pv  = numOrZero(precio_venta);
  const cap = numOrZero(capacidad);

  let imgRuta = null;

  try {
    if (req.file) {
      if (sharp) {
        const tmp = req.file.path + '_tmp';
        await sharp(req.file.path).resize({ width: 400 }).toFile(tmp);
        fs.renameSync(tmp, req.file.path);
      }
      imgRuta = '/img/products/' + path.basename(req.file.path);
    }

    const uid = req.session.user.id;
    const [r] = await pool.query(`
      INSERT INTO products
        (nombre, descripcion, brand_id,
         material_id, color_id, shape_id, unit_id, capacidad,
         precio_compra, precio_venta, imagen,
         clase,       creado_por, actualizado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?, ?, ?, ?, ?)
    `, [
      nombre, (descripcion || null),
      brand_id || null,
      material_id || null, color_id || null,
      shape_id || null, unit_id || null, cap,
      pc, pv, imgRuta,
      (clase || 'PRODUCTO'), uid, uid
    ]);

    const productId = r.insertId;

    // Pivot proveedores
    if (proveedoresSel.length) {
      const values = proveedoresSel.map(sid => [productId, Number(sid), uid]);
      await pool.query(`
        INSERT INTO product_suppliers (product_id, supplier_id, creado_por)
        VALUES ?
      `, [values]);
    }

    res.redirect('/inventario/productos');
  } catch (e) { next(e); }
});

/* =================================================
   EDITAR PRODUCTO – FORMULARIO
   ================================================= */
router.get('/:id/editar', auth, async (req, res, next) => {
  try {
    const [prod] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!prod.length) return res.redirect('/inventario/productos');

    const [marcas]      = await pool.query('SELECT id,nombre FROM marcas      ORDER BY nombre');
    const [materiales]  = await pool.query('SELECT id,nombre FROM materiales ORDER BY nombre');
    const [colores]     = await pool.query('SELECT id,nombre FROM colores    ORDER BY nombre');
    const [formas]      = await pool.query('SELECT id,nombre FROM formas     ORDER BY nombre');
    const [unidades]    = await pool.query('SELECT id,nombre FROM unidades   ORDER BY nombre');
    const [proveedores] = await pool.query('SELECT id,nombre FROM proveedores ORDER BY nombre');
    const [sel]         = await pool.query(
      'SELECT supplier_id FROM product_suppliers WHERE product_id=?',
      [req.params.id]
    );
    const proveedoresSeleccionados = sel.map(r => r.supplier_id);

    res.render('inventario/productos_form', {
      title: 'Editar producto',
      prod: prod[0],
      marcas, materiales, colores, formas, unidades,
      proveedores,
      proveedoresSeleccionados
    });
  } catch (e) { next(e); }
});

/* =================================================
   ACTUALIZAR PRODUCTO (POST) — Parche numéricos: numOrZero
   ================================================= */
router.post('/:id/editar', auth, upload.single('img'), async (req, res, next) => {
  const {
    nombre, descripcion, brand_id,
    material_id, color_id, shape_id, unit_id, capacidad,
    precio_compra, precio_venta, clase
  } = req.body;

  const proveedoresSel = Array.isArray(req.body['proveedores[]'])
    ? req.body['proveedores[]']
    : (Array.isArray(req.body.proveedores)
        ? req.body.proveedores
        : (req.body.proveedores ? [req.body.proveedores] : []));

  // Parche: normalizar numéricos a 0 si vienen vacíos
  const pc  = numOrZero(precio_compra);
  const pv  = numOrZero(precio_venta);
  const cap = numOrZero(capacidad);

  let imgRuta = null;

  try {
    if (req.file) {
      if (sharp) {
        const tmp = req.file.path + '_tmp';
        await sharp(req.file.path).resize({ width: 400 }).toFile(tmp);
        fs.renameSync(tmp, req.file.path);
      }
      imgRuta = '/img/products/' + path.basename(req.file.path);
    }

    const uid = req.session.user.id;
    const params = [
      nombre, (descripcion || null), brand_id || null,
      material_id || null, color_id || null,
      shape_id || null, unit_id || null, cap,
      pc, pv,
      (clase || 'PRODUCTO'),
      uid
    ];

    let sql = `
      UPDATE products SET
        nombre=?, descripcion=?, brand_id=?,
        material_id=?, color_id=?, shape_id=?, unit_id=?, capacidad=?,
        precio_compra=?, precio_venta=?,
        clase=?,
        actualizado_por=?, updated_at=NOW()`;
    if (imgRuta) { sql += ', imagen=?'; params.push(imgRuta); }

    sql += ' WHERE id = ?';
    params.push(req.params.id);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(sql, params);

      // Sync proveedores: borra e inserta
      await conn.query('DELETE FROM product_suppliers WHERE product_id=?', [req.params.id]);
      if (proveedoresSel.length) {
        const values = proveedoresSel.map(sid => [req.params.id, Number(sid), uid]);
        await conn.query(`
          INSERT INTO product_suppliers (product_id, supplier_id, creado_por)
          VALUES ?
        `, [values]);
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    res.redirect('/inventario/productos');
  } catch (e) { next(e); }
});

/* =================================================
   FICHA SIMPLIFICADA DEL PRODUCTO
   ================================================= */
router.get('/:id', auth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*,
             b.nombre   AS marca,
             mat.nombre AS material,
             col.nombre AS color,
             sh.nombre  AS forma,
             un.nombre  AS unidad,
             u1.nombre  AS creado_por_nombre,
             u2.nombre  AS actualizado_por_nombre
        FROM products p
        LEFT JOIN marcas      b   ON b.id  = p.brand_id
        LEFT JOIN materiales  mat ON mat.id = p.material_id
        LEFT JOIN colores     col ON col.id = p.color_id
        LEFT JOIN formas      sh  ON sh.id  = p.shape_id
        LEFT JOIN unidades    un  ON un.id  = p.unit_id
        LEFT JOIN usuarios    u1  ON u1.id  = p.creado_por
        LEFT JOIN usuarios    u2  ON u2.id  = p.actualizado_por
       WHERE p.id = ?`, [req.params.id]);

    if (!rows.length) return res.redirect('/inventario/productos');

    // (Opcional) Proveedores vinculados para mostrar en ficha
    const [prov] = await pool.query(`
      SELECT ps.supplier_id AS id, pr.nombre
        FROM product_suppliers ps
        JOIN proveedores pr ON pr.id = ps.supplier_id
       WHERE ps.product_id = ?
       ORDER BY pr.nombre
    `, [req.params.id]);

    res.render('inventario/productos_ficha', {
      title: 'Ficha producto',
      producto: rows[0],
      proveedores: prov
    });
  } catch (e) { next(e); }
});

module.exports = router;
