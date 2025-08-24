const express = require('express');
const bcrypt  = require('bcrypt');
const pool    = require('../config/db');

const router = express.Router();

/* --- Middleware solo admin --- */
function isAdmin(req, res, next) {
  if (req.session.user?.rol_id === 1) return next();
  return res.redirect('/dashboard');
}

/* --- LISTAR con búsqueda & filtros --- */
router.get('/', isAdmin, async (req, res) => {
  const { q = '', rol = 'all', estado = 'all' } = req.query;

  let where = 'WHERE u.nombre LIKE ? OR u.apellido LIKE ? OR u.usuario LIKE ?';
  const params = [`%${q}%`, `%${q}%`, `%${q}%`];

  if (rol !== 'all')   { where += ' AND r.id = ?'; params.push(rol); }
  if (estado !== 'all'){ where += ' AND e.id = ?'; params.push(estado); }

  const [rows] = await pool.query(
    `SELECT u.id, u.nombre, u.apellido, u.usuario,
            r.nombre AS rol, e.nombre AS estado
       FROM usuarios u
       JOIN roles  r ON r.id = u.rol_id
       JOIN estado e ON e.id = u.estado_id
     ${where}
     ORDER BY u.id DESC`,
    params
  );

  const [roles]   = await pool.query('SELECT id, nombre FROM roles');
  const [estados] = await pool.query('SELECT id, nombre FROM estado');
  res.render('usuarios_list', { user:req.session.user, rows, roles, estados, filters:{q,rol,estado} });
});

/* --- FORM CREAR --- */
router.get('/nuevo', isAdmin, async (req, res) => {
  const [roles]   = await pool.query('SELECT id,nombre FROM roles');
  const [estados] = await pool.query('SELECT id,nombre FROM estado');
  res.render('usuarios_form', { user:req.session.user, roles, estados, data:null });
});

/* --- GUARDAR NUEVO --- */
router.post('/nuevo', isAdmin, async (req, res) => {
  const { nombre, apellido, usuario, password, rol_id, estado_id } = req.body;
  const hash = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO usuarios (nombre, apellido, usuario, contrasena, rol_id, estado_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nombre, apellido, usuario, hash, rol_id, estado_id]
  );
  res.redirect('/usuarios');
});

/* --- FORM EDITAR --- */
router.get('/editar/:id', isAdmin, async (req,res)=>{
  const [roles]   = await pool.query('SELECT id,nombre FROM roles');
  const [estados] = await pool.query('SELECT id,nombre FROM estado');
  const [rows] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [req.params.id]);
  if(!rows.length) return res.redirect('/usuarios');
  res.render('usuarios_form', { user:req.session.user, roles, estados, data: rows[0] });
});

/* --- ACTUALIZAR --- */
router.post('/editar/:id', isAdmin, async (req,res)=>{
  const { nombre, apellido, usuario, password, rol_id, estado_id } = req.body;

  /* Si password viene vacío, conserva el hash actual */
  let sql = `UPDATE usuarios SET nombre=?, apellido=?, usuario=?, rol_id=?, estado_id=?`;
  const params = [nombre, apellido, usuario, rol_id, estado_id];

  if(password){
    sql += `, contrasena=?`;
    params.push(await bcrypt.hash(password,10));
  }
  sql += ' WHERE id=?'; params.push(req.params.id);

  await pool.query(sql, params);
  res.redirect('/usuarios');
});

module.exports = router;
