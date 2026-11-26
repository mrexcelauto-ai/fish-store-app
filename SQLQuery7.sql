USE fresh_fish_db;
GO

-- تحديث كمية المخزون وجعلها متاحة لجميع المنتجات الموجودة حالياً
UPDATE products 
SET stock_quantity = 50.00, is_available = 1 
WHERE stock_quantity IS NULL OR stock_quantity = 0;
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'store_settings')
BEGIN
    CREATE TABLE store_settings (
        setting_key VARCHAR(50) PRIMARY KEY,
        setting_value NVARCHAR(255) NOT NULL
    );
    -- قيم افتراضية: نوع الحساب (fixed / threshold / free) وقيمة الرسوم والحد الأدنى
    INSERT INTO store_settings (setting_key, setting_value) VALUES 
    ('delivery_type', 'fixed'),      -- fixed (ثابت), threshold (مجاني بعد حد معين), free (مجاني)
    ('delivery_fee', '20'),          -- قيمة التوصيل بالريال
    ('free_threshold', '200');       -- حد التوصيل المجاني بالريال
END;