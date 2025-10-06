const express = require('express');
const bcrypt  = require('bcrypt');
const multer  = require('multer');
const pool    = require('../config/db');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

/* --- Solo usuarios autenticados --- */
function isAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/');
}

/* --- Ver mi ficha (reusa la vista usuarios_ficha.ejs) --- */
router.get('/', isAuth, async (req, res) => {
  const uid = req.session.user.id;

  const [rows] = await pool.query(`
    SELECT u.*, r.nombre AS rol, e.nombre AS estado
      FROM usuarios u
      JOIN roles  r ON r.id = u.rol_id
      JOIN estado e ON e.id = u.estado_id
     WHERE u.id = ? LIMIT 1
  `, [uid]);

  if (!rows.length) return res.redirect('/dashboard');
  res.render('usuarios_ficha', { user: req.session.user, data: rows[0] });
});

/* --- Formulario para cambiar mi contraseña y foto --- */
router.get('/editar', isAuth, async (req, res) => {
  const uid = req.session.user.id;
  const [rows] = await pool.query(
    'SELECT id, foto_perfil FROM usuarios WHERE id = ? LIMIT 1', [uid]
  );
  const data = rows.length ? rows[0] : null;
  res.render('perfil_form', { user: req.session.user, data, error: null });
});

/* --- Guardar cambios (contraseña y/o foto) --- */
router.post('/editar', isAuth, upload.single('foto'), async (req, res) => {
  const uid = req.session.user.id;
  const { actual = '', nueva = '', confirmar = '' } = req.body;

  try {
    const [rows] = await pool.query(
      'SELECT contrasena FROM usuarios WHERE id = ? LIMIT 1', [uid]
    );
    if (!rows.length) {
      return res.render('perfil_form', { user: req.session.user, data: {}, error: 'Usuario no encontrado.' });
    }

    const updates = [];
    const params  = [];

    // Si se quiere cambiar la contraseña
    if (nueva) {
      const ok = await bcrypt.compare(actual, rows[0].contrasena);
      if (!ok) {
        return res.render('perfil_form', { user: req.session.user, data: {}, error: 'La contraseña actual no es correcta.' });
      }
      if (nueva !== confirmar) {
        return res.render('perfil_form', { user: req.session.user, data: {}, error: 'La confirmación no coincide.' });
      }
      const hash = await bcrypt.hash(nueva, 10);
      updates.push('contrasena=?'); params.push(hash);
    }

    // Si se sube nueva foto
    if (req.file) {
      updates.push('foto_perfil=?'); params.push(req.file.buffer);
    }

    if (!updates.length) {
      return res.render('perfil_form', { user: req.session.user, data: {}, error: 'No hay cambios para guardar.' });
    }

    const sql = `UPDATE usuarios SET ${updates.join(', ')} WHERE id=?`;
    params.push(uid);
    await pool.query(sql, params);

    // Volver a mi ficha
    res.redirect('/perfil');
  } catch (err) {
    console.error(err);
    res.render('perfil_form', { user: req.session.user, data: {}, error: 'Error al actualizar.' });
  }
});

module.exports = router;
