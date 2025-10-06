// routes/catalogos_condiciones_pago.js
const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}

/* =========================
   LISTADO (DataTables)
========================= */
router.get('/', isAuth, async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, nombre, descripcion
        FROM condiciones_pago
    ORDER BY id DESC
    `);
    res.render('catalogos/condiciones_pago_list', {
      title: 'Condiciones de pago',
      items: rows
    });
  } catch (e) { next(e); }
});

/* =========================
   NUEVO (FORM)
========================= */
router.get('/nuevo', isAuth, (_req, res) => {
  res.render('catalogos/condiciones_pago_form', {
    title: 'Nueva condición de pago',
    item: { id: 0, nombre: '', descripcion: '' },
    action: '/catalogos/condiciones-pago'
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
      `INSERT INTO condiciones_pago (nombre, descripcion) VALUES (?, ?)`,
      [nombre.trim(), (descripcion || null)]
    );
    res.redirect('/catalogos/condiciones-pago');
  } catch (e) { next(e); }
});

/* =========================
   EDITAR (FORM)
========================= */
router.get('/:id/editar', isAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await pool.query(`SELECT * FROM condiciones_pago WHERE id=?`, [id]);
    if (!row) return res.redirect('/catalogos/condiciones-pago');
    res.render('catalogos/condiciones_pago_form', {
      title: 'Editar condición de pago',
      item: row,
      action: `/catalogos/condiciones-pago/${id}`
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
      `UPDATE condiciones_pago SET nombre=?, descripcion=?, actualizado_en=NOW() WHERE id=?`,
      [nombre.trim(), (descripcion || null), id]
    );
    res.redirect('/catalogos/condiciones-pago');
  } catch (e) { next(e); }
});

module.exports = router;
