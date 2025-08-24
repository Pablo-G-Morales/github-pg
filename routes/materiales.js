const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

// Middleware para proteger rutas
function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

/* ====================
   LISTADO PRINCIPAL
==================== */
router.get('/', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM materiales ORDER BY nombre');
  res.render('inventario/materiales_list', {
    title: 'Materiales',
    materiales: rows
  });
});

/* ====================
   NUEVO MATERIAL
==================== */
router.get('/nuevo', isAuthenticated, (req, res) => {
  res.render('inventario/materiales_form', {
    title: 'Nuevo material',
    material: { id: 0, nombre: '', descripcion: '' }
  });
});

router.post('/nuevo', isAuthenticated, async (req, res) => {
  const { nombre, descripcion } = req.body;
  const usuarioId = req.session.user.id;
  await pool.query(
    `INSERT INTO materiales (nombre, descripcion, creado_por, actualizado_por)
     VALUES (?, ?, ?, ?)`,
    [nombre, descripcion, usuarioId, usuarioId]
  );
  res.redirect('/inventario/materiales');
});

/* ====================
   EDITAR MATERIAL
==================== */
router.get('/:id/editar', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM materiales WHERE id = ?',
    [req.params.id]
  );
  if (!rows.length) return res.redirect('/inventario/materiales');

  res.render('inventario/materiales_form', {
    title: 'Editar material',
    material: rows[0]
  });
});

router.post('/:id/editar', isAuthenticated, async (req, res) => {
  const { nombre, descripcion } = req.body;
  const usuarioId = req.session.user.id;

  await pool.query(
    `UPDATE materiales
     SET nombre = ?, descripcion = ?, actualizado_por = ?, actualizado_en = NOW()
     WHERE id = ?`,
    [nombre, descripcion, usuarioId, req.params.id]
  );
  res.redirect('/inventario/materiales');
});

/* ====================
   FICHA DETALLE
==================== */
router.get('/:id', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT m.*,
            uc.nombre AS creado_por_nombre,
            uu.nombre AS actualizado_por_nombre
     FROM materiales m
     LEFT JOIN usuarios uc ON uc.id = m.creado_por
     LEFT JOIN usuarios uu ON uu.id = m.actualizado_por
     WHERE m.id = ?`,
    [req.params.id]
  );

  if (!rows.length) return res.redirect('/inventario/materiales');

  res.render('inventario/materiales_ficha', {
    title: 'Ficha material',
    material: rows[0]
  });
});

module.exports = router;
