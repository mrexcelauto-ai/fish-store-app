const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const session = require('express-session');
require('dotenv').config();

const { sql, connectDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

app.use(session({
    name: 'marasi.sid',
    secret: process.env.SESSION_SECRET || 'marasi_secret_change_this_in_production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: 1000 * 60 * 60 * 12
    }
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        if (origin) {
            res.header('Access-Control-Allow-Origin', origin);
            res.header('Access-Control-Allow-Credentials', 'true');
        }
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

function requireAdminAuth(req, res, next) {
    const adminUser = req.session && req.session.adminUser;
    if (!adminUser || !adminUser.id) {
        if (req.method === 'GET' && req.accepts('html')) {
            return res.redirect('/login.html');
        }
        return res.status(401).json({ success: false, message: 'غير مصرح بالدخول. يرجى تسجيل الدخول أولاً.' });
    }
    req.adminUser = adminUser;
    next();
}

function requireAdminRole(allowedRoles = ['super_admin', 'sales']) {
    return (req, res, next) => {
        const role = req.adminUser && req.adminUser.role;
        if (!role || !allowedRoles.includes(role)) {
            return res.status(403).json({ success: false, message: 'ليس لديك صلاحية تنفيذ هذا الإجراء.' });
        }
        next();
    };
}

app.get('/admin.html', requireAdminAuth, requireAdminRole(['super_admin', 'sales']), (req, res) => {
    const protectedPath = path.join(__dirname, 'protected-views', 'admin.html');
    const rootFallbackPath = path.join(__dirname, 'admin.html');
    if (fs.existsSync(protectedPath)) {
        return res.sendFile(protectedPath);
    }
    if (fs.existsSync(rootFallbackPath)) {
        return res.sendFile(rootFallbackPath);
    }
    return res.status(404).send('Admin view not found');
});

app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    if (
        p === '/admin.html' ||
        p.startsWith('/protected-views') ||
        p === '/.env' ||
        p === '/db.js' ||
        p === '/server.js' ||
        p === '/server_2.js' ||
        p === '/server_4.js' ||
        p.endsWith('.bak')
    ) {
        return res.status(403).send('Forbidden');
    }
    next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname), {
    index: 'index.html',
    extensions: ['html']
}));

app.use('/api/admin', (req, res, next) => {
    if (req.path === '/login' && req.method === 'POST') return next();
    if (req.path === '/logout' && req.method === 'POST') return next();
    return requireAdminAuth(req, res, () => requireAdminRole(['super_admin', 'sales'])(req, res, next));
});

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname || '').toLowerCase();
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('نوع الصورة غير مدعوم. يُسمح بـ JPG, PNG, WEBP, GIF فقط.'));
        }
    }
});

async function initializeDatabase() {
    try {
        const pool = await connectDB();

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'admin_users')
            BEGIN
                CREATE TABLE admin_users (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    full_name NVARCHAR(100) NOT NULL,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    password VARCHAR(100) NOT NULL,
                    role VARCHAR(20) NOT NULL DEFAULT 'sales',
                    created_at DATETIME DEFAULT GETDATE()
                );
                INSERT INTO admin_users (full_name, username, password, role)
                VALUES (N'مدير النظام', 'admin', 'admin123', 'super_admin');
            END
        `);

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'store_settings')
            BEGIN
                CREATE TABLE store_settings (setting_key VARCHAR(50) PRIMARY KEY, setting_value NVARCHAR(500) NOT NULL);
                INSERT INTO store_settings (setting_key, setting_value) VALUES
                ('delivery_type', 'fixed'),
                ('delivery_fee', '20'),
                ('free_threshold', '200'),
                ('flash_deal_active', '1'),
                ('flash_deal_text', N'وصول شحنة سمك دنيس وجمبري طازج صيد اليوم - الكمية محدودة جداً 🎣');
            END
            ELSE
            BEGIN
                IF NOT EXISTS (SELECT * FROM store_settings WHERE setting_key = 'flash_deal_active')
                    INSERT INTO store_settings (setting_key, setting_value) VALUES ('flash_deal_active', '1');
                IF NOT EXISTS (SELECT * FROM store_settings WHERE setting_key = 'flash_deal_text')
                    INSERT INTO store_settings (setting_key, setting_value) VALUES ('flash_deal_text', N'وصول شحنة سمك دنيس وجمبري طازج صيد اليوم - الكمية محدودة جداً 🎣');
            END
        `);

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'complaints_suggestions')
            BEGIN
                CREATE TABLE complaints_suggestions (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    type VARCHAR(20) NOT NULL DEFAULT 'complaint',
                    customer_name NVARCHAR(120) NULL,
                    phone VARCHAR(30) NULL,
                    order_id NVARCHAR(50) NULL,
                    message NVARCHAR(1000) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'new',
                    created_at DATETIME DEFAULT GETDATE()
                );
            END
            ELSE
            BEGIN
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('complaints_suggestions') AND name = 'order_id')
                    ALTER TABLE complaints_suggestions ADD order_id NVARCHAR(50) NULL;
            END
        `);

        await pool.request().query(`
            IF OBJECT_ID('customers', 'U') IS NOT NULL
            BEGIN
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('customers') AND name = 'used_points')
                    ALTER TABLE customers ADD used_points INT NOT NULL DEFAULT 0;
                UPDATE customers SET used_points = 0 WHERE used_points IS NULL;
                UPDATE customers SET points = 0 WHERE points IS NULL;
            END
        `);

        await pool.request().query(`
            IF OBJECT_ID('products', 'U') IS NOT NULL
            BEGIN
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('products') AND name = 'name_en')
                    ALTER TABLE products ADD name_en NVARCHAR(200) NULL;
            END
        `);

        await pool.request().query(`
            IF OBJECT_ID('orders', 'U') IS NOT NULL
            BEGIN
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'items_json')
                    ALTER TABLE orders ADD items_json NVARCHAR(MAX) NULL;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'subtotal')
                    ALTER TABLE orders ADD subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'discount_amount')
                    ALTER TABLE orders ADD discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'customer_id')
                    ALTER TABLE orders ADD customer_id INT NULL;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'delivery_fee')
                    ALTER TABLE orders ADD delivery_fee DECIMAL(10, 2) NOT NULL DEFAULT 0;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'scheduled_at')
                    ALTER TABLE orders ADD scheduled_at NVARCHAR(150) NULL;
            END
        `);

        console.log('Database tables and columns verified successfully.');
    } catch (e) {
        console.error('Database initialization error:', e.message);
    }
}
initializeDatabase();

async function getStoreSettingsMap(pool) {
    const result = await pool.request().query('SELECT setting_key, setting_value FROM store_settings');
    const settings = {};
    result.recordset.forEach(row => {
        settings[row.setting_key] = row.setting_value;
    });
    return settings;
}

async function computeServerDeliveryFee(pool, deliveryMethod, amountAfterDiscount) {
    if (deliveryMethod === 'pickup') return 0;
    const settings = await getStoreSettingsMap(pool);
    const type = settings.delivery_type || 'fixed';
    const fee = parseFloat(settings.delivery_fee || '0') || 0;
    const threshold = parseFloat(settings.free_threshold || '0') || 0;

    if (type === 'free') return 0;
    if (type === 'threshold') {
        return amountAfterDiscount >= threshold ? 0 : fee;
    }
    return fee;
}

function buildOrderWhatsAppMessage({ orderId, full_name, phone, cleanMethod, address, scheduled_at, verifiedItems, finalTotal }) {
    const itemsText = verifiedItems
        .map(it => `- ${it.name} (${it.quantity} كجم × ${it.price} = ${(it.quantity * it.price).toFixed(2)})`)
        .join('\n');

    return [
        `طلب جديد رقم #${orderId}`,
        `العميل: ${full_name.trim()}`,
        `الهاتف: ${phone.trim()}`,
        `الاستلام: ${cleanMethod === 'pickup' ? 'استلام من الفرع' : 'توصيل للمنزل'}`,
        `العنوان: ${(address || '').trim() || 'غير محدد'}`,
        `الموعد: ${(scheduled_at || '').trim() || 'فوري الآن'}`,
        `الأصناف:\n${itemsText}`,
        `الإجمالي النهائي: ${finalTotal}`
    ].join('\n');
}

app.get('/api/settings/delivery', async (req, res) => {
    try {
        const pool = await connectDB();
        const settings = await getStoreSettingsMap(pool);
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/settings/delivery', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const { delivery_type, delivery_fee, free_threshold } = req.body;
        const allowedTypes = ['fixed', 'free', 'threshold'];
        const cleanType = allowedTypes.includes(delivery_type) ? delivery_type : 'fixed';
        const cleanFee = Math.max(0, parseFloat(delivery_fee) || 0);
        const cleanThreshold = Math.max(0, parseFloat(free_threshold) || 0);

        const pool = await connectDB();
        await pool.request()
            .input('type', sql.NVarChar, cleanType)
            .input('fee', sql.NVarChar, String(cleanFee))
            .input('threshold', sql.NVarChar, String(cleanThreshold))
            .query(`
                UPDATE store_settings SET setting_value = @type WHERE setting_key = 'delivery_type';
                UPDATE store_settings SET setting_value = @fee WHERE setting_key = 'delivery_fee';
                UPDATE store_settings SET setting_value = @threshold WHERE setting_key = 'free_threshold';
            `);
        res.json({ success: true, message: 'تم حفظ سياسة التوصيل بنجاح 🚚' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/settings/flash-deal', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const { flash_deal_active, flash_deal_text } = req.body;
        const pool = await connectDB();
        await pool.request()
            .input('active', sql.NVarChar, flash_deal_active ? '1' : '0')
            .input('text', sql.NVarChar, (flash_deal_text || '').trim())
            .query(`
                IF EXISTS (SELECT * FROM store_settings WHERE setting_key = 'flash_deal_active')
                    UPDATE store_settings SET setting_value = @active WHERE setting_key = 'flash_deal_active';
                ELSE
                    INSERT INTO store_settings (setting_key, setting_value) VALUES ('flash_deal_active', @active);

                IF EXISTS (SELECT * FROM store_settings WHERE setting_key = 'flash_deal_text')
                    UPDATE store_settings SET setting_value = @text WHERE setting_key = 'flash_deal_text';
                ELSE
                    INSERT INTO store_settings (setting_key, setting_value) VALUES ('flash_deal_text', @text);
            `);
        res.json({ success: true, message: 'تم تحديث إعدادات شريط صيد اليوم بنجاح ⚡' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

async function handleCreateComplaintSuggestion(req, res) {
    try {
        const rawType = req.body.type || req.body.feedback_type || 'complaint';
        const { customer_name, phone, order_id, message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, message: 'يرجى كتابة نص الشكوى أو المقترح' });
        }

        const allowedTypes = ['complaint', 'suggestion', 'inquiry'];
        const cleanType = allowedTypes.includes(rawType) ? rawType : 'complaint';

        const pool = await connectDB();
        const inserted = await pool.request()
            .input('type', sql.VarChar(20), cleanType)
            .input('customer_name', sql.NVarChar(120), (customer_name || '').trim() || null)
            .input('phone', sql.VarChar(30), (phone || '').trim() || null)
            .input('order_id', sql.NVarChar(50), (order_id || '').toString().trim() || null)
            .input('message', sql.NVarChar(1000), message.trim())
            .query(`
                INSERT INTO complaints_suggestions (type, customer_name, phone, order_id, message, status)
                VALUES (@type, @customer_name, @phone, @order_id, @message, 'new');
                SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;
            `);

        const newId = inserted.recordset && inserted.recordset[0] ? inserted.recordset[0].id : null;
        res.json({ success: true, id: newId, message: 'تم إرسال رسالتك بنجاح، نشكر تواصلك معنا ✨' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
}

app.post('/api/complaints-suggestions', handleCreateComplaintSuggestion);
app.post('/api/feedback', handleCreateComplaintSuggestion);

app.get('/api/admin/complaints-suggestions', async (req, res) => {
    try {
        const pool = await connectDB();
        const result = await pool.request().query(`
            SELECT id, type, customer_name, phone, order_id, message, status, created_at
            FROM complaints_suggestions
            ORDER BY created_at DESC, id DESC
        `);
        res.json({ success: true, items: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/admin/complaints-suggestions/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const allowed = ['new', 'in_progress', 'resolved'];
        const nextStatus = allowed.includes(status) ? status : 'new';
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('status', sql.VarChar(20), nextStatus)
            .query('UPDATE complaints_suggestions SET status = @status WHERE id = @id');

        res.json({ success: true, message: 'تم تحديث حالة الرسالة بنجاح' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/admin/complaints-suggestions/:id', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const pool = await connectDB();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM complaints_suggestions WHERE id = @id');

        res.json({ success: true, message: 'تم حذف الرسالة بنجاح' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/products', async (req, res) => {
    try {
        const pool = await connectDB();
        const result = await pool.request().query('SELECT id, name, name_en, price_per_kg AS price, stock_quantity AS stock, is_available, image_url FROM products ORDER BY id ASC');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/products/:id', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const { price, stock, name_en } = req.body;
        const cleanPrice = Math.max(0, parseFloat(price) || 0);
        const cleanStock = Math.max(0, parseFloat(stock) || 0);
        const isAvailable = cleanStock <= 0 ? 0 : 1;
        const pool = await connectDB();
        const reqDb = pool.request()
            .input('id', sql.Int, req.params.id)
            .input('price', sql.Decimal(10, 2), cleanPrice)
            .input('stock', sql.Decimal(10, 2), cleanStock)
            .input('is_available', sql.Bit, isAvailable);

        if (name_en !== undefined) {
            const cleanEn = (name_en || '').trim() || null;
            reqDb.input('name_en', sql.NVarChar(200), cleanEn);
            await reqDb.query('UPDATE products SET price_per_kg = @price, stock_quantity = @stock, is_available = @is_available, name_en = @name_en WHERE id = @id');
        } else {
            await reqDb.query('UPDATE products SET price_per_kg = @price, stock_quantity = @stock, is_available = @is_available WHERE id = @id');
        }

        res.json({ success: true, message: 'تم تحديث المنتج بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/products/:id', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const pool = await connectDB();
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM products WHERE id = @id');
        res.json({ success: true, message: 'تم حذف المنتج بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/products', requireAdminRole(['super_admin']), upload.single('image'), async (req, res) => {
    try {
        const { name, name_en, price, stock } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'اسم الصنف مطلوب' });
        }
        const cleanEn = (name_en || '').trim() || null;
        const priceVal = Math.max(0, parseFloat(price) || 0);
        const stockVal = Math.max(0, parseFloat(stock) || 0);
        const imageUrl = req.file ? `/uploads/${req.file.filename}` : 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=500';
        const pool = await connectDB();
        await pool.request()
            .input('category_id', sql.Int, 1)
            .input('name', sql.NVarChar(200), name.trim())
            .input('name_en', sql.NVarChar(200), cleanEn)
            .input('price', sql.Decimal(10, 2), priceVal)
            .input('stock', sql.Decimal(10, 2), stockVal)
            .input('is_available', sql.Bit, stockVal <= 0 ? 0 : 1)
            .input('image_url', sql.VarChar, imageUrl)
            .query('INSERT INTO products (category_id, name, name_en, price_per_kg, stock_quantity, image_url, is_available) VALUES (@category_id, @name, @name_en, @price, @stock, @image_url, @is_available)');
        res.json({ success: true, message: 'تم إضافة المنتج بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/coupons/apply', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code || !code.trim()) {
            return res.status(400).json({ success: false, message: 'يرجى إدخال كود الخصم' });
        }
        const pool = await connectDB();
        const result = await pool.request()
            .input('code', sql.VarChar, code.trim().toUpperCase())
            .query('SELECT id, code, discount_type, discount_value FROM coupons WHERE UPPER(code) = @code AND is_active = 1');
        if (result.recordset.length > 0) {
            res.json({ success: true, coupon: result.recordset[0] });
        } else {
            res.status(400).json({ success: false, message: 'كود الخصم غير صالح أو غير مفعّل ❌' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/coupons', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const pool = await connectDB();
        const result = await pool.request().query('SELECT * FROM coupons ORDER BY created_at DESC');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/coupons', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const { code, discount_type, discount_value } = req.body;
        const cleanCode = (code || '').trim().toUpperCase();
        const cleanType = discount_type === 'fixed' ? 'fixed' : 'percent';
        const cleanVal = parseFloat(discount_value);
        if (!cleanCode || isNaN(cleanVal) || cleanVal <= 0) {
            return res.status(400).json({ success: false, message: 'بيانات الكوبون غير صالحة' });
        }
        const pool = await connectDB();
        await pool.request()
            .input('code', sql.VarChar, cleanCode)
            .input('type', sql.VarChar, cleanType)
            .input('val', sql.Decimal(10, 2), cleanVal)
            .query('INSERT INTO coupons (code, discount_type, discount_value, is_active) VALUES (@code, @type, @val, 1)');
        res.json({ success: true, message: 'تم إنشاء كود الخصم بنجاح 🎉' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/coupons/:id', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const pool = await connectDB();
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM coupons WHERE id = @id');
        res.json({ success: true, message: 'تم حذف الكوبون بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/orders/track/:query', async (req, res) => {
    try {
        const q = req.params.query;
        const pool = await connectDB();
        const result = await pool.request()
            .input('q', sql.VarChar, q)
            .query(`
                SELECT id, customer_name AS customer, status, total_price, created_at, scheduled_at, notes
                FROM orders
                WHERE id = TRY_CAST(@q AS INT) OR phone = @q
                ORDER BY created_at DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const pool = await connectDB();
        const result = await pool.request()
            .input('username', sql.VarChar, username ? username.trim() : '')
            .input('password', sql.VarChar, password ? password.trim() : '')
            .query('SELECT id, full_name, username, role FROM admin_users WHERE username = @username AND password = @password');

        if (result.recordset.length > 0) {
            const adminRecord = result.recordset[0];
            req.session.adminUser = {
                id: adminRecord.id,
                full_name: adminRecord.full_name,
                username: adminRecord.username,
                role: adminRecord.role
            };
            res.json({ success: true, message: 'تم تسجيل دخول المشرف بنجاح', user: adminRecord });
        } else {
            res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور للمشرف غير صحيحة ❌' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/logout', (req, res) => {
    if (req.session) {
        req.session.destroy(() => {
            res.clearCookie('marasi.sid');
            res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
        });
    } else {
        res.json({ success: true });
    }
});

app.get('/api/admin/users', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const pool = await connectDB();
        const result = await pool.request().query('SELECT id, full_name, username, role, created_at FROM admin_users ORDER BY created_at DESC');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const { full_name, username, password, role } = req.body;
        const cleanRole = role === 'super_admin' ? 'super_admin' : 'sales';
        const pool = await connectDB();
        await pool.request()
            .input('full_name', sql.NVarChar, (full_name || '').trim())
            .input('username', sql.VarChar, (username || '').trim())
            .input('password', sql.VarChar, password)
            .input('role', sql.VarChar, cleanRole)
            .query('INSERT INTO admin_users (full_name, username, password, role) VALUES (@full_name, @username, @password, @role)');
        res.json({ success: true, message: 'تم إضافة المشرف بنجاح 👤' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/users/:id', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const userId = req.params.id;
        const { password, role } = req.body;
        const cleanRole = role === 'super_admin' ? 'super_admin' : 'sales';
        const pool = await connectDB();

        if (password && password.trim() !== '') {
            await pool.request()
                .input('id', sql.Int, userId)
                .input('password', sql.VarChar, password.trim())
                .input('role', sql.VarChar, cleanRole)
                .query('UPDATE admin_users SET password = @password, role = @role WHERE id = @id');
        } else {
            await pool.request()
                .input('id', sql.Int, userId)
                .input('role', sql.VarChar, cleanRole)
                .query('UPDATE admin_users SET role = @role WHERE id = @id');
        }

        res.json({ success: true, message: 'تم تحديث بيانات المشرف بنجاح ✏️' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/admin/users/:id', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const targetId = parseInt(req.params.id, 10);
        if (req.adminUser && req.adminUser.id === targetId) {
            return res.status(400).json({ success: false, message: 'لا يمكنك حذف حسابك الحالي أثناء تسجيل الدخول.' });
        }
        const pool = await connectDB();
        await pool.request().input('id', sql.Int, targetId).query('DELETE FROM admin_users WHERE id = @id');
        res.json({ success: true, message: 'تم حذف المشرف بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// العملاء والتسجيل
app.post('/api/customer/register', async (req, res) => {
    try {
        const { full_name, phone, username, password, address } = req.body;

        const phoneRegex = /^01[0125][0-9]{8}$/;
        if (!phone || !phoneRegex.test(phone.trim())) {
            return res.status(400).json({ success: false, message: 'رقم الهاتف غير صحيح أو غير مطابق للشروط!' });
        }

        const pool = await connectDB();

        const checkUsername = await pool.request().input('username', sql.NVarChar, username.trim()).query('SELECT id FROM customers WHERE username = @username');
        if (checkUsername.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'اسم المستخدم مستخدم من قبل، اختر اسم آخر!' });
        }

        const checkPhone = await pool.request().input('phone', sql.VarChar, phone.trim()).query('SELECT id, username FROM customers WHERE phone = @phone');
        if (checkPhone.recordset.length > 0) {
            const existingCustomer = checkPhone.recordset[0];
            if (!existingCustomer.username || existingCustomer.username.trim() === '') {
                await pool.request()
                    .input('id', sql.Int, existingCustomer.id)
                    .input('full_name', sql.NVarChar, (full_name || '').trim())
                    .input('username', sql.NVarChar, username.trim())
                    .input('password', sql.NVarChar, password)
                    .input('address', sql.NVarChar, (address || '').trim())
                    .query(`
                        UPDATE customers
                        SET full_name = @full_name, username = @username, password = @password, default_address = ISNULL(NULLIF(default_address, ''), @address), points = ISNULL(points, 0) + 50, used_points = ISNULL(used_points, 0)
                        WHERE id = @id
                    `);
                return res.json({ success: true, message: 'تم ربط حسابك بنجاح! وحصلت على 50 نقطة هدية 🎁', customerId: existingCustomer.id });
            } else {
                return res.status(400).json({ success: false, message: 'رقم الهاتف مسجل لحساب آخر بالفعل!' });
            }
        }

        const result = await pool.request()
            .input('full_name', sql.NVarChar, (full_name || '').trim())
            .input('phone', sql.VarChar, phone.trim())
            .input('username', sql.NVarChar, username.trim())
            .input('password', sql.NVarChar, password)
            .input('address', sql.NVarChar, (address || '').trim())
            .query('INSERT INTO customers (full_name, phone, username, password, default_address, points, used_points) VALUES (@full_name, @phone, @username, @password, @address, 50, 0); SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;');

        res.json({ success: true, message: 'تم إنشاء الحساب بنجاح! وحصلت على 50 نقطة هدية 🎁', customerId: result.recordset[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/customer/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const pool = await connectDB();
        const result = await pool.request()
            .input('username', sql.NVarChar, (username || '').trim())
            .input('password', sql.NVarChar, password)
            .query('SELECT id, full_name, phone, username, default_address, ISNULL(points, 0) AS points, ISNULL(used_points, 0) AS used_points FROM customers WHERE (username = @username OR phone = @username) AND password = @password');
        if (result.recordset.length > 0) {
            res.json({ success: true, customer: result.recordset[0] });
        } else {
            res.status(401).json({ success: false, message: 'بيانات حساب العميل غير صحيحة!' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/customer/change-password', async (req, res) => {
    try {
        const { customer_id, username, current_password, new_password } = req.body;

        if ((!customer_id && !username) || !current_password || !new_password) {
            return res.status(400).json({
                success: false,
                message: 'يرجى إرسال بيانات الحساب وكلمة السر الحالية والجديدة'
            });
        }

        if (String(new_password).trim().length < 4) {
            return res.status(400).json({
                success: false,
                message: 'كلمة السر الجديدة يجب أن تكون 4 أحرف على الأقل'
            });
        }

        const pool = await connectDB();
        const request = pool.request();

        let whereClause = '';
        if (customer_id) {
            request.input('customer_id', sql.Int, Number(customer_id));
            whereClause = 'id = @customer_id';
        } else {
            request.input('username', sql.NVarChar(100), String(username).trim());
            whereClause = 'username = @username';
        }

        const userResult = await request.query(`
            SELECT TOP 1 id, username, password
            FROM customers
            WHERE ${whereClause}
        `);

        if (!userResult.recordset || userResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'الحساب غير موجود'
            });
        }

        const customer = userResult.recordset[0];

        if (String(customer.password) !== String(current_password)) {
            return res.status(401).json({
                success: false,
                message: 'كلمة السر الحالية غير صحيحة'
            });
        }

        await pool.request()
            .input('id', sql.Int, customer.id)
            .input('new_password', sql.NVarChar(255), String(new_password))
            .query(`
                UPDATE customers
                SET password = @new_password
                WHERE id = @id
            `);

        return res.json({
            success: true,
            message: 'تم تغيير كلمة السر بنجاح'
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: 'حدث خطأ في الخادم أثناء تحديث كلمة السر',
            error: err.message
        });
    }
});

app.post('/api/customer/use-points', async (req, res) => {
    try {
        const { customer_id, points_to_use } = req.body;
        const pts = parseInt(points_to_use, 10);
        if (!customer_id || isNaN(pts) || pts <= 0 || pts % 50 !== 0) {
            return res.status(400).json({ success: false, message: 'يجب استبدال النقاط بمضاعفات 50 نقطة' });
        }

        const pool = await connectDB();
        const customerCheck = await pool.request()
            .input('id', sql.Int, customer_id)
            .query('SELECT ISNULL(points, 0) AS points FROM customers WHERE id = @id');

        if (customerCheck.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'العميل غير موجود' });
        }

        const currentPoints = customerCheck.recordset[0].points;
        if (currentPoints < pts) {
            return res.status(400).json({ success: false, message: 'رصيد النقاط لا يكفي!' });
        }

        const discountValue = (pts / 50) * 25;

        await pool.request()
            .input('id', sql.Int, customer_id)
            .input('deduct', sql.Int, pts)
            .query('UPDATE customers SET points = ISNULL(points, 0) - @deduct, used_points = ISNULL(used_points, 0) + @deduct WHERE id = @id');

        res.json({
            success: true,
            message: `تم خصم ${pts} نقطة بنجاح واستبدالها بخصم ${discountValue} ر.س 🎁`,
            discount_amount: discountValue
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/admin/customers', async (req, res) => {
    try {
        const pool = await connectDB();
        const result = await pool.request().query(`
            SELECT c.id, c.full_name, c.phone, c.username, c.default_address,
                   ISNULL(c.points, 0) AS remaining_points,
                   ISNULL(c.used_points, 0) AS used_points,
                   (ISNULL(c.points, 0) + ISNULL(c.used_points, 0)) AS total_earned_points,
                   c.created_at,
                   (SELECT COUNT(*) FROM orders o WHERE o.phone = c.phone) AS total_orders
            FROM customers c ORDER BY c.created_at DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/customers/:id', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const pool = await connectDB();
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM customers WHERE id = @id');
        res.json({ success: true, message: 'تم حذف العميل بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// إنشاء طلب جديد من المتجر
app.post('/api/orders', async (req, res) => {
    const {
        full_name,
        phone,
        delivery_method,
        address,
        notes,
        items,
        coupon_code,
        loyalty_discount,
        customer_id,
        scheduled_at
    } = req.body;

    if (!full_name || !full_name.trim() || !phone || !phone.trim()) {
        return res.status(400).json({ success: false, message: 'اسم العميل ورقم الهاتف مطلوبان' });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'سلة المشتريات فارغة' });
    }

    let transaction;
    try {
        const pool = await connectDB();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        let subtotal = 0;
        const verifiedItems = [];

        for (const item of items) {
            const prodId = parseInt(item.product_id || item.id, 10);
            const qty = parseFloat(item.quantity);
            if (isNaN(prodId) || isNaN(qty) || qty <= 0) {
                await transaction.rollback();
                return res.status(400).json({ success: false, message: 'بيانات صنف غير صالحة في الطلب' });
            }

            const prodRes = await new sql.Request(transaction)
                .input('pid', sql.Int, prodId)
                .query('SELECT id, name, price_per_kg, stock_quantity, is_available FROM products WHERE id = @pid');

            if (!prodRes.recordset.length) {
                await transaction.rollback();
                return res.status(404).json({ success: false, message: `الصنف رقم #${prodId} غير موجود` });
            }

            const prod = prodRes.recordset[0];
            const currentStock = parseFloat(prod.stock_quantity || 0);
            if (!prod.is_available || currentStock < qty) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    message: `الكمية المطلوبة من (${prod.name}) غير متوفرة. المتاح حالياً: ${currentStock} كجم`
                });
            }

            const unitPrice = parseFloat(prod.price_per_kg || 0);
            subtotal += unitPrice * qty;
            verifiedItems.push({
                product_id: prod.id,
                name: prod.name,
                quantity: qty,
                price: unitPrice
            });
        }

        const cleanSubtotal = Number(subtotal.toFixed(2));

        let couponDiscount = 0;
        if (coupon_code && String(coupon_code).trim()) {
            const cpRes = await new sql.Request(transaction)
                .input('code', sql.VarChar, String(coupon_code).trim().toUpperCase())
                .query('SELECT TOP 1 discount_type, discount_value FROM coupons WHERE UPPER(code) = @code AND is_active = 1');
            if (cpRes.recordset.length > 0) {
                const cp = cpRes.recordset[0];
                const cVal = parseFloat(cp.discount_value || 0);
                couponDiscount = cp.discount_type === 'percent'
                    ? (cleanSubtotal * cVal) / 100
                    : cVal;
            }
        }

        const loyDiscount = Math.max(0, parseFloat(loyalty_discount) || 0);
        const totalDiscount = Math.min(cleanSubtotal, couponDiscount + loyDiscount);
        const afterDiscount = Math.max(0, cleanSubtotal - totalDiscount);

        const cleanMethod = delivery_method === 'pickup' ? 'pickup' : 'delivery';
        const deliveryFee = await computeServerDeliveryFee(pool, cleanMethod, afterDiscount);
        const finalTotal = Number((afterDiscount + deliveryFee).toFixed(2));

        let resolvedCustomerId = customer_id ? parseInt(customer_id, 10) : null;
        if (!resolvedCustomerId) {
            const existingCust = await new sql.Request(transaction)
                .input('phone', sql.VarChar, phone.trim())
                .query('SELECT TOP 1 id FROM customers WHERE phone = @phone');

            if (existingCust.recordset.length > 0) {
                resolvedCustomerId = existingCust.recordset[0].id;
            } else {
                const guestUsername = `guest_${phone.trim()}_${Date.now().toString().slice(-4)}`;
                const newCust = await new sql.Request(transaction)
                    .input('full_name', sql.NVarChar, full_name.trim())
                    .input('phone', sql.VarChar, phone.trim())
                    .input('username', sql.NVarChar, guestUsername)
                    .input('password', sql.NVarChar, 'guest_order')
                    .input('address', sql.NVarChar, (address || '').trim())
                    .query(`
                        INSERT INTO customers (full_name, phone, username, password, default_address, points, used_points)
                        VALUES (@full_name, @phone, @username, @password, @address, 0, 0);
                        SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;
                    `);
                resolvedCustomerId = newCust.recordset[0].id;
            }
        }

        const orderInsert = await new sql.Request(transaction)
            .input('customer_id', sql.Int, resolvedCustomerId)
            .input('customer_name', sql.NVarChar, full_name.trim())
            .input('phone', sql.VarChar, phone.trim())
            .input('delivery_method', sql.NVarChar, cleanMethod)
            .input('address', sql.NVarChar, (address || '').trim() || (cleanMethod === 'pickup' ? 'استلام من الفرع' : 'غير محدد'))
            .input('notes', sql.NVarChar(sql.MAX), notes || '')
            .input('items_json', sql.NVarChar(sql.MAX), JSON.stringify(verifiedItems))
            .input('subtotal', sql.Decimal(10, 2), cleanSubtotal)
            .input('discount_amount', sql.Decimal(10, 2), Number(totalDiscount.toFixed(2)))
            .input('delivery_fee', sql.Decimal(10, 2), Number(deliveryFee.toFixed(2)))
            .input('total_price', sql.Decimal(10, 2), finalTotal)
            .input('scheduled_at', sql.NVarChar(150), (scheduled_at || '').trim() || 'فوري الآن')
            .query(`
                INSERT INTO orders (customer_id, customer_name, phone, delivery_method, address, notes, items_json, subtotal, discount_amount, delivery_fee, total_price, scheduled_at, status)
                VALUES (@customer_id, @customer_name, @phone, @delivery_method, @address, @notes, @items_json, @subtotal, @discount_amount, @delivery_fee, @total_price, @scheduled_at, 'pending');
                SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;
            `);

        const orderId = orderInsert.recordset[0].id;
        await transaction.commit();

        const shopWaPhone = (process.env.WHATSAPP_PHONE || '').replace(/[^0-9]/g, '');
        const waMessage = buildOrderWhatsAppMessage({
            orderId,
            full_name,
            phone,
            cleanMethod,
            address,
            scheduled_at,
            verifiedItems,
            finalTotal
        });
        const whatsappUrl = shopWaPhone
            ? `https://wa.me/${shopWaPhone}?text=${encodeURIComponent(waMessage)}`
            : null;

        res.json({
            success: true,
            orderId,
            subtotal: cleanSubtotal,
            total_price: finalTotal,
            whatsapp_url: whatsappUrl,
            whatsapp_message: waMessage,
            message: 'تم استلام طلبك بنجاح'
        });
    } catch (err) {
        console.error('POST /api/orders error:', err);
        if (transaction) {
            try { await transaction.rollback(); } catch (rbErr) {}
        }
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء حفظ الطلب', error: err.message });
    }
});

// إدارة الطلبات
app.get('/api/admin/orders', async (req, res) => {
    try {
        const pool = await connectDB();
        const result = await pool.request().query(`
            SELECT id, customer_name AS customer, phone,
            ISNULL(delivery_method, N'delivery') AS method, ISNULL(address, N'غير محدد') AS address,
            ISNULL(notes, N'') AS items, ISNULL(total_price, 0) AS total, ISNULL(status, N'pending') AS status, created_at, scheduled_at
            FROM orders ORDER BY created_at DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/orders/:id/status', async (req, res) => {
    const orderId = req.params.id;
    const { status } = req.body;
    const allowedStatuses = ['pending', 'processing', 'completed'];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'حالة الطلب غير صالحة' });
    }

    let transaction;
    try {
        const pool = await connectDB();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const orderCheck = await new sql.Request(transaction)
            .input('id', sql.Int, orderId)
            .query('SELECT status, notes, items_json, customer_id, phone, total_price FROM orders WHERE id = @id');

        if (orderCheck.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        }

        const orderRow = orderCheck.recordset[0];
        const oldStatus = orderRow.status;
        const orderNotes = orderRow.notes || '';

        await new sql.Request(transaction)
            .input('id', sql.Int, orderId)
            .input('status', sql.VarChar, status)
            .query('UPDATE orders SET status = @status WHERE id = @id');

        if (status === 'completed' && oldStatus !== 'completed') {
            let parsedItems = [];
            if (orderRow.items_json) {
                try {
                    const arr = JSON.parse(orderRow.items_json);
                    if (Array.isArray(arr)) parsedItems = arr;
                } catch (e) {}
            }

            if (parsedItems.length > 0) {
                for (const item of parsedItems) {
                    const prodId = parseInt(item.product_id || item.id, 10);
                    const qtyToSubtract = parseFloat(item.quantity);
                    if (!isNaN(prodId) && !isNaN(qtyToSubtract) && qtyToSubtract > 0) {
                        await new sql.Request(transaction)
                            .input('pid', sql.Int, prodId)
                            .input('qsub', sql.Decimal(10, 2), qtyToSubtract)
                            .query(`
                                UPDATE products
                                SET stock_quantity = CASE WHEN stock_quantity >= @qsub THEN stock_quantity - @qsub ELSE 0 END,
                                    is_available = CASE WHEN (stock_quantity - @qsub) <= 0 THEN 0 ELSE is_available END
                                WHERE id = @pid
                            `);
                    }
                }
            } else {
                let productsPart = orderNotes;
                if (orderNotes.includes('المنتجات:')) {
                    productsPart = orderNotes.split('المنتجات:')[1];
                }
                const regex = /([^\(\,]+)\s*\(\s*([\d\.]+)\s*(?:كجم|kg)\s*\)/gi;
                let match;
                while ((match = regex.exec(productsPart)) !== null) {
                    const prodName = match[1].trim();
                    const qtyToSubtract = parseFloat(match[2]);
                    if (prodName && !isNaN(qtyToSubtract) && qtyToSubtract > 0) {
                        await new sql.Request(transaction)
                            .input('pname', sql.NVarChar, prodName)
                            .input('qsub', sql.Decimal(10, 2), qtyToSubtract)
                            .query(`
                                UPDATE products
                                SET stock_quantity = CASE WHEN stock_quantity >= @qsub THEN stock_quantity - @qsub ELSE 0 END,
                                    is_available = CASE WHEN (stock_quantity - @qsub) <= 0 THEN 0 ELSE is_available END
                                WHERE name = @pname
                            `);
                    }
                }
            }

            const earnedPoints = 10;
            if (orderRow.customer_id) {
                await new sql.Request(transaction)
                    .input('cid', sql.Int, orderRow.customer_id)
                    .input('pts', sql.Int, earnedPoints)
                    .query('UPDATE customers SET points = ISNULL(points, 0) + @pts WHERE id = @cid');
            } else if (orderRow.phone) {
                await new sql.Request(transaction)
                    .input('phone', sql.VarChar, orderRow.phone)
                    .input('pts', sql.Int, earnedPoints)
                    .query('UPDATE customers SET points = ISNULL(points, 0) + @pts WHERE phone = @phone');
            }
        }

        await transaction.commit();
        res.json({ success: true, message: 'تم تحديث حالة الطلب بنجاح ✅' });
    } catch (err) {
        if (transaction) {
            try { await transaction.rollback(); } catch (rbErr) {}
        }
        res.status(500).json({ success: false, message: 'تعذر تحديث حالة الطلب', error: err.message });
    }
});

app.delete('/api/admin/orders/:id', requireAdminRole(['super_admin']), async (req, res) => {
    try {
        const pool = await connectDB();
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM orders WHERE id = @id');
        res.json({ success: true, message: 'تم حذف الطلب بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// التقارير: المبيعات وحركة المخزون
app.get('/api/admin/reports/sales', async (req, res) => {
    try {
        const pool = await connectDB();
        const summaryRes = await pool.request().query(`
            SELECT
                COUNT(*) AS total_orders_count,
                ISNULL(SUM(total_price), 0) AS total_revenue
            FROM orders
            WHERE status = 'completed'
        `);

        const dailyRes = await pool.request().query(`
            SELECT
                CAST(created_at AS DATE) AS sale_date,
                COUNT(*) AS orders_count,
                ISNULL(SUM(total_price), 0) AS daily_revenue
            FROM orders
            WHERE status = 'completed'
              AND created_at >= DATEADD(DAY, -30, GETDATE())
            GROUP BY CAST(created_at AS DATE)
            ORDER BY sale_date DESC
        `);

        res.json({
            success: true,
            summary: summaryRes.recordset[0] || { total_orders_count: 0, total_revenue: 0 },
            daily_sales: dailyRes.recordset || []
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/admin/reports/inventory', async (req, res) => {
    try {
        const pool = await connectDB();
        const productsRes = await pool.request().query(`
            SELECT id, name, price_per_kg AS price, stock_quantity AS current_stock, is_available
            FROM products
            ORDER BY id ASC
        `);

        const completedOrdersRes = await pool.request().query(`
            SELECT items_json, notes
            FROM orders
            WHERE status = 'completed'
        `);

        const soldById = {};
        const soldByName = {};

        for (const row of completedOrdersRes.recordset) {
            let parsed = false;
            if (row.items_json) {
                try {
                    const arr = JSON.parse(row.items_json);
                    if (Array.isArray(arr) && arr.length > 0) {
                        parsed = true;
                        for (const it of arr) {
                            const qty = parseFloat(it.quantity) || 0;
                            if (it.product_id) {
                                soldById[it.product_id] = (soldById[it.product_id] || 0) + qty;
                            }
                            if (it.name) {
                                const k = String(it.name).trim();
                                soldByName[k] = (soldByName[k] || 0) + qty;
                            }
                        }
                    }
                } catch (e) {}
            }

            if (!parsed && row.notes) {
                let productsPart = row.notes;
                if (row.notes.includes('المنتجات:')) {
                    productsPart = row.notes.split('المنتجات:')[1];
                }
                const regex = /([^\(\,]+)\s*\(\s*([\d\.]+)\s*(?:كجم|kg)\s*\)/gi;
                let match;
                while ((match = regex.exec(productsPart)) !== null) {
                    const pName = match[1].trim();
                    const qty = parseFloat(match[2]) || 0;
                    if (pName) {
                        soldByName[pName] = (soldByName[pName] || 0) + qty;
                    }
                }
            }
        }

        const items = productsRes.recordset.map(p => {
            const soldQty = Number(((soldById[p.id] || 0) || (soldByName[p.name] || 0)).toFixed(2));
            return {
                id: p.id,
                name: p.name,
                price: Number(p.price || 0),
                sold_quantity: soldQty,
                current_stock: Number(p.current_stock || 0),
                is_available: Boolean(p.is_available)
            };
        });

        res.json({ success: true, items });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || (err && err.message && err.message.includes('الصورة'))) {
        return res.status(400).json({ success: false, message: err.message });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
});

app.listen(PORT, () => {
    console.log(`Marasi server running on port ${PORT}`);
});
