SELECT id, username, password, role, created_at 
FROM admins;

USE fresh_fish_db;
GO
SELECT * FROM products;
SELECT * FROM admin_users;
select * from customers;
ALTER TABLE customers ADD used_points INT DEFAULT 0;
USE fresh_fish_db;
GO

USE fresh_fish_db;
GO

-- 1. إلغاء ارتباط جدول الطلبات بالقيود الأجنبية إن وجدت لتجنب خطأ الحذف
DECLARE @Sql NVARCHAR(MAX) = N;
SELECT @Sql += N'ALTER TABLE ' + OBJECT_NAME(parent_object_id) + N' DROP CONSTRAINT ' + OBJECT_NAME(object_id) + N';'
FROM sys.foreign_keys
WHERE referenced_object_id = OBJECT_ID('orders');
EXEC sp_executesql @Sql;
GO
USE fresh_fish_db;
GO

-- التأكد من وجود عمود total_amount بالنوع الصحيح
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'total_amount')
    ALTER TABLE orders ADD total_amount DECIMAL(10,2) DEFAULT 0;
GO

-- التأكد من وجود عمود customer_name
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'customer_name')
    ALTER TABLE orders ADD customer_name NVARCHAR(100) DEFAULT N'عميل عام';
GO

-- التأكد من وجود عمود phone
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'phone')
    ALTER TABLE orders ADD phone VARCHAR(20) DEFAULT 'غير متوفر';
GO

-- التأكد من وجود عمود address
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'address')
    ALTER TABLE orders ADD address NVARCHAR(255) DEFAULT N'غير محدد';
GO

-- التأكد من وجود عمود notes
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'notes')
    ALTER TABLE orders ADD notes NVARCHAR(MAX) DEFAULT N'';
GO

-- التأكد من وجود عمود status
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('orders') AND name = 'status')
    ALTER TABLE orders ADD status VARCHAR(50) DEFAULT 'pending';
GO

ALTER TABLE orders ALTER COLUMN customer_id INT NULL;


EXEC sp_help 'coupons';

EXEC sp_help 'orders';