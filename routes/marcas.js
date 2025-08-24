const express = require('express');
const router  = express.Router();
const pool    = require('../config/db');

function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

/* LISTA */
router.get('/', isAuthenticated, async (_, res) => {
  const [rows] = await pool.query('SELECT * FROM marcas ORDER BY nombre');
  res.render('inventario/marcas_list', { title:'Marcas', marcas: rows });
});

/* NUEVA */
router.get('/nueva', isAuthenticated, (_, res) => {
  res.render('inventario/marcas_form', {
    title:'Nueva marca',
    marca:{ id:0, nombre:'', descripcion:'' }
  });
});

router.post('/nueva', isAuthenticated, async (req,res) => {
  const { nombre, descripcion } = req.body;
  const uid = req.session.user.id;
  await pool.query(
    'INSERT INTO marcas (nombre, descripcion, creado_por, actualizado_por) VALUES (?,?,?,?)',
    [nombre, descripcion, uid, uid]
  );
  res.redirect('/inventario/marcas');
});

/* EDITAR */
router.get('/:id/editar', isAuthenticated, async (req,res) => {
  const [rows] = await pool.query('SELECT * FROM marcas WHERE id=?',[req.params.id]);
  if(!rows.length) return res.redirect('/inventario/marcas');
  res.render('inventario/marcas_form', { title:'Editar marca', marca: rows[0] });
});

router.post('/:id/editar', isAuthenticated, async (req,res)=>{
  const { nombre, descripcion } = req.body;
  const uid = req.session.user.id;
  await pool.query(
    `UPDATE marcas SET nombre=?, descripcion=?, actualizado_por=?, actualizado_en=NOW()
     WHERE id=?`,
     [nombre, descripcion, uid, req.params.id]
  );
  res.redirect('/inventario/marcas');
});

/* FICHA */
router.get('/:id', isAuthenticated, async (req,res)=>{
  const [rows] = await pool.query(
    `SELECT m.*,
            u1.nombre AS creado_por_nombre,
            u2.nombre AS actualizado_por_nombre
     FROM marcas m
     LEFT JOIN usuarios u1 ON u1.id = m.creado_por
     LEFT JOIN usuarios u2 ON u2.id = m.actualizado_por
     WHERE m.id=?`, [req.params.id]);

  if(!rows.length) return res.redirect('/inventario/marcas');
  res.render('inventario/marcas_ficha', { title:'Ficha marca', marca: rows[0] });
});

module.exports = router;
