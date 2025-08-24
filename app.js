require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path       = require('path');
const pool       = require('./config/db');

const authRouter            = require('./routes/auth');
const usuariosRouter        = require('./routes/usuarios');

/* INVENTARIO ─ sub-módulos */
const inventarioRouter      = require('./routes/inventario');
const coloresRouter         = require('./routes/colores');
const materialesRouter      = require('./routes/materiales');
const formasRouter          = require('./routes/formas');
const unidadesRouter        = require('./routes/unidades');
const proveedoresRouter     = require('./routes/proveedores');
const marcasRouter          = require('./routes/marcas');
const bodegasRouter         = require('./routes/bodegas');
const productosRouter       = require('./routes/productos');
const invProdRouter         = require('./routes/inventario_producto');
const stockRouter           = require('./routes/stock');

/* COMPRAS */
const comprasRouter         = require('./routes/compras');          // dashboard
const comprasInsumosRouter  = require('./routes/compras_insumos');  // CRUD insumos

/* INFORMACIÓN */
const planchasRouter        = require('./routes/planchas');
const informacionRouter     = require('./routes/informacion');
const comprasOrdenesRouter = require('./routes/compras_ordenes');

const app  = express();
const PORT = process.env.PORT || 3000;

/* EJS + estáticos */
app.set('view engine','ejs');
app.set('views', path.join(__dirname,'views'));
app.use(express.urlencoded({ extended:false }));
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

/* Sesión */
app.use(session({
  key   : 'sublirex.sid',
  secret: process.env.SESSION_SECRET || 'Sblx_Secret_123',
  store : new MySQLStore({}, pool),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000*60*60 }
}));

/* user global en las vistas */
app.use((req,res,next)=>{
  res.locals.user = req.session.user || null;
  next();
});

/* RUTAS PÚBLICAS */
app.use('/',          authRouter);
app.use('/usuarios',  usuariosRouter);

/* INVENTARIO (siempre las específicas primero) */
app.use('/inventario/stock',      stockRouter);
app.use('/inventario/productos',  productosRouter);
app.use('/inventario/productos',  invProdRouter);

app.use('/inventario/colores',    coloresRouter);
app.use('/inventario/materiales', materialesRouter);
app.use('/inventario/formas',     formasRouter);
app.use('/inventario/unidades',   unidadesRouter);
app.use('/inventario/proveedores',proveedoresRouter);
app.use('/inventario/marcas',     marcasRouter);
app.use('/inventario/bodegas',    bodegasRouter);
app.use('/inventario',            inventarioRouter); // menú ppal

/* INFORMACIÓN */
app.use('/informacion/planchas',  planchasRouter);
app.use('/informacion',           informacionRouter);

/* COMPRAS */
app.use('/compras/insumos',       comprasInsumosRouter); // CRUD insumos
app.use('/compras',               comprasRouter);        // dashboard menú
app.use('/compras/ordenes', comprasOrdenesRouter);
/* Servidor */
app.listen(PORT, ()=> console.log(`✅ SubliRex en http://localhost:${PORT}`));
