// routes/disenos.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;

/* ===== Auth opcional (ajústalo a tu app) ===== */
function isLoggedIn(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}
router.use(isLoggedIn);

/* ===== Config ===== */
const BASE_DIRS = [
  path.join(__dirname, '..', 'public', 'uploads', 'pedidos'),
  path.join(__dirname, '..', 'public', 'uploads', 'disenos'), // fallback opcional
];

// extensiones permitidas
const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf', '.svg', '.ai', '.psd', '.tif', '.tiff', '.webp'];

/* ===== Utils ===== */

// recorrido recursivo (hasta maxDepth) devolviendo paths absolutos de archivos
async function walkDir(dir, maxDepth = 5, _depth = 0) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (_depth < maxDepth) {
        out.push(...await walkDir(full, maxDepth, _depth + 1));
      }
    } else {
      out.push(full);
    }
  }
  return out;
}

function buildCandidates(id) {
  return [
    `${id}`,            // 26
    `pedido-${id}`,     // pedido-26
    `pedido_${id}`,     // pedido_26
    `${id}-`,           // 26-...
    `${id}_`,           // 26_...
    `-${id}`,           // ...-26
    `_${id}`,           // ..._26
  ];
}

function hasAllowedExt(filenameLower) {
  return EXTENSIONS.some(ext => filenameLower.endsWith(ext));
}

/* ===== Route ===== */

router.get('/pedidos/:id/diseno', async (req, res) => {
  const id = String(req.params.id || '').trim();
  const debug = req.query.debug === '1';

  if (!/^\d+$/.test(id)) {
    return res.status(400).send('ID de pedido inválido.');
  }

  try {
    const idNum = Number(id);
    // regex que permite ceros a la izquierda alrededor del ID y fronteras no numéricas
    // ej: ..., _00026, pedido-26.pdf, 26_v2.png
    const idBoundary = new RegExp(`(^|\\D)0*${id}(\\D|$)`, 'i');
    const cands = buildCandidates(id).map(c => c.toLowerCase());

    let scannedFiles = [];
    for (const base of BASE_DIRS) {
      const files = await walkDir(base, 5);
      scannedFiles.push(...files);
    }

    // Filtrar por extensión primero
    let candidates = scannedFiles.filter(f => hasAllowedExt(f.toLowerCase()));

    // Aplicar heurísticas de nombre
    const matches = candidates.filter(absPath => {
      const lower = absPath.toLowerCase();
      const fname = path.basename(lower);
      // contiene alguno de los "cands" simples
      const hasCand = cands.some(c => fname.includes(c));
      // o pasa el regex de frontera con 0*
      const boundaryOk = idBoundary.test(fname);
      return hasCand || boundaryOk;
    });

    if (debug) {
      return res
        .status(matches.length ? 200 : 404)
        .send(
          `DEBUG:
ID: ${id}
BaseDirs:
 - ${BASE_DIRS.join('\n - ')}
Total archivos escaneados: ${scannedFiles.length}
Coincidencias: ${matches.length}
${matches.map(m => ' - ' + m).join('\n')}`
        );
    }

    if (!matches.length) {
      return res.status(404).send(
        `No se encontró un diseño para el pedido #${id} en /uploads/pedidos ni /uploads/disenos.
Asegúrate de que el nombre del archivo contenga el ID (por ejemplo: ${id}.png, pedido-${id}.pdf, 0${id}.jpg) o usa ?debug=1 para diagnosticar.`
      );
    }

    // Elige el más reciente según mtime
    const stats = await Promise.all(matches.map(async p => ({ p, s: await fs.stat(p) })));
    stats.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
    const bestAbs = stats[0].p;

    // construir URL pública /uploads/<carpeta...>/archivo.ext (relativo a /public)
    // Cortamos todo hasta "uploads" para generar la URL estándar de express.static
    const idx = bestAbs.toLowerCase().lastIndexOf(path.sep + 'uploads' + path.sep);
    let publicUrl;
    if (idx >= 0) {
      const relFromUploads = bestAbs.substring(idx).replaceAll(path.sep, '/'); // "/uploads/...."
      publicUrl = relFromUploads;
    } else {
      // fallback: si por alguna razón no contiene /uploads/, sirve el archivo directamente
      return res.sendFile(bestAbs);
    }

    return res.redirect(publicUrl);
  } catch (err) {
    console.error('Error al buscar diseño:', err);
    return res.status(500).send('Error al buscar el diseño.');
  }
});

module.exports = router;
