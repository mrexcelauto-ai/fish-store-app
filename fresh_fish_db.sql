-- ==========================================
-- قاعدة بيانات متجر أسماك البحر الطازجة (SQL Server)
-- ==========================================

IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'fresh_fish_db')
BEGIN
    CREATE DATABASE fresh_fish_db;
END;
GO

USE fresh_fish_db;
GO

-- 1. جدول الفئات
CREATE TABLE categories (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    icon NVARCHAR(50),
    created_at DATETIME DEFAULT GETDATE()
);
GO

-- 2. جدول المنتجات
CREATE TABLE products (
    id INT IDENTITY(1,1) PRIMARY KEY,
    category_id INT NOT NULL,
    name NVARCHAR(150) NOT NULL,
    price_per_kg DECIMAL(10, 2) NOT NULL,
    image_url TEXT,
    is_available BIT DEFAULT 1,
    created_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);
GO

-- 3. جدول طرق التحضير
CREATE TABLE preparations (
    id INT IDENTITY(1,1) PRIMARY KEY,
    product_id INT NOT NULL,
    prep_name NVARCHAR(150) NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
GO

-- 4. جدول العملاء
CREATE TABLE customers (
    id INT IDENTITY(1,1) PRIMARY KEY,
    full_name NVARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    default_address NVARCHAR(MAX),
    created_at DATETIME DEFAULT GETDATE()
);
GO

-- 5. جدول الطلبات
CREATE TABLE orders (
    id INT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT NOT NULL,
    delivery_method VARCHAR(20) NOT NULL DEFAULT 'delivery',
    address NVARCHAR(MAX) NULL,
    notes NVARCHAR(MAX) NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    delivery_fee DECIMAL(10, 2) NOT NULL DEFAULT 30.00,
    total_price DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);
GO

-- 6. جدول تفاصيل عناصر الطلب
CREATE TABLE order_items (
    id INT IDENTITY(1,1) PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    preparation_name NVARCHAR(150) NOT NULL,
    weight_kg DECIMAL(5, 2) NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    total_item_price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);
GO

-- ==========================================
-- إدراج بيانات المتجر (Seed Data)
-- ==========================================

INSERT INTO categories (name, slug) VALUES 
(N'أسماك طازجة 🐟', 'fresh'),
(N'مأكولات بحرية 🦐', 'shellfish'),
(N'جاهز للطهي والتقديم 🍳', 'ready');
GO

INSERT INTO products (category_id, name, price_per_kg, image_url) VALUES 
(1, N'سمك بلطي ممتاز', 95.00, 'https://images.unsplash.com/photo-1534483509719-3feaee7c30da?auto=format&fit=crop&w=600&q=80'),
(1, N'سمك بوري طازج', 160.00, 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=600&q=80'),
(2, N'جمبري جامبو طازج', 380.00, 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?auto=format&fit=crop&w=600&q=80'),
(1, N'سمك دنيس ممتاز', 240.00, 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=600&q=80'),
(2, N'كابوريا نتي مليانة', 210.00, 'https://images.unsplash.com/photo-1559742811-822863646df8?auto=format&fit=crop&w=600&q=80'),
(3, N'طبق فواكه البحر (سي فود)', 190.00, 'https://images.unsplash.com/photo-1615141982883-c7ad0e69fd62?auto=format&fit=crop&w=600&q=80'),
(2, N'سبيط (كاليماري) بلدي', 320.00, 'https://images.unsplash.com/photo-1604909052743-94e838986d24?auto=format&fit=crop&w=600&q=80'),
(1, N'سمك قاروص فاخر', 290.00, 'https://images.unsplash.com/photo-1535591273668-578e31182c4f?auto=format&fit=crop&w=600&q=80');
GO

INSERT INTO preparations (product_id, prep_name) VALUES 
(1, N'تنظيف كامل فقط'), (1, N'قلي جاهز'), (1, N'مشوي ردة'), (1, N'سنجاري زيت ولمون'),
(2, N'سنجاري بالخضار'), (2, N'مشوي بالردة'), (2, N'تنظيف فقط'),
(3, N'بدون تقشير (شوربة)'), (3, N'مقشر تنظيف كامل'), (3, N'مشوي باترفلاي'),
(4, N'سنجاري بالفرن'), (4, N'مشوي زيت ولمون'), (4, N'تنظيف فقط'),
(5, N'مغسولة جاهزة للطهي'), (5, N'مسلوقة بالخلطة'),
(6, N'مكونات شوربة مشكلة طازجة'), (6, N'شوربة جاهزة بالكريمة'),
(7, N'مقطع حلقات جاهز للقلي'), (7, N'طاجن بالصلصة'), (7, N'تنظيف فقط'),
(8, N'سنجاري بالأعشاب'), (8, N'ملح في الفرن'), (8, N'تنظيف فقط');
GO
