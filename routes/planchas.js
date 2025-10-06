const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');
const fs      = require('fs');
const path    = require('path');

/* ---- configuración de subir imágenes ---- */
const multer  = require('multer');
const storage = multer.diskStorage({
  destination: (_,__,cb)=> cb(null, 'public/img/planchas'),
  filename:    (_,file,cb)=> cb(null, Date.now() + path.extname(file.originalname))
});
const upload  = multer({ storage });

/* ---- helpers ---- */
const logAccion = async ({planchaId, accion, prev, next, userId}) => {
  await pool.query('INSERT INTO planchas_log SET ?', {
    plancha_id    : planchaId,
    accion,
    usuario_id    : userId || null,
    datos_previos : prev ? JSON.stringify(prev)  : null,
    datos_nuevos  : next ? JSON.stringify(next)  : null
  });
};

/* ===================== RUTAS ===================== */

/* Listado */
router.get('/', async (req, res, next) => {
  try {
    const [planchas] = await pool.query('SELECT * FROM planchas ORDER BY id DESC');
    res.render('informacion/planchas_lista', {
      planchas,
      title: 'Listado de planchas'
    });
  } catch (err) { next(err); }
});

/* Formulario nuevo */
router.get('/nuevo',  (_, res)=> {
  res.render('informacion/planchas_form', { plancha:{}, title:'Nueva plancha' });
});

/* Crear */
router.post('/nuevo', upload.single('imagen'), async (req, res, next) => {
  try {
    const data = {
      nombre : req.body.nombre.trim(),
      imagen : req.file ? `/img/planchas/${req.file.filename}` : null
    };
    const [result] = await pool.query('INSERT INTO planchas SET ?', [data]);

    await logAccion({
      planchaId : result.insertId,
      accion    : 'CREAR',
      next      : data,
      userId    : req.session?.user?.id
    });

    res.redirect('/informacion/planchas');
  } catch (err) { next(err); }
});

/* Formulario editar */
router.get('/:id/editar', async (req, res, next) => {
  try {
    const [[plancha]] = await pool.query('SELECT * FROM planchas WHERE id = ?', [req.params.id]);
    if (!plancha) return res.redirect('/informacion/planchas');
    res.render('informacion/planchas_form', { plancha, title:'Editar plancha' });
  } catch (err) { next(err); }
});

/* Actualizar */
router.post('/:id/editar', upload.single('imagen'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const [[prev]] = await pool.query('SELECT * FROM planchas WHERE id = ?', [id]);
    if (!prev) return res.redirect('/informacion/planchas');

    const updates = { nombre: req.body.nombre.trim() };
    if (req.file){
      if (prev.imagen) fs.unlinkSync(path.join(__dirname,'..','public',prev.imagen));
      updates.imagen = `/img/planchas/${req.file.filename}`;
    }

    await pool.query('UPDATE planchas SET ? WHERE id = ?', [updates, id]);

    await logAccion({
      planchaId : id,
      accion    : 'ACTUALIZAR',
      prev,
      next      : { ...prev, ...updates },
      userId    : req.session?.user?.id
    });

    res.redirect('/informacion/planchas');
  } catch (err) { next(err); }
});

/* Eliminar */
router.post('/:id/eliminar', async (req, res, next) => {
  try {
    const id = req.params.id;
    const [[prev]] = await pool.query('SELECT * FROM planchas WHERE id = ?', [id]);
    if (!prev) return res.redirect('/informacion/planchas');

    if (prev.imagen) fs.unlinkSync(path.join(__dirname,'..','public',prev.imagen));
    await pool.query('DELETE FROM planchas WHERE id = ?', [id]);

    await logAccion({
      planchaId : id,
      accion    : 'ELIMINAR',
      prev,
      userId    : req.session?.user?.id
    });

    res.redirect('/informacion/planchas');
  } catch (err) { next(err); }
});

router.get('/nuevo', (_req, res) => {
  res.render('planchas/form', { title: 'Nueva plancha', registro: {} });
});

// POST /planchas/nuevo
router.post('/nuevo', async (req, res, next) => {
  try {
    const data = { nombre: req.body.nombre, imagen: req.body.imagen || null };
    await pool.query('INSERT INTO planchas SET ?', [data]);
    res.redirect('/informacion'); // vuelve a la lista de Info
  } catch (e) { next(e); }
});
module.exports = router;
