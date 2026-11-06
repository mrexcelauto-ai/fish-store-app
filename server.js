const express = require('express');
const sql = require('mssql');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/'); },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const dbConfig = {
    user: 'sa',
    password: '123456',
    server: 'DESKTOP-LQAAB71',
    database: 'fresh_fish_db',
    options: { encrypt: false, trustServerCertificate: true, instanceName: 'SQLEXPRESS' }
};

// =================== مسارات المنتجات ===================
app.get('/api/products', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().query('SELECT id, name, price_per_kg AS price, stock_quantity AS stock, is_available, image_url FROM products');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const price = req.body.price ?? 0;
        const stock = req.body.stock ?? 0;
        const isAvailable = stock <= 0 ? 0 : (req.body.is_available ?? 1);

        let pool = await sql.connect(dbConfig);
        await pool.request()
            .input('id', sql.Int, productId)
            .input('price', sql.Decimal(10,2), price)
            .input('stock', sql.Decimal(10,2), stock)
            .input('is_available', sql.Bit, isAvailable)
            .query('UPDATE products SET price_per_kg = @price, stock_quantity = @stock, is_available = @is_available WHERE id = @id');

        res.json({ success: true, message: 'تم تحديث المنتج بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        let pool = await sql.connect(dbConfig);
        await pool.request().input('product_id', sql.Int, productId).query('DELETE FROM order_items WHERE product_id = @product_id');
        await pool.request().input('id', sql.Int, productId).query('DELETE FROM products WHERE id = @id');
        res.json({ success: true, message: 'تم حذف المنتج بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/products', upload.single('image'), async (req, res) => {
    try {
        const { category_id, name, price, stock } = req.body;
        const stockVal = stock || 0;
        const isAvailable = stockVal <= 0 ? 0 : 1;
        const imageUrl = req.file ? `/uploads/${req.file.filename}` : 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&q=80&w=500';

        let pool = await sql.connect(dbConfig);
        await pool.request()
            .input('category_id', sql.Int, category_id || 1)
            .input('name', sql.NVarChar, name)
            .input('price', sql.Decimal(10,2), price || 0)
            .input('stock', sql.Decimal(10,2), stockVal)
            .input('is_available', sql.Bit, isAvailable)
            .input('image_url', sql.VarChar, imageUrl)
            .query('INSERT INTO products (category_id, name, price_per_kg, stock_quantity, image_url, is_available) VALUES (@category_id, @name, @price, @stock, @image_url, @is_available)');

        res.json({ success: true, message: 'تم إضافة المنتج بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================== مسارات الطلبات ===================
app.get('/api/admin/orders', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().query(`
            SELECT o.id, ISNULL(c.full_name, N'عميل عام') AS customer, ISNULL(c.phone, N'غير متوفر') AS phone,
            ISNULL(o.delivery_method, N'delivery') AS method, ISNULL(o.address, N'غير محدد') AS address,
            ISNULL(o.notes, N'') AS items, ISNULL(o.total_price, 0) AS total, ISNULL(o.status, N'pending') AS status, o.created_at
            FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/orders/:id/status', async (req, res) => {
    try {
        const orderId = req.params.id;
        const { status } = req.body;

        let pool = await sql.connect(dbConfig);

        const orderInfoQuery = await pool.request()
            .input('id', sql.Int, orderId)
            .query('SELECT status, notes FROM orders WHERE id = @id');

        if (orderInfoQuery.recordset.length === 0) {
            return res.status(404).json({ error: 'الطلب غير موجود' });
        }

        const oldStatus = orderInfoQuery.recordset[0].status;
        const orderNotes = orderInfoQuery.recordset[0].notes || '';

        await pool.request()
            .input('id', sql.Int, orderId)
            .input('status', sql.VarChar, status)
            .query('UPDATE orders SET status = @status WHERE id = @id');

        // الخصم التلقائي للمخزون عند اكتمال الطلب
        if (status === 'completed' && oldStatus !== 'completed') {
            const productsResult = await pool.request().query('SELECT id, name FROM products');

            for (let prod of productsResult.recordset) {
                if (orderNotes.includes(prod.name)) {
                    let qtyToSubtract = 1;
                    try {
                        const regex = new RegExp(`${prod.name} \\(([0-9\\.]+)\\s*كجم\\)`, 'i');
                        const match = orderNotes.match(regex);
                        if (match && match[1]) {
                            qtyToSubtract = parseFloat(match[1]);
                        }
                    } catch (e) {
                        qtyToSubtract = 1;
                    }

                    await pool.request()
                        .input('prod_id', sql.Int, prod.id)
                        .input('qty', sql.Decimal(10,2), qtyToSubtract)
                        .query(`
                            UPDATE products
                            SET stock_quantity = CASE WHEN stock_quantity >= @qty THEN stock_quantity - @qty ELSE 0 END,
                                is_available = CASE WHEN (stock_quantity - @qty) <= 0 THEN 0 ELSE is_available END
                            WHERE id = @prod_id
                        `);
                }
            }
        }
        res.json({ success: true, message: 'تم تحديث الحالة بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/orders/:id', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        await pool.request().input('order_id', sql.Int, req.params.id).query('DELETE FROM order_items WHERE order_id = @order_id');
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM orders WHERE id = @id');
        res.json({ success: true, message: 'تم حذف الطلب بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/orders', async (req, res) => {
    try {
        const { full_name, phone, delivery_method, address, notes, total_price } = req.body;
        let pool = await sql.connect(dbConfig);
        let custResult = await pool.request().input('phone', sql.VarChar, phone).input('full_name', sql.NVarChar, full_name).input('address', sql.NVarChar, address || '')
            .query('IF NOT EXISTS (SELECT * FROM customers WHERE phone = @phone) INSERT INTO customers (full_name, phone, default_address) VALUES (@full_name, @phone, @address); SELECT id FROM customers WHERE phone = @phone;');
        const customer_id = custResult.recordset[0].id;
        await pool.request().input('customer_id', sql.Int, customer_id).input('delivery_method', sql.VarChar, delivery_method || 'delivery').input('address', sql.NVarChar, address || 'غير محدد').input('notes', sql.NVarChar, notes || '').input('subtotal', sql.Decimal(10,2), total_price || 0).input('delivery_fee', sql.Decimal(10,2), 20).input('total_price', sql.Decimal(10,2), (total_price || 0) + 20).input('status', sql.VarChar, 'pending')
            .query('INSERT INTO orders (customer_id, delivery_method, address, notes, subtotal, delivery_fee, total_price, status) VALUES (@customer_id, @delivery_method, @address, @notes, @subtotal, @delivery_fee, @total_price, @status)');
        res.json({ success: true, message: 'تم حفظ الطلب بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================== مسارات العملاء (جديد) ===================
app.get('/api/admin/customers', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().query(`
            SELECT
                c.id, c.full_name, c.phone, c.default_address, c.created_at,
                (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS total_orders
            FROM customers c
            ORDER BY c.created_at DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/customers/:id', async (req, res) => {
    try {
        const customerId = req.params.id;
        let pool = await sql.connect(dbConfig);

        // فك ارتباط الطلبات بالعميل قبل حذفه لتجنب أخطاء قاعدة البيانات
        await pool.request()
            .input('customer_id', sql.Int, customerId)
            .query('UPDATE orders SET customer_id = NULL WHERE customer_id = @customer_id');

        await pool.request()
            .input('id', sql.Int, customerId)
            .query('DELETE FROM customers WHERE id = @id');

        res.json({ success: true, message: 'تم حذف العميل بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================== مسارات المستخدمين (المشرفين) ===================
app.get('/api/admin/users', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().query('SELECT id, username, role, created_at FROM admins');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users', async (req, res) => {
    try {
        const { username, password, role } = req.body;
        let pool = await sql.connect(dbConfig);
        await pool.request().input('username', sql.NVarChar, username).input('password', sql.NVarChar, password).input('role', sql.NVarChar, role || 'مشرف')
            .query('INSERT INTO admins (username, password, role) VALUES (@username, @password, @role)');
        res.json({ success: true, message: 'تم إضافة المستخدم بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/users/:id', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM admins WHERE id = @id');
        res.json({ success: true, message: 'تم حذف المستخدم بنجاح' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================== تسجيل الدخول ===================
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().input('username', sql.NVarChar, username).input('password', sql.NVarChar, password)
            .query('SELECT * FROM admins WHERE username = @username AND password = @password');

        if (result.recordset.length > 0) {
            res.json({ success: true, message: 'تم تسجيل الدخول', user: result.recordset[0] });
        } else {
            res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => { console.log(`Server is running on http://localhost:${PORT}`); });
