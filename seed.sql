-- 本地开发默认管理员：用户名 admin / 密码 admin123
-- 生产环境请删除此种子，在 Dashboard 中设置 ADMIN_BOOTSTRAP 后自行注册
INSERT OR IGNORE INTO users (username, password_hash, role)
VALUES (
  'admin',
  '$2a$10$jtyJk7R5bV4Jn/34fzCxQu4btnRuquFr70Lyp2KC7yCmpLFwV6BSy',
  'admin'
);
