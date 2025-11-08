// routes/dashboard_imagenes.js
const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const pool    = require('../config/db');

// ====== Auth / Roles ======
function isAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.rol_id === 1) return next();
  return res.status(403).send('Solo administrador');
}

// ====== Uploads (carpeta pública) ======
const uploadDir = path.resolve(process.cwd(), 'public', 'uploads', 'dashboard');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename   : (req, file, cb) => {
    const ext = (path.extname(file.originalname || '').toLowerCase()) || '';
    const safeExt = ['.png','.jpg','.jpeg','.webp','.gif'].includes(ext) ? ext : '.png';
    cb(null, `dash_${Date.now()}_${Math.random().toString(36).slice(2)}${safeExt}`);
  }
});
const upload = multer({ storage }); // sin límite estricto (puedes agregarlo si quieres)

// ====== Admin: listado ======
router.get('/admin/dashboard-imagenes', isAuth, isAdmin, async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, titulo, image_path, sort_order, is_active, created_at
        FROM dashboard_images
       ORDER BY sort_order DESC, id DESC
    `);
    return res.render('admin/dashboard_imagenes_list', {
      title: 'Imágenes del Dashboard',
      items: rows
    });
  } catch (e) { return next(e); }
});

// ====== Admin: formulario nueva ======
router.get('/admin/dashboard-imagenes/nueva', isAuth, isAdmin, (req, res) => {
  return res.render('admin/dashboard_imagenes_form', {
    title: 'Nueva imagen para Dashboard'
  });
});

// ====== Admin: crear (subir imagen) ======
router.post('/admin/dashboard-imagenes', isAuth, isAdmin, upload.single('imagen'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).send('Debes seleccionar una imagen.');
    }
    const { titulo, sort_order } = req.body || {};
    const imageRel = path.posix.join('/uploads/dashboard', path.basename(req.file.path));
    const created_by = req.session?.user?.id || null;

    await pool.query(`
      INSERT INTO dashboard_images (titulo, image_path, sort_order, is_active, created_by)
      VALUES (?,?,?,?,?)
    `, [titulo || null, imageRel, Number(sort_order || 0), 1, created_by]);

    return res.redirect('/admin/dashboard-imagenes');
  } catch (e) { return next(e); }
});

// ====== Admin: activar/desactivar ======
router.post('/admin/dashboard-imagenes/:id/toggle', isAuth, isAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await pool.query(`
      UPDATE dashboard_images
         SET is_active = 1 - is_active
       WHERE id = ? LIMIT 1
    `, [id]);
    return res.redirect('/admin/dashboard-imagenes');
  } catch (e) { return next(e); }
});

// ====== Admin: eliminar ======
router.post('/admin/dashboard-imagenes/:id/eliminar', isAuth, isAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await pool.query(`SELECT image_path FROM dashboard_images WHERE id=?`, [id]);
    await pool.query(`DELETE FROM dashboard_images WHERE id=? LIMIT 1`, [id]);

    // eliminar archivo físico (opcional)
    if (row?.image_path && row.image_path.startsWith('/uploads/')) {
      const abs = path.join(process.cwd(), 'public', row.image_path.replace(/^\/+/, ''));
      fs.promises.unlink(abs).catch(()=>{});
    }
    return res.redirect('/admin/dashboard-imagenes');
  } catch (e) { return next(e); }
});

module.exports = router;
