const express  = require('express');
const router   = express.Router();
const pool     = require('../config/db');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

/* carga opcional de sharp para redimensionar imágenes */
let sharp;
try { sharp = require('sharp'); }
catch { console.warn('⚠️  sharp no instalado; las imágenes no se optimizarán'); }

/* ───────── middleware de autenticación ───────── */
function auth (req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

/* ───────── Multer (límite 1 MB) ───────── */
const storage = multer.diskStorage({
  destination: (_, __, cb) =>
    cb(null, path.join(__dirname, '../public/img/products')),
  filename: (_, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 1 * 1024 * 1024 } });

/* =================================================
   LISTA DE PRODUCTOS
   ================================================= */
router.get('/', auth, async (_, res) => {
  const [rows] = await pool.query(`
    SELECT p.*,
           b.nombre  AS marca,
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
  ORDER BY p.nombre`);
  res.render('inventario/productos_list', {
    title: 'Productos',
    productos: rows
  });
});

/* =================================================
   NUEVO PRODUCTO – FORMULARIO
   ================================================= */
router.get('/nuevo', auth, async (_, res) => {
  const [marcas]     = await pool.query('SELECT id,nombre FROM marcas      ORDER BY nombre');
  const [materiales] = await pool.query('SELECT id,nombre FROM materiales ORDER BY nombre');
  const [colores]    = await pool.query('SELECT id,nombre FROM colores    ORDER BY nombre');
  const [formas]     = await pool.query('SELECT id,nombre FROM formas     ORDER BY nombre');
  const [unidades]   = await pool.query('SELECT id,nombre FROM unidades   ORDER BY nombre');

  res.render('inventario/productos_form', {
    title: 'Nuevo producto',
    prod: { id:0, nombre:'', descripcion:'', brand_id:'',
            material_id:'', color_id:'', shape_id:'', unit_id:'',
            capacidad:'', precio_compra:'', precio_venta:'', imagen:'' },
    marcas, materiales, colores, formas, unidades
  });
});

/* =================================================
   CREAR PRODUCTO (POST)
   ================================================= */
router.post('/nuevo', auth, upload.single('img'), async (req, res) => {
  const {
    nombre, descripcion, brand_id,
    material_id, color_id, shape_id, unit_id, capacidad,
    precio_compra, precio_venta
  } = req.body;

  /* imagen: redimensionar (opcional) */
  let imgRuta = null;
  if (req.file) {
    if (sharp) {
      const tmp = req.file.path + '_tmp';
      await sharp(req.file.path).resize({ width: 400 }).toFile(tmp);
      fs.renameSync(tmp, req.file.path);
    }
    imgRuta = '/img/products/' + path.basename(req.file.path);
  }

  const uid = req.session.user.id;
  await pool.query(`
    INSERT INTO products
      (nombre, descripcion, brand_id,
       material_id, color_id, shape_id, unit_id, capacidad,
       precio_compra, precio_venta, imagen,
       creado_por, actualizado_por)
    VALUES (?,?,?,?,?,?,?,?,?,?, ?, ?)`,
    [
      nombre, descripcion,
      brand_id || null,
      material_id || null, color_id || null,
      shape_id || null, unit_id || null, capacidad || null,
      precio_compra, precio_venta, imgRuta,
      uid, uid
    ]);
  res.redirect('/inventario/productos');
});

/* =================================================
   EDITAR PRODUCTO – FORMULARIO
   ================================================= */
router.get('/:id/editar', auth, async (req, res) => {
  const [prod] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!prod.length) return res.redirect('/inventario/productos');

  const [marcas]     = await pool.query('SELECT id,nombre FROM marcas      ORDER BY nombre');
  const [materiales] = await pool.query('SELECT id,nombre FROM materiales ORDER BY nombre');
  const [colores]    = await pool.query('SELECT id,nombre FROM colores    ORDER BY nombre');
  const [formas]     = await pool.query('SELECT id,nombre FROM formas     ORDER BY nombre');
  const [unidades]   = await pool.query('SELECT id,nombre FROM unidades   ORDER BY nombre');

  res.render('inventario/productos_form', {
    title: 'Editar producto',
    prod: prod[0],
    marcas, materiales, colores, formas, unidades
  });
});

/* =================================================
   ACTUALIZAR PRODUCTO (POST)
   ================================================= */
router.post('/:id/editar', auth, upload.single('img'), async (req, res) => {
  const {
    nombre, descripcion, brand_id,
    material_id, color_id, shape_id, unit_id, capacidad,
    precio_compra, precio_venta
  } = req.body;

  let imgRuta = null;
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
    nombre, descripcion, brand_id || null,
    material_id || null, color_id || null,
    shape_id || null, unit_id || null, capacidad || null,
    precio_compra, precio_venta, uid
  ];
  let sql = `
    UPDATE products SET
      nombre=?, descripcion=?, brand_id=?,
      material_id=?, color_id=?, shape_id=?, unit_id=?, capacidad=?,
      precio_compra=?, precio_venta=?, actualizado_por=?, updated_at=NOW()`;

  if (imgRuta) { sql += ', imagen=?'; params.push(imgRuta); }

  sql += ' WHERE id = ?';
  params.push(req.params.id);

  await pool.query(sql, params);
  res.redirect('/inventario/productos');
});

/* =================================================
   FICHA SIMPLIFICADA DEL PRODUCTO
   ================================================= */
router.get('/:id', auth, async (req, res) => {
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
  res.render('inventario/productos_ficha', {
    title: 'Ficha producto',
    producto: rows[0]
  });
});

module.exports = router;
