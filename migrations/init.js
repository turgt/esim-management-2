const pool = require('../src/config/database');
const bcrypt = require('bcryptjs');

const runMigrations = async () => {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migrations...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        role VARCHAR(20) DEFAULT 'tenant' CHECK (role IN ('admin','tenant')),
        is_active BOOLEAN DEFAULT true,
        daily_esim_limit INTEGER DEFAULT 5 CHECK (daily_esim_limit >= 0),
        max_gb_per_esim INTEGER DEFAULT 20 CHECK (max_gb_per_esim > 0),
        company_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS esim_packages (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        gb_limit INTEGER NOT NULL CHECK (gb_limit > 0 AND gb_limit <= 100),
        country VARCHAR(3) DEFAULT 'TR' NOT NULL,
        validity_days INTEGER DEFAULT 30,
        zendit_transaction_id VARCHAR(100) UNIQUE,
        qr_code_data TEXT,
        activation_code VARCHAR(255),
        sm_dp_address VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','active','expired','cancelled','deleted')),
        data_used_mb INTEGER DEFAULT 0,
        price DECIMAL(10,2),
        currency VARCHAR(3) DEFAULT 'USD',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        activated_at TIMESTAMP,
        deleted_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_usage (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
        esims_created INTEGER DEFAULT 0,
        total_gb_created INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, usage_date)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        esim_id INTEGER REFERENCES esim_packages(id) ON DELETE SET NULL,
        details TEXT,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION update_daily_usage(p_tenant_id INTEGER, p_gb_amount INTEGER)
      RETURNS VOID AS $func$
      BEGIN
        INSERT INTO daily_usage (tenant_id, usage_date, esims_created, total_gb_created)
        VALUES (p_tenant_id, CURRENT_DATE, 1, p_gb_amount)
        ON CONFLICT (tenant_id, usage_date)
        DO UPDATE SET
          esims_created = daily_usage.esims_created + 1,
          total_gb_created = daily_usage.total_gb_created + p_gb_amount;
      END;
      $func$ LANGUAGE plpgsql;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION check_daily_limit(p_tenant_id INTEGER)
      RETURNS JSON AS $func$
      DECLARE
        user_limit INTEGER;
        today_usage INTEGER;
      BEGIN
        SELECT daily_esim_limit INTO user_limit FROM users WHERE id=p_tenant_id AND is_active=true;
        IF user_limit IS NULL THEN
          RETURN json_build_object('allowed',false,'error','User not found');
        END IF;
        SELECT COALESCE(esims_created,0) INTO today_usage FROM daily_usage WHERE tenant_id=p_tenant_id AND usage_date=CURRENT_DATE;
        IF today_usage >= user_limit THEN
          RETURN json_build_object('allowed',false,'error','Daily limit reached','limit',user_limit,'used',today_usage);
        ELSE
          RETURN json_build_object('allowed',true,'limit',user_limit,'used',today_usage,'remaining',user_limit-today_usage);
        END IF;
      END;
      $func$ LANGUAGE plpgsql;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION get_system_stats()
      RETURNS JSON AS $func$
      DECLARE stats JSON;
      BEGIN
        SELECT json_build_object(
          'total_tenants',(SELECT COUNT(*) FROM users WHERE role='tenant' AND is_active=true),
          'total_esims',(SELECT COUNT(*) FROM esim_packages WHERE status!='deleted'),
          'active_esims',(SELECT COUNT(*) FROM esim_packages WHERE status='active'),
          'expired_esims',(SELECT COUNT(*) FROM esim_packages WHERE status='expired'),
          'today_esims',(SELECT COALESCE(SUM(esims_created),0) FROM daily_usage WHERE usage_date=CURRENT_DATE),
          'total_gb_created',(SELECT COALESCE(SUM(gb_limit),0) FROM esim_packages WHERE status!='deleted'),
          'turkey_esims',(SELECT COUNT(*) FROM esim_packages WHERE country='TR' AND status!='deleted')
        ) INTO stats;
        RETURN stats;
      END;
      $func$ LANGUAGE plpgsql;
    `);

    const admin = await client.query(`SELECT id FROM users WHERE username='admin'`);
    if (admin.rows.length===0) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123',10);
      await client.query(
        'INSERT INTO users(username,password_hash,role,daily_esim_limit,company_name) VALUES ($1,$2,$3,$4,$5)',
        ['admin',hashedPassword,'admin',999,'System Admin']
      );
      console.log('✅ Admin user created');
    }

    console.log('✅ Migrations completed');
  } catch (err) {
    console.error('❌ Migration error:',err);
  } finally {
    client.release();
    process.exit(0);
  }
};

runMigrations();
