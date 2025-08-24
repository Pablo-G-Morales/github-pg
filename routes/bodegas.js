const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

/* -------- LISTA -------- */
router.get('/', isAuthenticated, async (_, res) => {
  const [rows] = await pool.query('SELECT * FROM bodegas ORDER BY nombre');
  res.render('inventario/bodegas_list', { title: 'Bodegas', bodegas: rows });
});

/* -------- NUEVA -------- */
router.get('/nueva', isAuthenticated, (_, res) => {
  res.render('inventario/bodegas_form', {
    title: 'Nueva bodega',
    bodega: { id:0, nombre:'', ubicacion:'', descripcion:'' }
  });
});

router.post('/nueva', isAuthenticated, async (req, res) => {
  const { nombre, ubicacion, descripcion } = req.body;
  const uid = req.session.user.id;
  await pool.query(
    `INSERT INTO bodegas
       (nombre, ubicacion, descripcion, creado_por, actualizado_por)
     VALUES (?,?,?,?,?)`,
    [nombre, ubicacion, descripcion, uid, uid]
  );
  res.redirect('/inventario/bodegas');
});

/* -------- EDITAR -------- */
router.get('/:id/editar', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM bodegas WHERE id=?', [req.params.id]);
  if (!rows.length) return res.redirect('/inventario/bodegas');
  res.render('inventario/bodegas_form', {
    title: 'Editar bodega',
    bodega: rows[0]
  });
});

router.post('/:id/editar', isAuthenticated, async (req, res) => {
  const { nombre, ubicacion, descripcion } = req.body;
  const uid = req.session.user.id;
  await pool.query(
    `UPDATE bodegas
       SET nombre=?, ubicacion=?, descripcion=?,
           actualizado_por=?, actualizado_en=NOW()
     WHERE id=?`,
    [nombre, ubicacion, descripcion, uid, req.params.id]
  );
  res.redirect('/inventario/bodegas');
});

/* -------- FICHA -------- */
router.get('/:id', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT b.*,
            u1.nombre AS creado_por_nombre,
            u2.nombre AS actualizado_por_nombre
     FROM bodegas b
     LEFT JOIN usuarios u1 ON u1.id = b.creado_por
     LEFT JOIN usuarios u2 ON u2.id = b.actualizado_por
     WHERE b.id = ?`, [req.params.id]);

  if (!rows.length) return res.redirect('/inventario/bodegas');

  res.render('inventario/bodegas_ficha', { title: 'Ficha bodega', bodega: rows[0] });
});

module.exports = router;
