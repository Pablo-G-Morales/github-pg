const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

/* — intento cargar sharp si está disponible — */
let sharp;
try { sharp = require('sharp'); }
catch { console.warn('⚠️ sharp no instalado; las imágenes no se optimizarán'); }

/* — middleware de sesión — */
function isAuth (req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/');
}

/* — configuración multer — */
const storage = multer.diskStorage({
  destination: (_, __, cb) =>
    cb(null, path.join(__dirname, '../public/img/insumos')),
  filename: (_, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 1 * 1024 * 1024 } });

/* ╔═══════════════════════════════════════╗
   ║      LISTADO  –  /compras/insumos     ║
   ╚═══════════════════════════════════════╝ */
router.get('/', isAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM insumos ORDER BY id DESC');
    res.render('compras/insumos_list', {
      title: 'Insumos',
      insumos: rows
    });
  } catch (e) { next(e); }
});

/* ╔═══════════════════════════════════════╗
   ║      NUEVO – GET                      ║
   ╚═══════════════════════════════════════╝ */
router.get('/nuevo', isAuth, (req, res) => {
  res.render('compras/insumos_form', {
    title : 'Nuevo insumo',
    insumo: { id:0, nombre:'', descripcion:'', precio_estandar:'', imagen:null }
  });
});

/* ╔═══════════════════════════════════════╗
   ║      NUEVO – POST                     ║
   ╚═══════════════════════════════════════╝ */
router.post('/nuevo',
  isAuth,
  upload.single('imagen'),
  async (req, res, next) => {
    try {
      const { nombre, descripcion, precio } = req.body;
      let imgRuta = null;

      if (req.file) {
        if (sharp) {
          const tmp = req.file.path + '_tmp';
          await sharp(req.file.path).resize({ width: 400 }).toFile(tmp);
          fs.renameSync(tmp, req.file.path);
        }
        imgRuta = '/img/insumos/' + path.basename(req.file.path);
      }

      const uid = req.session.user.id;
      await pool.query(
        `INSERT INTO insumos
           (nombre, descripcion, precio_estandar, imagen, creado_por, actualizado_por)
         VALUES (?,?,?,?,?,?)`,
        [ nombre.trim(), descripcion || null, precio || null,
          imgRuta, uid, uid ]
      );

      res.redirect('/compras/insumos');
    } catch (e) { next(e); }
});

/* ╔═══════════════════════════════════════╗
   ║      EDITAR – GET                     ║
   ╚═══════════════════════════════════════╝ */
router.get('/:id/editar', isAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM insumos WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/compras/insumos');
    res.render('compras/insumos_form', {
      title : 'Editar insumo',
      insumo: rows[0]
    });
  } catch (e) { next(e); }
});

/* ╔═══════════════════════════════════════╗
   ║      EDITAR – POST                    ║
   ╚═══════════════════════════════════════╝ */
router.post('/:id/editar',
  isAuth,
  upload.single('imagen'),
  async (req, res, next) => {
    try {
      const { nombre, descripcion, precio } = req.body;
      const id = req.params.id;

      const [[prev]] = await pool.query('SELECT * FROM insumos WHERE id = ?', [id]);
      if (!prev) return res.redirect('/compras/insumos');

      const updates = {
        nombre         : nombre.trim(),
        descripcion    : descripcion || null,
        precio_estandar: precio || null,
        actualizado_por: req.session.user.id
      };

      if (req.file) {
        if (sharp) {
          const tmp = req.file.path + '_tmp';
          await sharp(req.file.path).resize({ width: 400 }).toFile(tmp);
          fs.renameSync(tmp, req.file.path);
        }
        if (prev.imagen) {
          fs.unlink(path.join(__dirname, '../public', prev.imagen),
                    err => err && console.error(err));
        }
        updates.imagen = '/img/insumos/' + path.basename(req.file.path);
      }

      await pool.query(
        'UPDATE insumos SET ?, actualizado_en = NOW() WHERE id = ?',
        [updates, id]
      );

      res.redirect('/compras/insumos');
    } catch (e) { next(e); }
});

/* ╔═══════════════════════════════════════╗
   ║      FICHA – GET                      ║
   ╚═══════════════════════════════════════╝ */
router.get('/:id', isAuth, async (req, res, next) => {
  try {
    const [[insumo]] = await pool.query(`
      SELECT i.*,
             u1.nombre AS creado_por_nombre,
             u2.nombre AS actualizado_por_nombre
        FROM insumos i
   LEFT JOIN usuarios u1 ON u1.id = i.creado_por
   LEFT JOIN usuarios u2 ON u2.id = i.actualizado_por
       WHERE i.id = ?`,
      [req.params.id]
    );

    if (!insumo) return res.redirect('/compras/insumos');
    res.render('compras/insumos_ficha', {
      title: `Ficha insumo – ${insumo.nombre}`,
      insumo
    });
  } catch (e) { next(e); }
});

module.exports = router;
