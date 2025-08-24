const express = require('express');
const bcrypt  = require('bcrypt');
const multer  = require('multer');
const pool    = require('../config/db');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

/* ---------- Middleware solo admin ---------- */
function isAdmin(req, res, next) {
  if (req.session.user?.rol_id === 1) return next();
  return res.redirect('/dashboard');
}

/* ---------- LISTAR usuarios + buscador + filtros ---------- */
router.get('/', isAdmin, async (req, res) => {
  const { q = '', rol = 'all', estado = 'all' } = req.query;

  let where  = 'WHERE (u.nombre LIKE ? OR u.apellido LIKE ? OR u.usuario LIKE ?)';
  const args = [`%${q}%`, `%${q}%`, `%${q}%`];

  if (rol !== 'all')    { where += ' AND r.id = ?';  args.push(rol); }
  if (estado !== 'all') { where += ' AND e.id = ?';  args.push(estado); }

  const [rows]   = await pool.query(
    `SELECT u.id, u.nombre, u.apellido, u.usuario,
            r.nombre AS rol, e.nombre AS estado
       FROM usuarios u
       JOIN roles  r ON r.id = u.rol_id
       JOIN estado e ON e.id = u.estado_id
     ${where}
     ORDER BY u.id DESC`, args);

  const [roles]   = await pool.query('SELECT id, nombre FROM roles');
  const [estados] = await pool.query('SELECT id, nombre FROM estado');

  res.render('usuarios_list', {
    user: req.session.user,
    rows,
    roles,
    estados,
    filters: { q, rol, estado }
  });
});

/* ---------- FICHA ---------- */
router.get('/ficha/:id', isAdmin, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.*, r.nombre AS rol, e.nombre AS estado
       FROM usuarios u
       JOIN roles  r ON r.id = u.rol_id
       JOIN estado e ON e.id = u.estado_id
      WHERE u.id = ?`, [req.params.id]);
  if (!rows.length) return res.redirect('/usuarios');
  res.render('usuarios_ficha', { user: req.session.user, data: rows[0] });
});

/* ---------- FORM NUEVO ---------- */
router.get('/nuevo', isAdmin, async (req, res) => {
  const [roles]   = await pool.query('SELECT id, nombre FROM roles');
  const [estados] = await pool.query('SELECT id, nombre FROM estado');
  res.render('usuarios_form', { user: req.session.user, roles, estados, data: null });
});

/* ---------- GUARDAR NUEVO ---------- */
router.post('/nuevo', isAdmin, upload.single('foto'), async (req, res) => {
  const { nombre, apellido, dpi, correo, telefono,
          usuario, password, rol_id, estado_id } = req.body;

  const hash = await bcrypt.hash(password, 10);
  const foto = req.file ? req.file.buffer : null;

  await pool.query(
    `INSERT INTO usuarios
      (nombre, apellido, dpi, correo, telefono,
       usuario, contrasena, rol_id, estado_id, foto_perfil)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [nombre, apellido, dpi || null, correo || null, telefono || null,
     usuario, hash, rol_id, estado_id, foto]);

  res.redirect('/usuarios');
});

/* ---------- FORM EDITAR ---------- */
router.get('/editar/:id', isAdmin, async (req, res) => {
  const [roles]   = await pool.query('SELECT id, nombre FROM roles');
  const [estados] = await pool.query('SELECT id, nombre FROM estado');
  const [rows]    = await pool.query('SELECT * FROM usuarios WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.redirect('/usuarios');
  res.render('usuarios_form', { user:req.session.user, roles, estados, data: rows[0] });
});

/* ---------- ACTUALIZAR ---------- */
router.post('/editar/:id', isAdmin, upload.single('foto'), async (req, res) => {
  const { nombre, apellido, dpi, correo, telefono,
          usuario, password, rol_id, estado_id } = req.body;

  const args = [nombre, apellido, dpi || null, correo || null, telefono || null,
                usuario, rol_id, estado_id];
  let  sql = `UPDATE usuarios
                 SET nombre=?, apellido=?, dpi=?, correo=?, telefono=?,
                     usuario=?, rol_id=?, estado_id=?`;

  if (password) {
    sql += `, contrasena=?`; args.push(await bcrypt.hash(password,10));
  }
  if (req.file) {
    sql += `, foto_perfil=?`; args.push(req.file.buffer);
  }

  sql += ` WHERE id=?`; args.push(req.params.id);

  await pool.query(sql, args);
  res.redirect('/usuarios');
});

module.exports = router;
