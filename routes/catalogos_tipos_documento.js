// routes/catalogos_tipos_documento.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}

/* =========================
   LISTADO con búsqueda + paginación + orden por id
========================= */
router.get('/', isAuth, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, nombre, descripcion
        FROM tipos_documento
    ORDER BY id DESC
    `);
    res.render('catalogos/tipos_documento_list', {
      title: 'Tipos de documento',
      items: rows
    });
  } catch (e) { next(e); }
});


/* =========================
   NUEVO (FORM)
========================= */
router.get('/nuevo', isAuth, (_req, res) => {
  res.render('catalogos/tipos_documento_form', {
    title: 'Nuevo tipo de documento',
    item: { id: 0, nombre: '', descripcion: '' },
    action: '/catalogos/tipos-documento'
  });
});

/* =========================
   CREAR (POST)
========================= */
router.post('/', isAuth, async (req, res, next) => {
  try {
    const { nombre, descripcion } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).send('El nombre es obligatorio');
    }
    await pool.query(
      `INSERT INTO tipos_documento (nombre, descripcion) VALUES (?, ?)`,
      [nombre.trim(), (descripcion || null)]
    );
    res.redirect('/catalogos/tipos-documento');
  } catch (e) { next(e); }
});

/* =========================
   EDITAR (FORM)
========================= */
router.get('/:id/editar', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await pool.query(`SELECT * FROM tipos_documento WHERE id=?`, [id]);
    if (!row) return res.redirect('/catalogos/tipos-documento');
    res.render('catalogos/tipos_documento_form', {
      title: `Editar tipo de documento`,
      item: row,
      action: `/catalogos/tipos-documento/${id}`
    });
  } catch (e) { next(e); }
});

/* =========================
   ACTUALIZAR (POST)
========================= */
router.post('/:id', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { nombre, descripcion } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).send('El nombre es obligatorio');
    }
    await pool.query(
      `UPDATE tipos_documento SET nombre=?, descripcion=?, actualizado_en=NOW() WHERE id=?`,
      [nombre.trim(), (descripcion || null), id]
    );
    res.redirect('/catalogos/tipos-documento');
  } catch (e) { next(e); }
});

module.exports = router;
