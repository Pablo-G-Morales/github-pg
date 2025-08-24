const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

/* -------- LISTA -------- */
router.get('/', isAuthenticated, async (_, res) => {
  const [rows] = await pool.query('SELECT * FROM proveedores ORDER BY nombre');
  res.render('inventario/proveedores_list', { title: 'Proveedores', proveedores: rows });
});

/* -------- NUEVO -------- */
router.get('/nuevo', isAuthenticated, (_, res) => {
  res.render('inventario/proveedores_form', {
    title: 'Nuevo proveedor',
    proveedor: { id:0, nombre:'', telefono:'', correo:'', direccion:'', descripcion:'' }
  });
});

router.post('/nuevo', isAuthenticated, async (req, res) => {
  const { nombre, telefono, correo, direccion, descripcion } = req.body;
  const uid = req.session.user.id;
  await pool.query(
    `INSERT INTO proveedores (nombre, telefono, correo, direccion, descripcion, creado_por, actualizado_por)
     VALUES (?,?,?,?,?,?,?)`,
    [nombre, telefono, correo, direccion, descripcion, uid, uid]
  );
  res.redirect('/inventario/proveedores');
});

/* -------- EDITAR -------- */
router.get('/:id/editar', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM proveedores WHERE id=?', [req.params.id]);
  if (!rows.length) return res.redirect('/inventario/proveedores');
  res.render('inventario/proveedores_form', { title:'Editar proveedor', proveedor: rows[0] });
});

router.post('/:id/editar', isAuthenticated, async (req, res) => {
  const { nombre, telefono, correo, direccion, descripcion } = req.body;
  const uid = req.session.user.id;
  await pool.query(
    `UPDATE proveedores
       SET nombre=?, telefono=?, correo=?, direccion=?, descripcion=?,
           actualizado_por=?, actualizado_en=NOW()
     WHERE id=?`,
    [nombre, telefono, correo, direccion, descripcion, uid, req.params.id]
  );
  res.redirect('/inventario/proveedores');
});

/* -------- FICHA -------- */
router.get('/:id', isAuthenticated, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*,
            u1.nombre AS creado_por_nombre,
            u2.nombre AS actualizado_por_nombre
     FROM proveedores p
     LEFT JOIN usuarios u1 ON u1.id = p.creado_por
     LEFT JOIN usuarios u2 ON u2.id = p.actualizado_por
     WHERE p.id = ?`, [req.params.id]);

  if (!rows.length) return res.redirect('/inventario/proveedores');

  res.render('inventario/proveedores_ficha', { title:'Ficha proveedor', proveedor: rows[0] });
});

module.exports = router;
